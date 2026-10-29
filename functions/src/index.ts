import * as crypto from 'crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { GEMINI_CONFIG } from './config';
import { parseTextWithGemini, ParsedServiceRequest } from './geminiParser';
import { allowCall, allowCallOnce, clientIp, DAY_MS, tooOldToRetry } from './limits';

// Phone login with a one-time code sent to WhatsApp; see whatsappLogin.ts
export { requestLoginCode, verifyLoginCode } from './whatsappLogin';
// In-app notices from real events, and push messages to phones; see notifications.ts
export {
  notifyOnOfferCreated,
  notifyOnOfferUpdated,
  notifyOnMessageCreated,
  notifyOnRequestUpdated,
  notifyOnAppointmentWritten,
  pushOnNotificationCreated,
} from './notifications';
// The operator's panel: admin claim for the numbers in config/admins; see admin.ts
export { claimAdmin, adminListChanged } from './admin';
// Jobs done, answer speed and typical prices, counted from real events; see stats.ts
export { statsOnOfferCreated, statsOnRequestCompleted, ratingsOnReviewWritten } from './stats';
// Reviews are checked (suspicion signals and Gemini) before they are published; see reviewModeration.ts
export { moderateReviewSubmission, decideReview, reviewerPhone } from './reviewModeration';
// Which phone and network accounts log in from, for the review check; see signals.ts
export { cleanupAccountData } from './signals';
// Request file links stop working when the request's audience changes; see fileLinks.ts
export { renewRequestFileLinks } from './fileLinks';
// Uploaded files must be what their type says; photos lose hidden metadata; see uploadCheck.ts
export { checkUploadedFile } from './uploadCheck';
// The operator's history and the evidence of a reported conversation; see adminLog.ts
export { adminLogBans, adminLogMasterFlags, adminLogReports, adminLogConfig, reportEvidence } from './adminLog';
// Masters' pre-registration form on the website; see masterSignup.ts
export { masterSignup } from './masterSignup';
// AI answers on the WhatsApp support line; see supportBot.ts
export { supportWebhook } from './supportBot';
// Copy of all personal data in Kazakhstan (Law 94-V art. 12 p. 2); see kzMirror.ts
export {
  kzMirrorUsers,
  kzMirrorProviders,
  kzMirrorRequests,
  kzMirrorRequestContacts,
  kzMirrorOffers,
  kzMirrorReviews,
  kzMirrorConversations,
  kzMirrorMessages,
  kzMirrorAppointments,
  kzMirrorNotifications,
  kzMirrorReports,
  kzMirrorPushTokens,
  kzMirrorCustomerReviews,
  kzMirrorBans,
  kzMirrorReviewSubmissions,
  kzMirrorAccountSignals,
  kzMirrorConsents,
  kzMirrorConsentHistory,
  kzMirrorAdminLog,
  kzMirrorMasterSignups,
  kzMirrorSupportChats,
  kzMirrorSupportMessages,
  kzMirrorFileSaved,
  kzMirrorFileDeleted,
} from './kzMirror';

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

    // Request texts go to Gemini only for accounts that accepted the privacy policy (the phone login
    // records the consent, whatsappLogin.ts); visitors get the app's own analysis instead
    if (!(await db.collection('consents').doc(uid).get()).exists) {
      throw new HttpsError('failed-precondition', 'Accept the privacy policy (phone login) to use the AI analysis.');
    }

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

/** Providers fetched per query page when a new request is matched (all pages are read) */
const MATCH_PAGE = 300;

/**
 * Alerts every matching provider (same city, works in the request's group) about a new request.
 * All matching profiles are read, page by page. Each alert is created only if it doesn't exist yet,
 * so a repeated delivery of the event never resets one a provider has read and never alerts twice;
 * alerts that could not be written make the call fail, and the retried event writes the rest.
 * Returns how many alerts were written.
 */
export async function notifyProvidersOfNewRequest(requestId: string, requestData: any): Promise<number> {
  const cityId = requestData?.cityId;
  const categoryId = requestData?.categoryId;
  const customerId = requestData?.customerId;
  const serviceTitle = cleanForNotification(requestData?.service) || cleanForNotification(requestData?.category) || 'Жаңа тапсырыс';

  if (!cityId || !categoryId || typeof customerId !== 'string') {
    console.log(`[onNewRequestNotifyProviders] Request ${requestId} missing cityId, categoryId or customerId`);
    return 0;
  }
  if (!['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED'].includes(requestData?.status)) return 0;

  // One customer can alert providers for at most 5 new requests an hour (protects providers
  // from spam and the project from write costs); a repeated delivery is not counted again
  if (!(await allowCallOnce(`newreq_${customerId}`, requestId, 5, Date.now(), 3600 * 1000))) {
    console.warn(`[onNewRequestNotifyProviders] Skipped alerts for ${requestId}: customer over the hourly limit`);
    return 0;
  }

  // Providers list every group they work in (categoryIds); older profiles have only categoryId
  const providers = new Map<string, FirebaseFirestore.DocumentData>();
  const queries = [
    db.collection('providers').where('cityId', '==', cityId).where('categoryIds', 'array-contains', categoryId),
    db.collection('providers').where('cityId', '==', cityId).where('categoryId', '==', categoryId),
  ];
  for (const base of queries) {
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await (last ? base.startAfter(last) : base).limit(MATCH_PAGE).get();
      page.docs.forEach((d) => providers.set(d.id, d.data()));
      if (page.size < MATCH_PAGE) break;
      last = page.docs[page.docs.length - 1];
    }
  }

  const writer = db.bulkWriter();
  let written = 0;
  let failed = 0;
  writer.onWriteError((err) => {
    // 6 = ALREADY_EXISTS: delivered before, left as it is (the provider may have read it)
    if (Number(err.code) === 6) return false;
    if (err.failedAttempts < 3) return true;
    failed++;
    console.error('[onNewRequestNotifyProviders] alert not written', err.documentRef.id, err.message);
    return false;
  });
  const now = new Date().toISOString();
  for (const [providerId, providerData] of providers) {
    const providerUserId = providerData.userId || providerId;
    // Skip the customer themselves, providers the operator blocked or hid, and paused masters
    if (providerUserId === customerId) continue;
    if (providerData.blocked === true || providerData.hidden === true) continue;
    // A master on a break ("not taking orders now") gets no new-request alerts
    if (providerData.paused === true) continue;
    const notifId = `notif_new_request_${requestId}_${providerId}`;
    writer
      .create(db.collection('notifications').doc(notifId), {
        id: notifId,
        recipientUserId: providerUserId,
        recipientRole: 'provider',
        type: 'NEW_REQUEST',
        title: { kz: 'Жаңа сұраныс табылды', ru: 'Новая подходящая заявка' },
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
      })
      .then(() => {
        written++;
      })
      .catch(() => {
        // counted in onWriteError
      });
  }
  await writer.close();
  if (failed > 0) throw new Error(`${failed} new-request alerts for ${requestId} were not written`);
  if (written > 0) console.log(`[onNewRequestNotifyProviders] Dispatched ${written} notifications for request ${requestId}`);
  return written;
}

/**
 * Triggered on new service request creation in Firestore: alerts the matching providers. Failures
 * are retried (for up to two hours); repeated deliveries write nothing twice.
 */
export const onNewRequestNotifyProviders = onDocumentCreated(
  // Firestore triggers run where the database is (asia-south1)
  { document: 'requests/{id}', region: 'asia-south1', maxInstances: 5, retry: true },
  async (event) => {
    if (tooOldToRetry(event.time)) {
      console.error(`[onNewRequestNotifyProviders] gave up on ${event.params.id} after retries`);
      return;
    }
    const snap = event.data;
    if (!snap) return;
    await notifyProvidersOfNewRequest(event.params.id, snap.data());
  }
);
