/**
 * The operator's history and chat-report evidence (functions/src/adminLog.ts) against the Firestore
 * emulator: changes to bans, master flags and reports are recorded with who/what/before/after, a
 * retried event is recorded once, and only an operator can read a reported conversation (logged).
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

/** A Firestore event as the trigger receives it */
function event(id: string, path: string, before: any, after: any, authId = 'op_uid') {
  const snap = (data: any) => ({ exists: Boolean(data), data: () => data, ref: { path } });
  return { id, time: new Date().toISOString(), authType: 'app_user', authId, params: {}, data: { before: snap(before), after: snap(after) } };
}

async function main() {
  const logPath = '../functions/src/adminLog';
  const al = await import(logPath);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const db = getFirestore();
  const tail = String(Date.now()).slice(-7);

  // --- What changed
  assert(JSON.stringify(al.changedFields({ verified: false, name: 'A' }, { verified: true, name: 'B' }, ['verified', 'hidden'])) === '["verified"]', 'Only watched fields count for a master profile');
  assert(al.changedFields({ a: 1 }, { a: 1 }, null).length === 0, 'No change, nothing to record');

  // --- Triggers record the operator's changes
  await al.adminLogBans.run(event(`ev_ban_${tail}`, `bans/u_${tail}`, undefined, { uid: `u_${tail}`, reason: 'мошенник', createdAt: 'x' }));
  const ban = (await db.collection('adminLog').doc(`ev_ban_${tail}`).get()).data();
  assert(ban?.action === 'ban' && ban?.actorUid === 'op_uid' && ban?.reason === 'мошенник' && ban?.target === `bans/u_${tail}` && typeof ban?.at?.toMillis === 'function', 'A block is recorded with who, why and server time', ban);
  await al.adminLogBans.run(event(`ev_ban_${tail}`, `bans/u_${tail}`, undefined, { uid: `u_${tail}`, reason: 'changed', createdAt: 'x' }));
  assert((await db.collection('adminLog').doc(`ev_ban_${tail}`).get()).get('reason') === 'мошенник', 'A retried event is recorded once (the first record stays)');
  await al.adminLogBans.run(event(`ev_unban_${tail}`, `bans/u_${tail}`, { uid: `u_${tail}`, reason: 'мошенник' }, undefined));
  assert((await db.collection('adminLog').doc(`ev_unban_${tail}`).get()).get('action') === 'unban', 'An unblock is recorded');

  await al.adminLogMasterFlags.run(event(`ev_flag_${tail}`, `providers/p_${tail}`, { name: 'A', verified: false }, { name: 'A', verified: true }));
  const flag = (await db.collection('adminLog').doc(`ev_flag_${tail}`).get()).data();
  assert(flag?.action === 'master_flags' && flag?.before?.verified === false && flag?.after?.verified === true, 'A trust badge is recorded with before and after', flag);
  await al.adminLogMasterFlags.run(event(`ev_rename_${tail}`, `providers/p_${tail}`, { name: 'A' }, { name: 'B' }, `p_${tail}`));
  assert(!(await db.collection('adminLog').doc(`ev_rename_${tail}`).get()).exists, 'A master renaming their own profile is not an operator action');

  await al.adminLogReports.run(event(`ev_rep_${tail}`, `reports/r_${tail}`, { status: 'open' }, { status: 'resolved', resolution: 'Заблокирован', resolvedAt: 'x' }));
  assert((await db.collection('adminLog').doc(`ev_rep_${tail}`).get()).get('reason') === 'Заблокирован', 'A report decision is recorded with its resolution');

  // --- Evidence of a reported conversation
  await db.doc('config/admins').set({ phones: ['+77000000009'] }, { merge: true });
  const convId = `conv_ev_${tail}`;
  await db.doc(`conversations/${convId}`).set({ id: convId, customerId: `c_${tail}`, providerUserId: `m_${tail}`, providerId: `m_${tail}` });
  await db.doc(`conversations/${convId}/messages/m1`).set({ senderRole: 'provider', text: 'Ақшаны картаға алдын ала аударыңыз', createdAt: '2026-10-17T10:00:00.000Z' });
  await db.doc(`conversations/${convId}/messages/m2`).set({ senderRole: 'customer', text: 'Неге?', createdAt: '2026-10-17T10:01:00.000Z', attachments: [{ fileName: 'chek.pdf' }] });
  const reportId = `REPORT-c_${tail}-conversation-${convId}`;
  await db.doc(`reports/${reportId}`).set({ id: reportId, reporterId: `c_${tail}`, targetType: 'conversation', targetId: convId, reason: 'fraud' });
  const call = (token: any) => al.reportEvidence.run({ data: { reportId }, auth: { uid: 'op_uid', token }, rawRequest: { headers: {} } } as any);
  let refused = '';
  try {
    await call({ phone_number: '+77011112233' });
  } catch (err: any) {
    refused = String(err?.code);
  }
  assert(refused === 'permission-denied', 'Someone who is not an operator cannot read a reported chat', refused);
  const ev = await call({ admin: true, phone_number: '+77000000009' });
  assert(ev.messages.length === 2 && ev.messages[0].text.includes('алдын ала') && ev.messages[1].files[0] === 'chek.pdf', 'The operator sees the messages in order, with file names', ev.messages);
  assert(ev.reported.uid === `m_${tail}` && ev.reported.isMaster === true, 'The reported account is the other participant (here the master)');
  const looks = await db.collection('adminLog').where('target', '==', `conversations/${convId}`).get();
  assert(looks.docs.some((d: any) => d.get('action') === 'viewed_conversation' && d.get('actorUid') === 'op_uid'), 'Looking at the chat is recorded in the history');

  console.log(failed ? `\nADMIN LOG: ${failed} FAILED` : '\nADMIN LOG: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Admin log test error:', err);
  process.exit(1);
});
