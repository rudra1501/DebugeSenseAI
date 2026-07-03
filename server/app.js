require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { analyzeWithAI } = require("./src/services/ai");
const { Pool } = require("pg");
const { calculateConfidence } = require("./src/utils/confidence");
const { generateDiff } = require("./src/utils/codeDiff");
const { detectSeverity } = require("./src/utils/severity");

const app = express();
const PORT = process.env.PORT || 5000;

const dbUrl = process.env.DATABASE_URL;
const pool = dbUrl
  ? new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  : null;
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD) || 0.95;
const PARSE_PROD = process.env.PARSE_PYTHON_PROD;
const SIMILAR_PROD = process.env.SIMILAR_PYTHON_PROD;
const PARSE_DEV = process.env.PARSE_PYTHON_DEV;
const SIMILAR_DEV = process.env.SIMILAR_PYTHON_DEV;

app.use(cors({
  origin: "*",
}));
app.use(express.json());

app.post("/analyze", async (req, res) => {
  try {
    let { stackTrace = "", logs = "", code = "" } = req.body || {};

    stackTrace = typeof stackTrace === "string" ? stackTrace.trim() : "";
    logs = typeof logs === "string" ? logs.trim() : "";
    code = typeof code === "string" ? code.trim() : "";

    const combinedInput = `${stackTrace} ${logs} ${code}`.trim();

    if (!combinedInput) {
      return res.status(400).json({
        error:
          "No valid input provided. Please enter stack trace, logs, or code.",
      });
    }

    if (combinedInput.length < 8) {
      return res.status(400).json({
        error: "Input too short to analyze.",
      });
    }
    const parseResponse = await axios.post(
      PARSE_PROD,
      req.body,
    );
    const { parsed, context } = parseResponse.data || {};

    const hasRealError =
      parsed?.type !== null ||
      parsed?.message !== null ||
      context?.category !== "UNKNOWN";

    if (!hasRealError) {
      return res.status(400).json({
        parsed,
        context,
        error:
          "Input does not contain a recognizable error pattern. Please provide a valid stack trace or logs.",
        analysis: null,
        similarIssues: null,
      });
    }

    const severity = detectSeverity(
      context?.category ?? "UNKNOWN",
      context?.logs ?? null,
    );

    if (!pool) {
      throw new Error(
        "Missing PostgreSQL connection string. Set DATABASE_URL in environment.",
      );
    }

    const input = {
      stackTrace: req.body?.stackTrace ?? null,
      logs: req.body?.logs ?? null,
      code: req.body?.code ?? context?.code ?? null,
    };

    let pastRows = [];
    try {
      const pastRes = await pool.query(
        `SELECT context->>'errorSummary' AS error_summary, "aiAnalysis"
        FROM sessions
        WHERE context IS NOT NULL
        AND context->>'errorSummary' IS NOT NULL
        AND context->>'errorSummary' <> ''
        ORDER BY id DESC
        LIMIT 10`,
      );

      pastRows = pastRes.rows || [];
    } catch (err) {
      console.log("DB fetch error:", err.message);
    }

    const pastSummaries = pastRows
      .map((r) => r.error_summary)
      .filter((s) => typeof s === "string" && s.trim().length > 0);

    const currentSummary = context?.errorSummary ?? "";

    let similarIssues = null;

    if (
      currentSummary &&
      currentSummary !== "Unknown error" &&
      currentSummary.length > 10
    ) {
      try {
        const similarResponse = await axios.post(
          SIMILAR_PROD,
          {
            current: currentSummary,
            past: pastSummaries,
          },
        );

        similarIssues = {
          mostSimilar: similarResponse.data?.mostSimilar ?? null,
          score:
            typeof similarResponse.data?.score === "number"
              ? similarResponse.data.score
              : 0,
          matchType:
            typeof similarResponse.data?.matchType === "string"
              ? similarResponse.data.matchType
              : "Weak match",
        };
      } catch (err) {
        console.log("Similarity error:", err.message);
      }
    }

    const matchedSummary = similarIssues?.mostSimilar || "";

    const isExactTextMatch = currentSummary === matchedSummary;

    const isTokenSimilar =
      matchedSummary &&
      Math.abs(
        currentSummary.split(" ").length - matchedSummary.split(" ").length,
      ) < 2;

    if (
      similarIssues &&
      similarIssues.score >= SIMILARITY_THRESHOLD &&
      similarIssues.matchType === "Exact match" &&
      (isExactTextMatch || isTokenSimilar)
    ) {
      const matchedRow = pastRows.find(
        (r) => r.error_summary === similarIssues.mostSimilar,
      );

      if (matchedRow && matchedRow.aiAnalysis) {
        const reusedAnalysis =
          typeof matchedRow.aiAnalysis === "object"
            ? matchedRow.aiAnalysis
            : JSON.parse(matchedRow.aiAnalysis);

        return res.json({
          parsed,
          context,
          analysis: reusedAnalysis,
          similarIssues,
          reused: true,
        });
      }
    }

    const aiAnalysis = await analyzeWithAI(context);

    const codeDiff = generateDiff(
      context?.code ?? null,
      aiAnalysis?.improvedCode ?? null,
    );

    const finalConfidence = calculateConfidence(
      aiAnalysis?.confidence ?? 0,
      similarIssues?.score ?? 0,
      context?.category ?? "UNKNOWN",
      context?.logs ?? "",
      context?.code ?? "",
    );

    const analysis = {
      rootCause: aiAnalysis?.rootCause ?? "",
      fixSuggestion: aiAnalysis?.fixSuggestion ?? "",
      improvedCode: aiAnalysis?.improvedCode ?? "",
      confidence: finalConfidence,
      severity: severity,
      reasoningSteps: Array.isArray(aiAnalysis?.reasoningSteps)
        ? aiAnalysis.reasoningSteps
        : [],
      debugHints: Array.isArray(aiAnalysis?.debugHints)
        ? aiAnalysis.debugHints
        : [],
      codeDiff: Array.isArray(codeDiff) ? codeDiff : [],
    };

    await pool.query(
      `INSERT INTO sessions ("input", "parsed", "context", "aiAnalysis")
       VALUES ($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)`,
      [
        JSON.stringify(input),
        JSON.stringify(parsed ?? null),
        JSON.stringify(context ?? null),
        JSON.stringify(analysis ?? null),
      ],
    );

    res.json({
      parsed,
      context,
      analysis,
      similarIssues,
      reused: false,
    });
  } catch (error) {
    console.error("Backend Error:", error.response?.data || error.message);
    if (error.response) {
    return res.status(error.response.status || 500).json({
      error:
        error.response.data?.error?.message ||
        "External service failed. Please try again later.",
    });
  }
  if (error.code === "ECONNABORTED") {
    return res.status(504).json({
      error: "Request timed out. Please try again later.",
    });
  }
    res.status(500).json({
      error: "Failed to analyze request",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
