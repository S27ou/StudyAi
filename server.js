import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

// =====================================================
// STUDY AI - SERVER
// Gemini Interactions API
// =====================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// =====================================================
// SETTINGS
// =====================================================

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

// =====================================================
// EXPRESS
// =====================================================

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve website files
app.use(express.static(__dirname));

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 20,
    fileSize: 8 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("يسمح برفع الصور فقط."));
    }
  },
});

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =====================================================
// HEALTH
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "Study AI",
    gemini: !!GEMINI_API_KEY,
    model: GEMINI_MODEL,
    fallbackModels: FALLBACK_MODELS,
    port: PORT,
  });
});

// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------
// Get text from Gemini Interactions response
// Supports:
// - output_text
// - steps
// - outputs
// -----------------------------------------------------

function getGeminiText(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  // -----------------------------------------------
  // 1. output_text
  // -----------------------------------------------

  if (
    typeof result.output_text === "string" &&
    result.output_text.trim()
  ) {
    return result.output_text.trim();
  }

  // -----------------------------------------------
  // 2. New Interactions API -> steps
  // -----------------------------------------------

  if (Array.isArray(result.steps)) {
    const texts = [];

    for (const step of result.steps) {
      if (!step || typeof step !== "object") continue;

      // Only model output is important
      if (
        step.type === "model_output" ||
        step.type === "text" ||
        !step.type
      ) {
        if (typeof step.text === "string") {
          texts.push(step.text);
        }

        if (typeof step.output_text === "string") {
          texts.push(step.output_text);
        }

        if (Array.isArray(step.content)) {
          for (const item of step.content) {
            if (
              item &&
              typeof item.text === "string" &&
              item.text.trim()
            ) {
              texts.push(item.text);
            }
          }
        }
      }
    }

    const text = texts.join("\n").trim();

    if (text) {
      return text;
    }
  }

  // -----------------------------------------------
  // 3. Legacy -> outputs
  // -----------------------------------------------

  if (Array.isArray(result.outputs)) {
    const texts = [];

    for (const output of result.outputs) {
      if (!output || typeof output !== "object") continue;

      if (typeof output.text === "string") {
        texts.push(output.text);
      }

      if (typeof output.output_text === "string") {
        texts.push(output.output_text);
      }

      if (Array.isArray(output.content)) {
        for (const item of output.content) {
          if (
            item &&
            typeof item.text === "string" &&
            item.text.trim()
          ) {
            texts.push(item.text);
          }
        }
      }
    }

    const text = texts.join("\n").trim();

    if (text) {
      return text;
    }
  }

  return "";
}

// =====================================================
// Parse JSON returned by Gemini
// =====================================================

function parseGeminiJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Gemini returned empty text.");
  }

  let cleaned = text.trim();

  // Remove Markdown code fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // -----------------------------------------------
  // Direct JSON
  // -----------------------------------------------

  try {
    return JSON.parse(cleaned);
  } catch {}

  // -----------------------------------------------
  // Find first JSON object
  // -----------------------------------------------

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    const jsonText = cleaned.slice(start, end + 1);

    try {
      return JSON.parse(jsonText);
    } catch (error) {
      console.error("JSON parse failed:");
      console.error(error.message);
      console.error(jsonText.slice(0, 5000));
    }
  }

  throw new Error(
    "Gemini returned text, but it was not valid JSON:\n" +
      cleaned.slice(0, 3000)
  );
}

// =====================================================
// Fetch with timeout
// =====================================================

async function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// =====================================================
// Gemini API call
// =====================================================

async function callGemini({
  model,
  input,
  systemInstruction = "",
  responseFormat = null,
  timeoutMs = 120000,
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY غير موجود. أضفه في Environment Variables."
    );
  }

  const body = {
    model,
    input,
    store: false,
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

  let response;

  try {
    response = await fetchWithTimeout(
      GEMINI_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,

          // Explicitly use the current Interactions schema.
          "Api-Revision": "2026-05-20",
        },

        body: JSON.stringify(body),
      },
      timeoutMs
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Gemini request timed out after ${timeoutMs / 1000} seconds.`
      );
    }

    throw error;
  }

  const raw = await response.text();

  let result;

  try {
    result = JSON.parse(raw);
  } catch {
    result = {
      raw,
    };
  }

  console.log("Gemini HTTP:", response.status);
  console.log("Gemini status:", result?.status || "unknown");

  // -----------------------------------------------
  // API ERROR
  // -----------------------------------------------

  if (!response.ok) {
    const message =
      result?.error?.message ||
      result?.message ||
      raw ||
      `Gemini HTTP ${response.status}`;

    const error = new Error(message);

    error.status = response.status;
    error.gemini = result;

    throw error;
  }

  // -----------------------------------------------
  // Extract text
  // -----------------------------------------------

  const text = getGeminiText(result);

  console.log("Gemini text length:", text.length);

  if (!text) {
    console.log("Gemini returned no readable text.");
    console.log(
      JSON.stringify(result, null, 2).slice(0, 15000)
    );

    throw new Error(
      "تمت استجابة Gemini ولكن لم أستطع استخراج النص من الاستجابة."
    );
  }

  console.log("Gemini response received successfully.");

  return {
    text,
    result,
    interactionId: result?.id || null,
    status: result?.status || "completed",
    model,
  };
}

// =====================================================
// Error classification
// =====================================================

function shouldTryAnotherModel(error) {
  const status = Number(error?.status || 0);

  // Authentication / billing errors
  if (
    status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 403
  ) {
    return false;
  }

  // Temporary / overloaded / unavailable
  if (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();

  if (
    message.includes("high demand") ||
    message.includes("temporarily") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("not available to new users") ||
    message.includes("no longer available")
  ) {
    return true;
  }

  return false;
}

// =====================================================
// Call Gemini with automatic model fallback
// =====================================================

async function callGeminiWithFallback(options) {
  const models = [
    options.model || GEMINI_MODEL,
    ...FALLBACK_MODELS,
  ].filter(Boolean);

  // Remove duplicates
  const uniqueModels = [...new Set(models)];

  let lastError = null;

  for (let i = 0; i < uniqueModels.length; i++) {
    const model = uniqueModels[i];

    console.log("");
    console.log(
      `Trying Gemini model ${i + 1}/${uniqueModels.length}: ${model}`
    );

    try {
      const result = await callGemini({
        ...options,
        model,
      });

      return result;
    } catch (error) {
      lastError = error;

      console.error(
        `Model failed: ${model}`
      );

      console.error(
        error?.message || error
      );

      // If this isn't a temporary/model availability
      // problem, stop immediately.
      if (!shouldTryAnotherModel(error)) {
        throw error;
      }

      // Small delay before switching model
      if (i < uniqueModels.length - 1) {
        await sleep(700);
      }
    }
  }

  throw lastError || new Error("All Gemini models failed.");
}

// =====================================================
// LESSON SCHEMA
// =====================================================

const lessonSchema = {
  type: "object",

  properties: {
    title: {
      type: "string",
      description: "عنوان الدرس",
    },

    summary: {
      type: "string",
      description: "ملخص واضح ومختصر للدرس باللغة العربية",
    },

    explanation: {
      type: "string",
      description:
        "شرح مبسط جدًا يساعد الطالب على فهم الدرس باللغة العربية",
    },

    important_points: {
      type: "array",

      items: {
        type: "string",
      },

      description: "أهم النقاط الموجودة في الدرس",
    },

    key_terms: {
      type: "array",

      items: {
        type: "string",
      },

      description: "المصطلحات المهمة الموجودة في الدرس",
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

      description:
        "التعاريف الموجودة في الدرس فقط",
    },

    laws: {
      type: "array",

      items: {
        type: "string",
      },

      description:
        "القوانين والمعادلات الموجودة في الدرس فقط",
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
              "اختياري",
              "صح وخطأ",
              "كتابي",
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
        },

        required: [
          "question",
          "type",
          "options",
          "answer",
        ],
      },

      description:
        "أسئلة اختبار متنوعة من محتوى الدرس",
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

// =====================================================
// NORMALIZE ANALYSIS DATA
// =====================================================

function normalizeAnalysis(data) {
  if (!data || typeof data !== "object") {
    data = {};
  }

  const normalized = {
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
        : [],

    key_terms:
      Array.isArray(data.key_terms)
        ? data.key_terms
        : [],

    definitions:
      Array.isArray(data.definitions)
        ? data.definitions
        : [],

    laws:
      Array.isArray(data.laws)
        ? data.laws
        : [],

    quiz:
      Array.isArray(data.quiz)
        ? data.quiz
        : [],
  };

  // Clean important points
  normalized.important_points =
    normalized.important_points
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  // Clean terms
  normalized.key_terms =
    normalized.key_terms
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  // Clean definitions
  normalized.definitions =
    normalized.definitions
      .filter(
        (x) =>
          x &&
          typeof x === "object"
      )
      .map((x) => ({
        term:
          typeof x.term === "string"
            ? x.term.trim()
            : "",

        definition:
          typeof x.definition === "string"
            ? x.definition.trim()
            : "",
      }))
      .filter(
        (x) =>
          x.term &&
          x.definition
      );

  // Clean laws
  normalized.laws =
    normalized.laws
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  // Clean quiz
  normalized.quiz =
    normalized.quiz
      .filter(
        (x) =>
          x &&
          typeof x === "object"
      )
      .map((q) => ({
        question:
          typeof q.question === "string"
            ? q.question.trim()
            : "",

        type:
          typeof q.type === "string"
            ? q.type
            : "كتابي",

        options:
          Array.isArray(q.options)
            ? q.options
                .filter(
                  (x) =>
                    typeof x === "string"
                )
                .map((x) => x.trim())
                .filter(Boolean)
            : [],

        answer:
          typeof q.answer === "string"
            ? q.answer.trim()
            : "",
      }))
      .filter((q) => q.question);

  return normalized;
}

// =====================================================
// ANALYZE LESSON
// =====================================================

app.post(
  "/api/analyze",
  upload.array("images", 20),
  async (req, res) => {
    console.log("");
    console.log("======================================");
    console.log("ANALYZE REQUEST");
    console.log("======================================");

    try {
      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          error:
            "GEMINI_API_KEY غير موجود في إعدادات السيرفر.",
        });
      }

      const files = req.files || [];

      console.log("عدد الصور:", files.length);

      if (!files.length) {
        return res.status(400).json({
          success: false,
          error:
            "لم يتم إرسال أي صورة.",
        });
      }

      const totalMB =
        files.reduce(
          (sum, file) =>
            sum + file.size,
          0
        ) /
        (1024 * 1024);

      console.log(
        "حجم الصور:",
        totalMB.toFixed(2),
        "MB"
      );

      // -----------------------------------------------
      // Text prompt
      // -----------------------------------------------

      const prompt = `
أنت مساعد دراسة ذكي للطلاب.

سأرسل لك صورة أو عدة صور لدرس دراسي.

اقرأ جميع الصور بعناية شديدة، واجمع المعلومات من جميع الصفحات قبل كتابة النتيجة.

المطلوب:

1. تحديد عنوان الدرس.
2. كتابة ملخص واضح ومفيد.
3. كتابة شرح مبسط جدًا يساعد الطالب على فهم الدرس.
4. استخراج أهم النقاط.
5. استخراج المصطلحات المهمة.
6. استخراج التعاريف الموجودة في الدرس.
7. استخراج القوانين والمعادلات الموجودة في الدرس.
8. إنشاء اختبار حقيقي من محتوى الدرس.

مهم جدًا:

- اعتمد على المعلومات الموجودة في الصور فقط.
- لا تخترع معلومات غير موجودة.
- لا تتجاهل أي صفحة من الصور.
- إذا كان النص موجودًا في صورة، حاول قراءته بدقة.
- إذا كانت الصورة غير واضحة، لا تخترع النص.
- اجعل الشرح باللغة العربية.
- اجعل الأسئلة مثل أسئلة الاختبارات المدرسية الحقيقية.
- لا تجعل جميع الأسئلة من نوع واحد.
- استخدم مزيجًا من:
  - اختياري
  - صح وخطأ
  - كتابي
- أسئلة الاختيار من متعدد يجب أن تحتوي على خيارات واضحة.
- أسئلة الصح والخطأ يجب أن يكون لها خياران مناسبين.
- الأسئلة الكتابية لا تحتاج خيارات.
- حاول إنشاء 10 أسئلة أو أكثر إذا كان محتوى الدرس يسمح بذلك.

أريد النتيجة بصيغة JSON مطابقة تمامًا للمخطط المطلوب.
`;

      // -----------------------------------------------
      // Build multimodal input
      // -----------------------------------------------

      const input = [
        {
          type: "text",
          text: prompt,
        },
      ];

      for (const file of files) {
        input.push({
          type: "image",
          mime_type:
            file.mimetype ||
            "image/jpeg",
          data: file.buffer.toString(
            "base64"
          ),
        });
      }

      // -----------------------------------------------
      // System instruction
      // -----------------------------------------------

      const systemInstruction = `
أنت Study AI، مساعد دراسة متخصص.

وظيفتك تحليل صفحات الدروس المصورة وتحويلها إلى محتوى دراسي منظم.

يجب أن تكون إجابتك مبنية على محتوى الصور فقط.

لا تخترع معلومات.

إذا لم تجد قانونًا أو تعريفًا واضحًا، اترك القائمة فارغة.

إذا كان محتوى الدرس قليلًا، لا تضف معلومات من خارج الصور فقط من أجل زيادة عدد الأسئلة.

اللغة المطلوبة: العربية.
`;

      // -----------------------------------------------
      // Structured output
      // -----------------------------------------------

      const responseFormat = {
        type: "text",
        mime_type: "application/json",
        schema: lessonSchema,
      };

      // -----------------------------------------------
      // Gemini
      // -----------------------------------------------

      const result =
        await callGeminiWithFallback({
          model: GEMINI_MODEL,

          input,

          systemInstruction,

          responseFormat,

          timeoutMs: 120000,
        });

      // -----------------------------------------------
      // Debug
      // -----------------------------------------------

      console.log("");
      console.log(
        "===== GEMINI ANALYSIS TEXT ====="
      );

      console.log(
        result.text.slice(0, 15000)
      );

      console.log(
        "================================"
      );

      // -----------------------------------------------
      // Parse JSON
      // -----------------------------------------------

      let data;

      try {
        data = parseGeminiJSON(
          result.text
        );
      } catch (parseError) {
        console.error(
          "Analysis JSON parse error:"
        );

        console.error(
          parseError.message
        );

        return res.status(502).json({
          success: false,

          error:
            "تمت استجابة Gemini ولكن لم أستطع تحويلها إلى بيانات التحليل.",

          details:
            parseError.message,

          raw:
            result.text.slice(0, 5000),

          modelUsed:
            result.model,

          interactionId:
            result.interactionId,
        });
      }

      // -----------------------------------------------
      // Normalize
      // -----------------------------------------------

      data = normalizeAnalysis(data);

      console.log("");
      console.log(
        "Analysis completed successfully."
      );

      console.log(
        "Summary:",
        data.summary.length,
        "chars"
      );

      console.log(
        "Questions:",
        data.quiz.length
      );

      console.log(
        "Definitions:",
        data.definitions.length
      );

      console.log(
        "Laws:",
        data.laws.length
      );

      // -----------------------------------------------
      // Return
      // -----------------------------------------------

      return res.json({
        success: true,

        data,

        // Extra compatibility fields
        analysis: data,

        title: data.title,

        summary:
          data.summary,

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
          result.model,

        interactionId:
          result.interactionId,
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
        error?.message || error
      );

      console.error(
        "======================================"
      );

      const status =
        Number(error?.status) || 500;

      return res.status(
        status >= 400 && status < 600
          ? status
          : 500
      ).json({
        success: false,

        error:
          error?.message ||
          "حدث خطأ أثناء تحليل الدرس.",
      });
    }
  }
);

// =====================================================
// CHAT
// =====================================================

app.post(
  "/api/chat",
  async (req, res) => {
    console.log("");
    console.log(
      "CHAT REQUEST"
    );

    try {
      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          error:
            "GEMINI_API_KEY غير موجود.",
        });
      }

      const message =
        typeof req.body?.message === "string"
          ? req.body.message.trim()
          : "";

      if (!message) {
        return res.status(400).json({
          success: false,
          error:
            "اكتب رسالة أولاً.",
        });
      }

      const input = [
        {
          type: "text",
          text: message,
        },
      ];

      const systemInstruction = `
أنت مساعد دراسة ذكي اسمه Study AI.

تحدث مع الطالب باللغة العربية.

أجب بطريقة واضحة ومباشرة ومفيدة.

إذا كان السؤال متعلقًا بالدرس الذي أرسله الطالب، اعتمد على المعلومات المتوفرة في المحادثة أو الصور المرسلة.

لا تخترع معلومات.
`;

      const result =
        await callGeminiWithFallback({
          model: GEMINI_MODEL,

          input,

          systemInstruction,

          // Chat does NOT need JSON.
          responseFormat: null,

          timeoutMs: 30000,
        });

      return res.json({
        success: true,

        answer:
          result.text,

        response:
          result.text,

        modelUsed:
          result.model,

        interactionId:
          result.interactionId,
      });
    } catch (error) {
      console.error(
        "CHAT ERROR:",
        error?.message || error
      );

      const status =
        Number(error?.status) || 500;

      return res.status(
        status >= 400 && status < 600
          ? status
          : 500
      ).json({
        success: false,

        error:
          error?.message ||
          "حدث خطأ أثناء التواصل مع Gemini.",
      });
    }
  }
);

// =====================================================
// MULTER / GENERAL ERROR HANDLER
// =====================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      error?.message || error
    );

    if (
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({
        success: false,

        error:
          `خطأ في رفع الملفات: ${error.message}`,
      });
    }

    if (error) {
      return res.status(400).json({
        success: false,

        error:
          error.message ||
          "حدث خطأ في السيرفر.",
      });
    }

    next();
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log("");
  console.log(
    "======================================"
  );

  console.log(
    "        STUDY AI SERVER"
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
    GEMINI_MODEL
  );

  console.log(
    "Fallback models:",
    FALLBACK_MODELS.join(", ")
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