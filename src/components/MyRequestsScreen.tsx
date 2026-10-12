import React, { useState, useEffect } from 'react';
import {
  Language,
  ServiceRequest,
  formatDynamicBudget,
  formatDynamicDate,
} from '../types';
import { translations } from '../i18n/translations';
import { getRequestDescription, getRequestTitle } from '../services/requestTitle';
import { formatShortDate } from '../services/dateFormat';
import { repository } from '../services';
import { getCityDisplayName, getCategoryDisplayName } from '../services/taxonomy';
import { MapPin, Calendar, Wallet, ChevronRight, Plus } from 'lucide-react';
import { Emoji3D } from './CategoryIcon';
import { RequestIcon } from './RequestIcon';

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

  useEffect(() => {
    let isMounted = true;
    const fetchCounts = async () => {
      const counts: Record<string, number> = {};
      for (const req of requests) {
        const offers = await repository.getOffers({ requestId: req.id });
        counts[req.id] = offers.length;
      }
      if (isMounted) {
        setOffersCountMap(counts);
      }
    };
    fetchCounts();
    return () => {
      isMounted = false;
    };
  }, [requests]);

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-5">
      <div className="space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Emoji3D code="1f4cb" size={40} eager />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight font-display leading-tight">{t.myRequestsTitle}</h2>
              {requests.length > 0 && (
                <p className="text-xs text-slate-500">
                  {requests.length} {language === 'kz' ? 'өтініш' : 'заявок'}
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
            <Emoji3D code="1f4ed" size={96} eager className="mx-auto animate-float" />
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
      </div>
    </div>
  );
};
