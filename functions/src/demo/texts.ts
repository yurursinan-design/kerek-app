import { localNow, weekdayOf } from './calendar';
import type { Business, Lang, Order } from './types';

/** Kazakh if the text has Kazakh letters or common Kazakh words (Cyrillic or Latin), else Russian. */
export function detectLang(text: string, fallback: Lang): Lang {
  const t = text.toLowerCase();
  if (/[әғқңөұүһі]/.test(t)) return 'kz';
  if (/(^|[^a-zа-я])(salem|sälem|salemetsiz|qansha|kansha|bar ma|ertең|erteñ|kerek|rakhmet|raqmet|rahmet|иа|ия|жок|жоқ|бар ма|канша|кашан|ертен|рахмет|салем|керек)([^a-zа-я]|$)/.test(t)) return 'kz';
  if (/[а-яё]/.test(t)) return 'ru';
  return fallback;
}

const WEEKDAYS: Record<Lang, string[]> = {
  ru: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  kz: ['дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі', 'жексенбі'],
};

export function weekdayName(date: string, lang: Lang): string {
  return WEEKDAYS[lang][weekdayOf(date)];
}

/** "сегодня", "завтра" or "пятница, 24.10" */
export function dayLabel(date: string, nowMs: number, lang: Lang): string {
  const today = localNow(nowMs).date;
  const [, m, d] = date.split('-');
  if (date === today) return lang === 'kz' ? 'бүгін' : 'сегодня';
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  if (date === tomorrow) return lang === 'kz' ? 'ертең' : 'завтра';
  return `${weekdayName(date, lang)}, ${d}.${m}`;
}

export function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ')} ₸`;
}

export const T = {
  consent: (b: Business, lang: Lang) =>
    lang === 'kz'
      ? `Сәлеметсіз бе! 👋 Мен «${b.name}» жасанды интеллект көмекшісімін, түнде де бірден жауап беремін.\nЖауап беру үшін хабарламаларыңызды өңдеуге келісіміңіз керек. Батырманы басыңыз — сұрағыңызға бірден жауап беремін.`
      : `Здравствуйте! 👋 Я ИИ-ассистент «${b.name}», отвечаю сразу, даже ночью.\nЧтобы ответить, мне нужно ваше согласие на обработку сообщений. Нажмите кнопку — и я сразу отвечу на ваш вопрос.`,
  consentButtons: (lang: Lang) =>
    lang === 'kz'
      ? [
          { id: 'consent_yes', label: 'Келісемін ✅' },
          { id: 'consent_owner', label: 'Әкімшіні шақыру' },
        ]
      : [
          { id: 'consent_yes', label: 'Согласен ✅' },
          { id: 'consent_owner', label: 'Позвать администратора' },
        ],
  consentAgain: (lang: Lang) =>
    lang === 'kz'
      ? 'Жауап беруім үшін «Келісемін ✅» батырмасын басыңыз. Немесе әкімші өзі жауап береді.'
      : 'Чтобы я ответил, нажмите «Согласен ✅». Или администратор ответит вам сам.',
  ownerWillAnswer: (lang: Lang) =>
    lang === 'kz' ? 'Жақсы! Әкімші жақын арада осы жерде жауап береді.' : 'Хорошо! Администратор ответит вам здесь в ближайшее время.',
  reminder: (lang: Lang, day: string, time: string, service: string, staff: string, address: string) =>
    lang === 'kz'
      ? `Еске саламыз: ${day}, сағат ${time} — ${service}${staff ? `, шебер ${staff}` : ''}.\nМекенжай: ${address}.\nКелесіз бе?`
      : `Напоминаем: ${day} в ${time} — ${service}${staff ? `, мастер ${staff}` : ''}.\nАдрес: ${address}.\nВы придёте?`,
  reminderButtons: (lang: Lang, bookingId: string) =>
    lang === 'kz'
      ? [
          { id: `remind_yes:${bookingId}`, label: 'Келемін ✅' },
          { id: `remind_move:${bookingId}`, label: 'Уақытын ауыстыру' },
        ]
      : [
          { id: `remind_yes:${bookingId}`, label: 'Приду ✅' },
          { id: `remind_move:${bookingId}`, label: 'Перенести' },
        ],
  remindYes: (lang: Lang) => (lang === 'kz' ? 'Керемет, сізді күтеміз! 😊' : 'Отлично, ждём вас! 😊'),
  moveRequest: (lang: Lang) => (lang === 'kz' ? 'Жазылу уақытын ауыстырғым келеді' : 'Хочу перенести запись'),
  orderConfirmed: (b: Business, o: Order, lang: Lang, nowMs: number) => {
    const items = o.items
      .map((it) => {
        const p = b.products.find((x) => x.id === it.productId);
        return p ? `• ${lang === 'kz' ? p.kz : p.ru} — ${it.qty} ${p.unit}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const day = dayLabel(o.date, nowMs, lang);
    const prepay = o.items.some((it) => b.products.find((p) => p.id === it.productId)?.available === false);
    return lang === 'kz'
      ? `Тапсырысыңыз расталды ✅\n${items}\n${day}, ${o.time} — ${o.mode === 'delivery' ? `жеткізу: ${o.address}` : 'өзі алып кету'}.\nБарлығы: ${money(o.total)}${prepay ? '\nАлдын ала төлем 50% — Kaspi арқылы, сілтемені әкімші жібереді.' : ''}`
      : `Ваш заказ подтверждён ✅\n${items}\n${day}, ${o.time} — ${o.mode === 'delivery' ? `доставка: ${o.address}` : 'самовывоз'}.\nИтого: ${money(o.total)}${prepay ? '\nПредоплата 50% — через Kaspi, ссылку пришлёт администратор.' : ''}`;
  },
  orderRejected: (lang: Lang) =>
    lang === 'kz'
      ? 'Кешіріңіз, бұл уақытқа үлгермейміз. Әкімші басқа уақыт ұсыну үшін сізге жазады.'
      : 'К сожалению, к этому времени не успеваем. Администратор напишет вам и предложит другое время.',
  failed: (lang: Lang) =>
    lang === 'kz'
      ? 'Кешіріңіз, бірден жауап бере алмадым. Сұрағыңызды әкімшіге жібердім, ол жақында жауап береді.'
      : 'Извините, не получилось ответить сразу. Я передал ваш вопрос администратору, он скоро ответит.',
};

export const ALERT_TEXT = {
  noConsent: { ru: 'Клиент пишет, но не нажал «Согласен». Ответьте ему сами.', kz: 'Клиент жазып жатыр, бірақ «Келісемін» батырмасын баспады. Өзіңіз жауап беріңіз.' },
  askedOwner: { ru: 'Клиент просит администратора. Ответьте в чате.', kz: 'Клиент әкімшіні сұрап тұр. Чатта жауап беріңіз.' },
  paused: { ru: 'Новое сообщение. Бот на паузе — ответьте сами.', kz: 'Жаңа хабарлама. Бот кідірісте — өзіңіз жауап беріңіз.' },
  failed: { ru: 'Бот не смог ответить. Ответьте клиенту сами.', kz: 'Бот жауап бере алмады. Клиентке өзіңіз жауап беріңіз.' },
  newOrder: { ru: 'Новый заказ ждёт подтверждения.', kz: 'Жаңа тапсырыс растауды күтіп тұр.' },
  handoff: (reason: string) => ({ ru: `Нужен ваш ответ: ${reason}`, kz: `Сіздің жауабыңыз керек: ${reason}` }),
};
