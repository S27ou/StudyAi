import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const PORT = process.env.PORT || 3001;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();

const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   EXPRESS
===================================================== */

app.use(
  express.json({
    limit: "30mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "30mb"
  })
);

app.use(express.static(__dirname));

/* =====================================================
   رفع الصور
===================================================== */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 8 * 1024 * 1024
  }
});

/* =====================================================
   الصفحة الرئيسية
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "Study AI",
    model: GEMINI_MODEL,
    geminiKey: Boolean(GEMINI_API_KEY)
  });
});

/* =====================================================
   استخراج النص من Gemini
===================================================== */

function getGeminiText(result) {
  if (!result) {
    return "";
  }

  /* الطريقة الأساسية */
  if (
    typeof result.output_text === "string" &&
    result.output_text.trim()
  ) {
    return result.output_text.trim();
  }

  /* outputs */
  if (Array.isArray(result.outputs)) {
    for (const output of result.outputs) {
      if (
        typeof output?.text === "string" &&
        output.text.trim()
      ) {
        return output.text.trim();
      }

      if (Array.isArray(output?.content)) {
        const text = output.content
          .filter(
            item => item?.type === "text"
          )
          .map(
            item => item?.text || ""
          )
          .join("")
          .trim();

        if (text) {
          return text;
        }
      }
    }
  }

  /* steps */
  if (Array.isArray(result.steps)) {
    for (const step of result.steps) {
      if (
        step?.type !== "model_output"
      ) {
        continue;
      }

      if (
        typeof step?.text === "string" &&
        step.text.trim()
      ) {
        return step.text.trim();
      }

      if (Array.isArray(step?.content)) {
        const text = step.content
          .filter(
            item => item?.type === "text"
          )
          .map(
            item => item?.text || ""
          )
          .join("")
          .trim();

        if (text) {
          return text;
        }
      }
    }
  }

  return "";
}

/* =====================================================
   تنظيف JSON
===================================================== */

function parseGeminiJSON(text) {
  if (!text) {
    throw new Error(
      "Gemini لم يرجع أي نص."
    );
  }

  let clean = String(text).trim();

  /* إزالة ```json */
  clean = clean
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  /* محاولة مباشرة */
  try {
    return JSON.parse(clean);
  } catch {}

  /* البحث عن أول { وآخر } */
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");

  if (
    start !== -1 &&
    end !== -1 &&
    end > start
  ) {
    const possibleJSON =
      clean.slice(
        start,
        end + 1
      );

    try {
      return JSON.parse(
        possibleJSON
      );
    } catch {}
  }

  throw new Error(
    "Gemini أرسل نتيجة ليست JSON صالحة."
  );
}

/* =====================================================
   استدعاء Gemini
===================================================== */

async function callGemini({
  input,
  systemInstruction = "",
  responseFormat = null,
  timeoutMs = 120000
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY غير موجود في ملف .env"
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  try {
    const body = {
      model: GEMINI_MODEL,

      input,

      store: false
    };

    if (
      systemInstruction &&
      systemInstruction.trim()
    ) {
      body.system_instruction =
        systemInstruction;
    }

    if (responseFormat) {
      body.response_format =
        responseFormat;
    }

    console.log(
      "========================================"
    );

    console.log(
      "GEMINI REQUEST"
    );

    console.log(
      "Model:",
      GEMINI_MODEL
    );

    console.log(
      "========================================"
    );

    const response =
      await fetch(
        GEMINI_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              GEMINI_API_KEY
          },

          body:
            JSON.stringify(body),

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let result = null;

    try {
      result =
        JSON.parse(raw);
    } catch {
      result = null;
    }

    console.log(
      "Gemini HTTP:",
      response.status
    );

    console.log(
      "Gemini status:",
      result?.status
    );

    if (!response.ok) {
      const message =
        result?.error?.message ||
        raw ||
        `HTTP ${response.status}`;

      console.error(
        "Gemini ERROR:",
        message
      );

      throw new Error(
        `Gemini API: ${message}`
      );
    }

    const text =
      getGeminiText(result);

    if (!text) {
      console.error(
        "لم يتم العثور على النص."
      );

      console.error(
        "Gemini full response:"
      );

      console.error(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      throw new Error(
        "Gemini رجع نتيجة بدون نص."
      );
    }

    console.log(
      "Gemini returned text ✅"
    );

    console.log(
      "Text length:",
      text.length
    );

    return {
      text,
      interactionId:
        result?.id || null,
      raw: result
    };

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "انتهى وقت انتظار Gemini. حاول مرة أخرى."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

/* =====================================================
   JSON SCHEMA
===================================================== */

const lessonSchema = {

  type: "object",

  properties: {

    title: {
      type: "string"
    },

    summary: {
      type: "string"
    },

    explanation: {
      type: "string"
    },

    important_points: {
      type: "array",

      items: {
        type: "string"
      }
    },

    key_terms: {
      type: "array",

      items: {
        type: "string"
      }
    },

    definitions: {

      type: "array",

      items: {

        type: "object",

        properties: {

          term: {
            type: "string"
          },

          definition: {
            type: "string"
          }

        },

        required: [
          "term",
          "definition"
        ],

        additionalProperties: false
      }
    },

    laws: {

      type: "array",

      items: {

        type: "object",

        properties: {

          name: {
            type: "string"
          },

          formula: {
            type: "string"
          },

          explanation: {
            type: "string"
          }

        },

        required: [
          "name",
          "formula",
          "explanation"
        ],

        additionalProperties: false
      }
    },

    quiz: {

      type: "array",

      items: {

        type: "object",

        properties: {

          type: {
            type: "string",

            enum: [
              "written",
              "multiple",
              "true_false"
            ]
          },

          question: {
            type: "string"
          },

          options: {

            type: "array",

            items: {
              type: "string"
            }
          },

          answer: {
            type: "string"
          }

        },

        required: [
          "type",
          "question",
          "options",
          "answer"
        ],

        additionalProperties: false
      }
    }

  },

  required: [
    "title",
    "summary",
    "explanation",
    "important_points",
    "key_terms",
    "definitions",
    "laws",
    "quiz"
  ],

  additionalProperties: false
};

/* =====================================================
   تحليل الدرس
===================================================== */

app.post(
  "/api/analyze",

  upload.array(
    "images",
    20
  ),

  async (req, res) => {

    try {

      console.log(
        "\n========================================"
      );

      console.log(
        "ANALYZE REQUEST"
      );

      console.log(
        "========================================"
      );

      if (!GEMINI_API_KEY) {

        return res
          .status(500)
          .json({

            success: false,

            error:
              "GEMINI_API_KEY غير موجود في ملف .env"

          });
      }

      const files =
        req.files || [];

      console.log(
        "عدد الصور:",
        files.length
      );

      if (!files.length) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "لم يتم إرسال أي صورة."

          });
      }

      const totalSize =
        files.reduce(
          (total, file) =>
            total + file.size,
          0
        );

      console.log(
        "حجم الصور:",
        Math.round(
          totalSize /
          1024 /
          1024 *
          100
        ) / 100,
        "MB"
      );

      if (
        totalSize >
        14 * 1024 * 1024
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "حجم الصور كبير جدًا. حاول رفع عدد أقل من الصور."

          });
      }

      /* =====================================
         بناء المدخلات
      ===================================== */

      const input = [];

      input.push({

        type: "text",

        text: `
أنت الآن تقوم بتحليل درس مدرسي من عدة صور.

حلل جميع الصور المرفقة على أنها صفحات من نفس الدرس.

اقرأ النص الموجود في الصور بدقة شديدة.

إذا كانت هناك عدة صفحات، اربط المعلومات الموجودة بينها.

المطلوب منك إنشاء تحليل دراسي كامل باللغة العربية.

أخرج:

1. عنوان الدرس.

2. ملخص الدرس:
ملخص واضح ومفيد وليس مجرد نسخ للنص.

3. الشرح المبسط:
اشرح الدرس بطريقة سهلة يفهمها الطالب.

4. أهم النقاط:
استخرج أهم الأفكار التي يجب على الطالب حفظها وفهمها.

5. المصطلحات المهمة:
استخرج المصطلحات الأساسية الموجودة في الدرس.

6. التعاريف:
استخرج التعريفات الموجودة في الصور.

7. القوانين والمعادلات:
استخرج القوانين والمعادلات الموجودة في الصور.
إذا لم توجد قوانين، اجعل القائمة فارغة.

8. الاختبار:
أنشئ اختبارًا من محتوى الدرس فقط.

يجب أن يكون الاختبار متنوعًا:

- أسئلة كتابية.
- أسئلة اختيار من متعدد.
- أسئلة صح وخطأ.

اجعل الأسئلة طبيعية وتشبه الاختبارات المدرسية الحقيقية.

لا تستخدم أسئلة ركيكة مثل:
"ما هو المصطلح؟"

اكتب أسئلة طبيعية مثل:
"ما اسم المرحلة التي تحدث فيها ...؟"

لأسئلة الاختيار من متعدد:
ضع 4 خيارات.

لأسئلة صح وخطأ:
ضع الخيارين:
صح
خطأ

للأسئلة الكتابية:
اجعل options مصفوفة فارغة.

مهم جدًا:

لا تخترع معلومات غير موجودة في الصور.

إذا لم تجد تعريفًا واضحًا:
لا تخترع تعريفًا.

إذا لم تجد قانونًا:
اجعل laws فارغة.

إذا كانت الصورة غير واضحة:
لا تخمن.

إذا وجدت جدولًا أو مخططًا:
حاول فهمه واستخدم معلوماته.

أنشئ على الأقل 10 أسئلة في الاختبار إذا كان محتوى الدرس يسمح بذلك.

النتيجة يجب أن تكون باللغة العربية.

التزم تمامًا بالـ JSON Schema.
`
      });

      /* =====================================
         إضافة الصور
      ===================================== */

      for (const file of files) {

        console.log(
          "إضافة صورة:",
          file.originalname,
          file.mimetype,
          file.size
        );

        input.push({

          type: "image",

          mime_type:
            file.mimetype ||
            "image/jpeg",

          data:
            file.buffer.toString(
              "base64"
            )

        });
      }

      /* =====================================
         System Instruction
      ===================================== */

      const systemInstruction = `
أنت Study AI.

أنت مساعد دراسي متخصص في تحليل صور الكتب والدروس المدرسية.

اقرأ الصور أولًا.

افهم محتوى الدرس.

ثم استخرج المعلومات المهمة.

يجب أن تكون جميع المعلومات مبنية على الصور المرسلة.

لا تخترع معلومات.

اكتب باللغة العربية.

أنشئ ملخصًا وشرحًا مبسطًا ونقاطًا مهمة ومصطلحات وتعريفات وقوانين واختبارًا.

الاختبار يجب أن يكون متنوعًا:
كتابي + اختيار من متعدد + صح وخطأ.

اجعل الأسئلة مشابهة لأسئلة الاختبارات المدرسية الحقيقية.

التزم بالـ JSON Schema حرفيًا.
`;

      /* =====================================
         Gemini
      ===================================== */

      const result =
        await callGemini({

          input,

          systemInstruction,

          responseFormat: {

            type: "text",

            mime_type:
              "application/json",

            schema:
              lessonSchema
          },

          timeoutMs: 120000
        });

      console.log(
        "تم استلام نتيجة Gemini ✅"
      );

      /* =====================================
         تحويل JSON
      ===================================== */

      let data;

      try {

        data =
          parseGeminiJSON(
            result.text
          );

      } catch (error) {

        console.error(
          "فشل تحويل JSON:"
        );

        console.error(
          result.text
        );

        throw error;
      }

      /* =====================================
         حماية البيانات
      ===================================== */

      if (
        typeof data !==
        "object" ||
        data === null
      ) {

        throw new Error(
          "نتيجة Gemini ليست كائن JSON."
        );
      }

      data.title =
        String(
          data.title ||
          "تحليل الدرس"
        );

      data.summary =
        String(
          data.summary ||
          ""
        );

      data.explanation =
        String(
          data.explanation ||
          ""
        );

      data.important_points =
        Array.isArray(
          data.important_points
        )
          ? data.important_points
          : [];

      data.key_terms =
        Array.isArray(
          data.key_terms
        )
          ? data.key_terms
          : [];

      data.definitions =
        Array.isArray(
          data.definitions
        )
          ? data.definitions
          : [];

      data.laws =
        Array.isArray(
          data.laws
        )
          ? data.laws
          : [];

      data.quiz =
        Array.isArray(
          data.quiz
        )
          ? data.quiz
          : [];

      console.log(
        "========================================"
      );

      console.log(
        "ANALYSIS RESULT"
      );

      console.log(
        "Title:",
        data.title
      );

      console.log(
        "Summary:",
        data.summary.length,
        "characters"
      );

      console.log(
        "Important points:",
        data.important_points.length
      );

      console.log(
        "Terms:",
        data.key_terms.length
      );

      console.log(
        "Definitions:",
        data.definitions.length
      );

      console.log(
        "Laws:",
        data.laws.length
      );

      console.log(
        "Quiz:",
        data.quiz.length
      );

      console.log(
        "========================================"
      );

      /* =====================================
         إرسال النتيجة للواجهة
         
         نرسلها بثلاث صيغ للتوافق
         مع index.html القديم والجديد
      ===================================== */

      return res.json({

        success: true,

        data: data,

        analysis: data,

        ...data,

        interactionId:
          result.interactionId
      });

    } catch (error) {

      console.error(
        "\n========================================"
      );

      console.error(
        "ANALYZE ERROR"
      );

      console.error(
        error?.message ||
        error
      );

      console.error(
        "========================================"
      );

      return res
        .status(500)
        .json({

          success: false,

          error:
            error?.message ||
            "حدث خطأ أثناء تحليل الدرس."

        });
    }
  }
);

/* =====================================================
   مساعد الذكاء
===================================================== */

app.post(
  "/api/chat",

  async (req, res) => {

    try {

      const {
        message,
        lesson
      } = req.body || {};

      if (
        !message ||
        !String(
          message
        ).trim()
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "اكتب سؤالك أولًا."

          });
      }

      let lessonText = "";

      if (lesson) {

        lessonText =
          typeof lesson ===
          "string"

            ? lesson

            : JSON.stringify(
                lesson
              );
      }

      const systemInstruction = `
أنت مساعد Study AI.

تحدث مع الطالب باللغة العربية.

أجب بطريقة طبيعية وودودة.

لا تستخدم JSON.

لا تكتب أقواس JSON.

أجب مباشرة عن سؤال الطالب.

إذا كان السؤال متعلقًا بالدرس،
استخدم محتوى الدرس.

إذا لم تكن المعلومة موجودة في الدرس،
قل للطالب إنها غير موجودة في المحتوى المرسل.

إذا طلب الطالب شرحًا:
اشرح خطوة بخطوة.

إذا لم يفهم:
اشرح بطريقة أبسط.

لا تطيل بدون داعٍ.
`;

      const userText = `
سؤال الطالب:

${String(
  message
).trim()}

${
  lessonText
    ? `
محتوى الدرس:

${lessonText}
`
    : ""
}
`;

      const result =
        await callGemini({

          input: userText,

          systemInstruction,

          timeoutMs: 60000
        });

      let answer =
        result.text.trim();

      /* تنظيف JSON لو رجع بالخطأ */

      try {

        const parsed =
          JSON.parse(answer);

        if (
          typeof parsed?.response ===
          "string"
        ) {

          answer =
            parsed.response;

        } else if (
          typeof parsed?.answer ===
          "string"
        ) {

          answer =
            parsed.answer;
        }

      } catch {
        /* الرد طبيعي */
      }

      return res.json({

        success: true,

        answer,

        interactionId:
          result.interactionId
      });

    } catch (error) {

      console.error(
        "Chat Error:",
        error?.message ||
        error
      );

      return res
        .status(500)
        .json({

          success: false,

          error:
            error?.message ||
            "حدث خطأ في مساعد الذكاء."

        });
    }
  }
);

/* =====================================================
   Multer / Server Errors
===================================================== */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    if (
      error instanceof
      multer.MulterError
    ) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            `خطأ في رفع الملفات: ${error.message}`

        });
    }

    if (error) {

      console.error(
        "Server Error:",
        error
      );

      return res
        .status(500)
        .json({

          success: false,

          error:
            error.message ||
            "حدث خطأ في السيرفر."

        });
    }

    next();
  }
);

/* =====================================================
   تشغيل السيرفر
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "          STUDY AI SERVER"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Model: ${GEMINI_MODEL}`
    );

    console.log(
      `API Key: ${
        GEMINI_API_KEY
          ? "موجودة ✅"
          : "غير موجودة ❌"
      }`
    );

    console.log(
      `Website: http://localhost:${PORT}`
    );

    console.log(
      "========================================"
    );
  }
);