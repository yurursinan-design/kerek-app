// Two-sided reviews: the master answers a customer's review, and rates the customer after a
// finished job. In the cloud these are Firestore writes the security rules check; without a cloud
// connection (device mode) they are kept on this phone.
import {
  average,
  collection,
  count,
  doc,
  getAggregateFromServer,
  getDoc,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { getCurrentUserId } from './localRepository';
import { CustomerReview } from '../types';

const LOCAL_REPLIES = 'kerek_review_replies_v1';
const LOCAL_CUSTOMER_REVIEWS = 'kerek_customer_reviews_v1';
const cloud = () => (isFirebaseConfigured() && db ? db : null);

function readLocal<T>(key: string): Record<string, T> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
function writeLocal<T>(key: string, value: Record<string, T>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // full or private storage: not kept
  }
}

/** Device mode: answers saved on this phone, merged into the reviews shown */
export function localReviewReply(reviewId: string): { text: string; at: string } | null {
  return readLocal<{ text: string; at: string }>(LOCAL_REPLIES)[reviewId] || null;
}

export async function replyToReview(reviewId: string, text: string): Promise<{ text: string; at: string }> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw new Error('Validation Error: Жауап бос / Ответ пустой');
  const at = new Date().toISOString();
  const fs = cloud();
  if (fs) {
    await updateDoc(doc(fs, 'reviews', reviewId), { providerReply: clean, providerReplyAt: at });
  } else {
    const all = readLocal<{ text: string; at: string }>(LOCAL_REPLIES);
    all[reviewId] = { text: clean, at };
    writeLocal(LOCAL_REPLIES, all);
  }
  return { text: clean, at };
}

/** The master's rating of this request's customer, if already given */
export async function getCustomerReview(requestId: string): Promise<CustomerReview | null> {
  const fs = cloud();
  if (fs) {
    try {
      const snap = await getDoc(doc(fs, 'customerReviews', requestId));
      return snap.exists() ? (snap.data() as CustomerReview) : null;
    } catch {
      return null;
    }
  }
  return readLocal<CustomerReview>(LOCAL_CUSTOMER_REVIEWS)[requestId] || null;
}

export async function rateCustomer(input: { requestId: string; customerId: string; rating: number; comment?: string }): Promise<CustomerReview> {
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new Error('Validation Error: rating');
  const review: CustomerReview = {
    id: input.requestId,
    requestId: input.requestId,
    customerId: input.customerId,
    providerId: auth?.currentUser?.uid || getCurrentUserId(),
    rating,
    ...(input.comment?.trim() ? { comment: input.comment.trim().slice(0, 500) } : {}),
    createdAt: new Date().toISOString(),
  };
  const fs = cloud();
  if (fs) {
    await setDoc(doc(fs, 'customerReviews', input.requestId), review);
  } else {
    const all = readLocal<CustomerReview>(LOCAL_CUSTOMER_REVIEWS);
    all[input.requestId] = review;
    writeLocal(LOCAL_CUSTOMER_REVIEWS, all);
  }
  return review;
}

/** Average rating masters gave this customer, counted on the server */
export async function getCustomerRating(customerId?: string): Promise<{ avg: number; count: number } | null> {
  if (!customerId) return null;
  const fs = cloud();
  if (fs) {
    try {
      const snap = await getAggregateFromServer(query(collection(fs, 'customerReviews'), where('customerId', '==', customerId)), {
        total: count(),
        avgRating: average('rating'),
      });
      const { total, avgRating } = snap.data();
      return { count: total || 0, avg: total ? Number(avgRating) || 0 : 0 };
    } catch {
      return null;
    }
  }
  const mine = Object.values(readLocal<CustomerReview>(LOCAL_CUSTOMER_REVIEWS)).filter((r) => r.customerId === customerId);
  return { count: mine.length, avg: mine.length ? mine.reduce((s, r) => s + r.rating, 0) / mine.length : 0 };
}
