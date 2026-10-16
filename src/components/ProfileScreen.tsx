import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  ChevronRight,
  Eye,
  FileText,
  Heart,
  LifeBuoy,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Pencil,
  Phone,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { Language, Provider, ServiceRequest, normalizeRequestStatus } from '../types';
import type { AppMode } from './RoleChooser';
import { Emoji3D } from './CategoryIcon';
import { LegalModal } from './LegalModal';
import type { LegalDocId } from '../data/legalTexts';
import { repository, getFriendlyErrorMessage } from '../services';
import { maskPhone } from '../services/phoneAuth';
import { cachedName, initials, loadMyName, NAME_MAX, saveMyName } from '../services/profile';
import { getFavorites, masterProfileLink, onFavoritesChange, toggleFavorite, FavoriteMaster } from '../services/favorites';
import { getCustomerRating } from '../services/reviewsExtra';
import { getProviderStats, ProviderStats } from '../services/publicStats';
import { isSoundOn, setSoundOn } from '../services/notificationService';
import {
  getNotificationPermission,
  NotificationPermissionState,
  requestNotificationPermission,
} from '../services/pushNotifications';
import { PUBLIC_SITE_URL } from '../config/site';
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM } from '../config/support';

const L = {
  hello: { kz: 'Сәлем', ru: 'Привет' },
  addName: { kz: 'Есіміңізді қосыңыз', ru: 'Добавьте имя' },
  verified: { kz: 'Нөмір расталған', ru: 'Номер подтверждён' },
  city: { kz: 'Қызылорда', ru: 'Кызылорда' },
  fromMasters: { kz: 'шеберлерден', ru: 'от мастеров' },
  editName: { kz: 'Есімді өзгерту', ru: 'Изменить имя' },
  welcome: { kz: 'Қош келдіңіз!', ru: 'Добро пожаловать!' },
  welcomeText: {
    kz: 'Нөміріңізбен кіріңіз: өтінімдеріңіз, ұсыныстар мен хаттар кез келген телефонда сақталады.',
    ru: 'Войдите по номеру: заявки, предложения и переписка сохранятся на любом телефоне.',
  },
  login: { kz: 'Нөмірмен кіру', ru: 'Войти по номеру' },
  noPassword: { kz: 'Құпия сөзсіз, бір реттік кодпен', ru: 'Без пароля, по одноразовому коду' },
  statRequests: { kz: 'Өтінім', ru: 'Заявки' },
  statActive: { kz: 'Белсенді', ru: 'Активные' },
  statDone: { kz: 'Аяқталған', ru: 'Завершено' },
  statJobs: { kz: 'Орындалған', ru: 'Выполнено' },
  statRating: { kz: 'Рейтинг', ru: 'Рейтинг' },
  statAnswer: { kz: 'Жауап уақыты', ru: 'Время ответа' },
  becomeMaster: { kz: 'Шебер болып табыс табыңыз', ru: 'Зарабатывайте как мастер' },
  becomeMasterText: { kz: 'Қызылордадағы жаңа тапсырыстарды алыңыз', ru: 'Получайте новые заказы в Кызылорде' },
  toMaster: { kz: 'Шебер режиміне өту', ru: 'Перейти в режим мастера' },
  toMasterText: { kz: 'Жаңа өтінімдер мен ұсыныстарыңыз', ru: 'Новые заявки и ваши предложения' },
  toCustomer: { kz: 'Тапсырыс беруші режимі', ru: 'Режим заказчика' },
  toCustomerText: { kz: 'Өзіңізге шебер керек пе? Өтінім қалдырыңыз', ru: 'Нужен мастер для себя? Оставьте заявку' },
  masterSection: { kz: 'Шебер профилі', ru: 'Профиль мастера' },
  previewProfile: { kz: 'Клиенттер профиліңізді қалай көреді', ru: 'Как клиенты видят ваш профиль' },
  shareProfile: { kz: 'Профиль сілтемесімен бөлісу', ru: 'Поделиться ссылкой на профиль' },
  shareProfileSub: { kz: 'WhatsApp, Instagram, 2GIS — клиенттер тікелей табады', ru: 'WhatsApp, Instagram, 2GIS — клиенты найдут вас сразу' },
  takingOrders: { kz: 'Жаңа тапсырыс қабылдаймын', ru: 'Принимаю новые заказы' },
  onPause: { kz: 'Үзілістемін', ru: 'Я на паузе' },
  takingOrdersSub: { kz: 'Бос емес болсаңыз, үзіліс қосыңыз', ru: 'Заняты? Включите паузу' },
  onPauseSub: { kz: 'Жаңа өтінімдер туралы хабарлама келмейді', ru: 'Уведомления о новых заявках не приходят' },
  masterSettings: { kz: 'Портфолио және жұмыс баптаулары', ru: 'Портфолио и рабочие настройки' },
  account: { kz: 'Аккаунт', ru: 'Аккаунт' },
  myData: { kz: 'Менің деректерім', ru: 'Мои данные' },
  myName: { kz: 'Есімім', ru: 'Моё имя' },
  notSet: { kz: 'Көрсетілмеген', ru: 'Не указано' },
  favorites: { kz: 'Таңдаулы шеберлер', ru: 'Избранные мастера' },
  myRequests: { kz: 'Менің өтінімдерім', ru: 'Мои заявки' },
  settings: { kz: 'Баптаулар', ru: 'Настройки' },
  language: { kz: 'Тіл', ru: 'Язык' },
  notifications: { kz: 'Хабарландырулар', ru: 'Уведомления' },
  notifOn: { kz: 'Қосулы', ru: 'Включены' },
  notifOff: { kz: 'Өшірулі', ru: 'Выключены' },
  notifDeniedPhone: { kz: 'Телефон баптауларынан қосыңыз', ru: 'Включите в настройках телефона' },
  notifDeniedWeb: { kz: 'Браузер баптауларынан қосыңыз', ru: 'Включите в настройках браузера' },
  notifInApp: { kz: 'Қолданба ішінде көрсетіледі', ru: 'Показываются в приложении' },
  notifPrompt: { kz: 'Жаңа ұсыныс пен хатты жіберіп алмаңыз', ru: 'Не пропускайте предложения и сообщения' },
  turnOn: { kz: 'Қосу', ru: 'Включить' },
  sound: { kz: 'Қолданба ішіндегі дыбыс', ru: 'Звук в приложении' },
  soundSub: { kz: 'Жаңа хабарландыру келгенде', ru: 'При новом уведомлении' },
  help: { kz: 'Көмек және ақпарат', ru: 'Помощь и информация' },
  invite: { kz: 'Достарыңызға ұсыныңыз', ru: 'Посоветуйте друзьям' },
  inviteSub: { kz: 'Tapsyr сілтемесін жіберіңіз', ru: 'Отправьте ссылку на Tapsyr' },
  support: { kz: 'Көмек және қолдау', ru: 'Помощь и поддержка' },
  terms: { kz: 'Пайдалану шарттары', ru: 'Условия использования' },
  privacy: { kz: 'Құпиялылық саясаты', ru: 'Политика конфиденциальности' },
  admin: { kz: 'Басқару панелі', ru: 'Панель управления' },
  adminSub: { kz: 'Шағымдар, шеберлер, көрсеткіштер', ru: 'Жалобы, мастера, показатели' },
  logout: { kz: 'Шығу', ru: 'Выйти' },
  deleteAccount: { kz: 'Аккаунтты жою', ru: 'Удалить аккаунт' },
  deleteText: {
    kz: 'Профиліңіз, байланыс деректеріңіз және аккаунтыңыз жойылады, ашық өтініштер жабылады. Мұны қайтару мүмкін емес.',
    ru: 'Профиль, контактные данные и аккаунт будут удалены, открытые заявки закроются. Это нельзя отменить.',
  },
  delete: { kz: 'Жою', ru: 'Удалить' },
  cancel: { kz: 'Болдырмау', ru: 'Отмена' },
  close: { kz: 'Жабу', ru: 'Закрыть' },
  save: { kz: 'Сақтау', ru: 'Сохранить' },
  saved: { kz: 'Сақталды', ru: 'Сохранено' },
  namePlaceholder: { kz: 'Мысалы: Айгүл', ru: 'Например: Айгуль' },
  nameHint: { kz: 'Есіміңізді тек өзіңіз көресіз.', ru: 'Ваше имя видите только вы.' },
  noFavorites: { kz: 'Әзірге таңдаулы шебер жоқ', ru: 'Пока нет избранных мастеров' },
  noFavoritesText: {
    kz: 'Шебер профиліндегі ♡ белгісін басыңыз — ол осында сақталады.',
    ru: 'Нажмите ♡ в профиле мастера — он сохранится здесь.',
  },
  removeFavorite: { kz: 'Таңдаулылардан алып тастау', ru: 'Убрать из избранного' },
  notFound: { kz: 'Профиль табылмады', ru: 'Профиль не найден' },
  linkCopied: { kz: 'Сілтеме көшірілді', ru: 'Ссылка скопирована' },
  inviteText: {
    kz: 'Tapsyr — Қызылордада шебер табудың оңай жолы. Өтінім қалдырыңыз, шеберлер өздері ұсыныс жібереді:',
    ru: 'Tapsyr — простой способ найти мастера в Кызылорде. Оставьте заявку, мастера сами пришлют предложения:',
  },
  madeIn: { kz: 'Қызылордада жасалған', ru: 'Сделано в Кызылорде' },
  version: { kz: 'Нұсқа', ru: 'Версия' },
} as const;

type Key = keyof typeof L;

interface ProfileScreenProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
  mode: AppMode;
  uid: string | null;
  phoneNumber: string | null;
  /** Cloud mode: login, logout and the account belong to the phone number */
  cloud: boolean;
  isAdmin: boolean;
  requests: ServiceRequest[];
  onLogin: () => void;
  onLogout: () => void | Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onSwitchMode: () => void;
  onOpenRequests: () => void;
  onOpenAdmin: () => void;
  /** Shows a master's profile (a favourite, or the master's own one as customers see it) */
  onOpenMaster: (provider: Provider) => void;
  /** Provider side: the screen with the master's card, pause switch and portfolio */
  onOpenMasterSettings: () => void;
}

const ACTIVE_STATUSES = new Set(['OPEN', 'PROVIDER_SELECTED', 'IN_PROGRESS']);

/** Short answer time for the hero tile: 15 мин, 2 сағ, 1 күн */
function shortAnswerTime(minutes: number, language: Language): string {
  if (minutes < 60) return `${Math.max(5, Math.ceil(minutes / 5) * 5)} мин`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} ${language === 'kz' ? 'сағ' : 'ч'}`;
  return `${Math.ceil(hours / 24)} ${language === 'kz' ? 'күн' : 'дн'}`;
}

/** One settings group: a small caption over a white rounded card of rows */
const Group: React.FC<{ title: string; children: React.ReactNode; delay?: number }> = ({ title, children, delay = 0 }) => (
  <section className="animate-fadeUp" style={{ animationDelay: `${delay}ms` }}>
    <h2 className="px-1 mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{title}</h2>
    <div className="bg-white rounded-3xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] divide-y divide-slate-100 overflow-hidden">
      {children}
    </div>
  </section>
);

interface RowProps {
  icon: React.ReactNode;
  /** Classes for the rounded icon tile */
  tint: string;
  label: string;
  sub?: string;
  /** Right side; a chevron when left out */
  right?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  role?: string;
  ariaChecked?: boolean;
  disabled?: boolean;
}

const Row: React.FC<RowProps> = ({ icon, tint, label, sub, right, onClick, href, danger, role, ariaChecked, disabled }) => {
  const body = (
    <>
      <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${tint}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-semibold leading-tight ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{label}</span>
        {sub && <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{sub}</span>}
      </span>
      {right !== undefined ? right : <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />}
    </>
  );
  const cls = 'w-full flex items-center gap-3 px-4 min-h-[64px] py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60';
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    );
  }
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} role={role} aria-checked={ariaChecked} disabled={disabled} className={cls}>
      {body}
    </button>
  );
};

const Switch: React.FC<{ on: boolean; color?: string }> = ({ on, color = 'bg-sky-500' }) => (
  <span aria-hidden="true" className={`relative w-12 h-7 rounded-full shrink-0 transition-colors duration-200 ${on ? color : 'bg-slate-300'}`}>
    <span
      className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-200 ${on ? 'left-[22px]' : 'left-0.5'}`}
    />
  </span>
);

/** Bottom sheet drawn over the whole page (a blurred parent would squeeze a fixed child) */
const Sheet: React.FC<{ title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  closeLabel,
  onClose,
  children,
}) =>
  createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[85vh] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-2xl flex flex-col animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2.5 flex justify-center sm:hidden" aria-hidden="true">
          <span className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            data-dialog-close
            className="w-10 h-10 -mr-2 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body
  );

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  language,
  onLanguageChange,
  mode,
  uid,
  phoneNumber,
  cloud,
  isAdmin,
  requests,
  onLogin,
  onLogout,
  onDeleteAccount,
  onSwitchMode,
  onOpenRequests,
  onOpenAdmin,
  onOpenMaster,
  onOpenMasterSettings,
}) => {
  const tx = (key: Key) => L[key][language] || L[key].ru;
  const isProvider = mode === 'provider';
  // Without the cloud the app keeps everything on this phone, so it is always "signed in"
  const signedIn = cloud ? Boolean(phoneNumber) : true;

  const [name, setName] = useState(() => cachedName(uid));
  const [provider, setProvider] = useState<Provider | null>(null);
  const [providerRating, setProviderRating] = useState<{ avg: number; count: number } | null>(null);
  const [providerStats, setProviderStats] = useState<ProviderStats | null>(null);
  const [customerRating, setCustomerRating] = useState<{ avg: number; count: number } | null>(null);
  const [favorites, setFavorites] = useState<FavoriteMaster[]>(() => getFavorites());
  const [notif, setNotif] = useState<NotificationPermissionState>('unsupported');
  const [sound, setSound] = useState(() => isSoundOn());
  const [pauseSaving, setPauseSaving] = useState(false);

  const [sheet, setSheet] = useState<'name' | 'favorites' | 'delete' | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2600);
  };

  // Name, master profile and ratings of the signed-in account
  useEffect(() => {
    if (!uid || !signedIn) {
      setName('');
      setProvider(null);
      setProviderRating(null);
      setProviderStats(null);
      setCustomerRating(null);
      return;
    }
    let cancelled = false;
    setName(cachedName(uid));
    loadMyName(uid).then((n) => !cancelled && setName(n)).catch(() => {});
    getCustomerRating(uid).then((r) => !cancelled && setCustomerRating(r)).catch(() => {});
    (async () => {
      try {
        const prov = await repository.getProvider(uid);
        if (cancelled || !prov || prov.isDemo) return;
        setProvider(prov);
        const [rating, stats] = await Promise.all([
          repository.getRatingSummary([prov.id, prov.userId || '']).catch(() => null),
          getProviderStats(uid),
        ]);
        if (cancelled) return;
        setProviderRating(rating);
        setProviderStats(stats);
      } catch {
        // no master profile or not allowed to read it: the customer view stays
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, signedIn]);

  useEffect(() => onFavoritesChange(() => setFavorites(getFavorites())), []);

  useEffect(() => {
    let cancelled = false;
    getNotificationPermission().then((p) => !cancelled && setNotif(p));
    // Coming back from the phone's settings may have changed the permission
    const onVisible = () => {
      if (document.visibilityState === 'visible') getNotificationPermission().then((p) => !cancelled && setNotif(p));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const counts = useMemo(() => {
    let active = 0;
    let done = 0;
    for (const r of requests) {
      const s = normalizeRequestStatus(r.status);
      if (s === 'COMPLETED') done++;
      else if (ACTIVE_STATUSES.has(s)) active++;
    }
    return { total: requests.length, active, done };
  }, [requests]);

  const displayName = (isProvider && provider?.name) || name;
  const accent = isProvider
    ? { hero: 'from-emerald-500 via-emerald-600 to-teal-700 shadow-emerald-700/25', blob: 'bg-teal-300/30', text: 'text-emerald-700', switch: 'bg-emerald-500' }
    : { hero: 'from-sky-500 via-sky-600 to-indigo-600 shadow-sky-700/25', blob: 'bg-indigo-300/30', text: 'text-sky-700', switch: 'bg-sky-500' };

  const openNameSheet = () => {
    setNameDraft(name);
    setSheet('name');
  };

  const handleSaveName = async () => {
    if (!uid || savingName) return;
    setSavingName(true);
    setError(null);
    try {
      const saved = await saveMyName(uid, nameDraft);
      setName(saved);
      setSheet(null);
      showToast(tx('saved'));
    } catch (err) {
      setError(getFriendlyErrorMessage(err, language));
    } finally {
      setSavingName(false);
    }
  };

  const shareLink = async (title: string, text: string, url: string) => {
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
    } catch (err) {
      // Closing the share sheet is not a failure
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
    // No share sheet (most desktop browsers): WhatsApp with the text, or copy the link
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      showToast(tx('linkCopied'));
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener,noreferrer');
    }
  };

  const handleTogglePause = async () => {
    if (!provider || pauseSaving) return;
    setPauseSaving(true);
    setError(null);
    try {
      const next = !provider.paused;
      const saved = await repository.createProvider({ ...provider, paused: next });
      setProvider({ ...provider, ...saved, paused: next });
    } catch (err) {
      setError(getFriendlyErrorMessage(err, language));
    } finally {
      setPauseSaving(false);
    }
  };

  const handleEnableNotifications = async () => {
    const next = await requestNotificationPermission();
    setNotif(next);
  };

  const handleOpenFavorite = async (fav: FavoriteMaster) => {
    if (openingId) return;
    setOpeningId(fav.id);
    try {
      const prov = await repository.getProvider(fav.id);
      if (prov && !prov.isDemo) {
        setSheet(null);
        onOpenMaster(prov);
      } else {
        showToast(tx('notFound'));
      }
    } catch {
      showToast(tx('notFound'));
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteAccount();
    } finally {
      setDeleting(false);
      setSheet(null);
    }
  };

  const notifRight = (() => {
    if (notif === 'granted') {
      return (
        <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          {tx('notifOn')}
        </span>
      );
    }
    if (notif === 'prompt') {
      return (
        <span className={`h-8 px-3.5 rounded-full text-white text-xs font-bold inline-flex items-center ${isProvider ? 'bg-emerald-600' : 'bg-sky-600'}`}>
          {tx('turnOn')}
        </span>
      );
    }
    if (notif === 'denied') {
      return <span className="text-xs font-semibold text-slate-400">{tx('notifOff')}</span>;
    }
    return null;
  })();
  const notifSub =
    notif === 'granted'
      ? undefined
      : notif === 'prompt'
      ? tx('notifPrompt')
      : notif === 'denied'
      ? tx(Capacitor.isNativePlatform() ? 'notifDeniedPhone' : 'notifDeniedWeb')
      : tx('notifInApp');

  const stats: { value: string; label: string; onClick?: () => void }[] = isProvider
    ? [
        { value: String(providerStats?.completedJobs ?? 0), label: tx('statJobs') },
        {
          value: providerRating && providerRating.count > 0 ? `★ ${providerRating.avg.toFixed(1)}` : '—',
          label: tx('statRating'),
        },
        {
          value: providerStats?.avgResponseMinutes != null ? shortAnswerTime(providerStats.avgResponseMinutes, language) : '—',
          label: tx('statAnswer'),
        },
      ]
    : [
        { value: String(counts.total), label: tx('statRequests'), onClick: onOpenRequests },
        { value: String(counts.active), label: tx('statActive'), onClick: onOpenRequests },
        { value: String(counts.done), label: tx('statDone'), onClick: onOpenRequests },
      ];

  const supportHref = SUPPORT_TELEGRAM ? `https://t.me/${SUPPORT_TELEGRAM}` : SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : '';
  const iconCls = 'w-5 h-5';

  return (
    <div className="flex-1 bg-slate-50">
      <div className="w-full max-w-md mx-auto px-4 pt-4 pb-8 space-y-6">
        {/* Hero: who is signed in, with the main numbers */}
        <section
          className={`relative overflow-hidden rounded-[28px] p-5 text-white bg-linear-to-br shadow-xl ${accent.hero} animate-fadeUp`}
        >
          <span aria-hidden="true" className="absolute -top-20 -right-16 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <span aria-hidden="true" className={`absolute -bottom-24 -left-16 w-64 h-64 rounded-full blur-3xl ${accent.blob}`} />
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px]"
          />

          {signedIn ? (
            <div className="relative">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className="w-[68px] h-[68px] rounded-[22px] bg-white/20 ring-1 ring-white/40 backdrop-blur-sm flex items-center justify-center shadow-inner">
                    {displayName ? (
                      <span className="font-display text-2xl font-bold tracking-tight">{initials(displayName)}</span>
                    ) : (
                      <UserRound className="w-8 h-8 text-white/90" />
                    )}
                  </div>
                  {phoneNumber && (
                    <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow">
                      <BadgeCheck className={`w-4 h-4 ${accent.text}`} />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-white/80 font-medium">
                    {tx('hello')} <span aria-hidden="true">👋</span>
                  </p>
                  {displayName ? (
                    <h1 className="text-[21px] font-extrabold leading-[1.15] tracking-tight line-clamp-2 break-words">{displayName}</h1>
                  ) : (
                    <button
                      type="button"
                      onClick={openNameSheet}
                      className="text-left text-[19px] font-extrabold leading-tight tracking-tight underline decoration-white/40 underline-offset-4"
                    >
                      {tx('addName')}
                    </button>
                  )}
                  {phoneNumber && (
                    <p className="mt-1 text-[13px] text-white/85 font-medium tabular-nums">{maskPhone(phoneNumber)}</p>
                  )}
                </div>
                {!isProvider && (
                  <button
                    type="button"
                    onClick={openNameSheet}
                    aria-label={tx('editName')}
                    className="w-11 h-11 rounded-2xl bg-white/15 hover:bg-white/25 ring-1 ring-white/25 flex items-center justify-center shrink-0 transition-colors"
                  >
                    <Pencil className="w-[18px] h-[18px]" />
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {phoneNumber && (
                  <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 ring-1 ring-white/20 text-xs font-semibold">
                    <BadgeCheck className="w-3.5 h-3.5" />
                    {tx('verified')}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 ring-1 ring-white/20 text-xs font-semibold">
                  <MapPin className="w-3.5 h-3.5" />
                  {provider?.city && isProvider ? provider.city : tx('city')}
                </span>
                {!isProvider && customerRating && customerRating.count > 0 && (
                  <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-amber-300/25 ring-1 ring-amber-200/40 text-xs font-semibold">
                    <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                    {customerRating.avg.toFixed(1)} {tx('fromMasters')}
                  </span>
                )}
                {isProvider && provider?.iinVerified && (
                  <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 ring-1 ring-white/20 text-xs font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {language === 'kz' ? 'Жеке басы расталған' : 'Личность проверена'}
                  </span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {stats.map((s) => {
                  const inner = (
                    <>
                      <span className={`block font-extrabold leading-none tabular-nums truncate ${s.value.length > 4 ? 'text-lg' : 'text-xl'}`}>{s.value}</span>
                      <span className="block mt-1.5 text-[11px] text-white/80 font-semibold truncate">{s.label}</span>
                    </>
                  );
                  const cls = 'rounded-2xl bg-white/12 ring-1 ring-white/15 backdrop-blur-sm px-2 py-3 text-center';
                  return s.onClick ? (
                    <button key={s.label} type="button" onClick={s.onClick} className={`${cls} hover:bg-white/20 transition-colors`}>
                      {inner}
                    </button>
                  ) : (
                    <div key={s.label} className={cls}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="relative">
              <Emoji3D code="1f44b" size={60} eager className="animate-float" />
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{tx('welcome')}</h1>
              <p className="mt-1.5 text-sm text-white/85 leading-relaxed">{tx('welcomeText')}</p>
              <button
                type="button"
                onClick={onLogin}
                className={`mt-4 w-full h-12 rounded-2xl bg-white font-extrabold text-[15px] flex items-center justify-center gap-2 shadow-lg active:scale-[0.99] transition-transform ${accent.text}`}
              >
                <Phone className="w-[18px] h-[18px]" />
                {tx('login')}
              </button>
              <p className="mt-2 text-center text-xs text-white/75">{tx('noPassword')}</p>
            </div>
          )}
        </section>

        {error && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start justify-between gap-2 animate-fadeIn">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={tx('close')} className="text-rose-500 font-bold px-1">
              ✕
            </button>
          </div>
        )}

        {/* The other side of the app */}
        <button
          type="button"
          onClick={onSwitchMode}
          className={`group w-full flex items-center gap-4 p-4 rounded-3xl text-left border transition-all active:scale-[0.99] animate-fadeUp ${
            isProvider
              ? 'bg-linear-to-br from-sky-50 via-white to-indigo-50 border-sky-100'
              : 'bg-linear-to-br from-emerald-50 via-white to-teal-50 border-emerald-100'
          }`}
          style={{ animationDelay: '60ms' }}
        >
          <Emoji3D code={isProvider ? '1f3e1' : '1f9d1-200d-1f527'} size={54} />
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-extrabold text-slate-900 leading-tight">
              {isProvider ? tx('toCustomer') : provider ? tx('toMaster') : tx('becomeMaster')}
            </span>
            <span className="block mt-1 text-xs text-slate-600 leading-snug">
              {isProvider ? tx('toCustomerText') : provider ? tx('toMasterText') : tx('becomeMasterText')}
            </span>
          </span>
          <span
            className={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 shadow-md transition-transform group-hover:translate-x-0.5 ${
              isProvider ? 'bg-sky-600 shadow-sky-600/30' : 'bg-emerald-600 shadow-emerald-600/30'
            }`}
          >
            <ArrowRight className="w-5 h-5" />
          </span>
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="w-full flex items-center gap-4 p-4 rounded-3xl text-left bg-linear-to-br from-slate-800 to-slate-950 text-white shadow-lg shadow-slate-900/20 active:scale-[0.99] transition-transform animate-fadeUp"
            style={{ animationDelay: '90ms' }}
          >
            <span className="w-12 h-12 rounded-2xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-amber-300" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[16px] font-extrabold leading-tight">{tx('admin')}</span>
              <span className="block mt-1 text-xs text-white/70">{tx('adminSub')}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-white/50" />
          </button>
        )}

        {/* Master tools (provider side, once the profile exists) */}
        {isProvider && provider && signedIn && (
          <Group title={tx('masterSection')} delay={120}>
            <Row
              icon={<Zap className={iconCls} />}
              tint={provider.paused ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}
              label={provider.paused ? tx('onPause') : tx('takingOrders')}
              sub={provider.paused ? tx('onPauseSub') : tx('takingOrdersSub')}
              role="switch"
              ariaChecked={!provider.paused}
              disabled={pauseSaving}
              onClick={handleTogglePause}
              right={<Switch on={!provider.paused} color="bg-emerald-500" />}
            />
            <Row
              icon={<Eye className={iconCls} />}
              tint="bg-emerald-50 text-emerald-600"
              label={tx('previewProfile')}
              onClick={() => onOpenMaster(provider)}
            />
            <Row
              icon={<Share2 className={iconCls} />}
              tint="bg-violet-50 text-violet-600"
              label={tx('shareProfile')}
              sub={tx('shareProfileSub')}
              onClick={() =>
                shareLink(
                  provider.name,
                  language === 'kz' ? `${provider.name} — Tapsyr-дағы шебер` : `${provider.name} — мастер в Tapsyr`,
                  masterProfileLink(provider.id)
                )
              }
            />
            <Row
              icon={<Pencil className={iconCls} />}
              tint="bg-slate-100 text-slate-600"
              label={tx('masterSettings')}
              onClick={onOpenMasterSettings}
            />
          </Group>
        )}

        {signedIn && !isProvider && (
          <Group title={tx('myData')} delay={120}>
            <Row
              icon={<UserRound className={iconCls} />}
              tint="bg-sky-50 text-sky-600"
              label={tx('myName')}
              sub={name || tx('notSet')}
              onClick={openNameSheet}
            />
            <Row
              icon={<Heart className={iconCls} />}
              tint="bg-rose-50 text-rose-500"
              label={tx('favorites')}
              onClick={() => setSheet('favorites')}
              right={
                <span className="flex items-center gap-1.5">
                  {favorites.length > 0 && (
                    <span className="min-w-6 h-6 px-1.5 rounded-full bg-rose-50 text-rose-600 text-xs font-bold flex items-center justify-center">
                      {favorites.length}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden="true" />
                </span>
              }
            />
          </Group>
        )}

        <Group title={tx('settings')} delay={160}>
          <div className="flex items-center gap-3 px-4 min-h-[64px] py-3">
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600">
              <span className="text-[13px] font-extrabold" aria-hidden="true">Aa</span>
            </span>
            <span className="flex-1 min-w-0 text-[15px] font-semibold text-slate-900">{tx('language')}</span>
            <div className="inline-flex p-1 rounded-2xl bg-slate-100" role="radiogroup" aria-label={tx('language')}>
              {(
                [
                  { id: 'kz', label: 'Қазақша', flag: '1f1f0-1f1ff' },
                  { id: 'ru', label: 'Русский', flag: '1f1f7-1f1fa' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={language === opt.id}
                  onClick={() => onLanguageChange(opt.id)}
                  className={`h-9 pl-1.5 pr-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
                    language === opt.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  <Emoji3D code={opt.flag} size={18} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Row
            icon={<Bell className={iconCls} />}
            tint="bg-amber-50 text-amber-600"
            label={tx('notifications')}
            sub={notifSub}
            onClick={notif === 'prompt' ? handleEnableNotifications : undefined}
            right={notifRight}
          />
          <Row
            icon={<Volume2 className={iconCls} />}
            tint="bg-teal-50 text-teal-600"
            label={tx('sound')}
            sub={tx('soundSub')}
            role="switch"
            ariaChecked={sound}
            onClick={() => {
              setSoundOn(!sound);
              setSound(!sound);
            }}
            right={<Switch on={sound} color={accent.switch} />}
          />
        </Group>

        <Group title={tx('help')} delay={200}>
          <Row
            icon={<Megaphone className={iconCls} />}
            tint="bg-fuchsia-50 text-fuchsia-600"
            label={tx('invite')}
            sub={tx('inviteSub')}
            onClick={() => shareLink('Tapsyr', tx('inviteText'), PUBLIC_SITE_URL)}
          />
          {supportHref && (
            <Row
              icon={<LifeBuoy className={iconCls} />}
              tint="bg-sky-50 text-sky-600"
              label={tx('support')}
              sub={SUPPORT_TELEGRAM ? `@${SUPPORT_TELEGRAM}` : SUPPORT_EMAIL}
              href={supportHref}
            />
          )}
          <Row
            icon={<FileText className={iconCls} />}
            tint="bg-slate-100 text-slate-600"
            label={tx('terms')}
            onClick={() => setLegalDoc('terms')}
          />
          <Row
            icon={<Lock className={iconCls} />}
            tint="bg-slate-100 text-slate-600"
            label={tx('privacy')}
            onClick={() => setLegalDoc('privacy')}
          />
        </Group>

        {signedIn && (
          <Group title={tx('account')} delay={240}>
            {cloud && (
              <Row
                icon={<LogOut className={iconCls} />}
                tint="bg-slate-100 text-slate-600"
                label={tx('logout')}
                onClick={() => void onLogout()}
                right={null}
              />
            )}
            <Row
              icon={<Trash2 className={iconCls} />}
              tint="bg-rose-50 text-rose-500"
              label={tx('deleteAccount')}
              danger
              onClick={() => setSheet('delete')}
              right={null}
            />
          </Group>
        )}

        <footer className="pt-2 pb-2 flex flex-col items-center gap-2 text-center animate-fadeIn">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="w-10 h-10 opacity-90" />
          <p className="text-xs font-bold text-slate-500">
            Tapsyr · {tx('version')} {__APP_VERSION__}
          </p>
          <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
            <Emoji3D code="1f1f0-1f1ff" size={14} />
            {tx('madeIn')}
          </p>
        </footer>
      </div>

      {/* Name */}
      {sheet === 'name' && (
        <Sheet title={tx('myName')} closeLabel={tx('close')} onClose={() => setSheet(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveName();
            }}
            className="space-y-3 pt-1"
          >
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={NAME_MAX}
              autoFocus
              autoComplete="given-name"
              placeholder={tx('namePlaceholder')}
              aria-label={tx('myName')}
              className="w-full h-14 px-4 rounded-2xl border-2 border-slate-200 focus:border-sky-500 outline-none text-base font-semibold text-slate-900 placeholder:text-slate-400 transition-colors"
            />
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              {tx('nameHint')}
            </p>
            <button
              type="submit"
              disabled={savingName || nameDraft.trim() === name}
              className="w-full h-13 min-h-[52px] rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-[15px] transition-colors"
            >
              {savingName ? '…' : tx('save')}
            </button>
          </form>
        </Sheet>
      )}

      {/* Favourite masters */}
      {sheet === 'favorites' && (
        <Sheet title={tx('favorites')} closeLabel={tx('close')} onClose={() => setSheet(null)}>
          {favorites.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center gap-3">
              <span className="w-16 h-16 rounded-3xl bg-rose-50 flex items-center justify-center">
                <Heart className="w-8 h-8 text-rose-400" />
              </span>
              <p className="text-base font-bold text-slate-900">{tx('noFavorites')}</p>
              <p className="text-sm text-slate-500 max-w-[260px]">{tx('noFavoritesText')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-1">
              {favorites.map((fav) => (
                <li key={fav.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenFavorite(fav)}
                    className="flex-1 min-w-0 flex items-center gap-3 px-1 py-3 text-left rounded-2xl hover:bg-slate-50"
                  >
                    <span className="w-11 h-11 rounded-2xl bg-linear-to-br from-emerald-400 to-teal-500 text-white font-display font-bold flex items-center justify-center shrink-0">
                      {initials(fav.name) || '?'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-slate-900 truncate">{fav.name}</span>
                      {fav.category && <span className="block text-xs text-slate-500 truncate">{fav.category}</span>}
                    </span>
                    {openingId === fav.id ? (
                      <span className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(fav)}
                    aria-label={tx('removeFavorite')}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-rose-500 hover:bg-rose-50 shrink-0"
                  >
                    <Heart className="w-5 h-5 fill-rose-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}

      {/* Delete the account */}
      {sheet === 'delete' && (
        <Sheet title={tx('deleteAccount')} closeLabel={tx('cancel')} onClose={() => !deleting && setSheet(null)}>
          <div className="space-y-4 pt-1">
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 flex gap-3">
              <Trash2 className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-900 leading-relaxed">{tx('deleteText')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setSheet(null)}
                className="h-13 min-h-[52px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[15px]"
              >
                {tx('cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="h-13 min-h-[52px] rounded-2xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-extrabold text-[15px]"
              >
                {deleting ? '…' : tx('delete')}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      <LegalModal doc={legalDoc} language={language} onClose={() => setLegalDoc(null)} />

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[95] px-4 h-11 rounded-full bg-slate-900/90 text-white text-sm font-semibold flex items-center gap-2 shadow-xl backdrop-blur animate-popIn"
        >
          <BadgeCheck className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
};
