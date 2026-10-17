// The operator's panel: who is an operator (admin claim, given by the claimAdmin function to the
// numbers in config/admins) and the reads and changes the panel makes. The security rules allow
// these only for an admin account.
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { app, auth, db, isFirebaseConfigured } from './firebase';
import { normalizeRequestStatus, Provider, ServiceRequest } from '../types';

const CHECK_EVERY_MS = 12 * 3600 * 1000;
const checkKey = (uid: string) => `kerek_admin_check_${uid}`;

async function tokenSaysAdmin(forceRefresh = false): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user) return false;
  const res = await user.getIdTokenResult(forceRefresh);
  return res.claims.admin === true;
}

/**
 * Whether this account is an operator. Asks the server at most every 12 hours (and right after a
 * login, with force); the answer in the sign-in token is used in between.
 */
export async function checkAdminRole(force = false): Promise<boolean> {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured() || !app || !user || !user.phoneNumber) return false;
  let last = 0;
  try {
    last = Number(localStorage.getItem(checkKey(user.uid)) || 0);
  } catch {
    last = 0;
  }
  const current = await tokenSaysAdmin().catch(() => false);
  if (!force && Date.now() - last < CHECK_EVERY_MS) return current;
  try {
    const { data } = await httpsCallable<unknown, { admin: boolean }>(getFunctions(app, 'asia-south1'), 'claimAdmin')({});
    try {
      localStorage.setItem(checkKey(user.uid), String(Date.now()));
    } catch {
      // not remembered: checked again next time
    }
    if (data.admin !== current) return await tokenSaysAdmin(true);
    return data.admin;
  } catch {
    return current;
  }
}

function firestore() {
  if (!db) throw new Error('Firestore is not configured');
  return db;
}

export interface HealthNumbers {
  /** Requests in the last 30 days (at most the newest 500 are read) */
  requests: number;
  /** Average offers per request */
  offersPerRequest: number;
  /** Share of requests that got at least one offer */
  withOffersShare: number;
  /** Share of requests where the customer chose a master */
  hiredShare: number;
  /** Average minutes from a request to a master's offer, over all masters */
  avgResponseMinutes: number | null;
  masters: number;
  pausedMasters: number;
}

const HIRED = ['PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];

export async function loadHealthNumbers(): Promise<HealthNumbers> {
  const fs = firestore();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [reqSnap, statsSnap, provSnap] = await Promise.all([
    getDocs(query(collection(fs, 'requests'), orderBy('createdAt', 'desc'), limit(500))),
    getDocs(query(collection(fs, 'providerStats'), limit(500))),
    getDocs(query(collection(fs, 'providers'), limit(500))),
  ]);
  const requests = reqSnap.docs.map((d) => d.data() as ServiceRequest).filter((r) => (r.createdAt || '') >= since);
  const n = requests.length;
  const offers = requests.reduce((sum, r) => sum + (typeof r.offerCount === 'number' ? r.offerCount : 0), 0);
  const withOffers = requests.filter((r) => (r.offerCount || 0) > 0 || Boolean(r.selectedOfferId)).length;
  const hired = requests.filter((r) => HIRED.includes(r.status) || HIRED.includes(normalizeRequestStatus(r.status))).length;
  let minutes = 0;
  let answers = 0;
  statsSnap.docs.forEach((d) => {
    const s = d.data();
    if (typeof s.responseMinutesTotal === 'number' && typeof s.responseCount === 'number') {
      minutes += s.responseMinutesTotal;
      answers += s.responseCount;
    }
  });
  const providers = provSnap.docs.map((d) => d.data() as Provider).filter((p) => !p.isDemo);
  return {
    requests: n,
    offersPerRequest: n ? offers / n : 0,
    withOffersShare: n ? withOffers / n : 0,
    hiredShare: n ? hired / n : 0,
    avgResponseMinutes: answers ? Math.round(minutes / answers) : null,
    masters: providers.length,
    pausedMasters: providers.filter((p) => p.paused).length,
  };
}

export interface AdminReport {
  id: string;
  reporterId: string;
  targetType: 'provider' | 'offer' | 'request' | 'conversation';
  targetId: string;
  requestId?: string;
  reason: string;
  details?: string;
  createdAt: string;
  status?: 'open' | 'resolved';
  resolution?: string;
}

export async function loadReports(): Promise<AdminReport[]> {
  const snap = await getDocs(query(collection(firestore(), 'reports'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminReport);
}

export async function resolveReport(id: string, resolution: string): Promise<void> {
  await updateDoc(doc(firestore(), 'reports', id), {
    status: 'resolved',
    resolution: resolution.slice(0, 300),
    resolvedAt: new Date().toISOString(),
  });
}

/** The account a report is about: the master of a provider or offer report, the customer of a request report. */
export async function reportedAccount(r: AdminReport): Promise<{ uid: string; isMaster: boolean } | null> {
  const fs = firestore();
  if (r.targetType === 'provider') return { uid: r.targetId, isMaster: true };
  if (r.targetType === 'offer') {
    const offer = (await getDoc(doc(fs, 'offers', r.targetId))).data();
    const uid = String(offer?.providerUserId || offer?.providerId || '');
    return uid ? { uid, isMaster: true } : null;
  }
  if (r.targetType === 'request') {
    const req = (await getDoc(doc(fs, 'requests', r.targetId))).data();
    const uid = String(req?.customerId || '');
    return uid ? { uid, isMaster: false } : null;
  }
  return null;
}

export async function loadMasters(): Promise<Provider[]> {
  const snap = await getDocs(query(collection(firestore(), 'providers'), limit(500)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Provider)
    .filter((p) => !p.isDemo)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export type MasterFlag = 'verified' | 'iinVerified' | 'hasCertificate' | 'hidden' | 'blocked';

export async function setMasterFlag(uid: string, flag: MasterFlag, value: boolean): Promise<void> {
  await updateDoc(doc(firestore(), 'providers', uid), { [flag]: value, updatedAt: new Date().toISOString() });
}

export async function isAccountBlocked(uid: string): Promise<boolean> {
  return (await getDoc(doc(firestore(), 'bans', uid))).exists();
}

/** Blocks publishing for the account; a master's profile is also hidden from customers and new requests. */
export async function blockAccount(uid: string, reason: string, isMaster: boolean): Promise<void> {
  const fs = firestore();
  await setDoc(doc(fs, 'bans', uid), { uid, reason: reason.slice(0, 300), createdAt: new Date().toISOString() });
  if (isMaster && (await getDoc(doc(fs, 'providers', uid))).exists()) await setMasterFlag(uid, 'blocked', true);
}

export async function unblockAccount(uid: string): Promise<void> {
  const fs = firestore();
  await deleteDoc(doc(fs, 'bans', uid));
  if ((await getDoc(doc(fs, 'providers', uid))).exists()) await setMasterFlag(uid, 'blocked', false);
}

// ------------------------------------------------------------ Review check (functions/src/reviewModeration.ts)

export type ReviewSignalCode =
  | 'same_device'
  | 'same_network'
  | 'ring_device'
  | 'ring_network'
  | 'quick_job'
  | 'instant_pick'
  | 'new_account'
  | 'new_master'
  | 'review_burst'
  | 'contact_in_text';

/** What the check knew about the two accounts and the job (functions/src/reviewModeration.ts) */
export interface ReviewContext {
  customerAgeDays?: number;
  customerJobs?: number;
  customerMasters?: number;
  masterAgeDays?: number;
  masterPublished?: number;
  masterRejected?: number;
  minutesToChoose?: number;
  minutesToDone?: number;
  offers?: number;
}

export interface ReviewCheck {
  id: string;
  customerId: string;
  providerId: string;
  customerName?: string;
  providerName?: string;
  rating: number;
  comment?: string;
  createdAt: string;
  /** Not set while the check is still running */
  status?: 'published' | 'held' | 'rejected';
  /** detail: minutes (quick_job, instant_pick), hours (new_account) or a number of reviews */
  signals: { code: ReviewSignalCode; detail?: number }[];
  /** Gemini's reading of the text */
  ai?: { decision: 'approve' | 'hold'; reason: string };
  context?: ReviewContext;
  decidedBy?: 'ai' | 'operator';
}

/** Whether the operator still has to decide: held by the check, or the check never finished. */
export const reviewNeedsDecision = (r: ReviewCheck) => r.status === 'held' || !r.status;

function numbersOnly(raw: Record<string, unknown>): ReviewContext {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out as ReviewContext;
}

/** The newest submitted reviews, with what the check found. */
export async function loadReviewChecks(): Promise<ReviewCheck[]> {
  const snap = await getDocs(query(collection(firestore(), 'reviewSubmissions'), orderBy('createdAt', 'desc'), limit(200)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      customerId: String(x.customerId || ''),
      providerId: String(x.providerId || ''),
      customerName: typeof x.customerName === 'string' ? x.customerName : undefined,
      providerName: typeof x.providerName === 'string' ? x.providerName : undefined,
      rating: Math.max(0, Math.min(5, Math.round(Number(x.rating) || 0))),
      comment: typeof x.comment === 'string' ? x.comment : undefined,
      createdAt: String(x.createdAt || ''),
      status: ['published', 'held', 'rejected'].includes(x.status) ? x.status : undefined,
      signals: Array.isArray(x.signals) ? x.signals.filter((s: unknown) => typeof (s as { code?: unknown })?.code === 'string') : [],
      ai: x.ai && typeof x.ai.decision === 'string' ? { decision: x.ai.decision, reason: String(x.ai.reason || '') } : undefined,
      context: x.context && typeof x.context === 'object' ? numbersOnly(x.context) : undefined,
      decidedBy: x.decidedBy === 'ai' || x.decidedBy === 'operator' ? x.decidedBy : undefined,
    };
  });
}

/** Publishes a review (also one rejected earlier) or rejects it (a published one is taken down). */
export async function decideReviewCheck(id: string, action: 'publish' | 'reject'): Promise<'published' | 'rejected'> {
  if (!app) throw new Error('Firebase is not configured');
  const { data } = await httpsCallable<{ id: string; action: string }, { status: string }>(
    getFunctions(app, 'asia-south1'),
    'decideReview'
  )({ id, action });
  return data.status === 'published' ? 'published' : 'rejected';
}

/** The reviewing customer's phone number, for a check call before deciding (looked up on the server). */
export async function reviewerPhone(id: string): Promise<string> {
  if (!app) throw new Error('Firebase is not configured');
  const { data } = await httpsCallable<{ id: string }, { phone: string }>(getFunctions(app, 'asia-south1'), 'reviewerPhone')({ id });
  return String(data.phone || '');
}

// ------------------------------------------------------------ Operator history and chat evidence

export interface AdminLogEntry {
  id: string;
  action: string;
  target: string;
  actorUid?: string;
  actorType?: string;
  changed?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  /** ISO time from the server timestamp */
  at: string;
}

/** The newest records of what operators did (functions/src/adminLog.ts). */
export async function loadAdminLog(max = 50): Promise<AdminLogEntry[]> {
  const snap = await getDocs(query(collection(firestore(), 'adminLog'), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((d) => {
    const x = d.data();
    const at = x.at && typeof x.at.toDate === 'function' ? x.at.toDate().toISOString() : '';
    return {
      id: d.id,
      action: String(x.action || ''),
      target: String(x.target || ''),
      actorUid: typeof x.actorUid === 'string' ? x.actorUid : undefined,
      actorType: typeof x.actorType === 'string' ? x.actorType : undefined,
      changed: Array.isArray(x.changed) ? x.changed.map(String) : undefined,
      before: x.before && typeof x.before === 'object' ? x.before : undefined,
      after: x.after && typeof x.after === 'object' ? x.after : undefined,
      reason: typeof x.reason === 'string' ? x.reason : undefined,
      at,
    };
  });
}

export interface ConversationEvidence {
  reported: { uid: string; isMaster: boolean };
  messages: { senderRole: 'customer' | 'provider'; text: string; createdAt: string; files: string[] }[];
}

/** For a chat report: the last 50 messages and the account reported (looked up on the server, logged). */
export async function loadConversationEvidence(reportId: string): Promise<ConversationEvidence> {
  if (!app) throw new Error('Firebase is not configured');
  const { data } = await httpsCallable<{ reportId: string }, ConversationEvidence>(getFunctions(app, 'asia-south1'), 'reportEvidence')({ reportId });
  return { reported: data.reported, messages: Array.isArray(data.messages) ? data.messages : [] };
}
