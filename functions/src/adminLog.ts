import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { isOperator } from './admin';
import { tooOldToRetry } from './limits';

/**
 * The operator's history (adminLog): every block and unblock, trust badge, hidden/blocked flag,
 * report decision, operator-list change, review decision and every look at someone's private data
 * (a reviewer's phone, a reported conversation) is recorded on the server with who, when, what and
 * the values before and after. Nobody can write or delete these records from the app; only an
 * operator reads them (firestore.rules).
 */

export interface AdminLogEntry {
  action: string;
  /** The changed document, e.g. "bans/uid123" */
  target: string;
  actorUid?: string;
  /** Who made the change according to Firebase: app_user, admin, service_account, unauthenticated, … */
  actorType?: string;
  changed?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
}

/** Short, plain copies of values for the log: strings cut to 300 characters, nested data as JSON. */
function plain(v: unknown): unknown {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') return v ?? null;
  if (typeof v === 'string') return v.slice(0, 300);
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  return JSON.stringify(v).slice(0, 300);
}

function pick(data: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (data && k in data) out[k] = plain(data[k]);
  return out;
}

/** Which of the watched fields differ between two versions (all fields when watched is null). */
export function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, watched: string[] | null): string[] {
  const keys = watched || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return keys.filter((k) => JSON.stringify(plain(before?.[k])) !== JSON.stringify(plain(after?.[k]))).sort();
}

/** Writes one record; the same id twice (a retried event) keeps the first. */
export async function writeAdminLog(id: string, entry: AdminLogEntry): Promise<void> {
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
  try {
    await getFirestore()
      .collection('adminLog')
      .doc(id.replace(/\//g, '_').slice(0, 1400))
      .create({ ...clean, at: FieldValue.serverTimestamp() });
  } catch (err: any) {
    if (err?.code !== 6 && err?.code !== 'already-exists') throw err;
  }
}

type WatchedDoc = { document: string; action: string; fields: string[] | null; reasonField?: string };

const WATCHED: Record<string, WatchedDoc> = {
  bans: { document: 'bans/{id}', action: 'ban', fields: null, reasonField: 'reason' },
  providers: { document: 'providers/{id}', action: 'master_flags', fields: ['verified', 'iinVerified', 'hasCertificate', 'hidden', 'blocked'] },
  reports: { document: 'reports/{id}', action: 'report_decision', fields: ['status', 'resolution', 'resolvedAt'], reasonField: 'resolution' },
  config: { document: 'config/{id}', action: 'config', fields: null },
};

function watch(w: WatchedDoc) {
  return onDocumentWrittenWithAuthContext({ document: w.document, region: 'asia-south1', maxInstances: 5, retry: true }, async (event) => {
    if (tooOldToRetry(event.time)) return;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : undefined;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : undefined;
    const changed = changedFields(before, after, w.fields);
    if (changed.length === 0) return;
    const ref = event.data?.after?.ref || event.data?.before?.ref;
    const action = w.action === 'ban' ? (after ? (before ? 'ban_changed' : 'ban') : 'unban') : w.action;
    const reason = w.reasonField ? (after?.[w.reasonField] ?? before?.[w.reasonField]) : undefined;
    await writeAdminLog(event.id, {
      action,
      target: ref?.path || w.document,
      actorUid: event.authId || undefined,
      actorType: event.authType,
      changed,
      before: pick(before, changed),
      after: pick(after, changed),
      reason: typeof reason === 'string' ? reason.slice(0, 300) : undefined,
    });
  });
}

export const adminLogBans = watch(WATCHED.bans);
export const adminLogMasterFlags = watch(WATCHED.providers);
export const adminLogReports = watch(WATCHED.reports);
export const adminLogConfig = watch(WATCHED.config);

async function operatorUid(request: { auth?: { uid: string; token: Record<string, unknown> } }): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid || !(await isOperator(request.auth?.token))) throw new HttpsError('permission-denied', 'Only the operator can do this.');
  return uid;
}

export interface EvidenceMessage {
  senderRole: 'customer' | 'provider';
  text: string;
  createdAt: string;
  files: string[];
}

/**
 * For a report about a conversation: the last 50 messages of that conversation and the account it
 * is about (the participant who did not report). Only for the operator, and every look is logged.
 */
export const reportEvidence = onCall({ region: 'asia-south1', maxInstances: 5 }, async (request) => {
  const actor = await operatorUid(request);
  const reportId = String(request.data?.reportId || '');
  if (!reportId || reportId.length > 300 || reportId.includes('/')) throw new HttpsError('invalid-argument', 'Unknown report.');
  const db = getFirestore();
  const report = (await db.collection('reports').doc(reportId).get()).data();
  if (!report || report.targetType !== 'conversation') throw new HttpsError('invalid-argument', 'Not a conversation report.');
  const convId = String(report.targetId || '');
  const conv = (await db.collection('conversations').doc(convId).get()).data();
  if (!conv) throw new HttpsError('not-found', 'The conversation no longer exists.');
  const reporter = String(report.reporterId || '');
  const customer = String(conv.customerId || '');
  const master = String(conv.providerUserId || conv.providerId || '');
  if (reporter !== customer && reporter !== master) throw new HttpsError('failed-precondition', 'The reporter is not in this conversation.');
  const snap = await db.collection('conversations').doc(convId).collection('messages').orderBy('createdAt', 'desc').limit(50).get();
  const messages: EvidenceMessage[] = snap.docs
    .map((d) => d.data())
    .reverse()
    .map((m) => ({
      senderRole: m.senderRole === 'provider' ? 'provider' : 'customer',
      text: typeof m.text === 'string' ? m.text.slice(0, 2000) : '',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
      files: Array.isArray(m.attachments) ? m.attachments.map((a: any) => String(a?.fileName || '').slice(0, 100)).filter(Boolean) : [],
    }));
  await writeAdminLog(`evidence_${reportId}_${Date.now()}`, {
    action: 'viewed_conversation',
    target: `conversations/${convId}`,
    actorUid: actor,
    actorType: 'app_user',
    reason: `report ${reportId}`,
  });
  return {
    reported: reporter === customer ? { uid: master, isMaster: true } : { uid: customer, isMaster: false },
    messages,
  };
});
