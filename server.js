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


// ======================================================
// OpenAI
// ======================================================

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is missing.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// ======================================================
// Multer - رفع الصور
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("يمكن رفع الصور فقط."));
    }

    cb(null, true);
  }
});


// ======================================================
// ملفات الموقع
// ======================================================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ======================================================
// تعليمات الذكاء الاصطناعي
// ======================================================

const instructions = `
أنت Study AI، مساعد دراسة ذكي متخصص في فهم الدروس المدرسية من الصور.

سيتم إرسال صورة واحدة أو عدة صور لصفحات درس.

مهمتك هي فهم محتوى الصور بالكامل، وليس مجرد نسخ النص الموجود فيها.

اقرأ جميع الصور معًا وكأنها صفحات متتابعة من نفس الدرس.

يجب أن تعتمد على المعلومات الموجودة في الصور فقط.

لا تخترع أي معلومة غير موجودة في الدرس.

إذا كانت معلومة غير واضحة فلا تخمنها.

استخرج من الدرس:

1. ملخص واضح ومختصر.
2. شرح مبسط يساعد الطالب على فهم الدرس.
3. أهم النقاط التي يجب التركيز عليها.
4. المصطلحات المهمة.
5. التعاريف الموجودة فعليًا في الدرس.
6. القوانين والمعادلات الموجودة فعليًا في الدرس.
7. اختبار مختلط مبني على محتوى الدرس.

بالنسبة للتعاريف:

استخرج التعاريف الواضحة الموجودة في الدرس فقط.

كل تعريف يجب أن يكون بهذا الشكل:

term = المصطلح
definition = تعريفه

إذا لم توجد تعاريف واضحة، استخدم مصفوفة فارغة.

بالنسبة للقوانين:

استخرج القوانين والمعادلات الموجودة في الدرس فقط.

كل قانون يجب أن يحتوي على:

title = اسم القانون أو موضوعه
formula = القانون أو المعادلة
explanation = شرح بسيط له

إذا لم توجد قوانين أو معادلات، استخدم مصفوفة فارغة.

بالنسبة للاختبار:

أنشئ اختبارًا من 10 إلى 15 سؤالًا عندما يسمح محتوى الدرس بذلك.

اجعل الاختبار متنوعًا.

استخدم:

choice
truefalse
written

أسئلة الاختيار من متعدد يجب أن تحتوي على 4 خيارات.

إجابة واحدة فقط تكون صحيحة.

answer يجب أن تكون مطابقة تمامًا لأحد الخيارات.

أسئلة الصح والخطأ يجب أن تحتوي على:

صح
خطأ

وanswer يجب أن تكون إما:

صح

أو:

خطأ

الأسئلة الكتابية يجب أن تحتوي على إجابة نموذجية قصيرة.

يمكن وضع إجابات بديلة صحيحة في accepted_answers.

اجعل الأسئلة مثل أسئلة الاختبارات المدرسية الحقيقية.

استخدم أسئلة مثل:

علل.
وضح.
اذكر.
قارن.
استنتج.
ما السبب؟
ما النتيجة؟
ماذا يحدث إذا؟
أي العبارات التالية صحيحة؟
احسب.
استخدم القانون.
فسر.

لا تجعل الاختبار كله أسئلة حفظ بسيطة.

إذا كان الدرس يحتوي على قوانين، اجعل بعض الأسئلة تختبر استخدام القانون وفهمه.

لا تستخدم أسئلة غير مرتبطة بمحتوى الصور.

لا تضف معلومات من خارج الدرس.

أعد النتيجة بصيغة JSON فقط.

لا تكتب أي كلام قبل JSON.

لا تكتب أي كلام بعد JSON.

لا تستخدم Markdown داخل النتيجة.

استخدم الشكل التالي:

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
      "definition": "التعريف"
    }
  ],
  "laws": [
    {
      "title": "اسم القانون",
      "formula": "القانون",
      "explanation": "شرح القانون"
    }
  ],
  "quiz": [
    {
      "type": "choice",
      "question": "السؤال",
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
      "question": "السؤال الكتابي",
      "options": [],
      "answer": "الإجابة النموذجية",
      "accepted_answers": [
        "إجابة بديلة صحيحة"
      ]
    }
  ]
}
`;


// ======================================================
// API تحليل الصور
// ======================================================

app.post(
  "/api/analyze",
  upload.array("images", 20),
  async (req, res) => {

    try {

      // -----------------------------------------------
      // التأكد من وجود المفتاح
      // -----------------------------------------------

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          error:
            "OPENAI_API_KEY غير موجود في Environment Variables في Render."
        });
      }


      // -----------------------------------------------
      // التأكد من وجود الصور
      // -----------------------------------------------

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: "لم يتم رفع أي صورة."
        });
      }


      // -----------------------------------------------
      // تحويل الصور إلى Data URLs
      // -----------------------------------------------

      const imageContents = req.files.map((file) => {

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
      // إرسال الصور للذكاء الاصطناعي
      // -----------------------------------------------

      const response = await openai.responses.create({

        model:
          process.env.OPENAI_MODEL ||
          "gpt-5.6-luna",

        instructions: instructions,

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


      // -----------------------------------------------
      // الحصول على نتيجة الذكاء الاصطناعي
      // -----------------------------------------------

      let output =
        response.output_text || "";

      output = output.trim();


      if (!output) {
        return res.status(500).json({
          error:
            "لم يرجع الذكاء الاصطناعي أي نتيجة."
        });
      }


      // -----------------------------------------------
      // تنظيف نتيجة JSON
      // -----------------------------------------------

      output = cleanJsonText(output);


      // -----------------------------------------------
      // تحويل JSON
      // -----------------------------------------------

      let data;

      try {

        data = JSON.parse(output);

      } catch (error) {

        console.error(
          "JSON PARSE ERROR:"
        );

        console.error(output);

        return res.status(500).json({
          error:
            "الذكاء الاصطناعي أرجع نتيجة غير صالحة. حاول مرة أخرى."
        });
      }


      // -----------------------------------------------
      // ترتيب وتنظيف البيانات
      // -----------------------------------------------

      const result =
        normalizeStudyData(data);


      // -----------------------------------------------
      // إرسال النتيجة للموقع
      // -----------------------------------------------

      return res.json(result);

    } catch (error) {

      console.error(
        "ANALYZE ERROR:"
      );

      console.error(error);


      let message =
        "حدث خطأ أثناء تحليل الصور.";


      if (error && error.message) {
        message = error.message;
      }


      return res.status(500).json({
        error: message
      });
    }
  }
);


// ======================================================
// تنظيف JSON
// ======================================================

function cleanJsonText(text) {

  let result =
    String(text || "").trim();


  // إزالة مسافات زائدة
  result =
    result.trim();


  // إذا رجع النموذج JSON داخل علامات code block
  if (result.startsWith("```")) {

    result =
      result.replace(/^```[a-zA-Z]*\s*/, "");

    result =
      result.replace(/\s*```$/, "");

    result =
      result.trim();
  }


  // إذا كان هناك كلام قبل JSON أو بعده
  const firstBrace =
    result.indexOf("{");

  const lastBrace =
    result.lastIndexOf("}");


  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {

    result =
      result.substring(
        firstBrace,
        lastBrace + 1
      );
  }


  return result.trim();
}


// ======================================================
// تنظيف البيانات الرئيسية
// ======================================================

function normalizeStudyData(data) {

  return {

    summary:
      typeof data?.summary === "string"
        ? data.summary.trim()
        : "",


    explanation:
      typeof data?.explanation === "string"
        ? data.explanation.trim()
        : "",


    important_points:
      normalizeStringArray(
        data?.important_points
      ),


    key_terms:
      normalizeKeyTerms(
        data?.key_terms
      ),


    definitions:
      normalizeDefinitions(
        data?.definitions
      ),


    laws:
      normalizeLaws(
        data?.laws
      ),


    quiz:
      normalizeQuiz(
        data?.quiz
      )

  };
}


// ======================================================
// تنظيف Arrays النصوص
// ======================================================

function normalizeStringArray(value) {

  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .filter(item =>
      typeof item === "string"
    )
    .map(item =>
      item.trim()
    )
    .filter(Boolean);
}


// ======================================================
// تنظيف المصطلحات
// ======================================================

function normalizeKeyTerms(value) {

  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .map(item => {

      if (typeof item === "string") {
        return item.trim();
      }


      if (
        item &&
        typeof item === "object"
      ) {

        const term =
          typeof item.term === "string"
            ? item.term
            : typeof item.name === "string"
              ? item.name
              : "";


        return {
          term: term.trim()
        };
      }


      return "";

    })
    .filter(item => {

      if (typeof item === "string") {
        return item.length > 0;
      }


      return Boolean(
        item &&
        item.term
      );
    });
}


// ======================================================
// تنظيف التعاريف
// ======================================================

function normalizeDefinitions(value) {

  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .map(item => {

      if (
        !item ||
        typeof item !== "object"
      ) {
        return null;
      }


      const term =
        typeof item.term === "string"
          ? item.term.trim()
          : "";


      const definition =
        typeof item.definition === "string"
          ? item.definition.trim()
          : "";


      return {
        term,
        definition
      };

    })
    .filter(item =>
      item &&
      item.term &&
      item.definition
    );
}


// ======================================================
// تنظيف القوانين
// ======================================================

function normalizeLaws(value) {

  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .map(item => {

      if (
        !item ||
        typeof item !== "object"
      ) {
        return null;
      }


      const title =
        typeof item.title === "string"
          ? item.title.trim()
          : "";


      const formula =
        typeof item.formula === "string"
          ? item.formula.trim()
          : "";


      const explanation =
        typeof item.explanation === "string"
          ? item.explanation.trim()
          : "";


      return {
        title,
        formula,
        explanation
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


// ======================================================
// تنظيف الاختبار
// ======================================================

function normalizeQuiz(value) {

  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .map(item => {

      if (
        !item ||
        typeof item !== "object"
      ) {
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


      const question =
        typeof item.question === "string"
          ? item.question.trim()
          : "";


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


      const answer =
        typeof item.answer === "string"
          ? item.answer.trim()
          : "";


      const acceptedAnswers =
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

        question,

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


// ======================================================
// معالجة أخطاء Multer
// ======================================================

app.use((error, req, res, next) => {

  if (error instanceof multer.MulterError) {

    if (
      error.code === "LIMIT_FILE_SIZE"
    ) {

      return res.status(400).json({
        error:
          "حجم الصورة أكبر من 10MB."
      });
    }


    if (
      error.code === "LIMIT_FILE_COUNT"
    ) {

      return res.status(400).json({
        error:
          "يمكن رفع 20 صورة كحد أقصى."
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
        "حدث خطأ أثناء رفع الصور."
    });
  }


  next();
});


// ======================================================
// تشغيل السيرفر
// ======================================================

app.listen(PORT, "0.0.0.0", () => {

  console.log(
    `Study AI server running on port ${PORT}`
  );

});
