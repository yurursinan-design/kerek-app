"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseServiceRequest = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const config_1 = require("./config");
const geminiParser_1 = require("./geminiParser");
// Access Gemini API key securely from Google Secret Manager
const geminiApiKey = (0, params_1.defineSecret)(config_1.GEMINI_CONFIG.secretName);
/**
 * Cloud Function v2: parseServiceRequest
 * Callable function deployed in asia-south1.
 *
 * Receives: { text: string } (up to 500 characters)
 * Returns: ParsedServiceRequest {
 *   cityId: string | null,
 *   categoryId: string | null,
 *   service: string | null,
 *   urgency: string | null,
 *   confidence: number
 * }
 */
exports.parseServiceRequest = (0, https_1.onCall)({
    region: config_1.GEMINI_CONFIG.region,
    secrets: [geminiApiKey],
}, async (request) => {
    // 1. Authentication check: Caller must be signed in (anonymous or permanent UID)
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated to use the AI request parser.');
    }
    // 2. Input validation: text must be non-empty string <= 500 characters
    const text = request.data?.text;
    if (typeof text !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Parameter "text" is required and must be a string.');
    }
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Parameter "text" cannot be empty.');
    }
    if (trimmedText.length > config_1.GEMINI_CONFIG.maxInputChars) {
        throw new https_1.HttpsError('invalid-argument', `Input text exceeds maximum allowed limit of ${config_1.GEMINI_CONFIG.maxInputChars} characters.`);
    }
    // 3. Resolve Gemini API Key from Secret Manager
    const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[parseServiceRequest] GEMINI_API_KEY secret is not configured.');
        throw new https_1.HttpsError('failed-precondition', 'Gemini API key is not configured in Secret Manager.');
    }
    // 4. Parse request with Gemini & validate server-side
    try {
        const parsed = await (0, geminiParser_1.parseTextWithGemini)(trimmedText, apiKey);
        // Ensure function NEVER writes to Firestore directly (pure parser)
        return parsed;
    }
    catch (err) {
        console.error('[parseServiceRequest] Error during AI parsing:', err);
        throw new https_1.HttpsError('internal', err?.message || 'Failed to parse request with Gemini.');
    }
});
//# sourceMappingURL=index.js.map