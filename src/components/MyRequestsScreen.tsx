import React, { useState, useEffect } from 'react';
import {
  Language,
  Provider,
  ServiceRequest,
  formatDynamicBudget,
  formatDynamicDate,
  isRequestExpired,
  normalizeRequestStatus,
} from '../types';
import { translations } from '../i18n/translations';
import { getRequestDescription, getRequestTitle } from '../services/requestTitle';
import { formatShortDate } from '../services/dateFormat';
import { repository } from '../services';
import { getCityDisplayName } from '../services/taxonomy';
import { Calendar, ChevronRight, ClipboardList, Heart, Inbox, MapPin, MessageCircle, Phone, Plus, Wallet } from 'lucide-react';
import { toTelHref, toWhatsAppHref } from '../services/phoneLinks';
import { FavoriteMaster, getFavorites, onFavoritesChange } from '../services/favorites';
import { ProviderProfileModal } from './ProviderProfileModal';
import { getCustomerRating } from '../services/reviewsExtra';

import { RequestIcon } from './RequestIcon';

/** Russian noun form after a number: 1 заявка, 2 заявки, 5 заявок */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

/** A master the customer already hired: shown so they can call the same person again */
interface PastMaster {
  key: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  lastJob: string;
  jobs: number;
}

interface MyRequestsScreenProps {
  requests: ServiceRequest[];
  /** True until the requests were loaded the first time */
  loading?: boolean;
  language: Language;
  onSelectRequest: (request: ServiceRequest) => void;
  onCreateNewRequest: () => void;
}

export const MyRequestsScreen: React.FC<MyRequestsScreenProps> = ({
  requests,
  loading = false,
  language,
  onSelectRequest,
  onCreateNewRequest,
}) => {
  const t = translations[language];
  const [offersCountMap, setOffersCountMap] = useState<Record<string, number>>({});

  // Offer counts, read in parallel, and only again when the list of requests really changes
  const requestIdsKey = requests.map((r) => r.id).join(',');
  useEffect(() => {
    let isMounted = true;
    const fetchCounts = async () => {
      const entries = await Promise.all(
        requests.map(async (req) => {
          try {
            // A count query: the offers themselves are not downloaded
            return [req.id, await repository.countOffers(req.id)] as const;
          } catch {
            return [req.id, 0] as const;
          }
        })
      );
      if (isMounted) {
        setOffersCountMap(Object.fromEntries(entries));
      }
    };
    fetchCounts();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestIdsKey]);

  // Masters from finished jobs (newest first, at most 10 jobs read), so a good master is one tap away next time
  const [pastMasters, setPastMasters] = useState<PastMaster[]>([]);
  const completedIdsKey = requests
    .filter((r) => normalizeRequestStatus(r.status) === 'COMPLETED')
    .map((r) => r.id)
    .join(',');
  useEffect(() => {
    let isMounted = true;
    const done = requests
      .filter((r) => normalizeRequestStatus(r.status) === 'COMPLETED')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 10);
    if (done.length === 0) {
      setPastMasters([]);
      return;
    }
    Promise.all(
      done.map(async (req) => {
        try {
          const offers = await repository.getOffers({ requestId: req.id });
          const hired = offers.find((o) => o.id === req.selectedOfferId) || offers.find((o) => o.status === 'ACCEPTED');
          return hired && !hired.isDemo ? { req, hired } : null;
        } catch {
          return null;
        }
      })
    ).then((rows) => {
      if (!isMounted) return;
      const byMaster = new Map<string, PastMaster>();
      for (const row of rows) {
        if (!row) continue;
        const key = row.hired.providerUserId || row.hired.providerId;
        const seen = byMaster.get(key);
        if (seen) {
          seen.jobs += 1;
        } else {
          byMaster.set(key, {
            key,
            name: row.hired.providerName,
            phone: row.hired.providerPhone,
            whatsapp: row.hired.providerWhatsapp,
            lastJob: getRequestTitle(row.req, language),
            jobs: 1,
          });
        }
      }
      setPastMasters(Array.from(byMaster.values()));
    });
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedIdsKey, language]);

  // The rating masters gave this customer (two-sided reviews)
  const [myRating, setMyRating] = useState<{ avg: number; count: number } | null>(null);
  const myUid = requests[0]?.customerId || '';
  useEffect(() => {
    let alive = true;
    if (myUid) getCustomerRating(myUid).then((r) => alive && setMyRating(r));
    return () => {
      alive = false;
    };
  }, [myUid]);

  // Masters saved with the heart button (on this phone)
  const [favorites, setFavorites] = useState<FavoriteMaster[]>(() => getFavorites());
  useEffect(() => onFavoritesChange(() => setFavorites(getFavorites())), []);
  const [profile, setProfile] = useState<Provider | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const openProfile = async (id: string) => {
    setProfileError(null);
    try {
      const prov = await repository.getProvider(id);
      if (prov) setProfile(prov);
      else setProfileError(language === 'kz' ? 'Шебер профилі табылмады' : 'Профиль мастера не найден');
    } catch {
      setProfileError(language === 'kz' ? 'Шебер профилі табылмады' : 'Профиль мастера не найден');
    }
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-5">
      <div className="space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-2xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0"><ClipboardList className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight font-display leading-tight">{t.myRequestsTitle}</h2>
              {requests.length > 0 && (
                <p className="text-xs text-slate-500">
                  {requests.length} {language === 'kz' ? 'өтініш' : ruPlural(requests.length, 'заявка', 'заявки', 'заявок')}
                  {myRating && myRating.count > 0 && (
                    <span className="ml-1.5 text-amber-700 font-semibold">
                      · ★ {myRating.avg.toFixed(1)} {language === 'kz' ? 'шеберлерден' : 'от мастеров'}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onCreateNewRequest}
            aria-label={language === 'kz' ? 'Жаңа өтініш' : 'Новая заявка'}
            title={language === 'kz' ? 'Жаңа өтініш' : 'Новая заявка'}
            className="press w-12 h-12 rounded-2xl bg-linear-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-sky-600/25 shrink-0"
          >
            <Plus className="w-6 h-6" strokeWidth={3} />
          </button>
        </div>

        {/* Requests List */}
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16" role="status">
            <span className="w-6 h-6 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-8 bg-linear-to-b from-sky-50 to-white rounded-[28px] border border-sky-100 text-center space-y-4 mt-4 animate-fadeUp">
            <span className="mx-auto w-20 h-20 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center"><Inbox className="w-9 h-9" strokeWidth={1.75} /></span>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{t.myRequestsEmpty}</h3>
              <p className="text-[13px] text-slate-500 max-w-xs mx-auto mt-1 leading-relaxed">
                {language === 'kz'
                  ? 'Қызметті таңдап, өтініш қалдырыңыз — шеберлер өз бағасын ұсынады.'
                  : 'Выберите услугу и оставьте заявку — мастера предложат свою цену.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateNewRequest}
              className="press min-h-[48px] px-6 rounded-2xl bg-linear-to-r from-sky-600 to-indigo-600 text-white font-bold text-sm inline-flex items-center gap-2 shadow-lg shadow-sky-600/20"
            >
              <Plus className="w-4 h-4" strokeWidth={3} />
              <span>{t.createNewRequestBtn}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {requests.map((req, i) => {
              const offerCount = offersCountMap[req.id] || 0;
              const formattedDate = req.createdAt
                ? formatShortDate(req.createdAt, language)
                : req.date;

              return (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => onSelectRequest(req)}
                  style={{ ['--i' as string]: i }}
                  className="press w-full text-left p-4 bg-white border border-slate-200/80 rounded-3xl shadow-sm shadow-slate-200/60 group flex items-start gap-3"
                >
                  <RequestIcon request={req} size="lg" />
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          req.status === 'PROVIDER_SELECTED' || req.status === 'ACCEPTED'
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : req.status === 'IN_PROGRESS'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : req.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : req.status === 'CANCELLED' || req.status === 'REJECTED'
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : 'bg-sky-50 text-sky-800 border border-sky-200'
                        }`}
                      >
                        {req.status === 'PROVIDER_SELECTED' || req.status === 'ACCEPTED'
                          ? t.status_PROVIDER_SELECTED
                          : req.status === 'IN_PROGRESS'
                          ? t.status_IN_PROGRESS
                          : req.status === 'COMPLETED'
                          ? t.status_COMPLETED
                          : req.status === 'CANCELLED' || req.status === 'REJECTED'
                          ? t.status_CANCELLED
                          : t.status_OPEN}
                      </span>
                      {normalizeRequestStatus(req.status) === 'OPEN' && !req.selectedOfferId && isRequestExpired(req) && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                          {language === 'kz' ? 'Мерзімі бітті' : 'Срок истёк'}
                        </span>
                      )}
                    </div>

                    {/* Service & Text */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 leading-snug group-hover:text-sky-800 transition-colors">
                        {getRequestTitle(req, language)}
                      </h4>
                      {getRequestDescription(req) && (
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{getRequestDescription(req)}</p>
                      )}
                    </div>

                    {/* Meta: Created Date, City, Budget, Offers Count */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-medium pt-0.5">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {getCityDisplayName(req.cityId || req.city, language) || req.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {formatDynamicDate(formattedDate || req.date, language)}
                      </span>
                      {req.budget && (
                        <span className="flex items-center gap-1 text-sky-700 font-semibold">
                          <Wallet className="w-3 h-3" />
                          {formatDynamicBudget(req.budget, language)}
                        </span>
                      )}
                      {offerCount > 0 && (
                        <span className="flex items-center gap-1 text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded-full">
                          {offerCount} {language === 'kz' ? 'ұсыныс' : 'предл.'}
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-sky-600 transition-colors shrink-0 self-center" />
                </button>
              );
            })}
          </div>
        )}

        {pastMasters.length > 0 && (
          <section className="space-y-2 pt-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {language === 'kz' ? 'Сіз жұмыс істеген шеберлер' : 'Мастера, с которыми вы работали'}
              </h3>
              <p className="text-xs text-slate-500">
                {language === 'kz' ? 'Тағы керек болса, тікелей хабарласыңыз.' : 'Нужен снова — свяжитесь напрямую.'}
              </p>
            </div>
            {pastMasters.map((m) => {
              const tel = toTelHref(m.phone);
              const wa = toWhatsAppHref(m.whatsapp || m.phone);
              return (
                <div key={m.key} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                  <button type="button" onClick={() => openProfile(m.key)} className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-bold text-slate-900 truncate">{m.name}</span>
                    <span className="block text-xs text-slate-500 truncate">
                      {m.lastJob}
                      {m.jobs > 1 ? ` · ${m.jobs} ${language === 'kz' ? 'жұмыс' : ruPlural(m.jobs, 'заказ', 'заказа', 'заказов')}` : ''}
                    </span>
                  </button>
                  {tel && (
                    <a
                      href={tel}
                      aria-label={language === 'kz' ? 'Қоңырау шалу' : 'Позвонить'}
                      className="press w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0"
                    >
                      <Phone className="w-4.5 h-4.5" />
                    </a>
                  )}
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="WhatsApp"
                      className="press w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"
                    >
                      <MessageCircle className="w-4.5 h-4.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {favorites.length > 0 && (
          <section className="space-y-2 pt-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
              {language === 'kz' ? 'Таңдаулы шеберлер' : 'Избранные мастера'}
            </h3>
            {favorites.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => openProfile(f.id)}
                className="press w-full flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200 shadow-2xs text-left"
              >
                <span className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 font-bold flex items-center justify-center shrink-0">
                  {(f.name || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900 truncate">{f.name}</span>
                  {f.category && <span className="block text-xs text-slate-500 truncate">{f.category}</span>}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
            ))}
          </section>
        )}
        {profileError && <p className="text-xs text-rose-600">{profileError}</p>}
      </div>

      <ProviderProfileModal provider={profile} isOpen={!!profile} onClose={() => setProfile(null)} language={language} showContacts />
    </div>
  );
};
