"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTextWithGemini = parseTextWithGemini;
const genai_1 = require("@google/genai");
const config_1 = require("./config");
const taxonomy_1 = require("./taxonomy");
/**
 * Builds the structured parsing prompt for Gemini.
 */
function buildPrompt(userInput) {
    const categoriesList = taxonomy_1.CANONICAL_CATEGORIES.map((c) => `- "${c.id}": ${c.nameRu} / ${c.nameKz} (${c.description})`).join('\n');
    const citiesList = taxonomy_1.CANONICAL_CITIES.map((c) => `- "${c.id}": ${c.nameRu} / ${c.nameKz}`).join('\n');
    return `You are an expert NLP parser for "КЕРЕК", a local service and goods marketplace in Kazakhstan.
Your task is to analyze a customer's informal request written in Russian, Kazakh, or mixed colloquial language, and extract structured metadata into JSON.

ALLOWED CATEGORY IDs:
${categoriesList}

ALLOWED CITY IDs:
${citiesList}

RULES:
1. "cityId": Must be one of the exact canonical city IDs listed above. If the city is not mentioned or unknown, return null.
2. "categoryId": Must be one of the exact canonical category IDs listed above. If none fits or it's unclear, return "other" or null.
3. "service": A concise, clear title of the required service in Russian or Kazakh (e.g. "Ремонт стиральной машины Samsung", "Вызов сантехника", "Грузоперевозки Газель"). Max 100 characters. If no clear service, return null.
4. "urgency":
   - "high" if words indicate urgency (срочно, бүгін, қазір, авария, затопило, тез, прямо сейчас, ASAP).
   - "low" if not urgent (на выходных, келесі аптада, не к спеху, когда-нибудь).
   - "normal" if standard request or default.
   - null if completely unable to determine.
5. "confidence": A float between 0.0 and 1.0 indicating how confident you are in the extracted classification.

OUTPUT FORMAT:
Respond with ONLY valid JSON with keys:
{
  "cityId": string | null,
  "categoryId": string | null,
  "service": string | null,
  "urgency": "high" | "normal" | "low" | null,
  "confidence": number
}

CUSTOMER INPUT:
"""
${userInput}
"""`;
}
/**
 * Invokes Gemini via @google/genai SDK and performs strict server-side validation.
 */
async function parseTextWithGemini(text, apiKey) {
    const ai = new genai_1.GoogleGenAI({ apiKey });
    const prompt = buildPrompt(text);
    const response = await ai.models.generateContent({
        model: config_1.GEMINI_CONFIG.model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            temperature: config_1.GEMINI_CONFIG.temperature,
        },
    });
    const responseText = response.text?.trim() || '{}';
    let rawJson;
    try {
        rawJson = JSON.parse(responseText);
    }
    catch (parseErr) {
        console.warn('[geminiParser] Failed to parse JSON response:', responseText, parseErr);
        rawJson = {};
    }
    // --- Strict Server-Side Validation ---
    // 1. City ID validation & canonicalization
    const validCityId = (0, taxonomy_1.validateAndNormalizeCityId)(rawJson.cityId);
    // 2. Category ID validation & canonicalization
    const validCategoryId = (0, taxonomy_1.validateAndNormalizeCategoryId)(rawJson.categoryId);
    // 3. Service description validation
    let validService = null;
    if (typeof rawJson.service === 'string' && rawJson.service.trim().length > 0) {
        validService = rawJson.service.trim().slice(0, 150);
    }
    // 4. Urgency validation
    let validUrgency = null;
    if (rawJson.urgency === 'high' ||
        rawJson.urgency === 'normal' ||
        rawJson.urgency === 'low') {
        validUrgency = rawJson.urgency;
    }
    // 5. Confidence score validation
    let validConfidence = 0.7;
    if (typeof rawJson.confidence === 'number' && !isNaN(rawJson.confidence)) {
        validConfidence = Math.max(0, Math.min(1, Math.round(rawJson.confidence * 100) / 100));
    }
    else if (!validCategoryId && !validCityId) {
        validConfidence = 0.2;
    }
    return {
        cityId: validCityId,
        categoryId: validCategoryId,
        service: validService,
        urgency: validUrgency,
        confidence: validConfidence,
    };
}
//# sourceMappingURL=geminiParser.js.map