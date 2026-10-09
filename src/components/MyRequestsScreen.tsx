import React, { useState, useEffect } from 'react';
import {
  Language,
  ServiceRequest,
  formatDynamicBudget,
  formatDynamicDate,
} from '../types';
import { translations } from '../i18n/translations';
import { repository } from '../services';
import { getCityDisplayName, getCategoryDisplayName } from '../services/taxonomy';
import {
  ClipboardList,
  MapPin,
  Calendar,
  Wallet,
  ChevronRight,
  PlusCircle,
  Inbox,
} from 'lucide-react';

interface MyRequestsScreenProps {
  requests: ServiceRequest[];
  language: Language;
  onSelectRequest: (request: ServiceRequest) => void;
  onCreateNewRequest: () => void;
}

export const MyRequestsScreen: React.FC<MyRequestsScreenProps> = ({
  requests,
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight font-display">
                {t.myRequestsTitle}
              </h2>
              <p className="text-xs text-slate-500">
                {requests.length}{' '}
                {language === 'kz'
                  ? 'өтініш тіркелген'
                  : language === 'tr'
                  ? 'talep geçmişte'
                  : 'заявок в истории'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCreateNewRequest}
            className="min-h-[40px] px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>
              {language === 'kz'
                ? 'Жаңа өтініш'
                : language === 'tr'
                ? 'Yeni Talep'
                : 'Новая заявка'}
            </span>
          </button>
        </div>

        {/* Requests List */}
        {requests.length === 0 ? (
          <div className="p-8 bg-white rounded-3xl border border-slate-200 text-center space-y-4 mt-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                {t.myRequestsEmpty}
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                {language === 'kz'
                  ? 'Өз қажеттілігіңізді жазыңыз, біз орындаушыларды тауып береміз.'
                  : language === 'tr'
                  ? 'İhtiyacınızı kendi kelimelerinizle yazın, en iyi ustaları bulalım.'
                  : 'Опишите своими словами, что вам нужно — мы найдем лучших исполнителей.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateNewRequest}
              className="min-h-[44px] px-5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs inline-flex items-center gap-2 shadow-xs transition-colors"
            >
              <span>{t.createNewRequestBtn}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => {
              const offerCount = offersCountMap[req.id] || 0;
              const formattedDate = req.createdAt
                ? new Date(req.createdAt).toLocaleDateString(
                    language === 'kz'
                      ? 'kk-KZ'
                      : language === 'tr'
                      ? 'tr-TR'
                      : 'ru-RU',
                    { day: 'numeric', month: 'short' }
                  )
                : req.date;

              return (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => onSelectRequest(req)}
                  className="w-full text-left p-4 bg-white hover:bg-sky-50/40 active:bg-sky-100/50 border border-slate-200 rounded-2xl transition-all shadow-2xs hover:shadow-xs group flex items-start justify-between gap-3"
                >
                  <div className="space-y-2 flex-1">
                    {/* Request ID + Status */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200/60">
                        {req.id}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded ${
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
                        {req.service}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-1 italic mt-0.5">
                        «{req.requestText}»
                      </p>
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
                      <span className="flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                        <Inbox className="w-3 h-3" />
                        {offerCount}{' '}
                        {language === 'kz'
                          ? 'ұсыныс'
                          : language === 'tr'
                          ? 'teklif'
                          : 'предл.'}
                      </span>
                    </div>
                  </div>

                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-sky-600 transition-colors shrink-0 mt-3" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
