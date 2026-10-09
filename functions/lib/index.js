"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseServiceRequest = exports.kaspiEscrowWebhook = void 0;
const functions = __importStar(require("firebase-functions"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const config_1 = require("./config");
const geminiParser_1 = require("./geminiParser");
// Initialize Firebase Admin SDK safely (singleton pattern)
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
// Access Gemini API key securely from Google Secret Manager
const geminiApiKey = (0, params_1.defineSecret)(config_1.GEMINI_CONFIG.secretName);
/**
 * Kaspi.kz Escrow Webhook
 * HTTP endpoint triggered by Kaspi payment system to confirm funds locked in escrow.
 *
 * Expected payload:
 * {
 *   requestId: string,
 *   offerId: string,
 *   status: string (e.g. 'PAID')
 * }
 */
exports.kaspiEscrowWebhook = functions.https.onRequest(async (req, res) => {
    // Support CORS preflight if invoked from browser or payment sandbox
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.status(204).send('');
        return;
    }
    res.set('Access-Control-Allow-Origin', '*');
    try {
        const payload = req.body || {};
        const requestId = payload.requestId || req.query.requestId;
        const offerId = payload.offerId || req.query.offerId;
        const status = payload.status || req.query.status;
        if (!requestId || !offerId || !status) {
            res.status(400).json({
                success: false,
                error: 'Missing required parameters: requestId, offerId, and status are required.',
            });
            return;
        }
        if (status === 'PAID') {
            const requestRef = db.collection('requests').doc(String(requestId).trim());
            const offerRef = db.collection('offers').doc(String(offerId).trim());
            const [requestDoc, offerDoc] = await Promise.all([
                requestRef.get(),
                offerRef.get(),
            ]);
            if (!requestDoc.exists) {
                console.warn(`[kaspiEscrowWebhook] ServiceRequest with id ${requestId} not found`);
                res.status(404).json({
                    success: false,
                    error: `ServiceRequest with id "${requestId}" not found.`,
                });
                return;
            }
            if (!offerDoc.exists) {
                console.warn(`[kaspiEscrowWebhook] ProviderOffer with id ${offerId} not found`);
                res.status(404).json({
                    success: false,
                    error: `ProviderOffer with id "${offerId}" not found.`,
                });
                return;
            }
            const updatedAt = new Date().toISOString();
            // Concurrently update both documents' paymentStatus to 'held_in_escrow'
            await Promise.all([
                requestRef.update({
                    paymentStatus: 'held_in_escrow',
                    updatedAt,
                }),
                offerRef.update({
                    paymentStatus: 'held_in_escrow',
                    updatedAt,
                }),
            ]);
            console.log(`[kaspiEscrowWebhook] Successfully held in escrow: requestId=${requestId}, offerId=${offerId}`);
            res.status(200).json({
                success: true,
                message: 'Funds secured in escrow',
            });
            return;
        }
        // Acknowledge non-PAID events without mutating escrow state
        res.status(200).json({
            success: true,
            message: `Status "${status}" received, no escrow hold action required.`,
        });
    }
    catch (err) {
        console.error('[kaspiEscrowWebhook] Unexpected error:', err);
        res.status(500).json({
            success: false,
            error: err?.message || 'Internal server error processing Kaspi escrow webhook',
        });
    }
});
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