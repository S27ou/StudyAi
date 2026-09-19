import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY is missing. Add it to .env before starting the server.');
}

const openai = new OpenAI();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('يسمح برفع ملفات الصور فقط.'));
  }
});

app.use(express.static(__dirname));

function cleanJsonText(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function safeStudy(data) {
  const result = {
    summary: String(data?.summary || ''),
    explanation: String(data?.explanation || ''),
    important_points: Array.isArray(data?.important_points) ? data.important_points.map(String).slice(0, 12) : [],
    key_terms: Array.isArray(data?.key_terms) ? data.key_terms.map(String).slice(0, 20) : [],
    quiz: Array.isArray(data?.quiz) ? data.quiz.slice(0, 20).map(q => ({
      type: q?.type === 'choice' ? 'choice' : 'written',
      question: String(q?.question || ''),
      options: q?.type === 'choice' && Array.isArray(q?.options) ? q.options.map(String).slice(0, 4) : [],
      answer: String(q?.answer || ''),
      accepted_answers: Array.isArray(q?.accepted_answers) ? q.accepted_answers.map(String).slice(0, 5) : []
    })).filter(q => q.question && q.answer) : []
  };
  return result;
}

app.post('/api/analyze', upload.array('images', 20), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'مفتاح OPENAI_API_KEY غير موجود داخل ملف .env' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: 'ارفع صورة واحدة على الأقل.' });
    }

    const imageContents = req.files.map((file) => ({
      type: 'input_image',
      detail: 'auto',
      image_url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
    }));

    const instructions = `
أنت مساعد دراسي عربي دقيق جدًا. حلّل صفحات الدرس الموجودة في الصور كما هي، وافهم النص والعناوين والجداول والنقاط والتعريفات والأمثلة. لا تخترع معلومات غير موجودة في الصور، وإذا كانت معلومة غير واضحة لا تتوقعها.

أريد الناتج باللغة العربية وبأسلوب طالب يفهم بسرعة.
- summary: ملخص مركز لأهم المعلومات فقط، وليس نسخًا طويلًا للنص.
- explanation: شرح مبسط جدًا للفكرة، وكأنك تشرحها لطالب، مع ربط الأفكار ببعضها.
- important_points: أهم النقاط التي يجب حفظها، ويفضل أن تتضمن التعريفات والأسماء والمراحل والأسباب والنتائج والأرقام إن وجدت.
- key_terms: مصطلحات وأسماء مهمة من الدرس.
- quiz: 10 أسئلة على الأقل و15 كحد أقصى من محتوى الصور. اجعل الاختبار متنوعًا: تقريبًا نصفه كتابي ونصفه اختياري. صياغة الأسئلة يجب أن تكون طبيعية ومباشرة من محتوى الدرس، مثل "ما اسم مرحلة الرشد المبكر؟" وليس "ما هو المصطلح؟".
في الأسئلة الاختيارية: options تحتوي 4 خيارات، answer يكون الخيار الصحيح.
في الأسئلة الكتابية: answer إجابة قصيرة ودقيقة، وaccepted_answers إجابات بديلة مقبولة عند الإمكان.

أعد JSON فقط بالشكل التالي:
{
  "summary": "نص الملخص",
  "explanation": "نص الشرح",
  "important_points": ["نقطة 1", "نقطة 2"],
  "key_terms": ["مصطلح 1", "مصطلح 2"],
  "quiz": [
    {
      "type": "choice",
      "question": "السؤال",
      "options": ["أ", "ب", "ج", "د"],
      "answer": "الإجابة الصحيحة",
      "accepted_answers": []
    },
    {
      "type": "written",
      "question": "السؤال",
      "options": [],
      "answer": "الإجابة",
      "accepted_answers": ["إجابة بديلة"]
    }
  ]
}
`;

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'هذه صفحات درس. افهمها ثم أنشئ الملخص والشرح والمعلومات المهمة والاختبار حسب التعليمات.' },
          ...imageContents
        ]
      }
    ]
    });

    const parsed = JSON.parse(cleanJsonText(response.output_text));
    res.json(safeStudy(parsed));
  } catch (err) {
    console.error(err);
    let message = 'حدث خطأ أثناء تحليل الدرس.';
    if (err?.status === 401) message = 'مفتاح API غير صحيح أو غير صالح.';
    else if (err?.status === 429) message = 'تم تجاوز حد الطلبات أو الرصيد المتاح. تحقق من حساب API.';
    else if (err?.code === 'LIMIT_FILE_SIZE') message = 'إحدى الصور أكبر من 10MB.';
    else if (err?.message) message = err.message;
    res.status(500).json({ error: message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'حدث خطأ في رفع الملفات.' });
});

app.listen(PORT, () => {
  console.log(`\n✅ Study AI يعمل على: http://localhost:${PORT}`);
  console.log('اضغط Ctrl+C لإيقاف السيرفر.\n');
});
