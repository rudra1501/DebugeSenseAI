require("dotenv").config();
const axios = require("axios");

async function analyzeWithGemini(context) {
  const apiKey = process.env.GEMINI_API_KEY;
  const endpoint =
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";
  const safeContext = context || {};
  const errorSummary = String(safeContext.errorSummary ?? "");
  const location = String(safeContext.location ?? "");
  const category = String(safeContext.category ?? "");
  const logs = String(safeContext.logs ?? "");
  const code = String(safeContext.code ?? "");

  const PROMPT = `You are a senior software engineer specializing in debugging production software.

INPUT:
Error: ${errorSummary}
Location: ${location}
Category: ${category}
Logs: ${logs}
Code: ${code}

TASK:

1. Analyze the provided information only.
2. Identify the single most likely root cause.
3. Suggest only one best fix.
4. Generate the updated code implementing only that fix.
5. Assign a confidence score from 0-100.
6. Explain your reasoning clearly as ordered debugging steps.

RULES:

* Return ONLY valid JSON.
* Do not return markdown, code fences, comments, or additional text.
* Do not invent, infer, or assume information that is not present.
* Base every conclusion strictly on the provided Error, Location, Category, Logs, and Code.
* If Logs or Code are empty or insufficient, explicitly mention this limitation in reasoningSteps and lower the confidence score.
* If the available information is insufficient to determine an exact cause, provide the most likely root cause while reflecting the uncertainty through the confidence score.
* rootCause must be concise (maximum 2 lines) and contain only the actual cause.
* Do not include explanations inside rootCause.
* fixSuggestion must describe only the recommended fix.
* Do not provide multiple fixes, alternatives, or optional approaches.
* improvedCode must contain only the final updated code.
* Do not wrap improvedCode in markdown or backticks.
* Modify only the code necessary to implement the suggested fix.
* Preserve unrelated code whenever possible.
* reasoningSteps must explain how the conclusion was reached in logical order.
* debugHints should contain short actionable verification steps to confirm the issue is resolved.
* Ensure the response is always valid JSON.

FORMAT:
{
  "rootCause": "...",
  "fixSuggestion": "...",
  "improvedCode": "...",
  "confidence": number,
  "reasoningSteps": [
    "step 1...",
    "step 2..."
  ],
  "debugHints": [
    "step 1...",
    "step 2..."
  ]
}`;

  let response;

  try {
    response = await axios.post(`${endpoint}?key=${apiKey}`, {
      contents: [
        {
          parts: [{ text: PROMPT }],
        },
      ],
    });
  } catch (err) {
    console.error("Gemini API ERROR:");
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data);
    console.error("Message:", err.message);
    throw err;
  }

  const rawText =
    response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleanedJson = extractJSON(rawText);
  return cleanedJson;
}

function extractJSON(text) {
  try {
    const raw = String(text ?? "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonText = raw.slice(start, end + 1);
    return JSON.parse(jsonText);
  } catch (error) {
    return null;
  }
}

module.exports = {
  analyzeWithGemini,
  extractJSON,
};
