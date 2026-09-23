import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

// ======================================================
// Study AI - Server
// Gemini Interactions API
// Automatic model fallback system
// ======================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Render gives PORT automatically.
// Local development uses 3001.
const PORT = process.env.PORT || 3001;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();

// ======================================================
// Models
// ======================================================

// Primary model comes from .env.
// If it fails because of temporary overload,
// the server automatically tries the fallback models.
//
// Example:
// GEMINI_MODEL=gemini-3.6-flash

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

// You can change this list later without changing the code
// by using GEMINI_FALLBACK_MODELS in Render Environment.
//
// Default fallback order:
const DEFAULT_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.7-flash"
];

const ENV_FALLBACK_MODELS = process.env.GEMINI_FALLBACK_MODELS
  ? process.env.GEMINI_FALLBACK_MODELS
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
  : DEFAULT_FALLBACK_MODELS;

const MODEL_LIST = [
  PRIMARY_MODEL,
  ...ENV_FALLBACK_MODELS
].filter(
  (model, index, arr) =>
    model && arr.indexOf(model) === index
);

// Gemini Interactions API
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

// ======================================================
// Express
// ======================================================

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ======================================================
// Upload settings
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 8 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  }
});

// ======================================================
// Health
// ======================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "Study AI",
    gemini: !!GEMINI_API_KEY,
    primaryModel: PRIMARY_MODEL,
    fallbackModels: ENV_FALLBACK_MODELS
  });
});

// ======================================================
// Helpers
// ======================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isModelProblem(status, bodyText = "") {
  const text = bodyText.toLowerCase();

  return (
    status === 404 ||
    text.includes("model_not_found") ||
    text.includes("model is not found") ||
    text.includes("not available to new users") ||
    text.includes("is no longer available")
  );
}

function cleanText(text) {
  if (typeof text !== "string") return "";

  return text
    .replace(/\r/g, "")
    .trim();
}

// ======================================================
// Extract text from Interactions API response
// ======================================================

function getGeminiText(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  // ------------------------------------------
  // 1. output_text
  // ------------------------------------------

  if (
    typeof result.output_text === "string" &&
    result.output_text.trim()
  ) {
    return result.output_text.trim();
  }

  // ------------------------------------------
  // 2. outputs
  // ------------------------------------------

  if (Array.isArray(result.outputs)) {
    const texts = [];

    for (const output of result.outputs) {
      if (!output) continue;

      if (
        output.type === "text" &&
        typeof output.text === "string"
      ) {
        texts.push(output.text);
      }

      if (Array.isArray(output.content)) {
        for (const item of output.content) {
          if (
            item?.type === "text" &&
            typeof item.text === "string"
          ) {
            texts.push(item.text);
          }
        }
      }
    }

    const joined = texts.join("\n").trim();

    if (joined) {
      return joined;
    }
  }

  // ------------------------------------------
  // 3. steps
  // ------------------------------------------

  if (Array.isArray(result.steps)) {
    const texts = [];

    for (const step of result.steps) {
      if (!step) continue;

      // step.text
      if (
        typeof step.text === "string" &&
        step.text.trim()
      ) {
        texts.push(step.text);
      }

      // model_output content
      if (
        step.type === "model_output" &&
        Array.isArray(step.content)
      ) {
        for (const item of step.content) {
          if (
            item?.type === "text" &&
            typeof item.text === "string"
          ) {
            texts.push(item.text);
          }
        }
      }

      // generic content
      if (Array.isArray(step.content)) {
        for (const item of step.content) {
          if (
            item?.type === "text" &&
            typeof item.text === "string"
          ) {
            texts.push(item.text);
          }
        }
      }
    }

    const joined = texts.join("\n").trim();

    if (joined) {
      return joined;
    }
  }

  return "";
}

// ======================================================
// Parse JSON returned by Gemini
// ======================================================

function parseGeminiJSON(text) {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let cleaned = text.trim();

  // Remove markdown code fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // First direct JSON attempt
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue below
  }

  // Find first object
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");

  if (firstObject !== -1 && lastObject > firstObject) {
    const possibleJSON = cleaned
      .slice(firstObject, lastObject + 1)
      .trim();

    try {
      return JSON.parse(possibleJSON);
    } catch {
      // Continue
    }
  }

  // Find first array
  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");

  if (firstArray !== -1 && lastArray > firstArray) {
    const possibleJSON = cleaned
      .slice(firstArray, lastArray + 1)
      .trim();

    try {
      return JSON.parse(possibleJSON);
    } catch {
      // Continue
    }
  }

  throw new Error(
    "Gemini returned text, but it was not valid JSON."
  );
}

// ======================================================
// Request Gemini
// ======================================================

async function requestGemini({
  model,
  input,
  systemInstruction,
  responseFormat = null,
  timeoutMs = 120000
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is missing from environment variables."
    );
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const body = {
      model,
      input,
      store: false
    };

    if (systemInstruction) {
      body.system_instruction = systemInstruction;
    }

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    console.log("");
    console.log("======================================");
    console.log("Gemini request");
    console.log("Model:", model);
    console.log("======================================");

    const response = await fetch(GEMINI_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },

      body: JSON.stringify(body),

      signal: controller.signal
    });

    const rawText = await response.text();

    let result;

    try {
      result = JSON.parse(rawText);
    } catch {
      result = {
        rawText
      };
    }

    console.log("Gemini HTTP status:", response.status);

    // ------------------------------------------
    // Error
    // ------------------------------------------

    if (!response.ok) {
      const errorMessage =
        result?.error?.message ||
        result?.message ||
        rawText ||
        "Unknown Gemini error";

      console.log(
        "Gemini error:",
        errorMessage
      );

      const error = new Error(errorMessage);

      error.status = response.status;
      error.body = result;

      throw error;
    }

    // ------------------------------------------
    // Successful response
    // ------------------------------------------

    const text = getGeminiText(result);

    console.log(
      "Gemini response text length:",
      text.length
    );

    if (!text) {
      console.log(
        "Gemini returned no text."
      );

      console.log(
        "Full Gemini response:",
        JSON.stringify(result, null, 2)
      );

      const error = new Error(
        "Gemini returned an empty response."
      );

      error.status = 500;
      error.body = result;

      throw error;
    }

    return {
      text,
      result,
      interactionId: result?.id || null
    };

  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(
        "Gemini request timed out."
      );

      timeoutError.status = 504;

      throw timeoutError;
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

// ======================================================
// Automatic model fallback
// ======================================================

async function callGeminiWithFallback(options) {
  let lastError = null;

  console.log("");
  console.log("======================================");
  console.log("MODEL FALLBACK SYSTEM");
  console.log("Models:");
  console.log(MODEL_LIST.join(" -> "));
  console.log("======================================");

  for (let modelIndex = 0; modelIndex < MODEL_LIST.length; modelIndex++) {
    const model = MODEL_LIST[modelIndex];

    console.log("");
    console.log(
      `Trying model ${modelIndex + 1}/${MODEL_LIST.length}: ${model}`
    );

    // ------------------------------------------
    // Try this model
    // ------------------------------------------

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await requestGemini({
          ...options,
          model
        });

        console.log(
          `SUCCESS: ${model}`
        );

        return {
          ...result,
          modelUsed: model
        };

      } catch (error) {
        lastError = error;

        const status = error?.status;

        console.log(
          `FAILED: ${model} | attempt ${attempt} | status ${status || "unknown"}`
        );

        // --------------------------------------
        // Authentication / permission errors
        // Don't keep retrying the same key.
        // --------------------------------------

        if (
          status === 401 ||
          status === 403
        ) {
          throw error;
        }

        // --------------------------------------
        // Payment / quota errors
        // Fallback models won't necessarily
        // fix an account-level quota problem.
        // --------------------------------------

        if (status === 402) {
          throw error;
        }

        // --------------------------------------
        // Model unavailable
        // Immediately try next model.
        // --------------------------------------

        if (
          isModelProblem(
            status,
            error?.message || ""
          )
        ) {
          console.log(
            `Model unavailable: ${model}`
          );

          break;
        }

        // --------------------------------------
        // Temporary server overload
        // Retry once with backoff.
        // --------------------------------------

        if (
          isRetryableStatus(status) &&
          attempt === 1
        ) {
          const delay = 1500;

          console.log(
            `Temporary error. Retrying ${model} after ${delay}ms...`
          );

          await sleep(delay);

          continue;
        }

        // --------------------------------------
        // Other errors
        // Try next model.
        // --------------------------------------

        break;
      }
    }

    // ------------------------------------------
    // Move to next model
    // ------------------------------------------

    if (modelIndex < MODEL_LIST.length - 1) {
      console.log(
        `Switching from ${model} to ${MODEL_LIST[modelIndex + 1]}...`
      );

      // Small delay to avoid hammering API
      await sleep(700);
    }
  }

  throw lastError || new Error(
    "All Gemini models failed."
  );
}

// ======================================================
// Lesson schema
// ======================================================

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
        ]
      }
    },

    laws: {
      type: "array",
      items: {
        type: "string"
      }
    },

    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string"
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
          },

          explanation: {
            type: "string"
          }
        },

        required: [
          "type",
          "question",
          "options",
          "answer",
          "explanation"
        ]
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
  ]
};

// ======================================================
// Normalize analysis
// ======================================================

function normalizeAnalysis(data) {
  if (!data || typeof data !== "object") {
    data = {};
  }

  return {
    title:
      typeof data.title === "string"
        ? data.title
        : "تحليل الدرس",

    summary:
      typeof data.summary === "string"
        ? data.summary
        : "",

    explanation:
      typeof data.explanation === "string"
        ? data.explanation
        : "",

    important_points:
      Array.isArray(data.important_points)
        ? data.important_points
            .filter((x) => typeof x === "string")
        : [],

    key_terms:
      Array.isArray(data.key_terms)
        ? data.key_terms
            .filter((x) => typeof x === "string")
        : [],

    definitions:
      Array.isArray(data.definitions)
        ? data.definitions
            .filter(
              (x) =>
                x &&
                typeof x === "object"
            )
            .map((x) => ({
              term:
                typeof x.term === "string"
                  ? x.term
                  : "",

              definition:
                typeof x.definition === "string"
                  ? x.definition
                  : ""
            }))
        : [],

    laws:
      Array.isArray(data.laws)
        ? data.laws
            .filter((x) => typeof x === "string")
        : [],

    quiz:
      Array.isArray(data.quiz)
        ? data.quiz
            .filter(
              (x) =>
                x &&
                typeof x === "object"
            )
            .map((q) => ({
              type:
                typeof q.type === "string"
                  ? q.type
                  : "كتابي",

              question:
                typeof q.question === "string"
                  ? q.question
                  : "",

              options:
                Array.isArray(q.options)
                  ? q.options
                      .filter(
                        (x) =>
                          typeof x === "string"
                      )
                  : [],

              answer:
                typeof q.answer === "string"
                  ? q.answer
                  : "",

              explanation:
                typeof q.explanation === "string"
                  ? q.explanation
                  : ""
            }))
        : []
  };
}

// ======================================================
// Analyze lesson
// ======================================================

app.post(
  "/api/analyze",
  upload.array("images", 20),
  async (req, res) => {

    try {
      console.log("");
      console.log("======================================");
      console.log("ANALYZE REQUEST");
      console.log("======================================");

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "لم يتم رفع أي صورة."
        });
      }

      console.log(
        "عدد الصور:",
        req.files.length
      );

      const totalBytes = req.files.reduce(
        (sum, file) =>
          sum + file.buffer.length,
        0
      );

      console.log(
        "حجم الصور:",
        (totalBytes / 1024 / 1024).toFixed(2),
        "MB"
      );

      // ----------------------------------------
      // Text instruction
      // ----------------------------------------

      const input = [
        {
          type: "text",

          text: `
أنت مساعد دراسة ذكي متخصص في فهم الدروس من صور الكتب والمذكرات.

حلل جميع الصور المرفقة معًا، ولا تعتمد على صورة واحدة فقط.

مهم جدًا:
- اقرأ النص الموجود في الصور بدقة.
- لا تخترع معلومات غير موجودة في الدرس.
- إذا كانت معلومة غير واضحة في الصور فلا تخمنها.
- اكتب النتائج باللغة العربية.
- اجعل الشرح واضحًا للطالب وسهل الفهم.
- استخرج المعلومات المهمة فقط.
- استخرج التعاريف الموجودة فعلًا.
- استخرج القوانين والمعادلات الموجودة فعلًا.
- أنشئ اختبارًا يشبه الاختبارات المدرسية الحقيقية.
- لا تجعل كل الأسئلة من نوع واحد.

أنواع الاختبار المطلوبة:
1. اختيار من متعدد.
2. صح وخطأ.
3. أسئلة كتابية.

في أسئلة الاختيار من متعدد:
- ضع 4 خيارات عندما يكون ذلك ممكنًا.
- اجعل السؤال طبيعيًا مثل أسئلة الاختبارات المدرسية.
- لا تستخدم أسئلة عامة أو مصطلحات غريبة.

في أسئلة صح وخطأ:
- اجعل options فارغة أو تحتوي على ["صح","خطأ"].

في الأسئلة الكتابية:
- اجعل options فارغة.

أنشئ عددًا مناسبًا من الأسئلة حسب كمية محتوى الدرس، ويفضل 10 أسئلة أو أكثر إذا كان محتوى الصور يسمح بذلك.

أعد النتيجة JSON فقط وبنفس الهيكل المطلوب.
          `.trim()
        }
      ];

      // ----------------------------------------
      // Add all images
      // ----------------------------------------

      for (const file of req.files) {
        input.push({
          type: "image",

          mime_type:
            file.mimetype || "image/jpeg",

          data:
            file.buffer.toString("base64")
        });
      }

      // ----------------------------------------
      // System instruction
      // ----------------------------------------

      const systemInstruction = `
أنت Study AI، مساعد تعليمي باللغة العربية.

مهمتك تحليل صور الدرس وتحويلها إلى:
- ملخص واضح.
- شرح مبسط.
- أهم النقاط.
- المصطلحات المهمة.
- التعاريف.
- القوانين والمعادلات.
- اختبار متنوع.

اعتمد على محتوى الصور فقط.
لا تخترع معلومات غير موجودة.
إذا لم يوجد قانون في الصور اجعل laws مصفوفة فارغة.
إذا لم توجد تعاريف واضحة اجعل definitions مصفوفة فارغة.

الاختبار يجب أن يحتوي على:
- اختيار من متعدد.
- صح وخطأ.
- أسئلة كتابية.

أعد JSON صالحًا فقط.
      `.trim();

      // ----------------------------------------
      // Gemini structured output
      // ----------------------------------------

      const responseFormat = {
        type: "text",
        mime_type: "application/json",
        schema: lessonSchema
      };

      // ----------------------------------------
      // Call with automatic fallback
      // ----------------------------------------

      const result =
        await callGeminiWithFallback({
          input,
          systemInstruction,
          responseFormat,
          timeoutMs: 120000
        });

      console.log(
        "======================================"
      );

      console.log(
        "ANALYSIS SUCCESS"
      );

      console.log(
        "Model used:",
        result.modelUsed
      );

      console.log(
        "Interaction ID:",
        result.interactionId
      );

      console.log(
        "======================================"
      );

      // ----------------------------------------
      // Parse JSON
      // ----------------------------------------

      let data;

      try {
        data = parseGeminiJSON(
          result.text
        );
      } catch (parseError) {

        console.error(
          "JSON parse error:",
          parseError.message
        );

        console.error(
          "Gemini text:",
          result.text
        );

        return res.status(500).json({
          success: false,
          error:
            "تمت استجابة Gemini ولكن لم أستطع تحويلها إلى بيانات التحليل.",
          modelUsed: result.modelUsed
        });
      }

      data = normalizeAnalysis(data);

      // ----------------------------------------
      // Return
      // ----------------------------------------

      return res.json({
        success: true,

        data,

        // Compatibility with different frontend versions
        analysis: data,

        ...data,

        modelUsed: result.modelUsed,

        interactionId:
          result.interactionId
      });

    } catch (error) {

      console.error("");
      console.error(
        "======================================"
      );
      console.error(
        "ANALYZE ERROR"
      );
      console.error(
        "======================================"
      );

      console.error(
        "Status:",
        error?.status
      );

      console.error(
        "Message:",
        error?.message
      );

      // ----------------------------------------
      // User-friendly errors
      // ----------------------------------------

      if (error?.status === 401) {
        return res.status(401).json({
          success: false,
          error:
            "مفتاح Gemini غير صالح أو غير مصرح به في Render."
        });
      }

      if (error?.status === 403) {
        return res.status(403).json({
          success: false,
          error:
            "مفتاح Gemini لا يملك صلاحية استخدام هذا الطلب."
        });
      }

      if (error?.status === 402) {
        return res.status(402).json({
          success: false,
          error:
            "رصيد أو فئة الدفع في Gemini تمنع الطلب حاليًا."
        });
      }

      if (error?.status === 429) {
        return res.status(429).json({
          success: false,
          error:
            "تم تجاوز حد الاستخدام في Gemini. حاول مرة أخرى بعد قليل."
        });
      }

      if (error?.status === 503) {
        return res.status(503).json({
          success: false,
          error:
            "نماذج Gemini مشغولة حاليًا. تم تجربة النماذج الاحتياطية ولم تنجح."
        });
      }

      if (error?.status === 504) {
        return res.status(504).json({
          success: false,
          error:
            "استغرق تحليل الدرس وقتًا طويلًا. حاول مرة أخرى."
        });
      }

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "حدث خطأ أثناء تحليل الدرس."
      });
    }
  }
);

// ======================================================
// Chat
// ======================================================

app.post(
  "/api/chat",
  async (req, res) => {

    try {
      const message =
        typeof req.body?.message === "string"
          ? req.body.message.trim()
          : "";

      if (!message) {
        return res.status(400).json({
          success: false,
          error: "اكتب رسالة أولًا."
        });
      }

      const input = [
        {
          type: "text",
          text: message
        }
      ];

      const systemInstruction = `
أنت مساعد Study AI.

تحدث باللغة العربية.
أجب بطريقة طبيعية وواضحة ومفيدة للطالب.
لا تستخدم JSON.
إذا كان السؤال عن الدراسة فاشرح خطوة بخطوة.
لا تخترع معلومات إذا لم تكن متأكدًا.
      `.trim();

      const result =
        await callGeminiWithFallback({
          input,
          systemInstruction,
          responseFormat: null,
          timeoutMs: 30000
        });

      return res.json({
        success: true,

        answer: cleanText(
          result.text
        ),

        modelUsed:
          result.modelUsed,

        interactionId:
          result.interactionId
      });

    } catch (error) {

      console.error(
        "CHAT ERROR:",
        error?.message
      );

      if (error?.status === 401) {
        return res.status(401).json({
          success: false,
          error:
            "مفتاح Gemini غير صالح."
        });
      }

      if (error?.status === 429) {
        return res.status(429).json({
          success: false,
          error:
            "Gemini مشغول أو تم تجاوز الحد مؤقتًا. حاول مرة أخرى."
        });
      }

      if (error?.status === 503) {
        return res.status(503).json({
          success: false,
          error:
            "Gemini مشغول حاليًا. حاول مرة أخرى بعد قليل."
        });
      }

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "حدث خطأ في المساعد الذكي."
      });
    }
  }
);

// ======================================================
// Multer error handler
// ======================================================

app.use(
  (error, req, res, next) => {

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          `Upload error: ${error.message}`
      });
    }

    if (error) {
      console.error(
        "SERVER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          "حدث خطأ في السيرفر."
      });
    }

    next();
  }
);

// ======================================================
// Start
// ======================================================

app.listen(PORT, () => {

  console.log("");
  console.log(
    "======================================"
  );

  console.log(
    "       STUDY AI SERVER"
  );

  console.log(
    "======================================"
  );

  console.log(
    "Port:",
    PORT
  );

  console.log(
    "Primary model:",
    PRIMARY_MODEL
  );

  console.log(
    "Fallback models:"
  );

  MODEL_LIST.forEach(
    (model, index) => {
      console.log(
        `${index + 1}. ${model}`
      );
    }
  );

  console.log(
    "API Key:",
    GEMINI_API_KEY
      ? "موجودة ✅"
      : "مفقودة ❌"
  );

  console.log(
    "Website:",
    `http://localhost:${PORT}`
  );

  console.log(
    "======================================"
  );
});