import type { Alert, Booking, Business, ChatMessage, Order } from '../../functions/src/demo/types';
import type { UiLang } from './i18n';

/** The demo as the page sees it (functions/src/demo/index.ts → view) */
export interface DemoView {
  id: string;
  business: Business;
  bookings: Booking[];
  orders: Order[];
  messages: ChatMessage[];
  alerts: Alert[];
  consent: 'none' | 'asked' | 'given';
  chatLang: 'ru' | 'kz';
  botPaused: boolean;
  expiresAt: number;
}

export interface Media {
  data: string;
  mime: string;
}

export interface BuildPayload {
  name: string;
  type: string;
  text: string;
  photo?: Media;
  staff: string;
  address: string;
}

export interface DemoApi {
  start(p: { template?: string; build?: BuildPayload; lang: UiLang }): Promise<DemoView>;
  send(p: { id: string; text?: string; button?: string; voice?: Media & { seconds: number }; photo?: Media }): Promise<DemoView>;
  owner(p: { id: string; action: string; ref?: string; text?: string }): Promise<DemoView>;
}

export type ApiProblem = 'busy' | 'tooMany' | 'expired' | 'build' | 'generic';

export class ApiError extends Error {
  constructor(public problem: ApiProblem) {
    super(problem);
  }
}

function problemOf(err: unknown): ApiProblem {
  const code = String((err as { code?: string })?.code ?? '');
  if (code.endsWith('resource-exhausted')) return 'tooMany';
  if (code.endsWith('aborted')) return 'busy';
  if (code.endsWith('not-found')) return 'expired';
  if (code.endsWith('failed-precondition')) return 'build';
  return 'generic';
}

async function firebaseApi(): Promise<DemoApi> {
  const [{ initializeApp, getApps }, { getAuth, signInAnonymously }, { getFunctions, httpsCallable }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/functions'),
  ]);
  const env = import.meta.env;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    });
  const auth = getAuth(app);
  const functions = getFunctions(app, 'asia-south1');
  const signedIn = auth.currentUser ? Promise.resolve() : auth.authStateReady().then(() => (auth.currentUser ? undefined : signInAnonymously(auth).then(() => undefined)));
  const call = async (name: string, data: unknown): Promise<DemoView> => {
    await signedIn;
    try {
      const res = await httpsCallable<unknown, DemoView>(functions, name, { timeout: 90_000 })(data);
      return res.data;
    } catch (err) {
      throw new ApiError(problemOf(err));
    }
  };
  return {
    start: (p) => call('demoStart', p),
    send: (p) => call('demoSend', p),
    owner: (p) => call('demoOwner', p),
  };
}

let api: Promise<DemoApi> | null = null;

export function getApi(): Promise<DemoApi> {
  if (!api) {
    // Screenshots and layout work without the server: VITE_DEMO_MOCK=1 builds use a local stand-in
    api = import.meta.env.VITE_DEMO_MOCK === '1' ? import('./mock').then((m) => m.mockApi()) : firebaseApi();
    api.catch(() => {
      api = null;
    });
  }
  return api;
}
