import { GoogleGenAI } from '@google/genai';
import { GEMINI_CONFIG } from './config';
import {
  CANONICAL_CATEGORIES,
  CANONICAL_CITIES,
  validateAndNormalizeCategoryId,
  validateAndNormalizeCityId,
} from './taxonomy';
import { redactPersonalDetails } from './redact';

export interface ParsedServiceRequest {
  cityId: string | null;
  categoryId: string | null;
  service: string | null;
  urgency: 'high' | 'normal' | 'low' | null;
  confidence: number;
}

/**
 * Builds the structured parsing prompt for Gemini. Phone numbers, addresses and other personal
 * details are taken out of the customer's text first (redact.ts).
 */
export function buildPrompt(userInput: string): string {
  const safeInput = redactPersonalDetails(userInput).replace(/"""/g, '"');
  const categoriesList = CANONICAL_CATEGORIES.map(
    (c) => `- "${c.id}": ${c.nameRu} / ${c.nameKz} (${c.description})`
  ).join('\n');

  const citiesList = CANONICAL_CITIES.map(
    (c) => `- "${c.id}": ${c.nameRu} / ${c.nameKz}`
  ).join('\n');

  return `You are an expert NLP parser for "Tapsyr", a local service and goods marketplace in Kazakhstan.
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
${safeInput}
"""`;
}

/**
 * Invokes Gemini via @google/genai SDK and performs strict server-side validation.
 */
export async function parseTextWithGemini(
  text: string,
  apiKey: string
): Promise<ParsedServiceRequest> {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildPrompt(text);

  // Main model, then a lighter one if it fails (each listed once, so a failure costs at most two calls)
  const candidateModels = Array.from(new Set([GEMINI_CONFIG.model, GEMINI_CONFIG.fallbackModel]));

  let responseText = '{}';
  let lastErr: unknown = null;

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: GEMINI_CONFIG.temperature,
          // The answer is a small JSON object; a cap keeps a manipulated request from running up output tokens
          maxOutputTokens: GEMINI_CONFIG.maxOutputTokens,
        },
      });

      if (response.text && response.text.trim().length > 0) {
        responseText = response.text.trim();
        lastErr = null;
        break;
      }
    } catch (err: any) {
      console.warn(`[geminiParser] Model ${modelName} call failed, trying next fallback:`, err?.message || err);
      lastErr = err;
      // Brief pause before trying fallback
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (lastErr && responseText === '{}') {
    throw lastErr;
  }

  let rawJson: Record<string, unknown>;
  try {
    rawJson = JSON.parse(responseText);
  } catch (parseErr) {
    // The raw answer may echo the customer's text (personal data), so it is not logged
    console.warn('[geminiParser] Failed to parse JSON response, length', responseText.length, parseErr instanceof Error ? parseErr.message : '');
    rawJson = {};
  }

  // --- Strict Server-Side Validation ---

  // 1. City ID validation & canonicalization
  const validCityId = validateAndNormalizeCityId(rawJson.cityId);

  // 2. Category ID validation & canonicalization
  const validCategoryId = validateAndNormalizeCategoryId(rawJson.categoryId);

  // 3. Service description validation
  let validService: string | null = null;
  if (typeof rawJson.service === 'string' && rawJson.service.trim().length > 0) {
    validService = rawJson.service.trim().slice(0, 150);
  }

  // 4. Urgency validation
  let validUrgency: 'high' | 'normal' | 'low' | null = null;
  if (
    rawJson.urgency === 'high' ||
    rawJson.urgency === 'normal' ||
    rawJson.urgency === 'low'
  ) {
    validUrgency = rawJson.urgency;
  }

  // 5. Confidence score validation
  let validConfidence = 0.7;
  if (typeof rawJson.confidence === 'number' && !isNaN(rawJson.confidence)) {
    validConfidence = Math.max(0, Math.min(1, Math.round(rawJson.confidence * 100) / 100));
  } else if (!validCategoryId && !validCityId) {
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
