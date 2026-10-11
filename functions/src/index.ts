import * as functions from 'firebase-functions';
import * as crypto from 'crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { GEMINI_CONFIG } from './config';
import { parseTextWithGemini, ParsedServiceRequest } from './geminiParser';

// Initialize Firebase Admin SDK safely (singleton pattern)
if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

// Access secrets securely from Google Secret Manager
const kaspiWebhookSecret = defineSecret('KASPI_WEBHOOK_SECRET');
const geminiApiKey = defineSecret('GEMINI_API_KEY');

/**
 * Kaspi.kz Escrow Webhook
 *
 * SECURITY AUDIT NOTICE:
 * Official Kaspi.kz / Kaspi Pay webhook integration specifications (HMAC algorithm, signature header format,
 * timestamp headers, and replay protection) are neither documented nor present in this repository.
 * Per security guidelines:
 * 1. Do NOT invent a synthetic HMAC algorithm or signature scheme.
 * 2. Prevent the endpoint from modifying real payment status in the database without verified credentials.
 * 3. Safely reject requests with 501 Not Implemented until official Kaspi merchant integration specifications are provided.
 */
export const kaspiEscrowWebhook = onRequest(
  {
    secrets: [kaspiWebhookSecret],
  },
  async (req, res) => {
    console.warn(
      '[kaspiEscrowWebhook] Security notice: Official Kaspi payment webhook protocol is unverified in this repository. ' +
      'Escrow status mutation is safely disabled until official Kaspi merchant integration specifications are provided.'
    );

    res.status(501).json({
      success: false,
      error:
        'Official Kaspi payment webhook protocol is unverified in this repository. ' +
        'Escrow status mutation is disabled to prevent unauthorized payment state changes.',
    });
  }
);

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

    const uid = request.auth.uid;

    // 2. Server-side Rate Limit check (rateLimits/{uid})
    const now = Date.now();
    const rateLimitRef = db.collection('rateLimits').doc(uid);
    const rateLimitDoc = await rateLimitRef.get();

    if (rateLimitDoc.exists) {
      const rateLimitData = rateLimitDoc.data() || {};
      const lastCallAt = typeof rateLimitData.lastCallAt === 'number' ? rateLimitData.lastCallAt : 0;
      const callCount = typeof rateLimitData.callCount === 'number' ? rateLimitData.callCount : 0;

      if (now - lastCallAt < 60000 && callCount >= 10) {
        throw new HttpsError(
          'resource-exhausted',
          'Too many requests. Please wait a moment before trying again.'
        );
      }

      if (now - lastCallAt >= 60000) {
        await rateLimitRef.set(
          {
            callCount: 1,
            lastCallAt: now,
          },
          { merge: true }
        );
      } else {
        await rateLimitRef.set(
          {
            callCount: callCount + 1,
            lastCallAt: now,
          },
          { merge: true }
        );
      }
    } else {
      await rateLimitRef.set(
        {
          callCount: 1,
          lastCallAt: now,
        },
        { merge: true }
      );
    }

    // 3. Input validation: text must be non-empty string <= 500 characters
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

/**
 * Triggered on new service request creation in Firestore.
 * Automatically notifies providers matching the same cityId and categoryId.
 */
export const onNewRequestNotifyProviders = onDocumentCreated(
  'requests/{id}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const requestData = snap.data();
    const requestId = event.params.id;
    const cityId = requestData?.cityId;
    const categoryId = requestData?.categoryId;
    const customerId = requestData?.customerId;
    const serviceTitle = requestData?.service || requestData?.category || 'Жаңа тапсырыс';

    if (!cityId || !categoryId) {
      console.log(`[onNewRequestNotifyProviders] Request ${requestId} missing cityId or categoryId`);
      return;
    }

    try {
      // Find matching providers with same cityId and categoryId
      const queryRef = db
        .collection('providers')
        .where('cityId', '==', cityId)
        .where('categoryId', '==', categoryId);
      const providersSnap = await queryRef.get();

      const batch = db.batch();
      let count = 0;
      const now = new Date().toISOString();

      providersSnap.forEach((doc) => {
        const providerData = doc.data();
        const providerId = doc.id;
        const providerUserId = providerData.userId || providerId;

        // Skip if provider is the customer themselves
        if (providerUserId === customerId) return;

        const notifId = `notif_new_request_${requestId}_${providerId}`;
        const notifRef = db.collection('notifications').doc(notifId);

        batch.set(
          notifRef,
          {
            id: notifId,
            recipientUserId: providerUserId,
            recipientRole: 'provider',
            type: 'NEW_REQUEST',
            title: {
              kz: 'Жаңа сұраныс табылды',
              ru: 'Новая подходящая заявка',
              tr: 'Yeni uygun talep',
            },
            body: {
              kz: `Сіздің бағытыңыз бойынша жаңа тапсырыс: ${serviceTitle}`,
              ru: `Новый запрос по вашему профилю: ${serviceTitle}`,
              tr: `Profilinize uygun yeni talep: ${serviceTitle}`,
            },
            requestId,
            targetScreen: 'request_details',
            isRead: false,
            readAt: null,
            createdAt: now,
          },
          { merge: true }
        );
        count++;
      });

      if (count > 0) {
        await batch.commit();
        console.log(`[onNewRequestNotifyProviders] Dispatched ${count} notifications for request ${requestId}`);
      }
    } catch (err) {
      console.error('[onNewRequestNotifyProviders] Error notifying providers:', err);
    }
  }
);
