import {
  AppNotification,
  Appointment,
  ChatMessage,
  Conversation,
  NotificationEventType,
  ProviderOffer,
  ServiceRequest,
  WorkStatus,
} from '../types';
import { resilientRepository } from './resilientRepository';
import { auth } from './firebase';
import { getCurrentUserId } from './localRepository';

/**
 * Plays a subtle, pleasant chime for incoming in-app notifications using Web Audio API.
 * Gracefully silent if user has not interacted with DOM yet or audio context is unavailable.
 */
let chimeContext: AudioContext | null = null;
let dombra: HTMLAudioElement | null = null;

/** KEREK's sound for a new job: a short dombra strum (same file as the phone notification). */
function playDombra(): boolean {
  try {
    if (typeof Audio === 'undefined') return false;
    dombra = dombra || new Audio(`${import.meta.env.BASE_URL}sounds/dombra.wav`);
    dombra.currentTime = 0;
    dombra.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function playNotificationSound(type?: NotificationEventType): void {
  if (type === 'NEW_REQUEST' && playDombra()) return;
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    // One audio context for the whole session (browsers limit how many can be open)
    chimeContext = chimeContext || new AudioContextClass();
    const ctx = chimeContext;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  } catch {
    // Non-blocking: browsers with strict autoplay policies simply omit the chime
  }
}

/**
 * Triggers an optional browser Notification if user has previously granted permission.
 * Non-intrusive: never prompts for permission proactively on its own.
 */
export function showBrowserNotificationIfGranted(
  title: string,
  body: string,
  onClick?: () => void
): void {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const notif = new Notification(title, {
        body,
        icon: '/favicon.ico',
      });
      if (onClick) {
        notif.onclick = () => {
          window.focus();
          onClick();
          notif.close();
        };
      }
    }
  } catch {
    // Silently continue
  }
}

/**
 * Centralized Notification Dispatcher for KEREK
 * All functions are idempotent and non-blocking (guaranteeing that parent business
 * actions like creating an offer, accepting, or chatting are never halted if notifications fail).
 */
export const notificationService = {
  /**
   * 1. Customer: New offer arrived from provider
   */
  async notifyNewOffer(request: ServiceRequest, offer: ProviderOffer): Promise<void> {
    try {
      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      // Do not notify self if customer created the offer (in edge testing scenarios)
      if (offer.providerUserId === request.customerId || currentUid === request.customerId) {
        return;
      }

      const id = `notif_offer_${offer.id}`;
      const payload: AppNotification = {
        id,
        recipientUserId: request.customerId,
        recipientRole: 'customer',
        type: 'CUSTOMER_NEW_OFFER',
        title: {
          kz: 'Жаңа ұсыныс түсті',
          ru: 'Новое предложение',
        },
        body: {
          kz: `${offer.providerName || 'Маман'} сізге баға ұсынды: ${offer.price}`,
          ru: `${offer.providerName || 'Мастер'} предложил цену: ${offer.price}`,
        },
        requestId: request.id,
        offerId: offer.id,
        providerId: offer.providerId,
        targetScreen: 'offers_list',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyNewOffer note:', err);
    }
  },

  /**
   * 2. Customer & Provider: Offer accepted by customer
   */
  async notifyOfferAccepted(request: ServiceRequest, offer: ProviderOffer): Promise<void> {
    const provUserId = (offer.providerUserId || offer.providerId || '').trim();

    // 2a. Notification to Provider
    if (provUserId) {
      try {
        const idProv = `notif_offer_accepted_prov_${offer.id}`;
        const payloadProv: AppNotification = {
          id: idProv,
          recipientUserId: provUserId,
          recipientRole: 'provider',
          type: 'PROVIDER_OFFER_ACCEPTED',
          title: {
            kz: 'Ұсынысыңыз қабылданды!',
            ru: 'Ваше предложение принято!',
          },
          body: {
            kz: `Тапсырыс беруші (${request.customerName || 'Клиент'}) сіздің ұсынысыңызды таңдады. Сұхбатты бастаңыз.`,
            ru: `Клиент (${request.customerName || 'Клиент'}) выбрал ваше предложение. Перейдите в чат для связи.`,
          },
          requestId: request.id,
          offerId: offer.id,
          providerId: offer.providerId,
          conversationId: `conv_${request.id}`,
          targetScreen: 'chat',
          isRead: false,
          readAt: null,
          createdAt: new Date().toISOString(),
        };
        await resilientRepository.createNotification(payloadProv);
      } catch (err) {
        console.warn('[NotificationService] notifyOfferAccepted (provider) note:', err);
      }
    }

    // 2b. Notification to Customer
    try {
      const idCust = `notif_offer_accepted_cust_${offer.id}`;
      const payloadCust: AppNotification = {
        id: idCust,
        recipientUserId: request.customerId,
        recipientRole: 'customer',
        type: 'CUSTOMER_OFFER_ACCEPTED',
        title: {
          kz: 'Маман бекітілді',
          ru: 'Мастер подтвержден',
        },
        body: {
          kz: `${offer.providerName || 'Маман'} таңдалды. Сұрақтарыңыз болса чатта хабарласыңыз.`,
          ru: `Мастер ${offer.providerName || ''} выбран. Напишите в чат для уточнения деталей.`,
        },
        requestId: request.id,
        offerId: offer.id,
        providerId: offer.providerId,
        conversationId: `conv_${request.id}`,
        targetScreen: 'chat',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      await resilientRepository.createNotification(payloadCust);
    } catch (err) {
      console.warn('[NotificationService] notifyOfferAccepted (customer) note:', err);
    }
  },

  /**
   * 3. In-App Chat: New message or attachment from peer
   */
  async notifyNewMessage(conversation: Conversation, message: ChatMessage): Promise<void> {
    try {
      const isSenderCustomer = message.senderRole === 'customer';
      const recipientUserId = isSenderCustomer
        ? (conversation.providerUserId || conversation.providerId)
        : conversation.customerId;

      if (!recipientUserId) return;

      // Rule: Do NOT notify sender themselves
      if (recipientUserId === message.senderId) {
        return;
      }

      const id = `notif_msg_${message.id}`;
      const senderDisplayName = isSenderCustomer
        ? (conversation.customerName || 'Клиент')
        : (conversation.providerName || 'Маман');

      const hasAttachment = Boolean(message.attachments && message.attachments.length > 0);
      const isImage = message.type === 'image' || message.attachments?.[0]?.type === 'image';

      let eventType = isSenderCustomer ? 'PROVIDER_NEW_MESSAGE' : 'CUSTOMER_NEW_MESSAGE';
      if (hasAttachment) {
        eventType = isSenderCustomer ? 'PROVIDER_NEW_ATTACHMENT' : 'CUSTOMER_NEW_ATTACHMENT';
      }

      let titleKz = 'Жаңа хабарлама';
      let titleRu = 'Новое сообщение';
      if (hasAttachment) {
        titleKz = isImage ? 'Жаңа фотосурет' : 'Жаңа файл тіркелді';
        titleRu = isImage ? 'Новая фотография' : 'Новый файл в чате';
      }

      let snippet = message.text;
      if (!snippet && hasAttachment) {
        snippet = isImage ? '📷 Фотосурет' : `📎 ${message.attachments![0].fileName || 'Файл'}`;
      } else if (snippet.length > 70) {
        snippet = `${snippet.substring(0, 67)}...`;
      }

      const payload: AppNotification = {
        id,
        recipientUserId,
        recipientRole: isSenderCustomer ? 'provider' : 'customer',
        type: eventType as any,
        title: {
          kz: titleKz,
          ru: titleRu,
        },
        body: {
          kz: `${senderDisplayName}: ${snippet}`,
          ru: `${senderDisplayName}: ${snippet}`,
        },
        requestId: conversation.requestId,
        conversationId: conversation.id,
        providerId: conversation.providerId,
        targetScreen: 'chat',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyNewMessage note:', err);
    }
  },

  /**
   * 4. Lifecycle: Request completed
   */
  /**
   * The selected provider reports the job finished: ask the customer to confirm it.
   */
  async notifyProviderReportedDone(request: ServiceRequest): Promise<void> {
    try {
      const payload: AppNotification = {
        id: `notif_done_cust_${request.id}`,
        recipientUserId: request.customerId,
        recipientRole: 'customer',
        type: 'CUSTOMER_WORK_COMPLETED',
        title: {
          kz: 'Шебер жұмысты аяқтады',
          ru: 'Мастер завершил работу',
        },
        body: {
          kz: 'Жұмысты тексеріп, аяқталғанын растаңыз.',
          ru: 'Проверьте работу и подтвердите завершение.',
        },
        requestId: request.id,
        offerId: request.selectedOfferId,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyProviderReportedDone note:', err);
    }
  },

  async notifyWorkCompleted(request: ServiceRequest, providerUserId?: string): Promise<void> {
    // 4a. Notify Customer that work is completed and review is recommended
    try {
      const idCust = `notif_completed_cust_${request.id}`;
      const payloadCust: AppNotification = {
        id: idCust,
        recipientUserId: request.customerId,
        recipientRole: 'customer',
        type: 'CUSTOMER_WORK_COMPLETED',
        title: {
          kz: 'Жұмыс аяқталды',
          ru: 'Работа выполнена',
        },
        body: {
          kz: 'Тапсырыс орындалды. Маманға баға беріп, пікір қалдырыңыз.',
          ru: 'Заказ завершен. Пожалуйста, оцените качество работы мастера.',
        },
        requestId: request.id,
        offerId: request.selectedOfferId,
        targetScreen: 'review_modal',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      await resilientRepository.createNotification(payloadCust);
    } catch (err) {
      console.warn('[NotificationService] notifyWorkCompleted (customer) note:', err);
    }

    // 4b. Notify Provider that job is successfully closed
    if (providerUserId) {
      try {
        const idProv = `notif_completed_prov_${request.id}`;
        const payloadProv: AppNotification = {
          id: idProv,
          recipientUserId: providerUserId,
          recipientRole: 'provider',
          type: 'PROVIDER_WORK_COMPLETED',
          title: {
            kz: 'Тапсырыс аяқталды',
            ru: 'Заказ завершен',
          },
          body: {
            kz: 'Тапсырыс сәтті орындалды деп белгіленді.',
            ru: 'Заказ успешно отмечен как выполненный.',
          },
          requestId: request.id,
          offerId: request.selectedOfferId,
          targetScreen: 'request_detail',
          isRead: false,
          readAt: null,
          createdAt: new Date().toISOString(),
        };
        await resilientRepository.createNotification(payloadProv);
      } catch (err) {
        console.warn('[NotificationService] notifyWorkCompleted (provider) note:', err);
      }
    }
  },

  /**
   * 5. Lifecycle: Request cancelled
   */
  async notifyRequestCancelled(request: ServiceRequest, providerUserId?: string): Promise<void> {
    if (!providerUserId) return;
    try {
      const id = `notif_cancelled_${request.id}`;
      const payload: AppNotification = {
        id,
        recipientUserId: providerUserId,
        recipientRole: 'provider',
        type: 'PROVIDER_REQUEST_CANCELLED',
        title: {
          kz: 'Тапсырыс тоқтатылды',
          ru: 'Заявка отменена',
        },
        body: {
          kz: `Тапсырыс беруші (${request.customerName || 'Клиент'}) өтінішті тоқтатты.`,
          ru: `Клиент (${request.customerName || 'Клиент'}) отменил выполнение заявки.`,
        },
        requestId: request.id,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyRequestCancelled note:', err);
    }
  },

  /**
   * 6. Appointment: Created
   */
  async notifyAppointmentCreated(
    request: ServiceRequest,
    appointment: Appointment,
    actorRole: 'customer' | 'provider'
  ): Promise<void> {
    try {
      const isCustomerActor = actorRole === 'customer';
      const recipientUserId = isCustomerActor
        ? (appointment.providerUserId || appointment.providerId).trim()
        : appointment.customerId.trim();

      if (!recipientUserId) return;

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      if (recipientUserId === currentUid) return;

      const id = `notif_appt_create_${appointment.id}_${Date.now()}`;
      const payload: AppNotification = {
        id,
        recipientUserId,
        recipientRole: isCustomerActor ? 'provider' : 'customer',
        type: isCustomerActor ? 'PROVIDER_APPOINTMENT_CREATED' : 'CUSTOMER_APPOINTMENT_CREATED',
        title: {
          kz: isCustomerActor ? 'Кездесу уақыты ұсынылды' : 'Маман кездесу уақытын ұсынды',
          ru: isCustomerActor ? 'Предложено время встречи' : 'Мастер предложил время встречи',
        },
        body: {
          kz: isCustomerActor
            ? `${request.customerName || 'Клиент'} кездесу уақытын белгіледі: ${appointment.scheduledAt}`
            : `Маман сізге кездесу уақытын ұсынды: ${appointment.scheduledAt}`,
          ru: isCustomerActor
            ? `Клиент (${request.customerName || 'Клиент'}) предложил встречу: ${appointment.scheduledAt}`
            : `Мастер предложил время встречи: ${appointment.scheduledAt}`,
        },
        requestId: request.id,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyAppointmentCreated note:', err);
    }
  },

  /**
   * 7. Appointment: Updated (Confirmed or Rescheduled)
   */
  async notifyAppointmentUpdated(
    request: ServiceRequest,
    appointment: Appointment,
    actorRole: 'customer' | 'provider',
    action: 'CONFIRMED' | 'RESCHEDULED'
  ): Promise<void> {
    try {
      const isCustomerActor = actorRole === 'customer';
      const recipientUserId = isCustomerActor
        ? (appointment.providerUserId || appointment.providerId).trim()
        : appointment.customerId.trim();

      if (!recipientUserId) return;

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      if (recipientUserId === currentUid) return;

      const id = `notif_appt_upd_${appointment.id}_${action.toLowerCase()}_${Date.now()}`;

      let title = {
        kz: action === 'CONFIRMED' ? 'Кездесу уақыты расталды' : 'Кездесу уақыты өзгертілді',
        ru: action === 'CONFIRMED' ? 'Время встречи подтверждено' : 'Время встречи перенесено',
      };

      let body = {
        kz: action === 'CONFIRMED'
          ? (isCustomerActor ? 'Клиент кездесу уақытын растады' : 'Маман кездесу уақытын растады') + `: ${appointment.scheduledAt}`
          : (isCustomerActor ? 'Клиент жаңа кездесу уақытын ұсынды' : 'Маман жаңа кездесу уақытын ұсынды') + `: ${appointment.scheduledAt}`,
        ru: action === 'CONFIRMED'
          ? (isCustomerActor ? 'Клиент подтвердил время встречи' : 'Мастер подтвердил время встречи') + `: ${appointment.scheduledAt}`
          : (isCustomerActor ? 'Клиент предложил другое время' : 'Мастер предложил другое время') + `: ${appointment.scheduledAt}`,
      };

      const payload: AppNotification = {
        id,
        recipientUserId,
        recipientRole: isCustomerActor ? 'provider' : 'customer',
        type: isCustomerActor ? 'PROVIDER_APPOINTMENT_UPDATED' : 'CUSTOMER_APPOINTMENT_UPDATED',
        title,
        body,
        requestId: request.id,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyAppointmentUpdated note:', err);
    }
  },

  /**
   * 8. Appointment: Cancelled
   */
  async notifyAppointmentCancelled(
    request: ServiceRequest,
    appointment: Appointment,
    actorRole: 'customer' | 'provider',
    reason?: string
  ): Promise<void> {
    try {
      const isCustomerActor = actorRole === 'customer';
      const recipientUserId = isCustomerActor
        ? (appointment.providerUserId || appointment.providerId).trim()
        : appointment.customerId.trim();

      if (!recipientUserId) return;

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      if (recipientUserId === currentUid) return;

      const id = `notif_appt_cancel_${appointment.id}_${Date.now()}`;
      const suffix = reason ? ` (${reason})` : '';

      const payload: AppNotification = {
        id,
        recipientUserId,
        recipientRole: isCustomerActor ? 'provider' : 'customer',
        type: isCustomerActor ? 'PROVIDER_APPOINTMENT_CANCELLED' : 'CUSTOMER_APPOINTMENT_CANCELLED',
        title: {
          kz: 'Кездесу тоқтатылды',
          ru: 'Встреча отменена',
        },
        body: {
          kz: isCustomerActor
            ? `Клиент белгіленген кездесуді тоқтатты${suffix}.`
            : `Маман белгіленген кездесуді тоқтатты${suffix}.`,
          ru: isCustomerActor
            ? `Клиент отменил назначенную встречу${suffix}.`
            : `Мастер отменил назначенную встречу${suffix}.`,
        },
        requestId: request.id,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyAppointmentCancelled note:', err);
    }
  },

  /**
   * 9. Provider Work Status: Updated
   */
  async notifyWorkStatusUpdated(
    request: ServiceRequest,
    appointment: Appointment,
    workStatus: WorkStatus
  ): Promise<void> {
    try {
      const recipientUserId = appointment.customerId.trim();
      if (!recipientUserId) return;

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      if (recipientUserId === currentUid) return;

      let type: NotificationEventType;
      let title: { kz: string; ru: string };
      let body: { kz: string; ru: string };

      switch (workStatus) {
        case 'PROVIDER_ON_THE_WAY':
          type = 'CUSTOMER_PROVIDER_ON_THE_WAY';
          title = {
            kz: 'Шебер жолға шықты 🚗',
            ru: 'Мастер выехал к вам 🚗',
          };
          body = {
            kz: 'Шебер көрсетілген мекенжайға қарай жолға шықты.',
            ru: 'Мастер выехал по указанному адресу.',
          };
          break;
        case 'PROVIDER_ARRIVED':
          type = 'CUSTOMER_PROVIDER_ARRIVED';
          title = {
            kz: 'Шебер мекенжайға жетті 📍',
            ru: 'Мастер прибыл 📍',
          };
          body = {
            kz: 'Шебер мекенжайға жетті және қызмет көрсетуге дайын.',
            ru: 'Мастер прибыл на место и готов к выполнению заказа.',
          };
          break;
        case 'WORK_STARTED':
          type = 'CUSTOMER_WORK_STARTED';
          title = {
            kz: 'Жұмыс басталды 🔧',
            ru: 'Работа начата 🔧',
          };
          body = {
            kz: 'Шебер тапсырысты орындауға кірісті.',
            ru: 'Мастер приступил к выполнению работы.',
          };
          break;
        case 'WORK_COMPLETED':
          type = 'CUSTOMER_WORK_COMPLETED';
          title = {
            kz: 'Жұмыс аяқталды! ✅',
            ru: 'Работа завершена! ✅',
          };
          body = {
            kz: 'Шебер жұмысты орындап бітті. Нәтижені тексеріп, аяқталғанын растаңыз.',
            ru: 'Мастер завершил работу. Проверьте результат и подтвердите завершение.',
          };
          break;
        case 'CANCELLED':
          type = 'PROVIDER_WORK_STATUS_UPDATED';
          title = {
            kz: 'Қызмет барысы тоқтатылды ❌',
            ru: 'Выполнение услуги отменено ❌',
          };
          body = {
            kz: 'Шебер жұмысты орындауды тоқтатты.',
            ru: 'Мастер отменил выполнение услуги.',
          };
          break;
        default:
          type = 'PROVIDER_WORK_STATUS_UPDATED';
          title = {
            kz: 'Жұмыс күйі жаңартылды',
            ru: 'Статус заказа обновлен',
          };
          body = {
            kz: 'Шебер жұмыс барысының жаңа күйін белгіледі.',
            ru: 'Мастер обновил статус выполнения заказа.',
          };
          break;
      }

      const id = `notif_workstatus_${appointment.id}_${workStatus.toLowerCase()}_${Date.now()}`;
      const payload: AppNotification = {
        id,
        recipientUserId,
        recipientRole: 'customer',
        type,
        title,
        body,
        requestId: request.id,
        providerId: appointment.providerId,
        targetScreen: 'request_detail',
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      await resilientRepository.createNotification(payload);
    } catch (err) {
      console.warn('[NotificationService] notifyWorkStatusUpdated note:', err);
    }
  },
};
