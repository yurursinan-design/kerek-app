// Numbers shown on profiles and requests, counted on the server from real events:
//   providerStats/{uid}  — jobs completed and how fast the master usually answers
//   priceStats/{key}     — prices of finished jobs per city and service (key: "<cityId>_<serviceId>")
//   providerStats/{uid}  — also the rating from published reviews, each customer counted once
// Each event is counted once: a marker document under the stats document remembers it, so a
// repeated delivery of the same event changes nothing.
import { FieldValue, Firestore, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';

const OPTS = { region: 'asia-south1', maxInstances: 10 };
/** Answers slower than a week are counted as a week, so one old request doesn't skew the average */
const MAX_RESPONSE_MINUTES = 7 * 24 * 60;
/** Prices kept per service: the newest ones */
const MAX_PRICES = 50;

/** Minutes between the request and the offer, or null when either time is unknown or out of order. */
export function responseMinutes(requestCreatedAt: unknown, offerCreatedAt: unknown): number | null {
  const a = Date.parse(String(requestCreatedAt || ''));
  const b = Date.parse(String(offerCreatedAt || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.min(MAX_RESPONSE_MINUTES, Math.round((b - a) / 60000));
}

type ServerTime = { toDate(): Date } | null | undefined;

/**
 * Answer time from the server's create times of the request and the offer. The createdAt fields
 * inside the documents are written by the apps, so a master could fake them to look quick.
 */
export function serverResponseMinutes(requestCreated: ServerTime, offerCreated: ServerTime): number | null {
  if (!requestCreated || !offerCreated) return null;
  return responseMinutes(requestCreated.toDate().toISOString(), offerCreated.toDate().toISOString());
}

/** A plain amount in tenge from a price text ("12 000 ₸"), or null for ranges, "from" prices and nonsense. */
export function priceAmount(text: unknown): number | null {
  const s = String(text || '');
  if (!s || /от|бастап|-|–/i.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (!digits || digits.length > 9) return null;
  const n = Number(digits);
  return n >= 500 && n <= 10_000_000 ? n : null;
}

/** Document id for the price list of a city and service (ids are catalogue ids: letters, digits, _). */
export function priceKey(cityId: unknown, serviceOrCategoryId: unknown): string | null {
  const c = String(cityId || '').trim();
  const s = String(serviceOrCategoryId || '').trim();
  if (!/^[a-z0-9_]{1,64}$/.test(c) || !/^[a-z0-9_]{1,64}$/.test(s)) return null;
  return `${c}_${s}`;
}

export const statsOnOfferCreated = onDocumentCreated({ ...OPTS, document: 'offers/{offerId}' }, async (event) => {
  const offer = event.data?.data();
  const uid = String(offer?.providerUserId || offer?.providerId || '');
  if (!offer || !uid || offer.isDemo === true || !offer.requestId) return;
  const db = getFirestore();
  const requestSnap = await db.collection('requests').doc(String(offer.requestId)).get();
  const minutes = serverResponseMinutes(requestSnap.createTime, event.data?.createTime);
  const statsRef = db.collection('providerStats').doc(uid);
  const marker = statsRef.collection('offers').doc(event.params.offerId);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(marker)).exists) return;
    tx.set(marker, { at: FieldValue.serverTimestamp() });
    tx.set(
      statsRef,
      {
        offersSent: FieldValue.increment(1),
        ...(minutes !== null
          ? { responseMinutesTotal: FieldValue.increment(minutes), responseCount: FieldValue.increment(1) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
});

export const statsOnRequestCompleted = onDocumentUpdated({ ...OPTS, document: 'requests/{requestId}' }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || before?.status === 'COMPLETED' || after.status !== 'COMPLETED') return;
  const offerId = String(after.selectedOfferId || '');
  if (!offerId) return;
  const db = getFirestore();
  const offer = (await db.collection('offers').doc(offerId).get()).data();
  const uid = String(offer?.providerUserId || offer?.providerId || '');
  if (!offer || !uid || offer.isDemo === true) return;
  const requestId = event.params.requestId;

  // Jobs done by the master
  const statsRef = db.collection('providerStats').doc(uid);
  const doneMarker = statsRef.collection('done').doc(requestId);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(doneMarker)).exists) return;
    tx.set(doneMarker, { at: FieldValue.serverTimestamp() });
    tx.set(statsRef, { completedJobs: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  // The final price (the master's reported price, else a fixed offer price) joins the service's list
  const amount = priceAmount(after.finalPrice) ?? (offer.priceType === 'fixed' || !offer.priceType ? priceAmount(offer.price) : null);
  const key = priceKey(after.cityId, after.serviceId || after.categoryId);
  if (amount === null || !key) return;
  const priceRef = db.collection('priceStats').doc(key);
  const priceMarker = priceRef.collection('done').doc(requestId);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(priceMarker)).exists) return;
    const current = (await tx.get(priceRef)).data();
    const prices = Array.isArray(current?.prices) ? current.prices.filter((p: unknown) => typeof p === 'number') : [];
    tx.set(priceMarker, { at: FieldValue.serverTimestamp() });
    tx.set(priceRef, {
      prices: [...prices, amount].slice(-MAX_PRICES),
      count: (typeof current?.count === 'number' ? current.count : 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
});

export interface RatedReview {
  customerId?: unknown;
  rating?: unknown;
  /** Server time the review was published, to pick a customer's newest review */
  atMs?: number;
}

/**
 * A master's rating from the published reviews, counting each customer once (their newest review):
 * twenty reviews from two accounts of one person make two ratings, not twenty.
 */
export function ratingFromReviews(reviews: RatedReview[]): { ratingCount: number; ratingTotal: number; reviewCount: number } {
  const newest = new Map<string, { rating: number; at: number }>();
  let reviewCount = 0;
  for (const r of reviews) {
    const rating = Number(r.rating);
    const who = typeof r.customerId === 'string' ? r.customerId : '';
    if (!who || !Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    reviewCount++;
    const at = Number(r.atMs) || 0;
    const prev = newest.get(who);
    if (!prev || at >= prev.at) newest.set(who, { rating, at });
  }
  let ratingTotal = 0;
  newest.forEach((v) => (ratingTotal += v.rating));
  return { ratingCount: newest.size, ratingTotal, reviewCount };
}

/** Any change to a published review (new, answered, removed) recounts the master's rating. */
export const ratingsOnReviewWritten = onDocumentWritten({ ...OPTS, document: 'reviews/{reviewId}' }, async (event) => {
  const providerIds = new Set<string>();
  for (const d of [event.data?.before?.data(), event.data?.after?.data()]) {
    if (typeof d?.providerId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(d.providerId)) providerIds.add(d.providerId);
  }
  const db = getFirestore();
  for (const providerId of providerIds) await recountRating(db, providerId);
});

/** A master's rating, recounted from all their published reviews into providerStats. */
export async function recountRating(db: Firestore, providerId: string): Promise<void> {
  const snap = await db.collection('reviews').where('providerId', '==', providerId).limit(1000).get();
  const rating = ratingFromReviews(
    snap.docs.map((d) => ({ customerId: d.get('customerId'), rating: d.get('rating'), atMs: d.createTime.toMillis() }))
  );
  await db.collection('providerStats').doc(providerId).set({ ...rating, ratingUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
