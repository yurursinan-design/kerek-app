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
 * HTTP endpoint triggered by Kaspi payment system to confirm funds locked in escrow.
 *
 * Expected payload:
 * {
 *   requestId: string,
 *   offerId: string,
 *   status: string (e.g. 'PAID')
 * }
 */
export const kaspiEscrowWebhook = onRequest(
  {
    secrets: [kaspiWebhookSecret],
  },
  async (req, res) => {
    // 1. Shared secret header verification using crypto.timingSafeEqual (Server-to-server, no CORS)
    const signatureHeader = req.headers['x-kaspi-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const expectedSecret = kaspiWebhookSecret.value();

    let isValidSignature = false;
    if (signature && expectedSecret) {
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSecret, 'utf8');
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        isValidSignature = true;
      }
    }

    if (!isValidSignature) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or missing webhook signature.',
      });
      return;
    }

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

      if (status !== 'PAID') {
        res.status(200).json({
          success: true,
          message: `Status "${status}" received, no escrow hold action required.`,
        });
        return;
      }

      const cleanRequestId = String(requestId).trim();
      const cleanOfferId = String(offerId).trim();
      const requestRef = db.collection('requests').doc(cleanRequestId);
      const offerRef = db.collection('offers').doc(cleanOfferId);

      // Execute within Firestore Transaction
      await db.runTransaction(async (transaction) => {
        const [requestDoc, offerDoc] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(offerRef),
        ]);

        if (!requestDoc.exists) {
          const err: any = new Error(`ServiceRequest with id "${cleanRequestId}" not found.`);
          err.statusCode = 404;
          throw err;
        }

        if (!offerDoc.exists) {
          const err: any = new Error(`ProviderOffer with id "${cleanOfferId}" not found.`);
          err.statusCode = 404;
          throw err;
        }

        const requestData = requestDoc.data();
        const offerData = offerDoc.data();

        // Verify offer belongs to the request
        if (!offerData || offerData.requestId !== cleanRequestId) {
          const err: any = new Error('offer does not belong to request');
          err.statusCode = 400;
          throw err;
        }

        // Verify request.selectedOfferId matches offerId
        if (!requestData || requestData.selectedOfferId !== cleanOfferId) {
          const err: any = new Error('request selectedOfferId does not match offerId');
          err.statusCode = 400;
          throw err;
        }

        // Compare amount if present in payload with offer price
        if (payload.amount !== undefined && payload.amount !== null) {
          const payloadAmount =
            typeof payload.amount === 'number'
              ? payload.amount
              : parseFloat(String(payload.amount).replace(/[^0-9.]/g, ''));
          const offerPrice =
            typeof offerData.price === 'number'
              ? offerData.price
              : parseFloat(String(offerData.price || '').replace(/[^0-9.]/g, ''));

          if (!isNaN(payloadAmount) && !isNaN(offerPrice) && payloadAmount !== offerPrice) {
            const err: any = new Error(
              `Payment amount mismatch: expected ${offerPrice}, received ${payloadAmount}`
            );
            err.statusCode = 400;
            throw err;
          }
        }

        // Idempotency: if already processed, do not update again
        if (requestData?.paymentStatus === 'held_in_escrow') {
          return;
        }

        const updatedAt = new Date().toISOString();
        transaction.update(requestRef, {
          paymentStatus: 'held_in_escrow',
          updatedAt,
        });
        transaction.update(offerRef, {
          paymentStatus: 'held_in_escrow',
          updatedAt,
        });
      });

      console.log(
        `[kaspiEscrowWebhook] Successfully held in escrow: requestId=${cleanRequestId}, offerId=${cleanOfferId}`
      );

      res.status(200).json({
        success: true,
        message: 'Funds secured in escrow',
        requestId: cleanRequestId,
        offerId: cleanOfferId,
      });
    } catch (err: any) {
      console.error('[kaspiEscrowWebhook] Error processing payment webhook:', err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: err?.message || 'Internal server error processing Kaspi escrow webhook',
      });
    }
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
