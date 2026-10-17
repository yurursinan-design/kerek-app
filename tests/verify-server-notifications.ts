/**
 * Notices made on the server from real events (functions/src/notifications.ts), checked against
 * the Firestore emulator: who gets which notice, nothing for one's own action or for outsiders,
 * one notice per event even when the event comes twice, and push messages to the recipient's
 * phones in each phone's language (phones that no longer accept messages are forgotten).
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

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const modulePath = '../functions/src/notifications';
  const n = await import(modulePath);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const db = getFirestore();
  const tail = String(Date.now()).slice(-7);

  const request = { customerId: 'cust1', customerName: 'Айгүл', selectedOfferId: 'OFFER-r1-prov1' };

  // 1. New offer → the customer; not for an offer on one's own request
  const offer = { requestId: 'r1', providerId: 'prov1', providerUserId: 'prov1', providerName: 'Бауыржан', price: '15 000 ₸' };
  const o = n.forNewOffer('OFFER-r1-prov1', offer, request);
  assert(o.length === 1 && o[0].recipientUserId === 'cust1' && o[0].id === 'notif_offer_OFFER-r1-prov1' && o[0].body.ru.includes('15 000'), 'New offer: the customer is told the price');
  assert(n.forNewOffer('x', { ...offer, providerUserId: 'cust1' }, request).length === 0, 'No notice for an offer on one’s own request');

  // 2. Offer accepted → provider and customer, only on the change to ACCEPTED
  const acc = n.forOfferAccepted('OFFER-r1-prov1', { ...offer, status: 'PENDING' }, { ...offer, status: 'ACCEPTED' }, request);
  assert(acc.length === 2 && acc.some((x: any) => x.recipientUserId === 'prov1' && x.type === 'PROVIDER_OFFER_ACCEPTED'), 'Accepted offer: the provider is told');
  assert(n.forOfferAccepted('OFFER-r1-prov1', { ...offer, status: 'ACCEPTED' }, { ...offer, status: 'ACCEPTED' }, request).length === 0, 'No repeat notice when nothing changed');

  // 3. Message → the other participant; outsiders' messages give nothing
  const conv = { requestId: 'r1', customerId: 'cust1', customerName: 'Айгүл', providerId: 'prov1', providerUserId: 'prov1', providerName: 'Бауыржан' };
  const m = n.forNewMessage('conv_r1', 'msg1', { senderId: 'prov1', text: 'Сәлем', type: 'text' }, conv);
  assert(m.length === 1 && m[0].recipientUserId === 'cust1' && m[0].type === 'CUSTOMER_NEW_MESSAGE' && m[0].body.kz === 'Бауыржан: Сәлем', 'Message from the provider: the customer is told');
  const photo = n.forNewMessage('conv_r1', 'msg2', { senderId: 'cust1', text: '', type: 'image', attachments: [{ type: 'image' }] }, conv);
  assert(photo[0]?.recipientUserId === 'prov1' && photo[0]?.type === 'PROVIDER_NEW_ATTACHMENT', 'Photo from the customer: the provider is told');
  assert(n.forNewMessage('conv_r1', 'msg3', { senderId: 'stranger', text: 'x' }, conv).length === 0, 'A message from an outsider gives no notice');

  // 4. Request: provider reports done, customer completes, customer cancels
  const done = n.forRequestChange('r1', { status: 'PROVIDER_SELECTED' }, { ...request, status: 'PROVIDER_SELECTED', providerDoneAt: 'now' }, 'prov1');
  assert(done.length === 1 && done[0].id === 'notif_done_cust_r1', 'Provider reports done: the customer is asked to confirm');
  const completed = n.forRequestChange('r1', { status: 'IN_PROGRESS' }, { ...request, status: 'COMPLETED' }, 'prov1');
  assert(completed.length === 2 && completed.some((x: any) => x.targetScreen === 'review_modal'), 'Completed: both sides told, the customer is asked for a review');
  const cancelled = n.forRequestChange('r1', { status: 'PROVIDER_SELECTED' }, { ...request, status: 'CANCELLED' }, 'prov1');
  assert(cancelled.length === 1 && cancelled[0].recipientUserId === 'prov1', 'Cancelled: the chosen provider is told');

  // 5. Appointment: the other side is told; the actor comes from the event
  const appt = { requestId: 'r1', customerId: 'cust1', providerId: 'prov1', providerUserId: 'prov1', proposedBy: 'customer', scheduledAt: '2026-10-20 10:00', status: 'PROPOSED' };
  const created = n.forAppointmentChange('appointment_r1', undefined, appt, 'cust1', 'ev1');
  assert(created.length === 1 && created[0].recipientUserId === 'prov1' && created[0].type === 'PROVIDER_APPOINTMENT_CREATED', 'Customer proposes a time: the provider is told');
  const confirmed = n.forAppointmentChange('appointment_r1', appt, { ...appt, status: 'CONFIRMED' }, 'prov1', 'ev2');
  assert(confirmed[0]?.recipientUserId === 'cust1' && confirmed[0]?.title.ru.includes('подтверждено'), 'Provider confirms: the customer is told');
  const moved = n.forAppointmentChange('appointment_r1', appt, { ...appt, status: 'RESCHEDULED', scheduledAt: '2026-10-21T12:00+05:00', proposedBy: 'provider' }, 'prov1', 'ev3');
  assert(moved[0]?.title.ru.includes('перенесено') && moved[0]?.body.ru.includes('21.10.2026, 12:00'), 'New time proposed: the other side is told, in Kyzylorda time', moved[0]?.body.ru);
  assert(n.scheduleLabel('2026-10-20 10:00') === '20.10.2026, 10:00' && n.scheduleLabel('ертең кешке') === 'ертең кешке', 'Older visit times are shown readably, free text as it is');
  const cancel = n.forAppointmentChange('appointment_r1', appt, { ...appt, status: 'CANCELLED', note: 'Заболел' }, 'cust1', 'ev4');
  assert(cancel[0]?.recipientUserId === 'prov1' && cancel[0]?.body.ru.includes('(Заболел)'), 'Cancelled with a reason: the other side sees the reason');
  const onWay = n.forAppointmentChange('appointment_r1', { ...appt, status: 'CONFIRMED' }, { ...appt, status: 'CONFIRMED', workStatus: 'PROVIDER_ON_THE_WAY' }, 'prov1', 'ev5');
  assert(onWay.length === 1 && onWay[0].type === 'CUSTOMER_PROVIDER_ON_THE_WAY', 'Provider on the way: the customer is told');
  assert(n.forAppointmentChange('appointment_r1', appt, { ...appt, status: 'CONFIRMED' }, 'stranger', 'ev6').length === 0, 'A change by someone else gives no notice');
  assert(created[0].id !== n.forAppointmentChange('appointment_r1', undefined, appt, 'cust1', 'ev7')[0].id, 'Each appointment change has its own notice id');

  // 6. Written once per event, with an expiry date
  const item = { ...m[0], id: `notif_msg_test_${tail}` };
  assert((await n.saveNotifications([item])) === 1, 'Notice is written');
  assert((await n.saveNotifications([item])) === 0, 'The same event delivered twice writes nothing more');
  const saved = (await db.collection('notifications').doc(item.id).get()).data();
  assert(saved?.isRead === false && typeof saved?.expireAt?.toMillis === 'function' && saved.expireAt.toMillis() > Date.now() + 50 * 86400000, 'Notice is unread and removed after 60 days');

  // 7. Push to the recipient's phones, in each phone's language; dead phones forgotten
  const uid = `pushuser_${tail}`;
  await db.collection('pushTokens').doc(`tok_kz_${tail}`).set({ uid, platform: 'android', lang: 'kz', updatedAt: 'x' });
  await db.collection('pushTokens').doc(`tok_ru_${tail}`).set({ uid, platform: 'android', lang: 'ru', updatedAt: 'x' });
  await db.collection('pushTokens').doc(`tok_dead_${tail}`).set({ uid, platform: 'android', lang: 'ru', updatedAt: 'x' });
  await db.collection('pushTokens').doc(`tok_other_${tail}`).set({ uid: 'someone_else', platform: 'android', lang: 'ru', updatedAt: 'x' });
  const sent: any[] = [];
  const delivered = await n.pushNotification({ ...m[0], recipientUserId: uid }, async (msg: any) => {
    sent.push(msg);
    return { responses: msg.tokens.map((t: string) => (t.startsWith('tok_dead') ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true })) };
  });
  const kz = sent.find((s) => s.tokens.includes(`tok_kz_${tail}`));
  const ru = sent.find((s) => s.tokens.includes(`tok_ru_${tail}`));
  assert(delivered === 2 && kz?.notification.title === 'Жаңа хабарлама' && ru?.notification.title === 'Новое сообщение', 'Each phone gets the notice in its language', { delivered });
  assert(!sent.some((s) => s.tokens.includes(`tok_other_${tail}`)), 'Other people’s phones get nothing');
  assert(kz?.data.requestId === 'r1' && kz?.data.recipientRole === 'customer', 'Tapping the push can open the right request');
  assert(!(await db.collection('pushTokens').doc(`tok_dead_${tail}`).get()).exists, 'A phone that no longer accepts messages is forgotten');
  assert(kz?.android.notification.sound === 'default' && !kz?.android.notification.channelId, 'Other notices keep the normal sound');

  // 8. A new job rings with the dombra strum on the new-jobs channel
  const jobSent: any[] = [];
  await n.pushNotification({ id: `notif_new_request_r9_${tail}`, type: 'NEW_REQUEST', recipientUserId: uid, recipientRole: 'provider', requestId: 'r9', title: { kz: 'Жаңа сұраныс табылды', ru: 'Найден новый запрос' }, body: { kz: 'b', ru: 'b' } }, async (msg: any) => {
    jobSent.push(msg);
    return { responses: msg.tokens.map(() => ({ success: true })) };
  });
  assert(jobSent.length > 0 && jobSent.every((s) => s.android.notification.sound === 'dombra' && s.android.notification.channelId === 'new_jobs'), 'A new job plays the dombra sound', jobSent.map((s) => s.android));

  // 9. A passing push error is reported for a retry; a dead phone is not
  const flaky = await n.pushNotificationDetailed({ ...m[0], recipientUserId: uid }, async (msg: any) => ({
    responses: msg.tokens.map(() => ({ success: false, error: { code: 'messaging/internal-error' } })),
  }));
  assert(flaky.delivered === 0 && flaky.retryable === 2, 'A passing FCM error leaves the push for a retry', flaky);

  // 10. A notice that can't be written makes the event fail (so it is retried); duplicates don't
  let threw = false;
  try {
    await n.saveNotifications([{ ...item, id: `bad/${tail}` }]);
  } catch {
    threw = true;
  }
  assert(threw, 'A failed write is reported, not swallowed, so the event is retried');

  // 11. New-request alerts: every matching master (more than one page of 300), once per master,
  //     and a repeated delivery never resets a read alert
  const limPath = '../functions/src/limits';
  const lim = await import(limPath);
  const city = `city_${tail}`;
  const writer = db.bulkWriter();
  for (let i = 0; i < 320; i++) {
    writer.set(db.collection('providers').doc(`pm_${tail}_${i}`), { id: `pm_${tail}_${i}`, userId: `pm_${tail}_${i}`, cityId: city, categoryIds: ['plumbing'] });
  }
  writer.set(db.collection('providers').doc(`pm_${tail}_old`), { id: `pm_${tail}_old`, userId: `pm_${tail}_old`, cityId: city, categoryId: 'plumbing' });
  writer.set(db.collection('providers').doc(`pm_${tail}_paused`), { id: `pm_${tail}_paused`, userId: `pm_${tail}_paused`, cityId: city, categoryIds: ['plumbing'], paused: true });
  await writer.close();
  const idxPath = '../functions/src/index';
  const fx = await import(idxPath);
  const reqId = `req_fan_${tail}`;
  const newReq = { cityId: city, categoryId: 'plumbing', customerId: `cust_fan_${tail}`, status: 'MATCHING', service: 'Кран' };
  const first = await fx.notifyProvidersOfNewRequest(reqId, newReq);
  assert(first === 321, 'All 321 matching masters are alerted (two query pages, old profile included, paused master skipped)', first);
  await db.collection('notifications').doc(`notif_new_request_${reqId}_pm_${tail}_5`).update({ isRead: true });
  const again = await fx.notifyProvidersOfNewRequest(reqId, newReq);
  const stillRead = (await db.collection('notifications').doc(`notif_new_request_${reqId}_pm_${tail}_5`).get()).get('isRead');
  assert(again === 0 && stillRead === true, 'The same event again alerts nobody twice and keeps the read mark', { again, stillRead });
  const allowedA = await lim.allowCallOnce(`once_${tail}`, 'ev1', 1, Date.now(), 3600000);
  const allowedB = await lim.allowCallOnce(`once_${tail}`, 'ev1', 1, Date.now(), 3600000);
  const allowedC = await lim.allowCallOnce(`once_${tail}`, 'ev2', 1, Date.now(), 3600000);
  assert(allowedA && allowedB && !allowedC, 'A repeated event is not counted twice against the hourly limit', [allowedA, allowedB, allowedC]);
  assert(lim.tooOldToRetry(new Date(Date.now() - 3 * 3600000).toISOString()) && !lim.tooOldToRetry(new Date().toISOString()), 'Events older than two hours are given up');

  console.log(failed ? `\nSERVER NOTIFICATIONS: ${failed} FAILED` : '\nSERVER NOTIFICATIONS: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Server notifications test error:', err);
  process.exit(1);
});
