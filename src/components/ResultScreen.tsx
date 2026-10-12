import React, { useState, useEffect } from 'react';
import {
  DemoProvider,
  ExtractedNeed,
  formatDynamicBudget,
  formatDynamicDate,
  formatOfferDisplayPrice,
  Language,
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  RequestStatus,
  Review,
  ServiceRequest,
} from '../types';
import { translations } from '../i18n/translations';
import { getRequestTitle } from '../services/requestTitle';
import { formatShortDate } from '../services/dateFormat';
import { getDemoProviders } from '../data/demoProviders';
import { repository, checkClientRateLimit, getFriendlyErrorMessage, getCurrentUserId } from '../services';
import { auth, isFirebaseConfigured } from '../services/firebase';
import { getCategoryDisplayName, getCityDisplayName } from '../services/taxonomy';
import { ProviderProfileModal } from './ProviderProfileModal';
import { ReviewModal } from './ReviewModal';
import { ChatScreen } from './ChatScreen';
import { AppointmentSection } from './AppointmentSection';
import {
  AlertTriangle,
  Clock,
  MapPin,
  Tag,
  Phone,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  SlidersHorizontal,
  X,
  CheckCircle,
  UserCheck,
  Calendar,
  Wallet,
  XCircle,
  Inbox,
  Star,
  ShieldCheck,
  Award,
} from 'lucide-react';

interface ResultScreenProps {
  need: ExtractedNeed;
  request?: ServiceRequest;
  language: Language;
  onNewSearch: () => void;
  onEditSearch: () => void;
}

// Kazakhstan numbers are stored as typed (e.g. "+7 701 111 22 33" or "8 701 111 22 33").
// Normalize to international digits: a leading 8 on an 11-digit number is the domestic prefix for +7.
function toIntlDigits(raw?: string): string | null {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function toTelHref(raw?: string): string | null {
  const digits = toIntlDigits(raw);
  return digits ? `tel:+${digits}` : null;
}

function toWhatsAppHref(raw?: string): string | null {
  const digits = toIntlDigits(raw);
  return digits ? `https://wa.me/${digits}` : null;
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  need,
  request: initialRequest,
  language,
  onNewSearch,
  onEditSearch,
}) => {
  const t = translations[language];

  // Request & Offers state
  const [request, setRequest] = useState<ServiceRequest | null>(initialRequest || null);
  const [offers, setOffers] = useState<ProviderOffer[]>([]);

  // Demo directory fallback
  const demoProviders: DemoProvider[] = getDemoProviders(need, language);
  const showDemoContent = !isFirebaseConfigured();

  // Active contact modal
  const [activeModal, setActiveModal] = useState<{
    type: 'contact' | 'quote' | 'call' | 'whatsapp';
    title: string;
    phone: string;
    whatsapp: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Provider Profile Modal state
  const [selectedProviderForModal, setSelectedProviderForModal] = useState<Provider | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);

  // Rating & Review state
  const [existingReview, setExistingReview] = useState<Review | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

  // In-App Chat state
  const [isChatOpen, setIsChatOpen] = useState(false);

  const handleOpenProviderProfile = async (providerId: string) => {
    if (!providerId) return;
    setLoadingProviderId(providerId);
    setActionError(null);
    try {
      const prov = await repository.getProvider(providerId);
      if (!prov) {
        setActionError(t.providerProfileNotFound);
        setTimeout(() => setActionError(null), 3500);
        return;
      }
      setSelectedProviderForModal(prov);
      setIsProfileModalOpen(true);
    } catch {
      setActionError(t.providerProfileNotFound);
      setTimeout(() => setActionError(null), 3500);
    } finally {
      setLoadingProviderId(null);
    }
  };

  // Fetch request and offers via repository
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      if (initialRequest?.id) {
        try {
          const fetchedReq = await repository.getRequest(initialRequest.id);
          if (isMounted && fetchedReq) {
            setRequest(fetchedReq);
            if (fetchedReq.status === 'COMPLETED') {
              const reviews = await repository.getReviews({ requestId: fetchedReq.id });
              if (isMounted) {
                setExistingReview(reviews[0] || null);
              }
            }
          }
          const fetchedOffers = await repository.getOffers({ requestId: initialRequest.id });
          if (isMounted) {
            setOffers(fetchedOffers);
          }
        } catch (err) {
          if (isMounted) setActionError(getFriendlyErrorMessage(err, language));
        }
      }
    };
    loadData();
    return () => {
      isMounted = false;
    };
  }, [initialRequest, language]);

  // Average rating per provider from real reviews (shown on offer cards)
  const [providerRatings, setProviderRatings] = useState<Record<string, { avg: number; count: number }>>({});
  useEffect(() => {
    const ids = Array.from(new Set(offers.map((o) => o.providerUserId || o.providerId).filter(Boolean))) as string[];
    const missing = ids.filter((id) => !(id in providerRatings));
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(
      missing.map(async (id) => {
        try {
          const reviews = await repository.getReviews({ providerId: id });
          const count = reviews.length;
          const avg = count ? reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / count : 0;
          return [id, { avg, count }] as const;
        } catch {
          return [id, { avg: 0, count: 0 }] as const;
        }
      })
    ).then((entries) => {
      if (alive) setProviderRatings((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers]);

  // Handle Accept Offer: request -> PROVIDER_SELECTED, this offer -> ACCEPTED, others -> REJECTED
  const handleAcceptOffer = async (offer: ProviderOffer) => {
    if (!request) return;
    if (!checkClientRateLimit(`accept_offer_${offer.id}`, 800)) return;

    try {
      setActionError(null);
      const res = await repository.acceptOffer(request.id, offer.id);
      if (res.request) {
        setRequest(res.request);
      } else {
        const updatedReq = await repository.getRequest(request.id);
        if (updatedReq) setRequest(updatedReq);
      }
      const updatedOffers = await repository.getOffers({ requestId: request.id });
      setOffers(updatedOffers);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, language));
      setTimeout(() => setActionError(null), 4000);
    }
  };

  // Handle Reject Offer
  const handleRejectOffer = async (offer: ProviderOffer) => {
    if (!request) return;
    if (!checkClientRateLimit(`reject_offer_${offer.id}`, 800)) return;

    try {
      setActionError(null);
      await repository.updateOffer(offer.id, { status: 'REJECTED' });
      const updatedOffers = await repository.getOffers({ requestId: request.id });
      setOffers(updatedOffers);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, language));
      setTimeout(() => setActionError(null), 4000);
    }
  };

  // Customer completion confirmation modal state
  const [showCompletionConfirmModal, setShowCompletionConfirmModal] = useState(false);
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);

  // Status Lifecycle Handlers
  // The customer closes the job once it is done (the provider may already have reported it finished)
  const canConfirmCompletion = (status: string | undefined) =>
    status === 'PROVIDER_SELECTED' || status === 'ACCEPTED' || status === 'IN_PROGRESS';

  const handleCompleteWorkClick = () => {
    if (!request || isSubmittingCompletion) return;
    const currentStatus = normalizeRequestStatus(request.status);
    if (!canConfirmCompletion(currentStatus)) return;
    setShowCompletionConfirmModal(true);
  };

  const handleConfirmCompleteWork = async () => {
    if (!request || isSubmittingCompletion) return;
    const currentStatus = normalizeRequestStatus(request.status);
    if (!canConfirmCompletion(currentStatus)) {
      setShowCompletionConfirmModal(false);
      return;
    }

    setIsSubmittingCompletion(true);
    setActionError(null);

    try {
      const updated = await repository.updateRequestStatus(request.id, 'COMPLETED');
      if (updated) {
        const fresh = (await repository.getRequest(request.id)) || updated;
        const normalized = { ...fresh, status: normalizeRequestStatus(fresh.status) };
        setRequest(normalized);

        const reviews = await repository.getReviews({ requestId: fresh.id });
        const existing = reviews[0] || null;
        setExistingReview(existing);

        setShowCompletionConfirmModal(false);
        setIsSubmittingCompletion(false);

        // Trigger Review modal automatically if conditions met:
        // - request is COMPLETED
        // - an accepted provider exists (selectedOffer)
        // - no review submitted yet (!existing)
        // - not evaluating self (!isSelfProvider)
        if (selectedOffer && !existing && !isSelfProvider) {
          setIsReviewModalOpen(true);
        }
      } else {
        throw new Error('Failed to update request status');
      }
    } catch (err) {
      setIsSubmittingCompletion(false);
      setShowCompletionConfirmModal(false);
      setActionError(getFriendlyErrorMessage(err, language) || t.completeWorkError);
    }
  };

  const handleOpenRating = async () => {
    setActionError(null);
    let currentStatus = request?.status;
    if (request?.id) {
      try {
        const fresh = await repository.getRequest(request.id);
        if (fresh) {
          setRequest(fresh);
          currentStatus = fresh.status;
        }
      } catch (err) {
        console.warn('[ResultScreen] Refreshing request on open rating:', err);
      }
    }
    const canonical = normalizeRequestStatus(currentStatus);
    if (canonical !== 'COMPLETED') {
      setActionError(
        language === 'kz'
          ? 'Тек аяқталған тапсырысқа баға беруге болады'
          : 'Оценивать можно только завершенные заказы'
      );
      return;
    }
    setIsReviewModalOpen(true);
  };

  const handleCancelRequest = async () => {
    if (!request) return;
    if (!window.confirm(t.confirmCancelRequest)) return;
    try {
      setActionError(null);
      const updated = await repository.updateRequestStatus(request.id, 'CANCELLED');
      if (updated) setRequest(updated);
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err, language));
    }
  };

  const reqStatus = normalizeRequestStatus(request?.status);

  const selectedOffer =
    offers.find((o) => o.id === request?.selectedOfferId) ||
    (reqStatus === 'PROVIDER_SELECTED' ||
    reqStatus === 'IN_PROGRESS' ||
    reqStatus === 'COMPLETED'
      ? offers.find((o) => o.status === 'ACCEPTED')
      : undefined);

  const isSelfProvider = Boolean(
    request &&
    selectedOffer &&
    request.customerId &&
    ((selectedOffer.providerId && request.customerId.trim() === selectedOffer.providerId.trim()) ||
     (selectedOffer.providerUserId && request.customerId.trim() === selectedOffer.providerUserId.trim()) ||
     (auth?.currentUser?.uid && selectedOffer.providerUserId && auth.currentUser.uid === selectedOffer.providerUserId.trim()) ||
     (auth?.currentUser?.uid && selectedOffer.providerId && auth.currentUser.uid === selectedOffer.providerId.trim()) ||
     (getCurrentUserId() && selectedOffer.providerUserId && getCurrentUserId() === selectedOffer.providerUserId.trim()) ||
     (getCurrentUserId() && selectedOffer.providerId && getCurrentUserId() === selectedOffer.providerId.trim()))
  );

  // Format created date nicely
  const formattedCreatedDate = request?.createdAt
    ? formatShortDate(request.createdAt, language, { time: true })
    : '';

  // Helper for status badge
  const renderStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'OPEN':
      case 'NEW':
      case 'MATCHING':
      case 'OFFERS_RECEIVED':
        return (
          <span className="px-2.5 py-1 bg-sky-50 text-sky-800 font-bold rounded-lg text-xs flex items-center gap-1.5 border border-sky-200">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
            {t.status_OPEN}
          </span>
        );
      case 'PROVIDER_SELECTED':
      case 'ACCEPTED':
        return (
          <span className="px-2.5 py-1 bg-purple-50 text-purple-800 font-bold rounded-lg text-xs border border-purple-200 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-purple-600" />
            {t.status_PROVIDER_SELECTED}
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="px-2.5 py-1 bg-blue-50 text-blue-800 font-bold rounded-lg text-xs border border-blue-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            {t.status_IN_PROGRESS}
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 font-bold rounded-lg text-xs flex items-center gap-1 border border-emerald-300">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-700" />
            {t.status_COMPLETED}
          </span>
        );
      case 'REJECTED':
      case 'CANCELLED':
        return (
          <span className="px-2.5 py-1 bg-rose-50 text-rose-700 font-bold rounded-lg text-xs border border-rose-200">
            {t.status_CANCELLED}
          </span>
        );
      default:
        return null;
    }
  };

  if (isChatOpen && request?.id) {
    return (
      <div className="w-full max-w-xl mx-auto px-0 sm:px-4 py-2 sm:py-5">
        <ChatScreen
          requestId={request.id}
          language={language}
          onBack={() => setIsChatOpen(false)}
          userRole="customer"
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-4">
      <div className="space-y-4">
        {/* Demo notice and demo directory: only in demo mode (no real database connected) */}
        {showDemoContent && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 shadow-xs">
          <div className="p-1 bg-amber-100 rounded-xl text-amber-800 shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-amber-950 leading-tight">
              {t.demoNotice}
            </h3>
            <p className="text-[11px] text-amber-800 mt-0.5 leading-normal">
              {t.demoNoticeDescription}
            </p>
          </div>
        </div>
        )}

        {/* Action Error Alert */}
        {actionError && (
          <div className="p-3 bg-rose-50 border border-rose-300 rounded-2xl flex items-center justify-between text-xs text-rose-900 shadow-xs animate-fadeIn">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-rose-500 font-bold px-1">
              ✕
            </button>
          </div>
        )}

        {/* Customer Request Details Header: Request ID, Status, Created date, City, Service, Budget, Offers count */}
        {request && (
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {t.requestIdLabel}
                </span>
                <span className="text-lg font-extrabold text-slate-900 font-mono tracking-tight">
                  {request.id}
                </span>
              </div>
              <div>{renderStatusBadge(request.status)}</div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-1">
              <h2 className="text-sm font-bold text-slate-900">
                {getRequestTitle(request, language)}
              </h2>
              <p className="text-xs text-slate-500 italic">
                «{request.requestText}»
              </p>
            </div>

            {/* Spec: Show Created date, City, Service, Budget, Offers count */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">
                  {language === 'kz' ? 'Қала' : language === 'tr' ? 'Şehir' : 'Город'}:
                </span>
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-sky-600" />
                  {getCityDisplayName(request.cityId || request.city, language) || request.city}
                </span>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">
                  {language === 'kz' ? 'Бюджет' : language === 'tr' ? 'Bütçe' : 'Бюджет'}:
                </span>
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <Wallet className="w-3 h-3 text-sky-600" />
                  {request.budget ? formatDynamicBudget(request.budget, language) : '—'}
                </span>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">
                  {language === 'kz'
                    ? 'Құрылған уақыты'
                    : language === 'tr'
                    ? 'Oluşturulma Tarihi'
                    : 'Дата создания'}:
                </span>
                <span className="font-medium text-slate-600 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  {formatDynamicDate(formattedCreatedDate || request.date, language)}
                </span>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">
                  {language === 'kz'
                    ? 'Ұсыныстар саны'
                    : language === 'tr'
                    ? 'Teklif Sayısı'
                    : 'Кол-во предложений'}:
                </span>
                <span className="font-bold text-sky-700 flex items-center gap-1">
                  <Inbox className="w-3 h-3" />
                  {offers.length}{' '}
                  {language === 'kz'
                    ? 'ұсыныс'
                    : language === 'tr'
                    ? 'teklif'
                    : 'предл.'}
                </span>
              </div>
            </div>

            {/* Cancel option for Open requests */}
            {(request.status === 'OPEN' ||
              request.status === 'NEW' ||
              request.status === 'MATCHING' ||
              request.status === 'OFFERS_RECEIVED') && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelRequest}
                  className="text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors py-1 px-2 rounded-lg hover:bg-rose-50"
                >
                  {t.btnCancelRequest}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Phone Masking & Privacy Guarantee Notice */}
        <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-950 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold block text-[11px] uppercase tracking-wider text-emerald-800">
              {language === 'kz'
                ? 'Қауіпсіз маркетплейс және құпиялылық'
                : language === 'tr'
                ? 'Güvenli Pazar Yeri & Gizlilik'
                : 'Безопасный маркетплейс и приватность'}
            </span>
            <p className="text-emerald-800/90 leading-relaxed text-xs">
              {t.phoneMaskingGuarantee}
            </p>
          </div>
        </div>

        {/* Risk Category Notice for technical/gas/electric works */}
        {(need?.category?.toLowerCase().includes('электр') ||
          need?.category?.toLowerCase().includes('жылыту') ||
          need?.category?.toLowerCase().includes('отоплен') ||
          need?.category?.toLowerCase().includes('бойлер') ||
          need?.category?.toLowerCase().includes('electrician') ||
          need?.category?.toLowerCase().includes('heating') ||
          request?.category?.toLowerCase().includes('электр') ||
          request?.category?.toLowerCase().includes('жылыту') ||
          request?.category?.toLowerCase().includes('отоплен') ||
          request?.category?.toLowerCase().includes('бойлер')) && (
          <div className="p-3 bg-amber-50/80 border border-amber-200/90 rounded-2xl flex items-center gap-2.5 text-xs text-amber-900 shadow-2xs">
            <Award className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="leading-snug">{t.riskCategoryNotice}</span>
          </div>
        )}

        {/* Selected Provider Contact Banner & Status Workflow */}
        {(request?.status === 'PROVIDER_SELECTED' ||
          request?.status === 'ACCEPTED' ||
          request?.status === 'IN_PROGRESS' ||
          request?.status === 'COMPLETED') &&
          selectedOffer && (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-400 rounded-2xl shadow-sm space-y-3 animate-fadeIn">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-emerald-950">
                    {language === 'kz' ? 'Таңдалған маман' : 'Выбранный исполнитель'}
                  </h3>
                  <p className="text-xs text-emerald-800 font-medium flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenProviderProfile(selectedOffer.providerId)}
                      className="hover:underline font-bold text-emerald-950 inline-flex items-center gap-1 cursor-pointer"
                      title={t.viewProviderProfile}
                    >
                      <span>{selectedOffer.providerName}</span>
                      {loadingProviderId === selectedOffer.providerId && (
                        <span className="w-2.5 h-2.5 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin shrink-0" />
                      )}
                    </button>
                    <span>·</span>
                    <span>{formatOfferDisplayPrice(selectedOffer, language)}</span>
                  </p>
                </div>
              </div>

              {reqStatus === 'IN_PROGRESS' ? (
                <p className="text-xs text-blue-900 bg-blue-100/60 p-2.5 rounded-xl border border-blue-200 leading-relaxed font-medium">
                  {t.workInProgressNotice}
                </p>
              ) : reqStatus === 'COMPLETED' ? (
                <div className="space-y-3">
                  <p className="text-xs text-emerald-900 bg-emerald-100/70 p-2.5 rounded-xl border border-emerald-300 leading-relaxed font-medium">
                    {t.workCompletedNotice}
                  </p>

                  {/* Display Completed Review or Button to Rate */}
                  {existingReview ? (
                    <div className="p-3 bg-white/95 rounded-xl border border-emerald-200 space-y-1.5 shadow-2xs animate-fadeIn">
                      <div className="flex items-center justify-between">
                         <span className="text-[11px] font-bold text-emerald-950 flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
                          {t.yourReviewTitle}
                        </span>
                        <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg text-amber-800 font-bold text-xs">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                          <span>{existingReview.rating} / 5</span>
                        </div>
                      </div>
                      {existingReview.comment && (
                        <p className="text-xs text-slate-700 italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                          «{existingReview.comment}»
                        </p>
                      )}
                      <span className="text-[10px] text-emerald-700 font-semibold block">
                        {t.thankYouNotice}
                      </span>
                    </div>
                  ) : isSelfProvider ? (
                    <div className="p-3 bg-slate-100/90 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>
                        {language === 'kz'
                          ? 'Сіз осы тапсырыстың орындаушысысыз (өзіңізге баға беру мүмкін емес).'
                          : 'Вы являетесь исполнителем по этой заявке (оценка самого себя не предусмотрена).'}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleOpenRating}
                      className="w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                    >
                      <Star className="w-4 h-4 fill-white text-white" />
                      <span>{t.rateProviderBtn}</span>
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-emerald-900 leading-relaxed">
                  {t.selectedProviderNotice}
                </p>
              )}

              {/* In-App Chat Button: Available only for selected provider */}
              <button
                type="button"
                onClick={() => setIsChatOpen(true)}
                className="w-full min-h-[46px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                <span>{t.chatWithProviderBtn}</span>
              </button>

              {/* Call & WhatsApp: real providers get working tel:/wa.me links; demo offers keep the demo notice */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {!selectedOffer.isDemo && toTelHref(selectedOffer.providerPhone) ? (
                  <a
                    href={toTelHref(selectedOffer.providerPhone)!}
                    className="min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{t.btnCall}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!selectedOffer.isDemo}
                    onClick={() =>
                      setActiveModal({
                        type: 'call',
                        title: selectedOffer.providerName,
                        phone: selectedOffer.providerPhone,
                        whatsapp: selectedOffer.providerWhatsapp,
                      })
                    }
                    className="min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{t.btnCall}</span>
                  </button>
                )}

                {!selectedOffer.isDemo && toWhatsAppHref(selectedOffer.providerWhatsapp || selectedOffer.providerPhone) ? (
                  <a
                    href={toWhatsAppHref(selectedOffer.providerWhatsapp || selectedOffer.providerPhone)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{t.btnWhatsapp}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!selectedOffer.isDemo}
                    onClick={() =>
                      setActiveModal({
                        type: 'whatsapp',
                        title: selectedOffer.providerName,
                        phone: selectedOffer.providerPhone,
                        whatsapp: selectedOffer.providerWhatsapp,
                      })
                    }
                    className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{t.btnWhatsapp}</span>
                  </button>
                )}
              </div>

              {canConfirmCompletion(reqStatus) && request?.providerDoneAt && (
                <p className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-300 leading-relaxed font-semibold">
                  {language === 'kz'
                    ? 'Шебер жұмысты аяқтағанын хабарлады. Бәрі дұрыс болса, төмендегі түйме арқылы растаңыз.'
                    : language === 'tr'
                    ? 'Usta işi bitirdiğini bildirdi. Her şey yolundaysa aşağıdaki düğmeyle onaylayın.'
                    : 'Мастер сообщил, что работа выполнена. Если всё в порядке, подтвердите кнопкой ниже.'}
                </p>
              )}

              {/* Payment happens directly between customer and provider; the app does not take payments */}
              {reqStatus !== 'COMPLETED' && (
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {language === 'kz'
                    ? 'Төлем шеберге тікелей жасалады (қолма-қол немесе аударым). KEREK төлем қабылдамайды.'
                    : language === 'tr'
                    ? 'Ödeme doğrudan ustaya yapılır (nakit veya havale). KEREK ödeme almaz.'
                    : 'Оплата производится мастеру напрямую (наличными или переводом). KEREK не принимает платежи.'}
                </p>
              )}

              {/* Status Workflow Action Buttons */}
              <div className="pt-2 border-t border-emerald-200/80 flex flex-wrap gap-2">
                {canConfirmCompletion(reqStatus) && (
                  <>
                    <button
                      type="button"
                      disabled={isSubmittingCompletion}
                      onClick={handleCompleteWorkClick}
                      className="flex-1 min-h-[42px] px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>{t.btnCompleteWork}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRequest}
                      className="px-3 min-h-[42px] bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
                    >
                      {t.btnCancelRequest}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

        {/* Appointment Scheduling for Selected Provider */}
        {(request?.status === 'PROVIDER_SELECTED' ||
          request?.status === 'ACCEPTED' ||
          request?.status === 'IN_PROGRESS' ||
          request?.status === 'COMPLETED') &&
          selectedOffer && (
            <AppointmentSection
              request={request}
              selectedOffer={selectedOffer}
              currentRole="customer"
              language={language}
            />
          )}

        {/* Cancelled Notice */}
        {request?.status === 'CANCELLED' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-1">
            <p className="text-xs font-bold text-rose-800">{t.status_CANCELLED}</p>
            <p className="text-xs text-rose-600">{t.requestCancelledNotice}</p>
          </div>
        )}

        {/* Incoming Provider Offers Section (Customer can Accept or Reject) */}
        {offers.length > 0 && (
          <div className="space-y-3 pt-1">
            <div className="space-y-0.5">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight font-display">
                {t.offersReceivedTitle} ({offers.length})
              </h3>
              {(request?.status === 'MATCHING' || request?.status === 'OPEN') && (
                <span className="block text-xs text-sky-600 font-semibold animate-pulse">
                  {t.requestSearchingSubtitle}
                </span>
              )}
            </div>

            <div className="space-y-3">
              {offers.map((offer) => {
                const isSelected = request?.selectedOfferId
                  ? request.selectedOfferId === offer.id
                  : (request?.status === 'PROVIDER_SELECTED' ||
                      request?.status === 'ACCEPTED' ||
                      request?.status === 'IN_PROGRESS' ||
                      request?.status === 'COMPLETED') &&
                    offer.status === 'ACCEPTED';
                const isRejected = offer.status === 'REJECTED';

                return (
                  <div
                    key={offer.id}
                    className={`bg-white rounded-2xl border p-4 transition-all ${
                      isSelected
                        ? 'border-2 border-emerald-500 shadow-sm bg-emerald-50/20'
                        : isRejected
                        ? 'border-slate-200 opacity-60 bg-slate-50'
                        : 'border-slate-200 shadow-2xs hover:shadow-xs'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-white font-bold text-sm flex items-center justify-center shrink-0">
                          {(offer.providerName || '?')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((w) => w[0]?.toUpperCase())
                            .join('')}
                        </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenProviderProfile(offer.providerId)}
                            disabled={loadingProviderId === offer.providerId}
                            className="font-bold text-slate-900 text-sm hover:text-sky-700 hover:underline text-left inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                            title={t.viewProviderProfile}
                          >
                            <span>{offer.providerName}</span>
                            {loadingProviderId === offer.providerId && (
                              <span className="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
                            )}
                          </button>
                          {offer.isDemo && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                              ДЕМО
                            </span>
                          )}
                          {isRejected && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
                              {language === 'kz' ? 'Бас тартылды' : 'Отклонено'}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const r = providerRatings[offer.providerUserId || offer.providerId];
                          return r && r.count > 0 ? (
                            <div className="flex items-center gap-1 text-xs text-slate-700 mt-0.5">
                              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                              <span className="font-bold">{r.avg.toFixed(1)}</span>
                              <span className="text-slate-500">
                                ({r.count} {language === 'kz' ? 'пікір' : 'отзыв.'})
                              </span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {language === 'kz' ? 'Жаңа шебер' : 'Новый мастер'}
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatDynamicDate(offer.availability, language)}</span>
                        </div>
                      </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-base font-extrabold text-slate-900 whitespace-nowrap">
                          {formatOfferDisplayPrice(offer, language)}
                        </span>
                      </div>
                    </div>

                    {offer.message && (
                      <p className="text-xs text-slate-600 mt-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                        {offer.message}
                      </p>
                    )}

                    {/* Customer Action: Accept or Reject */}
                    <div className="pt-3">
                      {isSelected ? (
                        <div className="w-full min-h-[40px] rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-emerald-700" />
                          <span>{t.offerSelectedBadge}</span>
                        </div>
                      ) : isRejected ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Бұл ұсыныс қабылданбады' : 'Предложение отклонено'}
                        </div>
                      ) : request?.status === 'CANCELLED' ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Өтініш болдырмалды' : 'Заявка отменена'}
                        </div>
                      ) : request?.status === 'COMPLETED' ||
                        request?.status === 'PROVIDER_SELECTED' ||
                        request?.status === 'ACCEPTED' ||
                        request?.status === 'IN_PROGRESS' ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Басқа маман таңдалған' : 'Выбран другой исполнитель'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleAcceptOffer(offer)}
                            className="min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all"
                          >
                            <UserCheck className="w-4 h-4" />
                            <span>{language === 'kz' ? 'Қабылдау' : 'Принять'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRejectOffer(offer)}
                            className="min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all"
                          >
                            <XCircle className="w-4 h-4 text-slate-400" />
                            <span>{language === 'kz' ? 'Бас тарту' : 'Отклонить'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Existing Provider Directory Cards Section (demo mode only) */}
        {showDemoContent && (
        <div className="space-y-3 pt-2">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-slate-900 tracking-tight font-display">
              {t.resultsTitle}
            </h3>
            <p className="text-xs text-slate-500">{t.resultsSubtitle}</p>
          </div>

          <div className="space-y-3">
            {demoProviders.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:shadow-xs transition-shadow relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm leading-tight">
                      {p.name}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">
                      {p.service}
                    </p>
                  </div>
                </div>

                <div className="py-2 border-y border-slate-100 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      {t.approxPriceLabel}
                    </span>
                    <span className="font-bold text-slate-900 text-sm">
                      {p.approxPrice}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      {t.distanceLabel}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {p.distance}
                    </span>
                  </div>

                  <div className="col-span-2 flex items-center gap-1.5 text-emerald-700 font-medium text-xs pt-0.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{p.responseTime}</span>
                  </div>
                </div>

                <div className="pt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveModal({
                        type: 'call',
                        title: p.name,
                        phone: p.phone,
                        whatsapp: p.whatsapp,
                      })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-all"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{t.contactButton}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setActiveModal({
                        type: 'quote',
                        title: p.name,
                        phone: p.phone,
                        whatsapp: p.whatsapp,
                      })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs flex items-center justify-center gap-1.5 border border-slate-200 active:scale-[0.98] transition-all"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-slate-600" />
                    <span>{t.requestQuoteButton}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Bottom Action: New Request */}
      <div className="pt-4 pb-2">
        <button
          type="button"
          onClick={onNewSearch}
          className="w-full min-h-[48px] rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all"
        >
          <RotateCcw className="w-4 h-4 text-sky-600" />
          <span>{t.newSearchButton}</span>
        </button>
      </div>

      {/* Modal Dialog */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
                {activeModal.type === 'whatsapp' ? (
                  <MessageCircle className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Phone className="w-5 h-5 text-sky-600" />
                )}
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">
                {activeModal.type === 'call' ? t.btnCall : t.btnWhatsapp} (ДЕМО)
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {activeModal.type === 'call'
                  ? t.demoCallNotice
                  : t.demoWhatsappNotice}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900">
                {activeModal.title}
              </div>
              {/* Demo numbers are not shown: they are placeholders and may belong to real people */}
              <div className="text-slate-600">
                {language === 'kz' ? 'Демо нөмір көрсетілмейді' : language === 'tr' ? 'Demo numara gösterilmez' : 'Демо-номер не показывается'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white font-semibold text-xs flex items-center justify-center hover:bg-slate-800 transition-colors"
            >
              {t.closeButton}
            </button>
          </div>
        </div>
      )}

      {/* Completion Confirmation Modal */}
      {showCompletionConfirmModal && request && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
          onClick={() => !isSubmittingCompletion && setShowCompletionConfirmModal(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 p-5 space-y-4 animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 font-display">
                  {t.confirmCompleteWorkTitle}
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {t.confirmCompleteWorkSubtitle}
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={isSubmittingCompletion}
                onClick={() => setShowCompletionConfirmModal(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 active:scale-[0.99] text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                {t.btnCancelCompleteWorkModal}
              </button>

              <button
                type="button"
                disabled={isSubmittingCompletion}
                onClick={handleConfirmCompleteWork}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 active:scale-[0.99] text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmittingCompletion ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>{t.btnConfirmCompleteWork}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provider Profile Modal */}
      <ProviderProfileModal
        provider={selectedProviderForModal}
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedProviderForModal(null);
        }}
        language={language}
      />

      {/* Review Modal */}
      {request && selectedOffer && (
        <ReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          requestId={request.id}
          customerId={request.customerId || ''}
          customerName={request.customerName || ''}
          providerId={selectedOffer.providerId}
          providerName={selectedOffer.providerName}
          language={language}
          onReviewSubmitted={(review) => {
            setExistingReview(review);
          }}
        />
      )}
    </div>
  );
};
