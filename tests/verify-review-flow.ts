/**
 * The review check against the Firestore and Auth emulators (no Gemini or Claude call): the login
 * signals (functions/src/signals.ts), the signals found between a customer, a master and the master's
 * other reviewers, holding, publishing and rejecting (functions/src/reviewModeration.ts), the rating
 * that counts each customer once (functions/src/stats.ts) and forgetting a deleted account.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const rmPath = '../functions/src/reviewModeration';
  const sgPath = '../functions/src/signals';
  const stPath = '../functions/src/stats';
  const rm = await import(rmPath);
  const sg = await import(sgPath);
  const st = await import(stPath);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const { getAuth } = requireFromFunctions('firebase-admin/auth');
  const db = getFirestore();

  const tail = String(Date.now()).slice(-7);
  const customer = `cust_${tail}`;
  const master = `mast_${tail}`;
  const requestId = `req_rv_${tail}`;
  const offerId = `OFFER-${requestId}-${master}`;
  const phoneId = `phone-${tail}-6f1c2d3e4b5a`;

  // --- 1. Login signals: one phone used by both accounts, on different networks
  await sg.recordLoginSignals(customer, phoneId, '95.56.12.34');
  await sg.recordLoginSignals(customer, phoneId, '95.56.12.34');
  await sg.recordLoginSignals(master, phoneId, '2a02:1234:abcd:ef01::9');
  await sg.recordLoginSignals(master, 'not a device id', 'not an ip');
  const cs = (await db.collection('accountSignals').doc(customer).get()).data() || {};
  assert(cs.devices?.length === 1 && cs.networks?.length === 1, 'A repeated login is kept once', cs);
  const stored = JSON.stringify(cs);
  assert(!stored.includes(phoneId) && !stored.includes('95.56'), 'Only hashes are stored, not the device id or the address');
  const ms = (await db.collection('accountSignals').doc(master).get()).data() || {};
  assert(ms.devices?.length === 1 && ms.networks?.length === 1, 'A login with a bad device id and address adds nothing', ms);

  // --- 2. A job chosen and finished at once with no other offer, by a brand-new customer account, for a
  //        master with no reviews yet, with a phone number in the text
  await getAuth().createUser({ uid: customer }).catch(() => undefined);
  const requestRef = db.collection('requests').doc(requestId);
  const offerRef = db.collection('offers').doc(offerId);
  await requestRef.set({ id: requestId, customerId: customer, status: 'OPEN', offerCount: 1 });
  await offerRef.set({ id: offerId, requestId, providerId: master, providerUserId: master, status: 'PENDING' });
  await offerRef.update({ status: 'ACCEPTED' });
  await requestRef.update({ status: 'COMPLETED', selectedOfferId: offerId });
  const sub = {
    id: requestId,
    requestId,
    customerId: customer,
    providerId: master,
    rating: 5,
    comment: 'Звоните +7 707 123 45 67',
    customerName: 'Аня',
    providerName: 'Ержан',
    createdAt: new Date().toISOString(),
  };
  const facts = await rm.gatherFacts(db, sub, requestId, Date.now());
  const signals = facts.signals;
  const codes = signals.map((s: { code: string }) => s.code);
  assert(codes.includes('same_device'), 'The same phone is found', codes);
  assert(!codes.includes('same_network'), 'Different networks are not flagged', codes);
  assert(codes.includes('quick_job'), 'A job finished minutes after the master was chosen is found', signals);
  assert(codes.includes('instant_pick'), 'A master chosen at once with no other offer is found', signals);
  assert(codes.includes('new_account'), 'A brand-new customer account on its first finished job is found', signals);
  assert(codes.includes('new_master'), "A master's first review waits for the operator", signals);
  assert(codes.includes('contact_in_text'), 'A phone number in the text is found', codes);
  assert(rm.decide(signals, [{ decision: 'approve', reason: 'ok' }]) === 'held', 'These signals hold the review even when the text is fine');
  const ctx = facts.context;
  assert(
    facts.firstJob === true && ctx.customerJobs === 1 && ctx.customerAgeDays === 0 && ctx.masterPublished === 0 && ctx.offers === 1 && ctx.minutesToChoose === 0 && ctx.minutesToDone === 0,
    'The operator sees the accounts and the timeline',
    { firstJob: facts.firstJob, ctx }
  );

  const other = `mast2_${tail}`;
  for (let i = 0; i < 3; i++) {
    await db.collection('reviews').doc(`rv_m2_${i}_${tail}`).set({ providerId: other, customerId: `x${i}_${tail}`, rating: 5 });
  }
  const unrelated = await rm.gatherFacts(db, { ...sub, providerId: other, requestId: `req_none_${tail}`, comment: 'Жақсы шебер' }, `req_none_${tail}`, Date.now());
  assert(
    JSON.stringify(unrelated.signals.map((s: { code: string }) => s.code)) === '["new_account"]',
    'With an unrelated master who already has 3 reviews only the new account shows',
    unrelated.signals
  );
  assert(rm.decide(unrelated.signals, [{ decision: 'approve', reason: 'ok' }]) === 'published', 'A new account alone does not hold the review');

  // --- 2b. Friends: a customer on the same phone as an earlier reviewer of the master, in a burst of
  //         reviews from first-time customers
  const ringMaster = `mast_ring_${tail}`;
  const friendA = `friendA_${tail}`;
  const friendB = `friendB_${tail}`;
  const friendC = `friendC_${tail}`;
  const sharedPhone = `phone-${tail}-aaaabbbbcccc`;
  await sg.recordLoginSignals(friendA, sharedPhone, '10.1.2.3');
  await sg.recordLoginSignals(friendB, `phone-${tail}-ddddeeeeffff`, '10.5.5.5');
  await sg.recordLoginSignals(friendC, sharedPhone, '10.9.9.9');
  await db.collection('reviewSubmissions').doc(`rs_a_${tail}`).set({ providerId: ringMaster, customerId: friendA, rating: 5, comment: 'Отличный мастер!', firstJob: true, status: 'published' });
  await db.collection('reviewSubmissions').doc(`rs_b_${tail}`).set({ providerId: ringMaster, customerId: friendB, rating: 5, comment: 'Отличный мастер!!', firstJob: true, status: 'published' });
  const friendFacts = await rm.gatherFacts(
    db,
    { requestId: `req_c_${tail}`, customerId: friendC, providerId: ringMaster, rating: 5, comment: 'Отличный мастер' },
    `req_c_${tail}`,
    Date.now()
  );
  const friendCodes = friendFacts.signals.map((s: { code: string }) => s.code);
  assert(friendCodes.includes('ring_device'), "A phone shared with another of the master's reviewers is found", friendFacts.signals);
  assert(!friendCodes.includes('ring_network'), 'Different networks among the reviewers are not flagged', friendFacts.signals);
  const burst = friendFacts.signals.find((s: { code: string }) => s.code === 'review_burst');
  assert(!!burst && burst.detail === 3, 'Three reviews from first-time customers within a week are a burst', friendFacts.signals);
  assert(
    friendFacts.earlier.length === 2 && friendFacts.earlier.every((e: { text: string; firstJob: boolean }) => e.text.startsWith('Отличный') && e.firstJob),
    "Claude reads the master's earlier reviews",
    friendFacts.earlier
  );

  // --- 3. Holding, publishing, rejecting
  const subRef = db.collection('reviewSubmissions').doc(requestId);
  const publicRef = db.collection('reviews').doc(requestId);
  await subRef.set(sub);
  const ai = { decision: 'approve', reason: 'ok' };
  assert(
    (await rm.settle(db, subRef, 'held', { signals, ai, score: rm.signalScore(signals), decidedBy: 'ai' })) === true,
    'The check records its decision'
  );
  assert(!(await publicRef.get()).exists, 'A held review is not on the profile');
  assert((await rm.settle(db, subRef, 'published', { decidedBy: 'ai' })) === false, 'A repeated check never overrides an earlier decision');
  assert((await subRef.get()).get('status') === 'held', 'The review is still held');

  assert((await rm.settle(db, subRef, 'published', { decidedBy: 'operator', decidedByUid: 'op1' })) === true, 'The operator publishes it');
  const pub = (await publicRef.get()).data() || {};
  assert(pub.rating === 5 && pub.customerName === 'Аня' && pub.comment === sub.comment, 'The published review has the review fields', pub);
  assert(!('signals' in pub) && !('status' in pub) && !('ai' in pub), 'The published review carries no check details', pub);
  const decided = (await subRef.get()).data() || {};
  assert(decided.status === 'published' && decided.decidedBy === 'operator' && decided.decidedByUid === 'op1', 'The decision and who made it are kept', decided);
  assert((await rm.settle(db, subRef, 'held', { score: 7, decidedBy: 'ai' })) === false, "A check finishing late does not change the operator's decision");
  const late = (await subRef.get()).data() || {};
  assert(late.status === 'published' && late.decidedBy === 'operator' && late.score === 7, 'but its findings are added', late);

  await publicRef.update({ providerReply: 'Рахмет!', providerReplyAt: new Date().toISOString() });
  await rm.settle(db, subRef, 'published', { decidedBy: 'operator', decidedByUid: 'op1' });
  assert((await publicRef.get()).get('providerReply') === 'Рахмет!', "Publishing again keeps the master's reply");

  assert((await rm.settle(db, subRef, 'rejected', { decidedBy: 'operator', decidedByUid: 'op1' })) === true, 'The operator rejects it');
  assert(!(await publicRef.get()).exists && (await subRef.get()).get('status') === 'rejected', 'Rejecting takes the review off the profile');
  assert(
    (await rm.settle(db, db.collection('reviewSubmissions').doc(`none_${tail}`), 'published', { decidedBy: 'operator' })) === false,
    'An unknown review changes nothing'
  );

  // --- 4. Rating: three reviews from one customer and one from another make two ratings
  const rated = `mast_rate_${tail}`;
  const rows: [string, string, number][] = [
    ['a', 'fake', 5],
    ['b', 'fake', 5],
    ['c', 'fake', 5],
    ['d', 'real', 2],
  ];
  for (const [id, who, rating] of rows) {
    await db.collection('reviews').doc(`rv_${id}_${tail}`).set({ providerId: rated, customerId: `${who}_${tail}`, rating });
  }
  await st.recountRating(db, rated);
  const stats = (await db.collection('providerStats').doc(rated).get()).data() || {};
  assert(stats.ratingCount === 2 && stats.ratingTotal === 7 && stats.reviewCount === 4, 'Rating: two customers (5 + 2), four reviews', stats);

  // --- 5. A deleted account is forgotten: signals gone, its name leaves the reviews, the reviews stay
  const namedRef = db.collection('reviews').doc(`rv_named_${tail}`);
  await namedRef.set({ providerId: master, customerId: customer, rating: 4, comment: 'Ок', customerName: 'Аня', providerName: 'Ержан' });
  await sg.forgetAccount(customer);
  assert(!(await db.collection('accountSignals').doc(customer).get()).exists, "Deleted customer: the account's signals are gone");
  const kept = (await namedRef.get()).data() || {};
  assert(!('customerName' in kept) && kept.providerName === 'Ержан' && kept.rating === 4 && kept.comment === 'Ок', "Deleted customer: the name leaves the review, the review stays", kept);
  assert(!('customerName' in ((await subRef.get()).data() || {})), 'Deleted customer: the name leaves the submission too');
  await sg.forgetAccount(master);
  assert(!('providerName' in ((await namedRef.get()).data() || {})), "Deleted master: the master's name leaves the review");

  console.log(failed ? `\nREVIEW FLOW: ${failed} FAILED` : '\nREVIEW FLOW: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
