import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { LEGAL_VERSION } from '../data/legalTexts';

/** Deleting an account needs a recent sign-in (Firebase rule); older sessions confirm by SMS again. */
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
 * Deletes the signed-in account: closes open requests, removes their private contact details,
 * the provider profile, the user record and finally the sign-in account itself. Completed jobs,
 * messages and reviews stay without a linked account (see the privacy policy).
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

  const requests = await getDocs(query(collection(firestore, 'requests'), where('customerId', '==', uid)));
  for (const snap of requests.docs) {
    const status = snap.data().status;
    if (ACTIVE_REQUEST_STATUSES.includes(status)) {
      await updateDoc(snap.ref, { status: 'CANCELLED', updatedAt: now });
    }
    await deleteDoc(doc(firestore, 'requestContacts', snap.id));
  }

  await deleteIfExists(doc(firestore, 'providers', uid));
  await deleteIfExists(doc(firestore, 'users', uid));

  try {
    await deleteUser(user);
  } catch (err: any) {
    if (err?.code === 'auth/requires-recent-login') throw new RecentLoginRequiredError();
    throw err;
  }
}

async function deleteIfExists(ref: ReturnType<typeof doc>): Promise<void> {
  const snap = await getDoc(ref);
  if (snap.exists()) await deleteDoc(ref);
}
