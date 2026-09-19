import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY غير موجود في Environment Variables.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// =====================================================
// Multer
// =====================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(
        new Error("يمكن رفع الصور فقط.")
      );
    }

    cb(null, true);
  }
});


// =====================================================
// Static files
// =====================================================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


// =====================================================
// تعليمات الذكاء الاصطناعي
// =====================================================

const instructions = `
أنت مساعد دراسة ذكي متخصص في فهم الدروس من الصور.

المستخدم سيرسل صورة أو عدة صور لدرس مدرسي.

مهمتك ليست مجرد استخراج النص OCR.

يجب أن تفهم محتوى الصور وسياق الدرس والعناوين والجداول والأمثلة والقوانين والتعاريف.

اقرأ جميع الصور معًا وكأنها صفحات متتابعة من نفس الدرس.

قواعد مهمة جدًا:

1. اعتمد فقط على المعلومات الموجودة فعليًا في الصور.
2. لا تخترع معلومات غير موجودة في الدرس.
3. إذا كانت معلومة غير واضحة، لا تخمنها.
4. اجعل الملخص مركزًا على المعلومات المهمة للاختبار.
5. اشرح الدرس بلغة عربية بسيطة وسهلة للطالب.
6. استخرج أهم النقاط التي يجب حفظها وفهمها.
7. استخرج المصطلحات المهمة.
8. استخرج التعاريف الموجودة فعليًا في الدرس.
9. استخرج القوانين والمعادلات الموجودة فعليًا في الدرس.
10. إذا لم توجد قوانين أو معادلات، اجعل laws مصفوفة فارغة.
11. إذا لم توجد تعاريف واضحة، اجعل definitions مصفوفة فارغة.

بالنسبة للاختبار:

أنشئ اختبارًا مختلطًا من أسئلة مناسبة للدرس.

استخدم الأنواع التالية:

- choice = اختيار من متعدد
- truefalse = صح أو خطأ
- written = سؤال كتابي

لا تجعل كل الأسئلة من نوع واحد.

اجعل الأسئلة تشبه أسئلة الاختبارات المدرسية الحقيقية.

تجنب الأسئلة السطحية مثل:
"ما المصطلح؟"
إلا إذا كان هذا فعلًا مناسبًا لمحتوى الدرس.

يفضل استخدام أسئلة مثل:
- علل...
- اذكر...
- قارن...
- ماذا يحدث إذا...
- أي العبارات التالية صحيحة...
- احسب...
- استنتج...
- وضح...
- ما السبب...
- ما النتيجة...

إذا كان الدرس يحتوي على قوانين، أنشئ بعض الأسئلة التي تختبر فهم القانون أو استخدامه، وليس حفظ اسمه فقط.

أسئلة الاختيار من متعدد:
- 4 خيارات بالضبط.
- إجابة واحدة صحيحة.
- answer يجب أن تكون مطابقة تمامًا لأحد الخيارات.

أسئلة صح وخطأ:
- options يجب أن تكون ["صح","خطأ"].
- answer يجب أن تكون "صح" أو "خطأ".

الأسئلة الكتابية:
- answer تكون إجابة نموذجية قصيرة وواضحة.
- accepted_answers تحتوي على إجابات بديلة صحيحة إن وجدت.

أنشئ تقريبًا 10 إلى 15 سؤالًا إذا كان محتوى الصور يسمح بذلك.

أخرج النتيجة بصيغة JSON فقط.

لا تضع Markdown.
لا تضع ```json.
لا تكتب أي كلام قبل JSON أو بعده.

الصيغة المطلوبة:

{
  "summary": "ملخص الدرس",
  "explanation": "شرح مبسط للدرس",
  "important_points": [
    "نقطة مهمة",
    "نقطة مهمة"
  ],
  "key_terms": [
    "مصطلح",
    "مصطلح"
  ],
  "definitions": [
    {
      "term": "المصطلح",
      "definition": "تعريف المصطلح"
    }
  ],
  "laws": [
    {
      "title": "اسم القانون",
      "formula": "القانون أو المعادلة",
      "explanation": "شرح مختصر للقانون"
    }
  ],
  "quiz": [
    {
      "type": "choice",
      "question": "نص السؤال",
      "options": [
        "الخيار الأول",
        "الخيار الثاني",
        "الخيار الثالث",
        "الخيار الرابع"
      ],
      "answer": "الخيار الصحيح",
      "accepted_answers": []
    },
    {
      "type": "truefalse",
      "question": "نص العبارة",
      "options": [
        "صح",
        "خطأ"
      ],
      "answer": "صح",
      "accepted_answers": []
    },
    {
      "type": "written",
      "question": "نص السؤال الكتابي",
      "options": [],
      "answer": "الإجابة النموذجية",
      "accepted_answers": [
        "إجابة بديلة صحيحة"
      ]
    }
  ]
}
`;


// =====================================================
// API
// =====================================================

app.post(
  "/api/analyze",
  upload.array("images", 20),
  async (req, res) => {

    try {

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          error:
            "مفتاح OpenAI غير موجود. أضف OPENAI_API_KEY في Environment Variables."
        });
      }


      // -----------------------------------------------
      // التأكد من وجود الصور
      // -----------------------------------------------

      if (!req.files || !req.files.length) {
        return res.status(400).json({
          error: "لم يتم رفع أي صورة."
        });
      }


      // -----------------------------------------------
      // تحويل الصور إلى input_image
      // -----------------------------------------------

      const imageContents = req.files.map(file => {

        const base64 =
          file.buffer.toString("base64");

        const dataUrl =
          `data:${file.mimetype};base64,${base64}`;

        return {
          type: "input_image",
          image_url: dataUrl,
          detail: "high"
        };
      });


      // -----------------------------------------------
      // طلب التحليل
      // -----------------------------------------------

      const response =
        await openai.responses.create({

          model:
            process.env.OPENAI_MODEL ||
            "gpt-5.6-luna",

          instructions,

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",

                  text:
                    `
حلل جميع صور الدرس المرفقة.

أريد منك فهم محتوى الدرس كاملًا وليس مجرد نسخ النص.

استخرج:
- الملخص
- الشرح المبسط
- أهم النقاط
- المصطلحات
- التعاريف
- القوانين والمعادلات
- اختبار مختلط

انتبه إلى ترتيب الصور، فقد تكون الصفحات متتابعة.
                    `.trim()
                },

                ...imageContents
              ]
            }
          ]
        });


      // -----------------------------------------------
      // استخراج النص
      // -----------------------------------------------

      let output =
        response.output_text || "";

      output = output.trim();


      // -----------------------------------------------
      // تنظيف JSON
      // -----------------------------------------------

      output = cleanJsonText(output);


      let data;

      try {

        data = JSON.parse(output);

      } catch (parseError) {

        console.error(
          "❌ فشل تحويل رد الذكاء الاصطناعي إلى JSON:"
        );

        console.error(output);

        return res.status(500).json({
          error:
            "الذكاء الاصطناعي أعاد نتيجة غير صالحة. حاول مرة أخرى."
        });
      }


      // -----------------------------------------------
      // تنظيف النتيجة
      // -----------------------------------------------

      const safeData =
        normalizeStudyData(data);


      return res.json(safeData);

    } catch (error) {

      console.error("❌ API ERROR:");
      console.error(error);

      let message =
        "حدث خطأ أثناء تحليل الصور.";

      if (error?.message) {
        message = error.message;
      }

      return res.status(500).json({
        error: message
      });
    }
  }
);


// =====================================================
// تنظيف JSON
// =====================================================

function cleanJsonText(text) {

  let result = String(text || "").trim();


  // إزالة ```json
  result = result.replace(
    /^```json\s*/i,
    ""
  );

  // إزالة ```
  result = result.replace(
    /^```\s*/i,
    ""
  );

  result = result.replace(
    /\s*```$/i,
    ""
  );

  result = result.trim();


  // إذا كان هناك كلام حول JSON
  // نحاول استخراج أول object
  if (!result.startsWith("{")) {

    const first =
      result.indexOf("{");

    const last =
      result.lastIndexOf("}");

    if (
      first !== -1 &&
      last !== -1 &&
      last > first
    ) {
      result =
        result.slice(first, last + 1);
    }
  }


  return result.trim();
}


// =====================================================
// Normalize study data
// =====================================================

function normalizeStudyData(data) {

  const result = {

    summary:
      typeof data?.summary === "string"
        ? data.summary.trim()
        : "",

    explanation:
      typeof data?.explanation === "string"
        ? data.explanation.trim()
        : "",

    important_points:
      Array.isArray(data?.important_points)
        ? data.important_points
            .filter(item => typeof item === "string")
            .map(item => item.trim())
            .filter(Boolean)
        : [],

    key_terms:
      Array.isArray(data?.key_terms)
        ? normalizeKeyTerms(data.key_terms)
        : [],

    definitions:
      Array.isArray(data?.definitions)
        ? normalizeDefinitions(data.definitions)
        : [],

    laws:
      Array.isArray(data?.laws)
        ? normalizeLaws(data.laws)
        : [],

    quiz:
      Array.isArray(data?.quiz)
        ? normalizeQuiz(data.quiz)
        : []
  };


  return result;
}


// =====================================================
// Key terms
// =====================================================

function normalizeKeyTerms(terms) {

  return terms
    .map(term => {

      if (typeof term === "string") {
        return term.trim();
      }

      if (
        term &&
        typeof term === "object"
      ) {
        return {
          term:
            typeof term.term === "string"
              ? term.term.trim()
              : typeof term.name === "string"
                ? term.name.trim()
                : ""
        };
      }

      return "";

    })
    .filter(item => {

      if (typeof item === "string") {
        return item.length > 0;
      }

      return item?.term;
    });
}


// =====================================================
// Definitions
// =====================================================

function normalizeDefinitions(definitions) {

  return definitions
    .map(item => {

      if (!item || typeof item !== "object") {
        return null;
      }

      return {
        term:
          typeof item.term === "string"
            ? item.term.trim()
            : "",

        definition:
          typeof item.definition === "string"
            ? item.definition.trim()
            : ""
      };

    })
    .filter(item =>
      item &&
      item.term &&
      item.definition
    );
}


// =====================================================
// Laws
// =====================================================

function normalizeLaws(laws) {

  return laws
    .map(item => {

      if (!item || typeof item !== "object") {
        return null;
      }

      return {
        title:
          typeof item.title === "string"
            ? item.title.trim()
            : "",

        formula:
          typeof item.formula === "string"
            ? item.formula.trim()
            : "",

        explanation:
          typeof item.explanation === "string"
            ? item.explanation.trim()
            : ""
      };

    })
    .filter(item =>
      item &&
      (
        item.title ||
        item.formula ||
        item.explanation
      )
    );
}


// =====================================================
// Quiz
// =====================================================

function normalizeQuiz(quiz) {

  return quiz
    .map(item => {

      if (!item || typeof item !== "object") {
        return null;
      }


      let type =
        typeof item.type === "string"
          ? item.type.trim().toLowerCase()
          : "written";


      if (
        type !== "choice" &&
        type !== "truefalse" &&
        type !== "written"
      ) {
        type = "written";
      }


      let options =
        Array.isArray(item.options)
          ? item.options
              .filter(option =>
                typeof option === "string"
              )
              .map(option =>
                option.trim()
              )
              .filter(Boolean)
          : [];


      if (type === "truefalse") {

        options = [
          "صح",
          "خطأ"
        ];
      }


      if (type === "choice") {

        options =
          options.slice(0, 4);

      }


      let answer =
        typeof item.answer === "string"
          ? item.answer.trim()
          : "";


      let acceptedAnswers =
        Array.isArray(item.accepted_answers)
          ? item.accepted_answers
              .filter(answer =>
                typeof answer === "string"
              )
              .map(answer =>
                answer.trim()
              )
              .filter(Boolean)
          : [];


      return {

        type,

        question:
          typeof item.question === "string"
            ? item.question.trim()
            : "",

        options,

        answer,

        accepted_answers:
          acceptedAnswers
      };

    })
    .filter(item =>
      item &&
      item.question &&
      item.answer
    );
}


// =====================================================
// Error handling for Multer
// =====================================================

app.use((error, req, res, next) => {

  if (error instanceof multer.MulterError) {

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error:
          "حجم الصورة كبير جدًا. الحد الأقصى 10MB للصورة."
      });
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        error:
          "يمكن رفع 20 صورة كحد أقصى."
      });
    }

    return res.status(400).json({
      error: error.message
    });
  }


  if (error) {

    return res.status(400).json({
      error: error.message ||
        "حدث خطأ."
    });
  }


  next();
});


// =====================================================
// تشغيل السيرفر
// =====================================================

app.listen(PORT, () => {

  console.log(
    `Study AI يعمل على المنفذ ${PORT}`
  );

});
