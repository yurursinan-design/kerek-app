import * as crypto from 'crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { GEMINI_CONFIG } from './config';
import { parseTextWithGemini, ParsedServiceRequest } from './geminiParser';
import { allowCall, clientIp, DAY_MS } from './limits';

// SMS login through Mobizon (Kazakhstan); see smsLogin.ts
export { requestLoginCode, verifyLoginCode } from './smsLogin';
// In-app notices from real events, and push messages to phones; see notifications.ts
export {
  notifyOnOfferCreated,
  notifyOnOfferUpdated,
  notifyOnMessageCreated,
  notifyOnRequestUpdated,
  notifyOnAppointmentWritten,
  pushOnNotificationCreated,
} from './notifications';

const db = getFirestore();

// Access secrets securely from Google Secret Manager
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Payments are made directly between customer and provider for now. The Kaspi escrow webhook stub
// (and its KASPI_WEBHOOK_SECRET, which blocked deploying functions while undefined) was removed;
// add a real integration once the Kaspi merchant specifications are available.

/** Request text shown to other people: no links or phone numbers, short. */
function cleanForNotification(text: unknown): string {
  return String(typeof text === 'string' ? text : '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
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
    // Hard ceiling on parallel instances and run time, so abuse can't scale the bill
    maxInstances: 5,
    timeoutSeconds: 20,
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
    const isAnonymous = (request.auth.token as any)?.firebase?.sign_in_provider === 'anonymous';

    // 2. Server-side rate limits: per account (stricter for anonymous visitors), per day, per
    // network address (so new anonymous accounts don't get around the account limit), and one
    // overall daily ceiling for the whole app.
    const now = Date.now();
    const tooMany = () => new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment before trying again.');
    if (!(await allowCall(`uid_${uid}`, isAnonymous ? 5 : 10, now))) throw tooMany();
    if (!(await allowCall(`uid_day_${uid}`, isAnonymous ? 30 : 100, now, DAY_MS))) throw tooMany();
    const ip = clientIp(request.rawRequest);
    if (ip && !(await allowCall(`ip_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)}`, 30, now))) {
      throw tooMany();
    }
    if (!(await allowCall('global_day', 5000, now, DAY_MS))) throw tooMany();

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
      throw new HttpsError('unavailable', 'The AI parser is not available right now.');
    }

    // 4. Parse request with Gemini & validate server-side
    try {
      const parsed = await parseTextWithGemini(trimmedText, apiKey);
      // Ensure function NEVER writes to Firestore directly (pure parser)
      return parsed;
    } catch (err: any) {
      console.error('[parseServiceRequest] Error during AI parsing:', err?.message || err);
      // Details stay in the server log; the app falls back to its own analysis
      throw new HttpsError('internal', 'The AI parser could not read this request.');
    }
  }
);

/**
 * Triggered on new service request creation in Firestore.
 * Automatically notifies providers matching the same cityId and categoryId.
 */
export const onNewRequestNotifyProviders = onDocumentCreated(
  // Firestore triggers run where the database is (asia-south1)
  { document: 'requests/{id}', region: 'asia-south1', maxInstances: 5 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const requestData = snap.data();
    const requestId = event.params.id;
    const cityId = requestData?.cityId;
    const categoryId = requestData?.categoryId;
    const customerId = requestData?.customerId;
    const serviceTitle = cleanForNotification(requestData?.service) || cleanForNotification(requestData?.category) || 'Жаңа тапсырыс';

    if (!cityId || !categoryId || typeof customerId !== 'string') {
      console.log(`[onNewRequestNotifyProviders] Request ${requestId} missing cityId, categoryId or customerId`);
      return;
    }
    if (!['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED'].includes(requestData?.status)) return;

    // One customer can alert providers for at most 5 new requests an hour (protects providers
    // from spam and the project from write costs)
    if (!(await allowCall(`newreq_${customerId}`, 5, Date.now(), 3600 * 1000))) {
      console.warn(`[onNewRequestNotifyProviders] Skipped alerts for ${requestId}: customer over the hourly limit`);
      return;
    }

    try {
      // Find matching providers with same cityId and categoryId
      // Providers list every group they work in (categoryIds); older profiles have only categoryId
      const [byList, byMain] = await Promise.all([
        db.collection('providers').where('cityId', '==', cityId).where('categoryIds', 'array-contains', categoryId).limit(300).get(),
        db.collection('providers').where('cityId', '==', cityId).where('categoryId', '==', categoryId).limit(300).get(),
      ]);
      const seen = new Set<string>();
      const providersSnap = { docs: [...byList.docs, ...byMain.docs].filter((d) => !seen.has(d.id) && (seen.add(d.id), true)) };

      // Events can be delivered more than once: notices that already exist are left as they are
      // (a provider may have read them)
      const candidateRefs = providersSnap.docs.map((d) => db.collection('notifications').doc(`notif_new_request_${requestId}_${d.id}`));
      const existing = new Set<string>();
      for (let i = 0; i < candidateRefs.length; i += 100) {
        const snaps = await db.getAll(...candidateRefs.slice(i, i + 100));
        snaps.forEach((s) => s.exists && existing.add(s.id));
      }

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

        // Skip the customer themselves, and providers the operator blocked or hid
        if (providerUserId === customerId) continue;
        if (providerData.blocked === true || providerData.hidden === true) continue;

        const notifId = `notif_new_request_${requestId}_${providerId}`;
        if (existing.has(notifId)) continue;
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
            },
            body: {
              kz: `Сіздің бағытыңыз бойынша жаңа тапсырыс: ${serviceTitle}`,
              ru: `Новый запрос по вашему профилю: ${serviceTitle}`,
            },
            requestId,
            targetScreen: 'request_details',
            isRead: false,
            readAt: null,
            createdAt: now,
            // Kept 60 days (Firestore TTL on expireAt)
            expireAt: Timestamp.fromMillis(Date.now() + 60 * DAY_MS),
          }
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
