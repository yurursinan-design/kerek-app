import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc, setDoc, getDocFromServer } from 'firebase/firestore';

/**
 * Firebase Client Initialization
 * Reads credentials securely from Vite environment variables.
 * If credentials are not supplied, it safely remains inactive without crashing the app,
 * allowing the application to function in LocalStorage fallback mode.
 */

const getEnvVar = (viteVal: string | undefined, nodeVal: string | undefined): string | undefined => {
  if (viteVal && typeof viteVal === 'string' && viteVal.trim().length > 0) return viteVal.trim();
  if (nodeVal && typeof nodeVal === 'string' && nodeVal.trim().length > 0) return nodeVal.trim();
  return undefined;
};

const firebaseConfig = {
  apiKey: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_API_KEY : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_API_KEY : undefined
  ),
  authDomain: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined
  ),
  projectId: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_PROJECT_ID : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_PROJECT_ID : undefined
  ),
  storageBucket: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined
  ),
  messagingSenderId: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined
  ),
  appId: getEnvVar(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_APP_ID : undefined,
    typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_APP_ID : undefined
  ),
};

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.apiKey.length > 5 &&
    firebaseConfig.projectId.length > 2 &&
    !firebaseConfig.apiKey.includes('your-api-key')
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured()) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    db = getFirestore(app);

    // Keep local storage user ID in sync with Firebase Auth UID
    onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      if (user?.uid) {
        try {
          localStorage.setItem('kerek_current_user_id_v2', user.uid);
        } catch {}
      }
    });
  } catch (err) {
    console.warn('[KEREK Firebase] Initialization skipped or failed:', err);
    app = null;
    auth = null;
    db = null;
  }
}

export { app, auth, db };

let authInitPromise: Promise<string | null> | null = null;

/**
 * Ensures an active Firebase Auth session exists (e.g. Anonymous authentication).
 * Must be awaited before executing any Firestore operation.
 */
export async function ensureFirebaseAuth(): Promise<string | null> {
  if (!isFirebaseConfigured() || !auth) {
    return null;
  }
  if (auth.currentUser?.uid) {
    try {
      localStorage.setItem('kerek_current_user_id_v2', auth.currentUser.uid);
    } catch {}
    return auth.currentUser.uid;
  }

  if (!authInitPromise) {
    authInitPromise = (async () => {
      try {
        if (!auth.currentUser) {
          const cred = await signInAnonymously(auth);
          if (cred.user?.uid) {
            try {
              localStorage.setItem('kerek_current_user_id_v2', cred.user.uid);
            } catch {}
            return cred.user.uid;
          }
        }
        return auth.currentUser?.uid || null;
      } catch (err: any) {
        console.warn('[KEREK Firebase] Anonymous auth initialization note:', err?.message || err);
        return null;
      } finally {
        authInitPromise = null;
      }
    })();
  }

  return authInitPromise;
}

// Kick off auth eagerly in the background when Firebase is configured
if (isFirebaseConfigured() && auth) {
  ensureFirebaseAuth().catch(() => {});
}

export interface FirebaseDiagnosticReport {
  config: { ok: boolean; projectId?: string; details?: string };
  auth: { ok: boolean; uid?: string; isAnonymous?: boolean; error?: string };
  connection: { ok: boolean; error?: string };
  firestoreRead: { ok: boolean; error?: string };
  firestoreWrite: { ok: boolean; error?: string };
  securityRules: { ok: boolean; message: string };
  timestamp: string;
}

let latestDiagnosticReport: FirebaseDiagnosticReport | null = null;

export function getLatestDiagnosticReport(): FirebaseDiagnosticReport | null {
  return latestDiagnosticReport;
}

export async function runFirebaseDiagnostics(): Promise<FirebaseDiagnosticReport> {
  const report: FirebaseDiagnosticReport = {
    config: {
      ok: isFirebaseConfigured(),
      projectId: firebaseConfig.projectId,
      details: isFirebaseConfigured()
        ? `Configured with Project ID: ${firebaseConfig.projectId}`
        : 'Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID',
    },
    auth: { ok: false },
    connection: { ok: false },
    firestoreRead: { ok: false },
    firestoreWrite: { ok: false },
    securityRules: { ok: false, message: 'Not evaluated yet' },
    timestamp: new Date().toISOString(),
  };

  console.group('%c[KEREK Firebase Live Diagnostics]', 'color: #0284c7; font-weight: bold;');

  // Step 1: Config
  if (!report.config.ok) {
    console.warn('❌ [1/6 Config] Missing Firebase credentials in environment variables.');
    report.securityRules.message = 'Firebase configuration is incomplete.';
    console.groupEnd();
    latestDiagnosticReport = report;
    return report;
  }
  console.log(`✅ [1/6 Config] Valid configuration detected for project: "${report.config.projectId}"`);

  // Step 2: Anonymous Auth
  try {
    const uid = await ensureFirebaseAuth();
    if (uid && auth?.currentUser) {
      report.auth = {
        ok: true,
        uid: auth.currentUser.uid,
        isAnonymous: auth.currentUser.isAnonymous,
      };
      console.log(`✅ [2/6 Anonymous Auth] Session active. UID: ${uid} (Anonymous: ${auth.currentUser.isAnonymous})`);
    } else {
      report.auth = { ok: false, error: 'No UID returned from ensureFirebaseAuth' };
      console.warn('❌ [2/6 Anonymous Auth] Could not establish anonymous user credentials.');
    }
  } catch (err: any) {
    report.auth = { ok: false, error: err?.message || String(err) };
    console.error('❌ [2/6 Anonymous Auth] Authentication failure:', err);
  }

  // Step 3: Connection Test
  if (db) {
    try {
      await getDocFromServer(doc(db, 'providers', 'probe_connection'));
      report.connection = { ok: true };
      console.log('✅ [3/6 Connection Test] Successfully reached Firestore server.');
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const msg = err?.message || String(err);
      report.connection = { ok: false, error: `[${code}] ${msg}` };
      console.warn(`❌ [3/6 Connection Test] Server probe failed: [${code}] ${msg}`);
    }

    // Step 4: Firestore Read (direct document read on providers matching "allow get" rule)
    try {
      const snap = await getDoc(doc(db, 'providers', report.auth.uid || 'probe_connection'));
      report.firestoreRead = { ok: true };
      console.log(`✅ [4/6 Firestore Read] Successfully verified document read on "providers" (doc exists: ${snap.exists()}).`);
    } catch (err: any) {
      const code = err?.code || 'unknown';
      const msg = err?.message || String(err);
      report.firestoreRead = { ok: false, error: `[${code}] ${msg}` };
      console.warn(`❌ [4/6 Firestore Read] Query failed: [${code}] ${msg}`, err);
    }

    // Step 5: Firestore Write (user profile)
    if (report.auth.uid) {
      try {
        await setDoc(doc(db, 'users', report.auth.uid), {
          id: report.auth.uid,
          role: 'customer',
          diagnosticPingAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }, { merge: true });
        report.firestoreWrite = { ok: true };
        console.log(`✅ [5/6 Firestore Write] Successfully wrote user record to "users/${report.auth.uid}".`);
      } catch (err: any) {
        const code = err?.code || 'unknown';
        const msg = err?.message || String(err);
        report.firestoreWrite = { ok: false, error: `[${code}] ${msg}` };
        console.warn(`❌ [5/6 Firestore Write] Write failed: [${code}] ${msg}`, err);
      }
    }

    // Step 6: Security Rules Assessment
    if (report.firestoreRead.ok && report.firestoreWrite.ok) {
      report.securityRules = {
        ok: true,
        message: 'Security rules on Firebase Console project are active and permit required operations.',
      };
      console.log('✅ [6/6 Security Rules] Rules are functioning correctly for anonymous authenticated users.');
    } else {
      const reasons: string[] = [];
      if (!report.connection.ok) reasons.push(`Connection: ${report.connection.error}`);
      if (!report.firestoreRead.ok) reasons.push(`Read: ${report.firestoreRead.error}`);
      if (!report.firestoreWrite.ok) reasons.push(`Write: ${report.firestoreWrite.error}`);

      const isPermissionDenied = reasons.some((r) => r.includes('permission-denied') || r.includes('Missing or insufficient permissions'));
      report.securityRules = {
        ok: false,
        message: isPermissionDenied
          ? `Firebase Console Firestore Security Rules for "${report.config.projectId}" are currently rejecting reads/writes (permission-denied). Rules must be published in Firebase Console.`
          : `Firestore operations failed: ${reasons.join(' | ')}`,
      };
      console.warn(`❌ [6/6 Security Rules] Diagnostics: ${report.securityRules.message}`);
    }
  }

  console.groupEnd();
  latestDiagnosticReport = report;
  return report;
}

// Auto-run diagnostic in background on startup if configured
if (isFirebaseConfigured()) {
  setTimeout(() => {
    runFirebaseDiagnostics().catch(() => {});
  }, 100);
}


// Standardized error context handling conforming to Firebase skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `%c[KEREK Firestore Error] ${operationType.toUpperCase()} on '${path}' failed:`,
    'color: #dc2626; font-weight: bold;',
    error
  );
  const errInfo: FirestoreErrorInfo = {
    error: message,
    operationType,
    path,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
  };
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Validates connection to Firestore as mandated by SKILL.md.
 * Returns true if remote Firestore is online and permissions are granted.
 */
export async function testFirestoreConnection(): Promise<boolean> {
  if (!isFirebaseConfigured() || !db) return false;
  try {
    const uid = await ensureFirebaseAuth();
    if (!uid) {
      console.warn('[KEREK Firebase] Anonymous auth could not be established.');
      return false;
    }
    // Probes connection on providers which allows signed-in reads
    await getDocFromServer(doc(db, 'providers', 'probe_connection'));
    return true;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[KEREK Firebase Connection Probe Note]:', msg, err);
    return false;
  }
}


