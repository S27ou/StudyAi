import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3001;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();

const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.7-flash"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const API_REVISION = "2026-05-20";


// ======================================================
// EXPRESS
// ======================================================

app.use(
  express.json({
    limit: "30mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "30mb",
  })
);

app.use(express.static(__dirname));


// ======================================================
// MULTER
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 8 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("يسمح بإرسال الصور فقط."));
    }

    cb(null, true);
  },
});


// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ======================================================
// HEALTH
// ======================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "Study AI",
    model: GEMINI_MODEL,
    fallbackModels: FALLBACK_MODELS,
    geminiKey: Boolean(GEMINI_API_KEY),
    api: "Gemini Interactions API",
    apiRevision: API_REVISION,
  });
});


// ======================================================
// HELPERS
// ======================================================

function fetchWithTimeout(url, options = {}, timeout = 120000) {
  return Promise.race([
    fetch(url, options),

    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("انتهى وقت انتظار Gemini."));
      }, timeout);
    }),
  ]);
}


// ======================================================
// EXTRACT GEMINI TEXT
// ======================================================

function getGeminiText(result) {
  if (!result) return "";

  // Direct output_text
  if (
    typeof result.output_text === "string" &&
    result.output_text.trim()
  ) {
    return result.output_text.trim();
  }

  // New Interactions API steps
  if (Array.isArray(result.steps)) {
    const pieces = [];

    for (const step of result.steps) {
      if (!step) continue;

      if (
        typeof step.text === "string" &&
        step.text.trim()
      ) {
        pieces.push(step.text.trim());
      }

      if (
        typeof step.output_text === "string" &&
        step.output_text.trim()
      ) {
        pieces.push(step.output_text.trim());
      }

      if (Array.isArray(step.content)) {
        for (const item of step.content) {
          if (!item) continue;

          if (
            item.type === "text" &&
            typeof item.text === "string"
          ) {
            pieces.push(item.text);
          }
        }
      }
    }

    if (pieces.length) {
      return pieces.join("\n").trim();
    }
  }

  // Legacy compatibility
  if (Array.isArray(result.outputs)) {
    const pieces = [];

    for (const output of result.outputs) {
      if (!output) continue;

      if (
        typeof output.text === "string" &&
        output.text.trim()
      ) {
        pieces.push(output.text.trim());
      }

      if (Array.isArray(output.content)) {
        for (const item of output.content) {
          if (
            item &&
            typeof item.text === "string"
          ) {
            pieces.push(item.text);
          }
        }
      }
    }

    if (pieces.length) {
      return pieces.join("\n").trim();
    }
  }

  return "";
}


// ======================================================
// PARSE JSON
// ======================================================

function parseGeminiJSON(text) {
  if (!text) return null;

  let cleaned = String(text).trim();

  // Remove markdown fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Direct JSON
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Find first object
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");

  if (firstObject !== -1 && lastObject > firstObject) {
    const possible = cleaned.slice(
      firstObject,
      lastObject + 1
    );

    try {
      return JSON.parse(possible);
    } catch {}
  }

  return null;
}


// ======================================================
// GEMINI REQUEST
// ======================================================

async function callGemini({
  model,
  input,
  systemInstruction = "",
  responseFormat = null,
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY غير موجود في إعدادات Render."
    );
  }

  const body = {
    model,
    input,
  };

  if (systemInstruction) {
    body.system_instruction = systemInstruction;
  }

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  console.log("Gemini request");
  console.log("Model:", model);
  console.log("API Revision:", API_REVISION);
  console.log("Images:", Array.isArray(input) ? input.filter(x => x?.type === "image").length : 0);

  const response = await fetchWithTimeout(
    GEMINI_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
        "Api-Revision": API_REVISION,
      },

      body: JSON.stringify(body),
    },

    180000
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ||
      data?.message ||
      raw ||
      `HTTP ${response.status}`;

    const error = new Error(errorMessage);

    error.status = response.status;
    error.data = data;

    throw error;
  }

  const text = getGeminiText(data);

  if (!text) {
    console.log(
      "Gemini returned no text.",
      JSON.stringify(data).slice(0, 3000)
    );

    throw new Error(
      "Gemini أعاد نتيجة بدون نص قابل للقراءة."
    );
  }

  return {
    text,
    raw: data,
  };
}


// ======================================================
// FALLBACK
// ======================================================

function shouldTryFallback(error) {
  const status = error?.status;

  if (
    [408, 429, 500, 502, 503, 504].includes(status)
  ) {
    return true;
  }

  const message = String(
    error?.message || ""
  ).toLowerCase();

  return (
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("capacity") ||
    message.includes("temporarily")
  );
}


async function callGeminiWithFallback(options) {
  const models = [
    GEMINI_MODEL,
    ...FALLBACK_MODELS,
  ].filter(
    (model, index, array) =>
      model && array.indexOf(model) === index
  );

  let lastError = null;

  for (const model of models) {
    try {
      const result = await callGemini({
        ...options,
        model,
      });

      return {
        ...result,
        modelUsed: model,
      };
    } catch (error) {
      lastError = error;

      console.error(
        `Gemini model failed: ${model}`,
        error.message
      );

      if (!shouldTryFallback(error)) {
        throw error;
      }

      console.log(
        `Trying next model after ${model}...`
      );
    }
  }

  throw lastError || new Error("كل نماذج Gemini فشلت.");
}


// ======================================================
// IMAGE CONVERSION
// ======================================================

function fileToGeminiImage(file) {
  return {
    type: "image",
    mime_type:
      file.mimetype || "image/jpeg",
    data: file.buffer.toString("base64"),
  };
}


// ======================================================
// LESSON SCHEMA
// ======================================================

const lessonSchema = {
  type: "object",

  properties: {
    title: {
      type: "string",
    },

    summary: {
      type: "string",
    },

    explanation: {
      type: "string",
    },

    important_points: {
      type: "array",
      items: {
        type: "string",
      },
    },

    key_terms: {
      type: "array",
      items: {
        type: "string",
      },
    },

    definitions: {
      type: "array",
      items: {
        type: "object",

        properties: {
          term: {
            type: "string",
          },

          definition: {
            type: "string",
          },
        },

        required: [
          "term",
          "definition",
        ],
      },
    },

    laws: {
      type: "array",
      items: {
        type: "string",
      },
    },

    quiz: {
      type: "array",

      items: {
        type: "object",

        properties: {
          question: {
            type: "string",
          },

          type: {
            type: "string",
            enum: [
              "multiple_choice",
              "true_false",
              "written",
            ],
          },

          options: {
            type: "array",

            items: {
              type: "string",
            },
          },

          answer: {
            type: "string",
          },

          explanation: {
            type: "string",
          },
        },

        required: [
          "question",
          "type",
          "answer",
        ],
      },
    },
  },

  required: [
    "title",
    "summary",
    "explanation",
    "important_points",
    "key_terms",
    "definitions",
    "laws",
    "quiz",
  ],
};


// ======================================================
// NORMALIZE LESSON
// ======================================================

function normalizeLesson(data) {
  const result = data || {};

  return {
    title:
      typeof result.title === "string"
        ? result.title
        : "اختبار الدرس",

    summary:
      typeof result.summary === "string"
        ? result.summary
        : "",

    explanation:
      typeof result.explanation === "string"
        ? result.explanation
        : "",

    important_points:
      Array.isArray(result.important_points)
        ? result.important_points.filter(Boolean)
        : [],

    key_terms:
      Array.isArray(result.key_terms)
        ? result.key_terms.filter(Boolean)
        : [],

    definitions:
      Array.isArray(result.definitions)
        ? result.definitions
            .filter(
              (x) =>
                x &&
                typeof x.term === "string" &&
                typeof x.definition === "string"
            )
            .map((x) => ({
              term: x.term,
              definition: x.definition,
            }))
        : [],

    laws:
      Array.isArray(result.laws)
        ? result.laws.filter(Boolean)
        : [],

    quiz:
      Array.isArray(result.quiz)
        ? result.quiz
            .filter(
              (q) =>
                q &&
                typeof q.question === "string" &&
                typeof q.answer === "string"
            )
            .map((q) => ({
              question: q.question,
              type:
                q.type || "multiple_choice",
              options:
                Array.isArray(q.options)
                  ? q.options
                  : [],
              answer: q.answer,
              explanation:
                typeof q.explanation === "string"
                  ? q.explanation
                  : "",
            }))
        : [],
  };
}


// ======================================================
// ANALYZE LESSON IMAGES
// ======================================================

app.post(
  "/api/analyze",
  upload.array("images", 20),
  async (req, res) => {
    try {
      console.log("");
      console.log("==============================");
      console.log("ANALYZE REQUEST");
      console.log("==============================");

      const files = req.files || [];

      console.log(
        "عدد الصور:",
        files.length
      );

      if (!files.length) {
        return res.status(400).json({
          success: false,
          error: "أرسل صورة واحدة على الأقل.",
        });
      }

      let totalSize = 0;

      for (const file of files) {
        totalSize += file.size;
      }

      console.log(
        "حجم الصور:",
        (totalSize / 1024 / 1024).toFixed(2),
        "MB"
      );

      // Inline images have a practical request-size limit.
      if (totalSize > 17 * 1024 * 1024) {
        return res.status(413).json({
          success: false,
          error:
            "حجم الصور كبير جدًا. أرسل عددًا أقل من الصور أو صورًا أصغر.",
        });
      }

      const input = [];

      input.push({
        type: "text",

        text: `
أنت مساعد دراسة ذكي داخل موقع Study AI.

مهمتك قراءة صور صفحات الدرس المرفقة وتحويل محتواها إلى مادة مراجعة واختبار.

قواعد مهمة جدًا:

1. اعتمد فقط على المعلومات الظاهرة والمقروءة في الصور.
2. لا تخترع معلومات غير موجودة في الصور.
3. لا تستخدم معلومات خارجية لإكمال النقص.
4. إذا كانت معلومة غير واضحة، لا تخمنها.
5. اقرأ العناوين والجداول والنقاط والتعريفات والأمثلة والقوانين الظاهرة.
6. استخرج المعلومات التي تبدو مهمة للدراسة والاختبار.
7. أنشئ أسئلة مدرسية طبيعية وليست أسئلة عامة أو مكررة.
8. لا تجعل كل الأسئلة من نوع "ما هو المصطلح؟".
9. نوّع الأسئلة بين:
   - اختيار من متعدد
   - صح أو خطأ
   - أسئلة كتابية
10. اجعل الإجابات مأخوذة من محتوى الصور فقط.
11. إذا لم يوجد قانون أو معادلة في الصور، اترك laws فارغة.
12. إذا لم توجد تعريفات واضحة، اترك definitions فارغة.
13. إذا كانت الصور تحتوي على معلومات كثيرة، ركز على المعلومات الأكثر أهمية للاختبار.
14. لا تقل إنك قرأت شيئًا غير ظاهر في الصور.
15. أجب بالعربية.

أنشئ على الأقل 10 أسئلة إذا كان محتوى الصور يسمح بذلك.
إذا كان محتوى الصور قليلًا، أنشئ عددًا أقل ولكن بجودة أفضل.

لكل سؤال:
- question = السؤال
- type = multiple_choice أو true_false أو written
- options = الخيارات فقط لأسئلة الاختيار من متعدد
- answer = الإجابة الصحيحة
- explanation = شرح قصير للإجابة إذا كان مناسبًا

أعد النتيجة بصيغة JSON المطابقة للمخطط المطلوب.
        `,
      });

      for (const file of files) {
        input.push(
          fileToGeminiImage(file)
        );
      }

      const result =
        await callGeminiWithFallback({
          input,

          systemInstruction:
            "أنت مساعد دراسة عربي دقيق. لا تخترع أي معلومة غير موجودة في الصور. اجعل الاختبار مستندًا إلى الصور فقط.",

          responseFormat: {
            type: "text",
            mime_type: "application/json",
            schema: lessonSchema,
          },
        });

      const parsed =
        parseGeminiJSON(result.text);

      if (!parsed) {
        console.error(
          "Could not parse Gemini JSON:",
          result.text.slice(0, 3000)
        );

        return res.status(502).json({
          success: false,
          error:
            "تم تحليل الصور لكن تعذر تجهيز الاختبار. حاول مرة أخرى.",
          raw: result.text,
        });
      }

      const data =
        normalizeLesson(parsed);

      console.log(
        "Quiz questions:",
        data.quiz.length
      );

      console.log(
        "Model used:",
        result.modelUsed
      );

      return res.json({
        success: true,

        data,

        analysis: data,

        title: data.title,

        summary: data.summary,

        explanation:
          data.explanation,

        important_points:
          data.important_points,

        key_terms:
          data.key_terms,

        definitions:
          data.definitions,

        laws:
          data.laws,

        quiz:
          data.quiz,

        modelUsed:
          result.modelUsed,

        interactionId:
          result.raw?.id || null,
      });
    } catch (error) {
      console.error(
        "ANALYZE ERROR:",
        error
      );

      return res.status(
        error.status || 500
      ).json({
        success: false,
        error:
          error.message ||
          "حدث خطأ أثناء تحليل الصور.",
      });
    }
  }
);


// ======================================================
// CHAT WITH OPTIONAL IMAGES
// ======================================================

app.post(
  "/api/chat",
  upload.array("images", 10),
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ""
        ).trim();

      const files =
        req.files || [];

      if (!message && !files.length) {
        return res.status(400).json({
          success: false,
          error:
            "اكتب رسالة أو أرسل صورة.",
        });
      }

      const input = [];

      if (message) {
        input.push({
          type: "text",
          text: message,
        });
      } else {
        input.push({
          type: "text",
          text:
            "حلل الصور المرفقة وساعدني في فهمها باللغة العربية.",
        });
      }

      for (const file of files) {
        input.push(
          fileToGeminiImage(file)
        );
      }

      const result =
        await callGeminiWithFallback({
          input,

          systemInstruction: `
أنت Study AI، مساعد دراسي عربي.

إذا أرسل المستخدم صورة:
- افهم محتوى الصورة.
- أجب بناءً على الصورة.
- لا تخترع معلومات غير ظاهرة.
- إذا كانت الصورة صفحة درس، ساعد المستخدم في فهمها واستخراج المهم منها.
- إذا طلب المستخدم اختبارًا، أنشئ أسئلة من المعلومات الموجودة في الصور.
- تحدث بطريقة طبيعية ومختصرة وواضحة.
          `,

          responseFormat: null,
        });

      return res.json({
        success: true,

        answer:
          result.text,

        response:
          result.text,

        modelUsed:
          result.modelUsed,

        interactionId:
          result.raw?.id || null,
      });
    } catch (error) {
      console.error(
        "CHAT ERROR:",
        error
      );

      return res.status(
        error.status || 500
      ).json({
        success: false,
        error:
          error.message ||
          "حدث خطأ في المساعد.",
      });
    }
  }
);


// ======================================================
// ERROR HANDLER
// ======================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    if (
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({
        success: false,
        error:
          error.code ===
          "LIMIT_FILE_SIZE"
            ? "الصورة أكبر من 8MB."
            : error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "حدث خطأ في السيرفر.",
    });
  }
);


// ======================================================
// START
// ======================================================

app.listen(PORT, () => {
  console.log("");
  console.log("================================");
  console.log("        STUDY AI SERVER");
  console.log("================================");
  console.log("Port:", PORT);
  console.log("Model:", GEMINI_MODEL);
  console.log(
    "Fallback:",
    FALLBACK_MODELS.join(", ")
  );
  console.log(
    "API Key:",
    GEMINI_API_KEY
      ? "موجودة"
      : "غير موجودة"
  );
  console.log(
    "API Revision:",
    API_REVISION
  );
  console.log(
    "Gemini URL:",
    GEMINI_URL
  );
  console.log(
    "Website:",
    `http://localhost:${PORT}`
  );
  console.log("================================");
});