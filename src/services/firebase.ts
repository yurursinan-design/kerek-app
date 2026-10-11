import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc, setDoc, getDocFromServer, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

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

// Read fallback configuration from root firebase-applet-config.json if present
let fileConfig: Record<string, any> = {};
try {
  const configs = import.meta.glob(
    ['/firebase-applet-config.json', '../*.json', '../../firebase-applet-config.json'],
    { eager: true }
  ) as Record<string, any>;
  for (const [key, value] of Object.entries(configs)) {
    if (key.endsWith('firebase-applet-config.json') && value) {
      fileConfig = ((value as any).default || value) as Record<string, any>;
      break;
    }
  }
} catch {
  fileConfig = {};
}
const rootConfig = fileConfig.firebaseConfig || fileConfig;

const getEnvOrFile = (envVal: string | undefined, fieldKey: string): string | undefined => {
  if (envVal && typeof envVal === 'string' && envVal.trim().length > 0) {
    return envVal.trim();
  }
  const fileVal = rootConfig[fieldKey];
  if (fileVal && typeof fileVal === 'string' && fileVal.trim().length > 0) {
    return fileVal.trim();
  }
  return undefined;
};

const firebaseConfig = {
  apiKey: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_API_KEY : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_API_KEY : undefined
    ),
    'apiKey'
  ),
  authDomain: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined
    ),
    'authDomain'
  ),
  projectId: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_PROJECT_ID : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_PROJECT_ID : undefined
    ),
    'projectId'
  ),
  storageBucket: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined
    ),
    'storageBucket'
  ),
  messagingSenderId: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined
    ),
    'messagingSenderId'
  ),
  appId: getEnvOrFile(
    getEnvVar(
      typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_APP_ID : undefined,
      typeof process !== 'undefined' ? process.env?.VITE_FIREBASE_APP_ID : undefined
    ),
    'appId'
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
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured()) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    db = getFirestore(app);

    const isNodeEnv = typeof window === 'undefined' && typeof process !== 'undefined';
    const shouldConnectEmulator =
      Boolean(process.env?.FIRESTORE_EMULATOR_HOST) ||
      process.env?.VITE_USE_EMULATOR === 'true' ||
      (isNodeEnv && process.env?.ALLOW_LIVE_FIREBASE !== 'true');

    if (shouldConnectEmulator) {
      const emulatorHostStr = process.env?.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
      const parts = emulatorHostStr.split(':');
      const host = parts[0] && parts[0].trim().length > 0 ? parts[0].trim() : '127.0.0.1';
      const port = parseInt(parts[1] || '8088', 10) || 8088;
      try {
        connectFirestoreEmulator(db, host, port);
      } catch {}

      if (auth) {
        const authHostStr = process.env?.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
        const authParts = authHostStr.replace(/^https?:\/\//, '').split(':');
        const authHost = authParts[0] && authParts[0].trim().length > 0 ? authParts[0].trim() : '127.0.0.1';
        const authPort = parseInt(authParts[1] || '9099', 10) || 9099;
        try {
          connectAuthEmulator(auth, `http://${authHost}:${authPort}`);
        } catch {}
      }
    }
    try {
      storage = getStorage(app);
    } catch (stErr) {
      console.warn('[KEREK Firebase] Storage init note:', stErr);
      storage = null;
    }

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
    storage = null;
  }
}

export { app, auth, db, storage };

export function createSecondaryFirebaseApp(appName: string) {
  if (!app) return null;
  const secondaryApp = initializeApp(app.options, appName);
  const secondaryAuth = getAuth(secondaryApp);
  const secondaryDb = getFirestore(secondaryApp);

  const isNodeEnv = typeof window === 'undefined' && typeof process !== 'undefined';
  const shouldConnectEmulator =
    Boolean(process.env?.FIRESTORE_EMULATOR_HOST) ||
    process.env?.VITE_USE_EMULATOR === 'true' ||
    (isNodeEnv && process.env?.ALLOW_LIVE_FIREBASE !== 'true');

  if (shouldConnectEmulator) {
    const emulatorHostStr = process.env?.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
    const parts = emulatorHostStr.split(':');
    const host = parts[0] && parts[0].trim().length > 0 ? parts[0].trim() : '127.0.0.1';
    const port = parseInt(parts[1] || '8088', 10) || 8088;
    try {
      connectFirestoreEmulator(secondaryDb, host, port);
    } catch {}

    const authHostStr = process.env?.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const authParts = authHostStr.replace(/^https?:\/\//, '').split(':');
    const authHost = authParts[0] && authParts[0].trim().length > 0 ? authParts[0].trim() : '127.0.0.1';
    const authPort = parseInt(authParts[1] || '9099', 10) || 9099;
    try {
      connectAuthEmulator(secondaryAuth, `http://${authHost}:${authPort}`);
    } catch {}
  }

  return { app: secondaryApp, auth: secondaryAuth, db: secondaryDb };
}

/**
 * Test support, Auth emulator only: gives the signed-in test user a verified phone number, the way
 * SMS login does in production (publishing requires a phone-verified account). The browser build
 * never runs this: there `process.env` is empty, so no emulator host is set.
 */
export async function attachEmulatorTestPhone(targetAuth: Auth | null = auth): Promise<void> {
  const host = typeof process !== 'undefined' ? process.env?.FIREBASE_AUTH_EMULATOR_HOST : undefined;
  const user = targetAuth?.currentUser;
  // Skip when there is no real signed-in user (some tests stub currentUser with a plain object)
  if (!host || !user || user.phoneNumber || typeof user.getIdToken !== 'function') return;
  // Unique, stable number per test user (the emulator rejects one number on two accounts)
  let hash = 0;
  for (const ch of user.uid) hash = (hash * 31 + ch.charCodeAt(0)) % 10000000;
  const phoneNumber = `+7700${String(hash).padStart(7, '0')}`;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/projects/${firebaseConfig.projectId}/accounts:update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.uid, phoneNumber }),
    }
  );
  if (!res.ok) {
    throw new Error(`Auth emulator could not attach a test phone number: ${res.status} ${await res.text()}`);
  }
  await user.reload();
  await user.getIdToken(true);
}

const autoTestPhone =
  typeof process !== 'undefined' && process.env?.KEREK_TEST_AUTO_PHONE === '1' && Boolean(process.env?.FIREBASE_AUTH_EMULATOR_HOST);

let authInitPromise: Promise<string | null> | null = null;

/**
 * Ensures an active Firebase Auth session exists (e.g. Anonymous authentication).
 * Must be awaited before executing any Firestore operation.
 */
export async function ensureFirebaseAuth(): Promise<string | null> {
  if (!isFirebaseConfigured() || !auth) {
    return null;
  }
  // Wait for the saved session to be restored first. Before that, currentUser is null even for a
  // signed-in visitor, and signing in anonymously at that moment replaced a phone-verified session
  // with a new anonymous account on every page load.
  try {
    await auth.authStateReady();
  } catch {}
  if (auth.currentUser?.uid) {
    try {
      localStorage.setItem('kerek_current_user_id_v2', auth.currentUser.uid);
    } catch {}
    if (autoTestPhone && !auth.currentUser.phoneNumber) {
      await attachEmulatorTestPhone(auth).catch((e) => console.warn('[KEREK Firebase] test phone note:', e?.message || e));
    }
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
            if (autoTestPhone) {
              await attachEmulatorTestPhone(auth).catch((e) => console.warn('[KEREK Firebase] test phone note:', e?.message || e));
            }
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
        // Touch only the ping field; never overwrite the user's role or original createdAt
        const userRef = doc(db, 'users', report.auth.uid);
        const existingUser = await getDoc(userRef);
        await setDoc(
          userRef,
          existingUser.exists()
            ? { id: report.auth.uid, diagnosticPingAt: new Date().toISOString() }
            : { id: report.auth.uid, createdAt: new Date().toISOString(), diagnosticPingAt: new Date().toISOString() },
          { merge: true }
        );
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

// Diagnostics run only on demand from the developer panel (?debug=1). Running them on every app
// open cost extra reads/writes and overwrote the user's record (role and createdAt) each time.


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


