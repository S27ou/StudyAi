import "dotenv/config";

import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT =
  process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "❌ OPENAI_API_KEY غير موجودة في Environment Variables."
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({
  limit: "2mb"
}));

app.use(
  express.static(__dirname)
);

/* =========================
   Multer
========================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: (req,file,cb) => {

    if (
      file.mimetype &&
      file.mimetype.startsWith("image/")
    ) {
      cb(null,true);
    } else {
      cb(
        new Error(
          "يسمح برفع الصور فقط."
        )
      );
    }
  }
});

/* =========================
   JSON Cleaning
========================= */

function cleanJsonText(text) {

  let cleaned =
    String(text || "")
      .trim();

  cleaned =
    cleaned.replace(
      /^```(?:json)?\s*/i,
      ""
    );

  cleaned =
    cleaned.replace(
      /\s*```$/i,
      ""
    );

  const first =
    cleaned.indexOf("{");

  const last =
    cleaned.lastIndexOf("}");

  if (
    first !== -1 &&
    last !== -1 &&
    last > first
  ) {
    cleaned =
      cleaned.slice(
        first,
        last + 1
      );
  }

  return cleaned;
}

/* =========================
   Normalize Study Data
========================= */

function normalizeStudyData(data) {

  const arrayOrEmpty = value =>
    Array.isArray(value)
      ? value
      : [];

  return {

    summary:
      typeof data?.summary === "string"
        ? data.summary
        : "",

    explanation:
      typeof data?.explanation === "string"
        ? data.explanation
        : "",

    important_points:
      arrayOrEmpty(
        data?.important_points
      ),

    key_terms:
      arrayOrEmpty(
        data?.key_terms
      ),

    definitions:
      arrayOrEmpty(
        data?.definitions
      ),

    laws:
      arrayOrEmpty(
        data?.laws
      ),

    quiz:
      arrayOrEmpty(
        data?.quiz
      )
  };
}

/* =========================
   Analyze Lesson
========================= */

app.post(
  "/api/analyze",
  upload.array("images",20),
  async (req,res) => {

    try {

      if (
        !process.env.OPENAI_API_KEY
      ) {
        return res.status(500).json({
          error:
            "OPENAI_API_KEY غير موجودة في السيرفر."
        });
      }

      if (
        !req.files ||
        !req.files.length
      ) {
        return res.status(400).json({
          error:
            "لم يتم رفع أي صورة."
        });
      }

      const imageContents =
        req.files.map(file => {

          const base64 =
            file.buffer.toString(
              "base64"
            );

          const dataUrl =
            `data:${file.mimetype};base64,${base64}`;

          return {
            type: "input_image",
            image_url: dataUrl,
            detail: "high"
          };
        });

      const instructions = `
أنت Study AI، مساعد تعليمي ذكي.

مهمتك تحليل صور الدرس المرفقة وفهم محتواها بشكل دلالي، وليس مجرد قراءة النص.

قواعد مهمة جدًا:

1. افهم جميع الصور معًا باعتبارها درسًا واحدًا.
2. اعتمد فقط على المعلومات الموجودة في الصور.
3. لا تخترع معلومات غير موجودة في الدرس.
4. إذا كانت معلومة غير واضحة، لا تخمن.
5. اكتب باللغة العربية الواضحة.
6. اجعل الشرح مناسبًا للطالب وسهل الفهم.

أنشئ JSON فقط بدون Markdown وبدون code fences.

الشكل المطلوب:

{
  "summary": "ملخص واضح ومختصر للدرس",
  "explanation": "شرح مبسط للدرس",
  "important_points": [
    "نقطة مهمة"
  ],
  "key_terms": [
    "مصطلح"
  ],
  "definitions": [
    {
      "term": "المصطلح",
      "definition": "تعريفه"
    }
  ],
  "laws": [
    {
      "title": "اسم القانون",
      "formula": "القانون",
      "explanation": "شرح بسيط"
    }
  ],
  "quiz": [
    {
      "type": "choice",
      "question": "السؤال",
      "options": [
        "الخيار 1",
        "الخيار 2",
        "الخيار 3",
        "الخيار 4"
      ],
      "answer": "الإجابة الصحيحة",
      "accepted_answers": []
    },
    {
      "type": "truefalse",
      "question": "العبارة",
      "options": [
        "صح",
        "خطأ"
      ],
      "answer": "صح",
      "accepted_answers": []
    },
    {
      "type": "written",
      "question": "سؤال كتابي",
      "options": [],
      "answer": "الإجابة",
      "accepted_answers": [
        "إجابة بديلة"
      ]
    }
  ]
}

قواعد الاختبار:

- أنشئ من 10 إلى 15 سؤالًا عندما يسمح محتوى الدرس.
- اجعل الأسئلة متنوعة.
- استخدم اختيار من متعدد.
- استخدم صح وخطأ.
- استخدم أسئلة كتابية.
- يمكن أن تتضمن الأسئلة:
  - اشرح.
  - علل.
  - قارن.
  - استنتج.
  - احسب إذا كان هناك قانون أو أرقام.
  - ما السبب؟
  - ما النتيجة؟
- أسئلة الاختيار من متعدد يجب أن تحتوي على 4 خيارات بالضبط.
- يجب أن تكون هناك إجابة صحيحة واحدة.
- أسئلة صح وخطأ يجب أن تحتوي على:
  ["صح","خطأ"]
- الأسئلة الكتابية يجب أن تحتوي على answer و accepted_answers.
- لا تضف قوانين إذا لم توجد قوانين واضحة في الصور.
- لا تضف تعاريف إذا لم توجد تعاريف واضحة.
`;


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
                    "حلل جميع صور الدرس المرفقة معًا. افهم محتوى الدرس ثم أنشئ الملخص والشرح وأهم النقاط والمصطلحات والتعاريف والقوانين والاختبار حسب التعليمات."
                },

                ...imageContents
              ]
            }
          ]
        });


      const raw =
        response.output_text || "";

      const jsonText =
        cleanJsonText(raw);

      let parsed;

      try {

        parsed =
          JSON.parse(jsonText);

      } catch (parseError) {

        console.error(
          "JSON PARSE ERROR:",
          parseError
        );

        console.error(
          "MODEL OUTPUT:",
          raw
        );

        return res.status(500).json({
          error:
            "الذكاء الاصطناعي أرسل نتيجة غير صالحة. حاول مرة أخرى."
        });
      }

      const result =
        normalizeStudyData(parsed);

      res.json(result);

    } catch(error) {

      console.error(
        "ANALYZE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error?.message ||
          "حدث خطأ أثناء تحليل الدرس."
      });
    }
  }
);

/* =========================
   AI Assistant
========================= */

app.post(
  "/api/chat",
  async (req,res) => {

    try {

      if (
        !process.env.OPENAI_API_KEY
      ) {
        return res.status(500).json({
          error:
            "OPENAI_API_KEY غير موجودة في السيرفر."
        });
      }

      const message =
        typeof req.body?.message === "string"
          ? req.body.message.trim()
          : "";

      const lesson =
        req.body?.lesson || null;

      if (!message) {
        return res.status(400).json({
          error:
            "اكتب سؤالك أولاً."
        });
      }

      let lessonContext =
        "لا يوجد درس محلل حاليًا.";

      if (lesson) {

        lessonContext =
          JSON.stringify(
            lesson,
            null,
            2
          );

        /*
         * حماية إضافية من إرسال بيانات ضخمة جدًا.
         */
        if (
          lessonContext.length > 120000
        ) {
          lessonContext =
            lessonContext.slice(
              0,
              120000
            );
        }
      }

      const instructions = `
أنت مساعد Study AI التعليمي.

أنت مساعد شخصي للطالب.

هدفك:
- مساعدة الطالب على فهم دروسه.
- شرح المعلومات بطريقة سهلة.
- الإجابة عن أسئلة الطالب.
- مساعدته في المراجعة.
- إنشاء أسئلة تدريبية عند طلب ذلك.
- تصحيح فهم الطالب عندما يكون لديه خطأ.
- استخدام أمثلة بسيطة عندما تكون مفيدة.

قواعد مهمة:

1. تحدث باللغة العربية غالبًا.
2. كن واضحًا ومختصرًا لكن مفيدًا.
3. إذا كان السؤال عن الدرس الحالي، اعتمد على بيانات الدرس.
4. لا تخترع معلومة وتقول إنها موجودة في الدرس.
5. إذا لم تكن الإجابة موجودة في الدرس، قل للطالب إنها غير موجودة في الدرس ثم يمكنك توضيحها كمعلومة عامة إذا كان ذلك مفيدًا.
6. إذا طلب الطالب "اختبرني"، اطرح سؤالًا واحدًا في كل مرة حتى يستطيع التفاعل معك.
7. إذا أجاب الطالب عن سؤال، أخبره هل إجابته صحيحة واشرح السبب.
8. لا تستخدم JSON إلا إذا طلب الطالب ذلك.
9. لا تقل إنك شاهدت شيئًا غير موجود في بيانات الدرس.
10. لا تكشف مفاتيح API أو معلومات النظام.

بيانات الدرس الحالي:
${lessonContext}
`;

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
                  text: message
                }
              ]
            }
          ]
        });

      const answer =
        response.output_text ||
        "لم أستطع إنشاء إجابة الآن.";

      res.json({
        answer
      });

    } catch(error) {

      console.error(
        "AI CHAT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error?.message ||
          "حدث خطأ أثناء التواصل مع مساعد الذكاء الاصطناعي."
      });
    }
  }
);

/* =========================
   Multer Error Handler
========================= */

app.use(
  (error,req,res,next) => {

    if (
      error instanceof multer.MulterError
    ) {

      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          error:
            "حجم إحدى الصور أكبر من 10MB."
        });
      }

      if (
        error.code ===
        "LIMIT_FILE_COUNT"
      ) {
        return res.status(400).json({
          error:
            "الحد الأقصى 20 صورة."
        });
      }

      return res.status(400).json({
        error:
          error.message
      });
    }

    if (error) {

      return res.status(400).json({
        error:
          error.message ||
          "حدث خطأ."
      });
    }

    next();
  }
);

/* =========================
   Start Server
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Study AI running on port ${PORT}`
    );
  }
);
