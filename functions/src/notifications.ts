/**
 * In-app notifications are made here, on the server, from the change that really happened (an
 * offer, a message, an accepted offer, an appointment or job change). Apps can't write them (see
 * firestore.rules), so nobody can fake an alert or flood someone with them. Each notice has an id
 * bound to its event, so an event delivered twice gives one notice.
 *
 * Every new notice is also sent to the recipient's phones as a push message (pushTokens).
 */
import * as crypto from 'crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWrittenWithAuthContext,
} from 'firebase-functions/v2/firestore';
import { DAY_MS } from './limits';

type Role = 'customer' | 'provider';
type Text = { kz: string; ru: string };

export interface NotificationDoc {
  id: string;
  recipientUserId: string;
  recipientRole: Role;
  type: string;
  title: Text;
  body: Text;
  requestId: string;
  offerId?: string;
  conversationId?: string;
  providerId?: string;
  targetScreen: 'request_detail' | 'chat' | 'offers_list' | 'review_modal';
}

/** Notices are kept 60 days (Firestore TTL on expireAt removes them) */
const KEEP_MS = 60 * DAY_MS;

function str(v: unknown, max = 200): string {
  return (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Ids from Firestore paths are safe; event ids are hashed into a short id part. */
function short(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
}

const upper = (r: Role) => (r === 'customer' ? 'CUSTOMER' : 'PROVIDER');
const other = (r: Role): Role => (r === 'customer' ? 'provider' : 'customer');

// ---------------------------------------------------------------- builders (pure, tested)

export function forNewOffer(offerId: string, offer: any, request: any): NotificationDoc[] {
  const customerId = str(request?.customerId, 128);
  if (!customerId || offer?.providerUserId === customerId) return [];
  const name = str(offer?.providerName, 60);
  const price = str(offer?.price, 60);
  return [
    {
      id: `notif_offer_${offerId}`,
      recipientUserId: customerId,
      recipientRole: 'customer',
      type: 'CUSTOMER_NEW_OFFER',
      title: { kz: 'Жаңа ұсыныс түсті', ru: 'Новое предложение' },
      body: {
        kz: `${name || 'Маман'} сізге баға ұсынды: ${price}`,
        ru: `${name || 'Мастер'} предложил цену: ${price}`,
      },
      requestId: str(offer?.requestId, 128),
      offerId,
      ...(offer?.providerId ? { providerId: str(offer.providerId, 128) } : {}),
      targetScreen: 'offers_list',
    },
  ];
}

export function forOfferAccepted(offerId: string, before: any, after: any, request: any): NotificationDoc[] {
  if (before?.status === 'ACCEPTED' || after?.status !== 'ACCEPTED') return [];
  const requestId = str(after?.requestId, 128);
  const providerUserId = str(after?.providerUserId || after?.providerId, 128);
  const customerId = str(request?.customerId, 128);
  const name = str(after?.providerName, 60);
  const customerName = str(request?.customerName, 60) || 'Клиент';
  const common = {
    requestId,
    offerId,
    ...(after?.providerId ? { providerId: str(after.providerId, 128) } : {}),
    conversationId: `conv_${requestId}`,
    targetScreen: 'chat' as const,
  };
  const out: NotificationDoc[] = [];
  if (providerUserId) {
    out.push({
      id: `notif_offer_accepted_prov_${offerId}`,
      recipientUserId: providerUserId,
      recipientRole: 'provider',
      type: 'PROVIDER_OFFER_ACCEPTED',
      title: { kz: 'Ұсынысыңыз қабылданды!', ru: 'Ваше предложение принято!' },
      body: {
        kz: `Тапсырыс беруші (${customerName}) сіздің ұсынысыңызды таңдады. Сұхбатты бастаңыз.`,
        ru: `Клиент (${customerName}) выбрал ваше предложение. Перейдите в чат для связи.`,
      },
      ...common,
    });
  }
  if (customerId) {
    out.push({
      id: `notif_offer_accepted_cust_${offerId}`,
      recipientUserId: customerId,
      recipientRole: 'customer',
      type: 'CUSTOMER_OFFER_ACCEPTED',
      title: { kz: 'Маман бекітілді', ru: 'Мастер подтвержден' },
      body: {
        kz: `${name || 'Маман'} таңдалды. Сұрақтарыңыз болса чатта хабарласыңыз.`,
        ru: `Мастер ${name} выбран. Напишите в чат для уточнения деталей.`.replace('  ', ' '),
      },
      ...common,
    });
  }
  return out;
}

export function forNewMessage(conversationId: string, messageId: string, message: any, conversation: any): NotificationDoc[] {
  const senderId = str(message?.senderId, 128);
  const senderIsCustomer = senderId && senderId === conversation?.customerId;
  const senderIsProvider = senderId && (senderId === conversation?.providerUserId || senderId === conversation?.providerId);
  if (!senderIsCustomer && !senderIsProvider) return [];
  const recipientUserId = str(senderIsCustomer ? conversation?.providerUserId || conversation?.providerId : conversation?.customerId, 128);
  if (!recipientUserId || recipientUserId === senderId) return [];
  const recipientRole: Role = senderIsCustomer ? 'provider' : 'customer';
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const hasAttachment = attachments.length > 0;
  const isImage = message?.type === 'image' || attachments[0]?.type === 'image';
  const senderName = senderIsCustomer ? str(conversation?.customerName, 60) || 'Клиент' : str(conversation?.providerName, 60) || 'Маман';
  let snippet = str(message?.text, 500);
  if (!snippet && hasAttachment) snippet = isImage ? '📷 Фото' : `📎 ${str(attachments[0]?.fileName, 60) || 'Файл'}`;
  else if (snippet.length > 70) snippet = `${snippet.slice(0, 67)}...`;
  const title: Text = hasAttachment
    ? isImage
      ? { kz: 'Жаңа фотосурет', ru: 'Новая фотография' }
      : { kz: 'Жаңа файл тіркелді', ru: 'Новый файл в чате' }
    : { kz: 'Жаңа хабарлама', ru: 'Новое сообщение' };
  return [
    {
      id: `notif_msg_${messageId}`,
      recipientUserId,
      recipientRole,
      type: `${upper(recipientRole)}_${hasAttachment ? 'NEW_ATTACHMENT' : 'NEW_MESSAGE'}`,
      title,
      body: { kz: `${senderName}: ${snippet}`, ru: `${senderName}: ${snippet}` },
      requestId: str(conversation?.requestId, 128),
      conversationId,
      ...(conversation?.providerId ? { providerId: str(conversation.providerId, 128) } : {}),
      targetScreen: 'chat',
    },
  ];
}

/** providerUserId: the provider of the request's selected offer ('' when none) */
export function forRequestChange(requestId: string, before: any, after: any, providerUserId: string): NotificationDoc[] {
  const out: NotificationDoc[] = [];
  const customerId = str(after?.customerId, 128);
  const offerId = str(after?.selectedOfferId, 128);
  const withOffer = offerId ? { offerId } : {};
  const customerName = str(after?.customerName, 60) || 'Клиент';
  if (!before?.providerDoneAt && after?.providerDoneAt && customerId && after?.status !== 'COMPLETED') {
    out.push({
      id: `notif_done_cust_${requestId}`,
      recipientUserId: customerId,
      recipientRole: 'customer',
      type: 'CUSTOMER_WORK_COMPLETED',
      title: { kz: 'Шебер жұмысты аяқтады', ru: 'Мастер завершил работу' },
      body: { kz: 'Жұмысты тексеріп, аяқталғанын растаңыз.', ru: 'Проверьте работу и подтвердите завершение.' },
      requestId,
      ...withOffer,
      targetScreen: 'request_detail',
    });
  }
  if (before?.status !== 'COMPLETED' && after?.status === 'COMPLETED') {
    if (customerId) {
      out.push({
        id: `notif_completed_cust_${requestId}`,
        recipientUserId: customerId,
        recipientRole: 'customer',
        type: 'CUSTOMER_WORK_COMPLETED',
        title: { kz: 'Жұмыс аяқталды', ru: 'Работа выполнена' },
        body: {
          kz: 'Тапсырыс орындалды. Маманға баға беріп, пікір қалдырыңыз.',
          ru: 'Заказ завершен. Пожалуйста, оцените качество работы мастера.',
        },
        requestId,
        ...withOffer,
        targetScreen: 'review_modal',
      });
    }
    if (providerUserId) {
      out.push({
        id: `notif_completed_prov_${requestId}`,
        recipientUserId: providerUserId,
        recipientRole: 'provider',
        type: 'PROVIDER_WORK_COMPLETED',
        title: { kz: 'Тапсырыс аяқталды', ru: 'Заказ завершен' },
        body: { kz: 'Тапсырыс сәтті орындалды деп белгіленді.', ru: 'Заказ успешно отмечен как выполненный.' },
        requestId,
        ...withOffer,
        targetScreen: 'request_detail',
      });
    }
  }
  if (before?.status !== 'CANCELLED' && after?.status === 'CANCELLED' && providerUserId) {
    out.push({
      id: `notif_cancelled_${requestId}`,
      recipientUserId: providerUserId,
      recipientRole: 'provider',
      type: 'PROVIDER_REQUEST_CANCELLED',
      title: { kz: 'Тапсырыс тоқтатылды', ru: 'Заявка отменена' },
      body: {
        kz: `Тапсырыс беруші (${customerName}) өтінішті тоқтатты.`,
        ru: `Клиент (${customerName}) отменил выполнение заявки.`,
      },
      requestId,
      targetScreen: 'request_detail',
    });
  }
  return out;
}

const WORK_STATUS_TEXT: Record<string, { type: string; title: Text; body: Text }> = {
  PROVIDER_ON_THE_WAY: {
    type: 'CUSTOMER_PROVIDER_ON_THE_WAY',
    title: { kz: 'Шебер жолға шықты 🚗', ru: 'Мастер выехал к вам 🚗' },
    body: { kz: 'Шебер көрсетілген мекенжайға қарай жолға шықты.', ru: 'Мастер выехал по указанному адресу.' },
  },
  PROVIDER_ARRIVED: {
    type: 'CUSTOMER_PROVIDER_ARRIVED',
    title: { kz: 'Шебер мекенжайға жетті 📍', ru: 'Мастер прибыл 📍' },
    body: { kz: 'Шебер мекенжайға жетті және қызмет көрсетуге дайын.', ru: 'Мастер прибыл на место и готов к выполнению заказа.' },
  },
  WORK_STARTED: {
    type: 'CUSTOMER_WORK_STARTED',
    title: { kz: 'Жұмыс басталды 🔧', ru: 'Работа начата 🔧' },
    body: { kz: 'Шебер тапсырысты орындауға кірісті.', ru: 'Мастер приступил к выполнению работы.' },
  },
  WORK_COMPLETED: {
    type: 'CUSTOMER_WORK_COMPLETED',
    title: { kz: 'Жұмыс аяқталды! ✅', ru: 'Работа завершена! ✅' },
    body: {
      kz: 'Шебер жұмысты орындап бітті. Нәтижені тексеріп, аяқталғанын растаңыз.',
      ru: 'Мастер завершил работу. Проверьте результат и подтвердите завершение.',
    },
  },
  CANCELLED: {
    type: 'PROVIDER_WORK_STATUS_UPDATED',
    title: { kz: 'Қызмет барысы тоқтатылды ❌', ru: 'Выполнение услуги отменено ❌' },
    body: { kz: 'Шебер жұмысты орындауды тоқтатты.', ru: 'Мастер отменил выполнение услуги.' },
  },
};

/**
 * Appointment created or changed. actorUid is who made the change (from the event's auth
 * context); the other side is told. eventId makes the notice id unique per change.
 */
export function forAppointmentChange(apptId: string, before: any, after: any, actorUid: string, eventId: string): NotificationDoc[] {
  if (!after) return [];
  const customerId = str(after.customerId, 128);
  const providerUserId = str(after.providerUserId || after.providerId, 128);
  const actor: Role | null = actorUid && actorUid === customerId ? 'customer' : actorUid && actorUid === providerUserId ? 'provider' : null;
  if (!actor) return [];
  const recipientRole = other(actor);
  const recipientUserId = recipientRole === 'customer' ? customerId : providerUserId;
  if (!recipientUserId || recipientUserId === actorUid) return [];
  const requestId = str(after.requestId, 128);
  const when = str(after.scheduledAt, 40);
  const byCustomer = actor === 'customer';
  const tag = short(eventId);
  const base = { recipientUserId, recipientRole, requestId, targetScreen: 'request_detail' as const };
  const out: NotificationDoc[] = [];

  if (!before) {
    out.push({
      ...base,
      id: `notif_appt_create_${apptId}_${tag}`,
      type: `${upper(recipientRole)}_APPOINTMENT_CREATED`,
      title: byCustomer
        ? { kz: 'Кездесу уақыты ұсынылды', ru: 'Предложено время встречи' }
        : { kz: 'Маман кездесу уақытын ұсынды', ru: 'Мастер предложил время встречи' },
      body: byCustomer
        ? { kz: `Клиент кездесу уақытын ұсынды: ${when}`, ru: `Клиент предложил встречу: ${when}` }
        : { kz: `Маман сізге кездесу уақытын ұсынды: ${when}`, ru: `Мастер предложил время встречи: ${when}` },
    });
    return out;
  }

  if (before.status !== 'CANCELLED' && after.status === 'CANCELLED') {
    const note = str(after.note, 500);
    const reason = note && note !== str(before.note, 500) ? str(note.split(' | ').pop(), 100) : '';
    const suffix = reason ? ` (${reason})` : '';
    out.push({
      ...base,
      id: `notif_appt_cancel_${apptId}_${tag}`,
      type: `${upper(recipientRole)}_APPOINTMENT_CANCELLED`,
      title: { kz: 'Кездесу тоқтатылды', ru: 'Встреча отменена' },
      body: byCustomer
        ? { kz: `Клиент белгіленген кездесуді тоқтатты${suffix}.`, ru: `Клиент отменил назначенную встречу${suffix}.` }
        : { kz: `Маман белгіленген кездесуді тоқтатты${suffix}.`, ru: `Мастер отменил назначенную встречу${suffix}.` },
    });
  } else if (before.status !== 'CONFIRMED' && after.status === 'CONFIRMED') {
    out.push({
      ...base,
      id: `notif_appt_upd_${apptId}_${tag}`,
      type: `${upper(recipientRole)}_APPOINTMENT_UPDATED`,
      title: { kz: 'Кездесу уақыты расталды', ru: 'Время встречи подтверждено' },
      body: byCustomer
        ? { kz: `Клиент кездесу уақытын растады: ${when}`, ru: `Клиент подтвердил время встречи: ${when}` }
        : { kz: `Маман кездесу уақытын растады: ${when}`, ru: `Мастер подтвердил время встречи: ${when}` },
    });
  } else if (str(before.scheduledAt, 40) !== when && (after.status === 'RESCHEDULED' || after.status === 'PROPOSED')) {
    out.push({
      ...base,
      id: `notif_appt_upd_${apptId}_${tag}`,
      type: `${upper(recipientRole)}_APPOINTMENT_UPDATED`,
      title: { kz: 'Кездесу уақыты өзгертілді', ru: 'Время встречи перенесено' },
      body: byCustomer
        ? { kz: `Клиент жаңа кездесу уақытын ұсынды: ${when}`, ru: `Клиент предложил другое время: ${when}` }
        : { kz: `Маман жаңа кездесу уақытын ұсынды: ${when}`, ru: `Мастер предложил другое время: ${when}` },
    });
  }

  const ws = str(after.workStatus, 40);
  if (ws && ws !== str(before.workStatus, 40) && actor === 'provider' && WORK_STATUS_TEXT[ws]) {
    const t = WORK_STATUS_TEXT[ws];
    out.push({
      recipientUserId: customerId,
      recipientRole: 'customer',
      requestId,
      targetScreen: 'request_detail',
      id: `notif_workstatus_${apptId}_${ws.toLowerCase()}_${tag}`,
      type: t.type,
      title: t.title,
      body: t.body,
      ...(after.providerId ? { providerId: str(after.providerId, 128) } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------- writing

/** Writes the notices; one that already exists (event delivered twice) is left as it is. */
export async function saveNotifications(items: NotificationDoc[], now = Date.now()): Promise<number> {
  const db = getFirestore();
  let written = 0;
  for (const n of items) {
    if (!n.recipientUserId || !n.requestId) continue;
    try {
      await db
        .collection('notifications')
        .doc(n.id)
        .create({ ...n, isRead: false, readAt: null, createdAt: new Date(now).toISOString(), expireAt: Timestamp.fromMillis(now + KEEP_MS) });
      written++;
    } catch (err: any) {
      // 6 = ALREADY_EXISTS
      if (err?.code !== 6 && err?.code !== 'already-exists') console.error('[notifications] write failed', n.id, err);
    }
  }
  return written;
}

async function selectedProviderUserId(request: any): Promise<string> {
  const offerId = str(request?.selectedOfferId, 128);
  if (!offerId) return '';
  const snap = await getFirestore().collection('offers').doc(offerId).get();
  const offer = snap.data();
  return str(offer?.providerUserId || offer?.providerId, 128);
}

// ---------------------------------------------------------------- triggers

// Firestore triggers run where the database is (asia-south1)
const OPTS = { region: 'asia-south1', maxInstances: 10 };

export const notifyOnOfferCreated = onDocumentCreated({ ...OPTS, document: 'offers/{offerId}' }, async (event) => {
  const offer = event.data?.data();
  if (!offer?.requestId) return;
  const request = (await getFirestore().collection('requests').doc(String(offer.requestId)).get()).data();
  await saveNotifications(forNewOffer(event.params.offerId, offer, request));
});

export const notifyOnOfferUpdated = onDocumentUpdated({ ...OPTS, document: 'offers/{offerId}' }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after?.requestId || before?.status === after.status) return;
  const request = (await getFirestore().collection('requests').doc(String(after.requestId)).get()).data();
  await saveNotifications(forOfferAccepted(event.params.offerId, before, after, request));
});

export const notifyOnMessageCreated = onDocumentCreated(
  { ...OPTS, document: 'conversations/{conversationId}/messages/{messageId}' },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;
    const conversation = (await getFirestore().collection('conversations').doc(event.params.conversationId).get()).data();
    if (!conversation) return;
    await saveNotifications(forNewMessage(event.params.conversationId, event.params.messageId, message, conversation));
  }
);

export const notifyOnRequestUpdated = onDocumentUpdated({ ...OPTS, document: 'requests/{requestId}' }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  const relevant =
    before?.status !== after.status || (!before?.providerDoneAt && Boolean(after.providerDoneAt));
  if (!relevant) return;
  const providerUserId = await selectedProviderUserId(after);
  await saveNotifications(forRequestChange(event.params.requestId, before, after, providerUserId));
});

export const notifyOnAppointmentWritten = onDocumentWrittenWithAuthContext(
  { ...OPTS, document: 'appointments/{appointmentId}' },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    // Who made the change: a signed-in app user's id (matched against the participants below);
    // server writes don't name a participant and send nothing
    const actorUid = String(event.authId || '');
    await saveNotifications(forAppointmentChange(event.params.appointmentId, before, after, actorUid, event.id));
  }
);

// ---------------------------------------------------------------- push to phones

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

type Sender = (msg: {
  tokens: string[];
  notification: { title: string; body: string };
  data: Record<string, string>;
  android: { priority: 'high'; notification: { sound: string; tag: string; channelId?: string } };
}) => Promise<{ responses: { success: boolean; error?: { code: string } }[] }>;

/** New-job notices ring with KEREK's dombra strum: the phone app's 'new_jobs' channel and res/raw/dombra.wav */
function androidSound(type: unknown): { sound: string; channelId?: string } {
  return type === 'NEW_REQUEST' ? { sound: 'dombra', channelId: 'new_jobs' } : { sound: 'default' };
}

/**
 * Sends one notice to the recipient's phones, in each phone's language, and forgets phones
 * that no longer accept messages (app removed). Returns how many phones got it.
 */
export async function pushNotification(n: any, send: Sender = (m) => getMessaging().sendEachForMulticast(m)): Promise<number> {
  const uid = str(n?.recipientUserId, 128);
  if (!uid) return 0;
  const db = getFirestore();
  const snap = await db.collection('pushTokens').where('uid', '==', uid).limit(10).get();
  if (snap.empty) return 0;
  const byLang: Record<'kz' | 'ru', string[]> = { kz: [], ru: [] };
  snap.docs.forEach((d) => byLang[d.get('lang') === 'kz' ? 'kz' : 'ru'].push(d.id));
  let delivered = 0;
  for (const lang of ['kz', 'ru'] as const) {
    const tokens = byLang[lang];
    if (!tokens.length) continue;
    const res = await send({
      tokens,
      notification: { title: str(n?.title?.[lang], 120), body: str(n?.body?.[lang], 400) },
      data: {
        notificationId: str(n?.id, 200),
        requestId: str(n?.requestId, 128),
        targetScreen: str(n?.targetScreen, 40),
        recipientRole: n?.recipientRole === 'provider' ? 'provider' : 'customer',
        ...(n?.conversationId ? { conversationId: str(n.conversationId, 128) } : {}),
      },
      android: { priority: 'high', notification: { ...androidSound(n?.type), tag: str(n?.requestId, 128) || 'kerek' } },
    });
    await Promise.all(
      res.responses.map((r, i) => {
        if (r.success) {
          delivered++;
          return null;
        }
        return r.error && DEAD_TOKEN_CODES.has(r.error.code) ? db.collection('pushTokens').doc(tokens[i]).delete() : null;
      })
    );
  }
  return delivered;
}

export const pushOnNotificationCreated = onDocumentCreated({ ...OPTS, document: 'notifications/{notificationId}' }, async (event) => {
  const n = event.data?.data();
  if (!n || n.isRead) return;
  try {
    await pushNotification(n);
  } catch (err) {
    console.error('[push] failed for', event.params.notificationId, err);
  }
});
