import React, { useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
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
} from '../data/serviceCatalog';
import { CategoryIcon } from './CategoryIcon';

interface ServiceDiscoveryProps {
  language: Language;
  /** A service was picked: start the step-by-step request */
  onPickService: (group: CatalogGroup, service: CatalogService) => void;
  /** Free text was submitted from the search box (analysed by the app, as before) */
  onFreeText: (text: string) => void;
}

const T = {
  title: { kz: 'Сізге қандай қызмет керек?', ru: 'Какая услуга вам нужна?' },
  subtitle: { kz: 'Қаладағы шеберлер бірнеше минутта ұсыныс жібереді', ru: 'Мастера вашего города пришлют предложения за несколько минут' },
  searchPlaceholder: { kz: 'Мысалы: сантехник, тазалау, кондиционер', ru: 'Например: сантехник, уборка, кондиционер' },
  searchFree: { kz: 'Осы мәтінмен өтініш беру', ru: 'Оставить заявку с этим текстом' },
  popular: { kz: 'Танымал қызметтер', ru: 'Популярные услуги' },
  categories: { kz: 'Барлық санаттар', ru: 'Все категории' },
  servicesCount: { kz: 'қызмет', ru: 'услуг' },
  howTitle: { kz: 'Қалай жұмыс істейді?', ru: 'Как это работает?' },
  how1: { kz: 'Өтініш қалдырыңыз', ru: 'Оставьте заявку' },
  how1d: { kz: 'Қызметті таңдап, бірнеше сұраққа жауап беріңіз', ru: 'Выберите услугу и ответьте на пару вопросов' },
  how2: { kz: 'Ұсыныстар алыңыз', ru: 'Получите предложения' },
  how2d: { kz: 'Шеберлер бағасы мен уақытын жібереді', ru: 'Мастера пришлют цену и время' },
  how3: { kz: 'Шеберді таңдаңыз', ru: 'Выберите мастера' },
  how3d: { kz: 'Пікірлерге қарап, ыңғайлысын таңдаңыз', ru: 'Сравните отзывы и выберите подходящего' },
  close: { kz: 'Жабу', ru: 'Закрыть' },
} as const;

/** Top of the customer home screen: search, popular services, all categories and "how it works". */
export const ServiceDiscovery: React.FC<ServiceDiscoveryProps> = ({ language, onPickService, onFreeText }) => {
  const lang = language === 'kz' ? 'kz' : 'ru';
  const tx = (e: { kz: string; ru: string }) => e[lang];
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<CatalogGroup | null>(null);
  const results = useMemo(() => searchServices(query, 7), [query]);
  const popular = useMemo(() => popularServices().slice(0, 10), []);

  return (
    <div className="space-y-7">
      {/* Hero + search */}
      <section className="space-y-3 pt-1">
        <h1 className="text-[28px] leading-tight font-extrabold text-slate-900 tracking-tight font-display">{tx(T.title)}</h1>
        <p className="text-sm text-slate-500">{tx(T.subtitle)}</p>
        <div className="relative">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (results[0]) onPickService(results[0].group, results[0].service);
              else if (query.trim()) onFreeText(query.trim());
            }}
            className="flex items-center gap-2 h-14 px-4 bg-white border-2 border-slate-200 focus-within:border-sky-500 rounded-2xl shadow-sm transition-colors"
          >
            <Search className="w-5 h-5 text-slate-400 shrink-0" />
            <input
              id="service-search"
              type="text"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tx(T.searchPlaceholder)}
              className="flex-1 min-w-0 bg-transparent text-base text-slate-900 placeholder:text-slate-400 outline-none"
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={tx(T.close)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            )}
          </form>
          {query.trim().length >= 2 && (
            <div className="absolute z-30 left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              {results.map(({ group, service }) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => onPickService(group, service)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0"
                >
                  <CategoryIcon icon={group.icon} color={group.color} size="sm" />
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
                className="w-full px-3.5 py-3 text-left text-sm font-semibold text-sky-700 hover:bg-sky-50"
              >
                «{query.trim()}» — {tx(T.searchFree)}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Popular services */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">{tx(T.popular)}</h2>
        <div className="-mx-4 px-4 scroll-px-4 flex gap-2.5 overflow-x-auto pb-1 snap-x" style={{ scrollbarWidth: 'none' }}>
          {popular.map(({ group, service }) => (
            <button
              key={service.id}
              type="button"
              onClick={() => onPickService(group, service)}
              className="snap-start shrink-0 w-32 p-3 bg-white border border-slate-200 rounded-2xl text-left shadow-2xs hover:shadow-sm active:scale-[0.98] transition-all space-y-2"
            >
              <CategoryIcon icon={group.icon} color={group.color} size="sm" />
              <span className="block text-[13px] font-semibold text-slate-800 leading-snug line-clamp-2">{serviceName(service, lang)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* All categories */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold text-slate-900">{tx(T.categories)}</h2>
          <span className="text-xs text-slate-500">
            {TOTAL_SERVICE_COUNT}+ {tx(T.servicesCount)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {SERVICE_CATALOG.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setOpenGroup(group)}
              className="p-3 bg-white border border-slate-200 rounded-2xl flex flex-col items-center text-center gap-2 shadow-2xs hover:shadow-sm active:scale-[0.97] transition-all min-h-[112px]"
            >
              <CategoryIcon icon={group.icon} color={group.color} />
              <span className="text-[12px] font-semibold text-slate-800 leading-tight line-clamp-3">{groupName(group, lang)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="p-5 bg-gradient-to-br from-sky-50 to-white border border-sky-100 rounded-3xl space-y-4">
        <h2 className="text-base font-bold text-slate-900">{tx(T.howTitle)}</h2>
        {[
          [T.how1, T.how1d],
          [T.how2, T.how2d],
          [T.how3, T.how3d],
        ].map(([title, desc], i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="w-8 h-8 rounded-full bg-sky-600 text-white text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span>
              <span className="block text-sm font-bold text-slate-900">{tx(title)}</span>
              <span className="block text-xs text-slate-500 leading-relaxed">{tx(desc)}</span>
            </span>
          </div>
        ))}
      </section>

      {/* Services of a group (bottom sheet) */}
      {openGroup && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setOpenGroup(null)}
        >
          <div
            className="w-full sm:max-w-md max-h-[85vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-5 pb-3 border-b border-slate-100">
              <CategoryIcon icon={openGroup.icon} color={openGroup.color} />
              <h3 className="flex-1 text-lg font-bold text-slate-900 font-display leading-tight">{groupName(openGroup, lang)}</h3>
              <button type="button" onClick={() => setOpenGroup(null)} aria-label={tx(T.close)} className="w-10 h-10 flex items-center justify-center text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {openGroup.services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => {
                    const g = openGroup;
                    setOpenGroup(null);
                    onPickService(g, service);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3.5 py-3.5 rounded-xl hover:bg-slate-50 text-left"
                >
                  <span className="text-[15px] font-medium text-slate-800">{serviceName(service, lang)}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
