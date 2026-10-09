import * as functions from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { GEMINI_CONFIG } from './config';
import { parseTextWithGemini, ParsedServiceRequest } from './geminiParser';

// Initialize Firebase Admin SDK safely (singleton pattern)
if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

// Access Gemini API key securely from Google Secret Manager
const geminiApiKey = defineSecret(GEMINI_CONFIG.secretName);

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
export const kaspiEscrowWebhook = functions.https.onRequest(async (req, res) => {
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

      console.log(
        `[kaspiEscrowWebhook] Successfully held in escrow: requestId=${requestId}, offerId=${offerId}`
      );

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
  } catch (err: any) {
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
export const parseServiceRequest = onCall<
  { text: string },
  Promise<ParsedServiceRequest>
>(
  {
    region: GEMINI_CONFIG.region,
    secrets: [geminiApiKey],
  },
  async (request) => {
    // 1. Authentication check: Caller must be signed in (anonymous or permanent UID)
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError(
        'unauthenticated',
        'User must be authenticated to use the AI request parser.'
      );
    }

    // 2. Input validation: text must be non-empty string <= 500 characters
    const text = request.data?.text;
    if (typeof text !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Parameter "text" is required and must be a string.'
      );
    }

    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Parameter "text" cannot be empty.'
      );
    }

    if (trimmedText.length > GEMINI_CONFIG.maxInputChars) {
      throw new HttpsError(
        'invalid-argument',
        `Input text exceeds maximum allowed limit of ${GEMINI_CONFIG.maxInputChars} characters.`
      );
    }

    // 3. Resolve Gemini API Key from Secret Manager
    const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[parseServiceRequest] GEMINI_API_KEY secret is not configured.');
      throw new HttpsError(
        'failed-precondition',
        'Gemini API key is not configured in Secret Manager.'
      );
    }

    // 4. Parse request with Gemini & validate server-side
    try {
      const parsed = await parseTextWithGemini(trimmedText, apiKey);
      // Ensure function NEVER writes to Firestore directly (pure parser)
      return parsed;
    } catch (err: any) {
      console.error('[parseServiceRequest] Error during AI parsing:', err);
      throw new HttpsError(
        'internal',
        err?.message || 'Failed to parse request with Gemini.'
      );
    }
  }
);
