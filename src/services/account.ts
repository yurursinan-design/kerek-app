import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { auth, db, isFirebaseConfigured, storage } from './firebase';
import { LEGAL_VERSION } from '../data/legalTexts';
import { clearPersonalLocalData } from './storage';
import { deleteAllPortfolioPhotos } from './portfolio';
import { forgetPushToken } from './pushNotifications';

/** Deleting an account needs a recent sign-in (Firebase rule); older sessions confirm the number with a new code. */
/** A provider with a job in progress can't delete the account until the job is finished or cancelled. */
export class ActiveJobsError extends Error {
  constructor() {
    super('active-jobs');
    this.name = 'ActiveJobsError';
  }
}

export class RecentLoginRequiredError extends Error {
  constructor() {
    super('auth/requires-recent-login');
    this.name = 'RecentLoginRequiredError';
  }
}

const RECENT_LOGIN_MS = 4 * 60 * 1000;
const ACTIVE_REQUEST_STATUSES = ['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED', 'PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS'];

/** Stores when the user accepted the privacy policy and terms, and which version. */
export async function recordLegalConsent(): Promise<void> {
  const consent = { consentVersion: LEGAL_VERSION, consentAt: new Date().toISOString() };
  const user = auth?.currentUser;
  if (!isFirebaseConfigured() || !db || !user) {
    try {
      localStorage.setItem('kerek_legal_consent_v1', JSON.stringify(consent));
    } catch {
      // storage unavailable: nothing to record locally
    }
    return;
  }
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, consent);
  } else {
    await setDoc(ref, { id: user.uid, createdAt: consent.consentAt, ...consent });
  }
}

/**
 * Deletes the signed-in account: closes open requests and strips their personal data (contact
 * details, name, text, files, location), removes phone numbers from sent offers, the account's
 * notifications, the provider profile, the user record and finally the sign-in account itself.
 * The bare job records, chat messages and reviews stay without a linked account (see the privacy
 * policy).
 */
export async function deleteMyAccount(): Promise<void> {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured() || !db || !user) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('kerek'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // storage unavailable: nothing stored locally
    }
    return;
  }

  // Check before deleting anything, so a stale session doesn't leave a half-deleted account
  const token = await user.getIdTokenResult();
  if (Date.now() - new Date(token.authTime).getTime() > RECENT_LOGIN_MS) {
    throw new RecentLoginRequiredError();
  }

  const uid = user.uid;
  const firestore = db;
  const now = new Date().toISOString();

  // A customer would be left with a job whose provider no longer exists
  const accepted = await getDocs(
    query(collection(firestore, 'offers'), where('providerUserId', '==', uid), where('status', '==', 'ACCEPTED'))
  );
  const acceptedRequests = await Promise.all(
    accepted.docs.map((offer) => getDoc(doc(firestore, 'requests', String(offer.data().requestId || '-'))))
  );
  if (acceptedRequests.some((req) => req.exists() && ['PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS'].includes(req.data().status))) {
    throw new ActiveJobsError();
  }

  const requests = await getDocs(query(collection(firestore, 'requests'), where('customerId', '==', uid)));
  // Each request is cleaned on its own, all at once (one after another took many seconds)
  await Promise.all(
    requests.docs.map(async (snap) => {
      const data = snap.data();
      if (ACTIVE_REQUEST_STATUSES.includes(data.status)) {
        await updateDoc(snap.ref, { status: 'CANCELLED', updatedAt: now });
      }
      // Photos, videos and voice notes go, then the name, text and location in the request itself
      await Promise.all([
        deleteDoc(doc(firestore, 'requestContacts', snap.id)),
        deleteRequestFiles(snap.id, Array.isArray(data.attachments) ? data.attachments.length : 0),
      ]);
      const personal = ['customerName', 'requestText', 'description', 'attachments', 'location', 'understanding'].filter((k) => k in data);
      // The short title can echo the customer's own words; it becomes the category name
      const titleUpdate = typeof data.category === 'string' && data.service !== data.category ? { service: data.category } : {};
      if (personal.length || Object.keys(titleUpdate).length) {
        await updateDoc(snap.ref, { ...Object.fromEntries(personal.map((k) => [k, deleteField()])), ...titleUpdate, updatedAt: now });
      }
    })
  );

  // Phone numbers in the offers this account sent as a provider, and the account's own notifications
  const [offers, notifications] = await Promise.all([
    getDocs(query(collection(firestore, 'offers'), where('providerUserId', '==', uid))),
    getDocs(query(collection(firestore, 'notifications'), where('recipientUserId', '==', uid))),
  ]);
  await Promise.all([
    ...offers.docs
      .filter((snap) => 'providerPhone' in snap.data() || 'providerWhatsapp' in snap.data())
      .map((snap) => updateDoc(snap.ref, { providerPhone: deleteField(), providerWhatsapp: deleteField(), updatedAt: now })),
    ...notifications.docs.map((snap) => deleteDoc(snap.ref)),
    // This phone stops getting push messages for the deleted account
    forgetPushToken(),
    deleteAllPortfolioPhotos(uid),
  ]);
  await Promise.all([deleteIfExists(doc(firestore, 'providers', uid)), deleteIfExists(doc(firestore, 'users', uid))]);

  try {
    await deleteUser(user);
  } catch (err: any) {
    if (err?.code === 'auth/requires-recent-login') throw new RecentLoginRequiredError();
    throw err;
  }
  // The device copy of the account's data goes too
  clearPersonalLocalData();
}

/** Request files live in fixed slots att0 … att14 (a failed upload can leave gaps); missing slots are skipped. */
async function deleteRequestFiles(requestId: string, count: number): Promise<void> {
  if (!storage || count <= 0) return;
  const st = storage;
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      deleteObject(storageRef(st, `requests/${requestId}/att${i}`)).catch(() => {
        // already gone, or an older file name: nothing to delete here
      })
    )
  );
}

async function deleteIfExists(ref: ReturnType<typeof doc>): Promise<void> {
  const snap = await getDoc(ref);
  if (snap.exists()) await deleteDoc(ref);
}
