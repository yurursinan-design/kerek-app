import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, ChevronRight, FilePenLine, HandCoins, Handshake, LockKeyhole, MessagesSquare, PenLine, Search, X } from 'lucide-react';
import { Language } from '../types';
import {
  CatalogGroup,
  CatalogService,
  SERVICE_CATALOG,
  TOTAL_SERVICE_COUNT,
  groupName,
  popularServices,
  searchServices,
  serviceName,
  getService,
} from '../data/serviceCatalog';
import { groupPhoto, hasPhoto, servicePhoto } from '../data/photos';
import { CategoryIcon, Emoji3D, Photo, tone } from './CategoryIcon';

interface ServiceDiscoveryProps {
  language: Language;
  /** A service was picked: start the step-by-step request */
  onPickService: (group: CatalogGroup, service: CatalogService) => void;
  /** Free text was submitted from the search box (analysed by the app, as before) */
  onFreeText: (text: string) => void;
  /** "Not in the list": jump to the free-text box below */
  onDescribeOwn: () => void;
  /** Switch to the provider side of the app */
  onBecomeProvider: () => void;
  /** Shown between the categories and "how it works" (the free-text request box) */
  children?: React.ReactNode;
}

// A reminder for the season (Kyzylorda: cold winters, very hot summers): one tap opens the request
const SEASONAL: { months: number[]; serviceId: string; emoji: string; title: { kz: string; ru: string }; text: { kz: string; ru: string } }[] = [
  {
    months: [8, 9, 10],
    serviceId: 'boiler_repair',
    emoji: '1f525',
    title: { kz: 'Қысқа дайындалыңыз', ru: 'Подготовьтесь к зиме' },
    text: { kz: 'Суық түскенше газ қазандығы мен батареяларды тексертіп алыңыз.', ru: 'Проверьте газовый котёл и батареи, пока не наступили холода.' },
  },
  {
    months: [11, 0, 1],
    serviceId: 'boiler_repair',
    emoji: '1f525',
    title: { kz: 'Үй жылы болсын', ru: 'Чтобы дома было тепло' },
    text: { kz: 'Қазандық нашар жылытса немесе өшіп қалса, шебер шақырыңыз.', ru: 'Котёл плохо греет или гаснет? Вызовите мастера.' },
  },
  {
    months: [2, 3, 4],
    serviceId: 'ac_service',
    emoji: '2744-fe0f',
    title: { kz: 'Жазға дайындалыңыз', ru: 'Подготовьтесь к лету' },
    text: { kz: 'Ыстық басталғанша кондиционерді тазалатып, фреон толтырыңыз.', ru: 'Почистите и заправьте кондиционер до жары.' },
  },
  {
    months: [5, 6, 7],
    serviceId: 'ac_service',
    emoji: '2744-fe0f',
    title: { kz: 'Ыстықта салқын болсын', ru: 'Прохлада в жару' },
    text: { kz: 'Кондиционер нашар салқындатса, тазалау мен фреон көмектеседі.', ru: 'Кондиционер плохо охлаждает? Помогут чистка и заправка.' },
  },
];

const T = {
  title: { kz: 'Сізге қандай қызмет керек?', ru: 'Какая услуга вам нужна?' },
  subtitle: { kz: 'Өтініш қалдырыңыз — қаладағы шеберлер баға ұсынады', ru: 'Оставьте заявку — мастера вашего города предложат цену' },
  searchPlaceholder: { kz: 'Қызметті іздеу', ru: 'Поиск услуги' },
  searchFree: { kz: 'осы мәтінмен өтініш беру', ru: 'оставить заявку с этим текстом' },
  free: { kz: 'Өтініш тегін', ru: 'Заявка бесплатна' },
  hidden: { kz: 'Нөміріңіз жасырын', ru: 'Номер скрыт' },
  direct: { kz: 'Төлем шеберге тікелей', ru: 'Оплата мастеру напрямую' },
  popular: { kz: 'Танымал қызметтер', ru: 'Популярные услуги' },
  categories: { kz: 'Барлық санаттар', ru: 'Все категории' },
  groupsUnit: { kz: 'санат', ru: 'категорий' },
  howTitle: { kz: 'Қалай жұмыс істейді?', ru: 'Как это работает?' },
  how1: { kz: 'Өтініш қалдырыңыз', ru: 'Оставьте заявку' },
  how1d: { kz: 'Қызметті таңдап, бірнеше сұраққа жауап беріңіз. Бір минуттан аз уақыт алады.', ru: 'Выберите услугу и ответьте на пару вопросов. Это меньше минуты.' },
  how2: { kz: 'Ұсыныстар алыңыз', ru: 'Получите предложения' },
  how2d: { kz: 'Шеберлер бағасын, уақытын және өзі туралы жазады.', ru: 'Мастера напишут цену, время и пару слов о себе.' },
  how3: { kz: 'Шеберді таңдаңыз', ru: 'Выберите мастера' },
  how3d: { kz: 'Пікірлер мен бағаны салыстырып, чатта келісіңіз.', ru: 'Сравните отзывы и цены, договоритесь в чате.' },
  providerTitle: { kz: 'Сіз шеберсіз бе?', ru: 'Вы мастер?' },
  providerText: { kz: 'Өз қалаңыздан тапсырыс алыңыз. Тіркелу тегін.', ru: 'Получайте заказы в своём городе. Регистрация бесплатна.' },
  providerBtn: { kz: 'Шебер болу', ru: 'Стать мастером' },
  notListed: { kz: 'Тізімде жоқ па?', ru: 'Нет в списке?' },
  notListedD: { kz: 'Өз сөзіңізбен жазыңыз', ru: 'Опишите своими словами' },
  close: { kz: 'Жабу', ru: 'Закрыть' },
  clear: { kz: 'Тазалау', ru: 'Очистить' },
} as const;

/** "N услуг" with the Russian plural form; Kazakh nouns don't change after numbers. */
function servicesCount(n: number, lang: 'kz' | 'ru'): string {
  if (lang === 'kz') return `${n} қызмет`;
  const d10 = n % 10;
  const d100 = n % 100;
  const word = d10 === 1 && d100 !== 11 ? 'услуга' : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? 'услуги' : 'услуг';
  return `${n} ${word}`;
}

const HOW_STEPS = [
  { Icon: FilePenLine, title: T.how1, desc: T.how1d },
  { Icon: MessagesSquare, title: T.how2, desc: T.how2d },
  { Icon: Handshake, title: T.how3, desc: T.how3d },
];

/** Top of the customer home screen: search, popular services, all categories and "how it works". */
export const ServiceDiscovery: React.FC<ServiceDiscoveryProps> = ({ language, onPickService, onFreeText, onDescribeOwn, onBecomeProvider, children }) => {
  const lang = language === 'kz' ? 'kz' : 'ru';
  const tx = (e: { kz: string; ru: string }) => e[lang];
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<CatalogGroup | null>(null);
  const results = useMemo(() => searchServices(query, 6), [query]);
  const popular = useMemo(() => popularServices().slice(0, 12), []);
  const season = useMemo(() => {
    const tip = SEASONAL.find((x) => x.months.includes(new Date().getMonth()));
    const found = tip && getService(tip.serviceId);
    return tip && found ? { tip, ...found } : null;
  }, []);

  // Keep the page behind the sheet still
  useEffect(() => {
    if (!openGroup) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openGroup]);

  const pick = (group: CatalogGroup, service: CatalogService) => {
    setOpenGroup(null);
    onPickService(group, service);
  };

  return (
    <div className="space-y-8">
      {/* Hero: title, floating 3D icons, search, honest promises */}
      <section className="relative -mx-4 -mt-5">
        <div className="absolute inset-0 rounded-b-[32px] overflow-hidden bg-sky-800" aria-hidden="true">
          {hasPhoto('hero_home') && <Photo name="hero_home" eager className="absolute inset-0 w-full h-full object-[70%_30%]" />}
          <div className="absolute inset-0 bg-linear-to-r from-sky-950/90 via-sky-900/70 to-sky-900/10" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-sky-950/80 to-transparent" />
        </div>

        <div className="relative px-4 pt-6 pb-5">
          <div className="h-16" aria-hidden="true" />
          <h1 className="relative max-w-[64%] text-[25px] leading-[1.18] font-bold text-white tracking-tight font-display animate-fadeUp">
            {tx(T.title)}
          </h1>
          <p className="relative max-w-[64%] mt-2 text-[13px] leading-snug text-white/85 animate-fadeUp" style={{ animationDelay: '60ms' }}>
            {tx(T.subtitle)}
          </p>

          <div className="relative z-20 mt-5 animate-fadeUp" style={{ animationDelay: '120ms' }}>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (results[0]) pick(results[0].group, results[0].service);
                else if (query.trim()) onFreeText(query.trim());
              }}
              className="flex items-center gap-2.5 h-14 pl-4 pr-2 bg-white rounded-2xl shadow-xl shadow-sky-900/20 ring-4 ring-white/20"
            >
              <Search className="w-5 h-5 text-sky-600 shrink-0" strokeWidth={2.5} />
              <input
                id="service-search"
                type="text"
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tx(T.searchPlaceholder)}
                aria-label={tx(T.searchPlaceholder)}
                className="flex-1 min-w-0 bg-transparent text-base text-slate-900 placeholder:text-slate-400 outline-none"
                autoComplete="off"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label={tx(T.clear)} className="w-10 h-10 flex items-center justify-center text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              )}
            </form>
            {query.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn">
                {results.map(({ group, service }) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => pick(group, service)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-100"
                  >
                    <CategoryIcon emoji={service.emoji} color={group.color} photo={servicePhoto(service.id, group.id)} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900 truncate">{serviceName(service, lang)}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{groupName(group, lang)}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onFreeText(query.trim())}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-sky-50"
                >
                  <span className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                    <PenLine className="w-4.5 h-4.5 text-sky-700" />
                  </span>
                  <span className="text-sm font-semibold text-sky-800 leading-snug">
                    «{query.trim()}» — {tx(T.searchFree)}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="relative mt-4 flex flex-wrap gap-2 animate-fadeUp" style={{ animationDelay: '180ms' }}>
            {[
              { Icon: BadgeCheck, text: T.free },
              { Icon: LockKeyhole, text: T.hidden },
              { Icon: HandCoins, text: T.direct },
            ].map(({ Icon, text }) => (
              <span
                key={text.ru}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/12 border border-white/20 backdrop-blur-md text-white text-[12px] font-semibold whitespace-nowrap"
              >
                <Icon className="w-3.5 h-3.5 text-sky-200" strokeWidth={2.5} />
                {tx(text)}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Seasonal reminder */}
      {season && (
        <button
          type="button"
          onClick={() => pick(season.group, season.service)}
          className="press w-full flex items-center gap-3 p-2.5 pr-3 rounded-3xl bg-white border border-slate-200/80 shadow-sm shadow-slate-200/60 text-left animate-fadeUp"
        >
          {servicePhoto(season.service.id, season.group.id) ? (
            <Photo name={servicePhoto(season.service.id, season.group.id)!} className="w-16 h-16 rounded-2xl shrink-0" />
          ) : (
            <span className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0">
              <Emoji3D code={season.tip.emoji} size={40} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-slate-900 leading-tight">{tx(season.tip.title)}</span>
            <span className="block mt-0.5 text-[12px] text-slate-600 leading-snug">{tx(season.tip.text)}</span>
          </span>
          <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
        </button>
      )}

      {/* Popular services */}
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{tx(T.popular)}</h2>
        <div className="-mx-4 px-4 scroll-px-4 flex gap-3 overflow-x-auto pb-2 snap-x no-scrollbar stagger">
          {popular.map(({ group, service }, i) => (
            <button
              key={service.id}
              type="button"
              onClick={() => pick(group, service)}
              style={{ ['--i' as string]: i }}
              className="press snap-start shrink-0 w-[148px] bg-white border border-slate-200/80 rounded-3xl overflow-hidden text-left shadow-sm shadow-slate-200/60"
            >
              {servicePhoto(service.id, group.id) ? (
                <Photo name={servicePhoto(service.id, group.id)!} className="w-full h-[112px]" />
              ) : (
                <span className={`h-[112px] bg-linear-to-br ${tone(group.color).tile} flex items-center justify-center`}>
                  <Emoji3D code={service.emoji} size={58} />
                </span>
              )}
              <span className="block px-3 pt-2.5 pb-3 text-[13px] font-bold text-slate-800 leading-snug line-clamp-2 min-h-[3.6em]">
                {serviceName(service, lang)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* All categories */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{tx(T.categories)}</h2>
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
            {SERVICE_CATALOG.length} {tx(T.groupsUnit)} · {servicesCount(TOTAL_SERVICE_COUNT, lang)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5 stagger">
          {SERVICE_CATALOG.map((group, i) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setOpenGroup(group)}
              style={{ ['--i' as string]: i }}
              className={`press relative overflow-hidden rounded-3xl min-h-[136px] flex flex-col justify-end text-left ${
                groupPhoto(group.id) ? 'bg-slate-800' : `bg-linear-to-br ${tone(group.color).tile} items-center text-center p-2.5`
              }`}
            >
              {groupPhoto(group.id) ? (
                <>
                  <Photo name={groupPhoto(group.id)!} className="absolute inset-0 w-full h-full" />
                  <span className="absolute inset-0 bg-linear-to-t from-slate-950/85 via-slate-950/25 to-transparent" aria-hidden="true" />
                  <span className="relative px-2.5 pb-2.5">
                    <span className="block text-[12px] font-bold text-white leading-tight line-clamp-2 [overflow-wrap:anywhere]">{groupName(group, lang)}</span>
                    <span className="block mt-0.5 text-[10px] font-medium text-white/75">{servicesCount(group.services.length, lang)}</span>
                  </span>
                </>
              ) : (
                <>
                  <Emoji3D code={group.emoji} size={50} className="mb-auto" />
                  <span className="text-[12px] font-bold text-slate-800 leading-tight line-clamp-2">{groupName(group, lang)}</span>
                  <span className={`text-[10px] font-semibold ${tone(group.color).text} opacity-80`}>{servicesCount(group.services.length, lang)}</span>
                </>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={onDescribeOwn}
            style={{ ['--i' as string]: SERVICE_CATALOG.length }}
            className={`press ${SERVICE_CATALOG.length % 3 === 1 ? 'col-span-2' : SERVICE_CATALOG.length % 3 === 2 ? 'col-span-1' : 'col-span-3'} p-3 rounded-3xl border-2 border-dashed border-slate-200 bg-white flex items-center gap-3 text-left min-h-[136px]`}
          >
            <span className="w-11 h-11 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0">
              <PenLine className="w-5 h-5 text-sky-700" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-slate-800 leading-tight">{tx(T.notListed)}</span>
              <span className="block mt-0.5 text-[11px] text-slate-500 leading-snug">{tx(T.notListedD)}</span>
            </span>
          </button>
        </div>
      </section>

      {children}

      {/* How it works */}
      <section className="p-5 bg-white border border-slate-200/80 rounded-3xl shadow-sm shadow-slate-200/60">
        <h2 className="text-lg font-extrabold text-slate-900 tracking-tight mb-4">{tx(T.howTitle)}</h2>
        <ol className="relative space-y-5">
          <span className="absolute left-7 top-8 bottom-8 border-l-2 border-dashed border-sky-200" aria-hidden="true" />
          {HOW_STEPS.map((s, i) => (
            <li key={i} className="relative flex items-start gap-3.5">
              <span className="relative w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0 ring-4 ring-white">
                <s.Icon className="w-6 h-6 text-sky-700" strokeWidth={2} />
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] font-extrabold flex items-center justify-center ring-2 ring-white">
                  {i + 1}
                </span>
              </span>
              <span className="pt-1">
                <span className="block text-[15px] font-bold text-slate-900">{tx(s.title)}</span>
                <span className="block text-[13px] text-slate-500 leading-relaxed">{tx(s.desc)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Become a provider */}
      <section className="relative overflow-hidden p-5 rounded-3xl bg-emerald-800 text-white">
        {hasPhoto('role_master') ? (
          <>
            <Photo name="role_master" className="absolute inset-y-0 right-0 w-[55%] h-full object-[50%_20%]" />
            <span className="absolute inset-0 bg-linear-to-r from-emerald-800 via-emerald-800/90 to-emerald-800/10" aria-hidden="true" />
          </>
        ) : (
          <Emoji3D code="1f9d1-200d-1f527" size={92} className="absolute right-2 bottom-1 drop-shadow-xl" />
        )}
        <div className="relative max-w-[66%] space-y-1.5">
          <h2 className="text-lg font-extrabold tracking-tight">{tx(T.providerTitle)}</h2>
          <p className="text-[13px] text-emerald-50/90 leading-snug">{tx(T.providerText)}</p>
        </div>
        <button
          type="button"
          onClick={onBecomeProvider}
          className="press relative mt-4 h-11 px-5 rounded-2xl bg-white text-emerald-700 text-sm font-extrabold inline-flex items-center gap-1.5 shadow-lg shadow-emerald-900/20"
        >
          {tx(T.providerBtn)}
          <ChevronRight className="w-4 h-4" strokeWidth={3} />
        </button>
      </section>

      {/* Services of a group (bottom sheet) */}
      {openGroup && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={groupName(openGroup, lang)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setOpenGroup(null)}
        >
          <div
            className="w-full sm:max-w-md max-h-[88vh] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-2xl flex flex-col overflow-hidden animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            {groupPhoto(openGroup.id) ? (
              <div className="relative h-40 shrink-0 bg-slate-800">
                <Photo name={groupPhoto(openGroup.id)!} eager className="absolute inset-0 w-full h-full" />
                <span className="absolute inset-0 bg-linear-to-t from-slate-950/85 via-slate-950/20 to-slate-950/10" aria-hidden="true" />
                <div className="absolute top-2 inset-x-0 mx-auto w-10 h-1.5 rounded-full bg-white/60" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setOpenGroup(null)}
                  aria-label={tx(T.close)}
                  className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/35 backdrop-blur-sm flex items-center justify-center text-white"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
                  <h3 className="text-xl font-bold text-white font-display leading-tight">{groupName(openGroup, lang)}</h3>
                  <p className="mt-1 text-[13px] text-white/80 leading-snug">{lang === 'kz' ? openGroup.kzHint : openGroup.ruHint}</p>
                </div>
              </div>
            ) : (
            <div className={`relative px-5 pt-3 pb-4 bg-linear-to-br ${tone(openGroup.color).tile}`}>
              <div className="mx-auto mb-3 w-10 h-1.5 rounded-full bg-slate-900/15" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setOpenGroup(null)}
                aria-label={tx(T.close)}
                className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/70 flex items-center justify-center text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-4 pr-10">
                <Emoji3D code={openGroup.emoji} size={68} className="animate-popIn drop-shadow-lg" />
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 font-display leading-tight">{groupName(openGroup, lang)}</h3>
                  <p className="mt-1 text-[13px] text-slate-600 leading-snug">{lang === 'kz' ? openGroup.kzHint : openGroup.ruHint}</p>
                </div>
              </div>
            </div>
            )}
            <div className="overflow-y-auto p-2 pb-4 stagger" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              {openGroup.services.map((service, i) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => pick(openGroup, service)}
                  style={{ ['--i' as string]: i }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-50 active:bg-slate-100 text-left"
                >
                  <CategoryIcon emoji={service.emoji} color={openGroup.color} photo={servicePhoto(service.id, openGroup.id)} size="sm" />
                  <span className="flex-1 text-[15px] font-semibold text-slate-800">{serviceName(service, lang)}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setOpenGroup(null);
                  onDescribeOwn();
                }}
                style={{ ['--i' as string]: openGroup.services.length }}
                className="mt-1 w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border-2 border-dashed border-slate-200 text-left"
              >
                <span className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <PenLine className="w-4.5 h-4.5 text-slate-600" />
                </span>
                <span className="flex-1">
                  <span className="block text-[14px] font-bold text-slate-800">{tx(T.notListed)}</span>
                  <span className="block text-[12px] text-slate-500">{tx(T.notListedD)}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
