import * as functions from 'firebase-functions';
import * as crypto from 'crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
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
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Payments are made directly between customer and provider for now. The Kaspi escrow webhook stub
// (and its KASPI_WEBHOOK_SECRET, which blocked deploying functions while undefined) was removed;
// add a real integration once the Kaspi merchant specifications are available.

/** Counts calls per key in a one-minute window (rateLimits/{key}); false once max is reached. */
async function allowCall(key: string, max: number, now: number): Promise<boolean> {
  const ref = db.collection('rateLimits').doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const windowStart = typeof data.windowStart === 'number' ? data.windowStart : 0;
    const count = typeof data.callCount === 'number' ? data.callCount : 0;
    if (now - windowStart >= 60000) {
      tx.set(ref, { windowStart: now, callCount: 1, lastCallAt: now });
      return true;
    }
    if (count >= max) return false;
    tx.set(ref, { windowStart, callCount: count + 1, lastCallAt: now });
    return true;
  });
}

/** Caller's address as seen by Google's front end (first X-Forwarded-For entry). */
function clientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> } | undefined): string {
  const fwd = req?.headers?.['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || req?.ip || '';
}

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

    // 2. Server-side rate limits: per account, and per network address so that opening new
    // anonymous accounts does not get around the account limit
    const now = Date.now();
    if (!(await allowCall(`uid_${uid}`, 10, now))) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment before trying again.');
    }
    const ip = clientIp(request.rawRequest);
    if (ip && !(await allowCall(`ip_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)}`, 30, now))) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment before trying again.');
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

      // A Firestore batch holds at most 500 writes, so notifications are written in chunks
      const BATCH_LIMIT = 450;
      let batch = db.batch();
      let inBatch = 0;
      let count = 0;
      const now = new Date().toISOString();

      for (const doc of providersSnap.docs) {
        const providerData = doc.data();
        const providerId = doc.id;
        const providerUserId = providerData.userId || providerId;

        // Skip if provider is the customer themselves
        if (providerUserId === customerId) continue;

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
        inBatch++;

        if (inBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }

      if (inBatch > 0) {
        await batch.commit();
      }
      if (count > 0) {
        console.log(`[onNewRequestNotifyProviders] Dispatched ${count} notifications for request ${requestId}`);
      }
    } catch (err) {
      console.error('[onNewRequestNotifyProviders] Error notifying providers:', err);
    }
  }
);
