import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';

// The name shown on the profile tab. It is kept in the account's own users/{uid} record, which
// only that account can read, and cached on the phone so the tab opens without waiting.

export const NAME_MAX = 60;
const CACHE_PREFIX = 'kerek_profile_name_';

export function cleanName(raw: string): string {
  // Drops control characters and angle brackets, folds whitespace
  const kept = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
    .join('');
  return kept.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function cachedName(uid?: string | null): string {
  if (!uid) return '';
  try {
    return cleanName(localStorage.getItem(CACHE_PREFIX + uid) || '');
  } catch {
    return '';
  }
}

function writeCache(uid: string, name: string) {
  try {
    if (name) localStorage.setItem(CACHE_PREFIX + uid, name);
    else localStorage.removeItem(CACHE_PREFIX + uid);
  } catch {
    // storage unavailable: the name is loaded from the account next time
  }
}

/** Logout or account deletion: the phone forgets the names it showed */
export function forgetCachedNames() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing cached
  }
}

const inCloud = (uid: string) => isFirebaseConfigured() && !!db && auth?.currentUser?.uid === uid;

export async function loadMyName(uid: string): Promise<string> {
  if (!inCloud(uid)) return cachedName(uid);
  try {
    const snap = await getDoc(doc(db!, 'users', uid));
    const raw = snap.exists() ? snap.data().name : '';
    const name = typeof raw === 'string' ? cleanName(raw) : '';
    writeCache(uid, name);
    return name;
  } catch {
    return cachedName(uid);
  }
}

export async function saveMyName(uid: string, raw: string): Promise<string> {
  const name = cleanName(raw);
  if (inCloud(uid)) {
    const ref = doc(db!, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { id: uid, name });
    else await setDoc(ref, { id: uid, name, createdAt: new Date().toISOString() });
  }
  writeCache(uid, name);
  return name;
}

/** Initials for the avatar: first letters of the first two words */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}
