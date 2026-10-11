import React, { useState, useEffect } from 'react';
import {
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
import { repository, getCurrentUserId } from '../services';
import { auth } from '../services/firebase';
import { ProviderProfileModal } from './ProviderProfileModal';
import { ReviewModal } from './ReviewModal';
import { AppointmentSection } from './AppointmentSection';
import { RequestMediaView } from './RequestMediaView';
import {
  Clock,
  MapPin,
  Tag,
  Phone,
  MessageCircle,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  UserCheck,
  Send,
  Calendar,
  Wallet,
  X,
  Star,
} from 'lucide-react';

interface RequestDetailScreenProps {
  request: ServiceRequest;
  language: Language;
  onNewSearch: () => void;
  onRefreshRequest?: (updated: ServiceRequest) => void;
}

export const RequestDetailScreen: React.FC<RequestDetailScreenProps> = ({
  request: initialRequest,
  language,
  onNewSearch,
  onRefreshRequest,
}) => {
  const t = translations[language];
  const [request, setRequest] = useState<ServiceRequest>(initialRequest);
  const [offers, setOffers] = useState<ProviderOffer[]>([]);
  const [contactModal, setContactModal] = useState<{
    type: 'call' | 'whatsapp';
    offer: ProviderOffer;
  } | null>(null);

  // Provider Profile Modal state
  const [selectedProviderForModal, setSelectedProviderForModal] = useState<Provider | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Rating & Review state
  const [existingReview, setExistingReview] = useState<Review | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [ratingSuccessToast, setRatingSuccessToast] = useState(false);

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

  // Sync request, offers, and review via repository
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      const current = (await repository.getRequest(initialRequest.id)) || initialRequest;
      const reqOffers = await repository.getOffers({ requestId: current.id });
      let reqReview: Review | null = null;
      try {
        const reviews = await repository.getReviews({ requestId: current.id });
        reqReview = reviews[0] || null;
      } catch {}

      if (isMounted) {
        setRequest(current);
        setOffers(reqOffers);
        setExistingReview(reqReview);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [initialRequest]);

  // Handle selecting an offer
  const handleSelectOffer = async (offer: ProviderOffer) => {
    const res = await repository.acceptOffer(request.id, offer.id);
    const updated = res.request || (await repository.getRequest(request.id));
    if (updated) {
      setRequest(updated);
      const reqOffers = await repository.getOffers({ requestId: request.id });
      setOffers(reqOffers);
      if (onRefreshRequest) onRefreshRequest(updated);
    }
  };

  // Status Lifecycle Handlers
  const handleStartWork = async () => {
    try {
      const updated = await repository.updateRequestStatus(request.id, 'IN_PROGRESS');
      if (updated) {
        setRequest(updated);
        if (onRefreshRequest) onRefreshRequest(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCompleteWork = async () => {
    try {
      const updated = await repository.updateRequestStatus(request.id, 'COMPLETED');
      if (updated) {
        const fresh = (await repository.getRequest(request.id)) || updated;
        const normalized = { ...fresh, status: normalizeRequestStatus(fresh.status) };
        setRequest(normalized);
        if (onRefreshRequest) onRefreshRequest(normalized);
        const reviews = await repository.getReviews({ requestId: fresh.id });
        setExistingReview(reviews[0] || null);
      }
    } catch (e) {
      console.error(e);
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
          if (onRefreshRequest) onRefreshRequest(fresh);
        }
      } catch (err) {
        console.warn('[RequestDetailScreen] Refreshing request on open rating:', err);
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
    if (!window.confirm(t.confirmCancelRequest)) return;
    try {
      const updated = await repository.updateRequestStatus(request.id, 'CANCELLED');
      if (updated) {
        setRequest(updated);
        if (onRefreshRequest) onRefreshRequest(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const reqStatus = normalizeRequestStatus(request?.status);

  const selectedOffer =
    offers.find((o) => o.id === request.selectedOfferId) ||
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

  // Helper for status styling
  const renderStatusBadge = (rawStatus: RequestStatus) => {
    const status = normalizeRequestStatus(rawStatus);
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
    }
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-5">
      <div className="space-y-4">
        {/* MANDATORY PROMINENT DEMO NOTICE */}
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

        {/* Error Alert */}
        {actionError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-center justify-between animate-fadeIn">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-500 hover:text-rose-700 ml-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Request Header & Status */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                {t.requestIdLabel}
              </span>
              <span className="text-lg font-extrabold text-slate-900 font-mono tracking-tight">
                {request.id}
              </span>
            </div>
            <div>{renderStatusBadge(request.status)}</div>
          </div>

          {/* Title & Request Text */}
          <div className="pt-2 border-t border-slate-100">
            <h2 className="text-base font-bold text-slate-900 leading-snug">
              {request.service}
            </h2>
            <p className="text-xs text-slate-600 mt-1 italic">
              «{request.requestText}»
            </p>
          </div>

          {/* Extracted Details */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs font-semibold text-slate-700">
            <span className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg">
              <MapPin className="w-3 h-3 text-sky-600" />
              {request.city}
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg">
              <Calendar className="w-3 h-3 text-sky-600" />
              {request.date}
            </span>
            {request.budget && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-sky-50 text-sky-800 border border-sky-100 rounded-lg">
                <Wallet className="w-3 h-3 text-sky-600" />
                {request.budget}
              </span>
            )}
          </div>

          {/* Request 2.0 Media Attachments & Location */}
          {Boolean(request.attachments?.length || request.location) && (
            <div className="pt-2 border-t border-slate-100">
              <RequestMediaView
                attachments={request.attachments}
                location={request.location}
                language={language}
              />
            </div>
          )}

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

        {/* Selected Provider Contact Card & Status Workflow */}
        {(request.status === 'PROVIDER_SELECTED' ||
          request.status === 'ACCEPTED' ||
          request.status === 'IN_PROGRESS' ||
          request.status === 'COMPLETED') &&
          selectedOffer && (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-400 rounded-2xl shadow-sm space-y-3">
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
                <div className="space-y-2.5">
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

              {/* Preserved phone and WhatsApp contact options */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setContactModal({ type: 'call', offer: selectedOffer })}
                  className="min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{t.btnCall}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setContactModal({ type: 'whatsapp', offer: selectedOffer })}
                  className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.98] transition-transform"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>{t.btnWhatsapp}</span>
                </button>
              </div>

              {/* Status Action Buttons */}
              <div className="pt-2 border-t border-emerald-200/80 flex flex-wrap gap-2">
                {reqStatus === 'PROVIDER_SELECTED' && (
                  <>
                    <button
                      type="button"
                      onClick={handleStartWork}
                      className="flex-1 min-h-[40px] px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>{t.btnStartWork}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRequest}
                      className="px-3 min-h-[40px] bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors"
                    >
                      {t.btnCancelRequest}
                    </button>
                  </>
                )}

                {reqStatus === 'IN_PROGRESS' && (
                  <>
                    <button
                      type="button"
                      onClick={handleCompleteWork}
                      className="flex-1 min-h-[40px] px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>{t.btnCompleteWork}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRequest}
                      className="px-3 min-h-[40px] bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors"
                    >
                      {t.btnCancelRequest}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

        {/* Appointment Scheduling */}
        {(reqStatus === 'PROVIDER_SELECTED' ||
          reqStatus === 'ACCEPTED' ||
          reqStatus === 'IN_PROGRESS' ||
          reqStatus === 'COMPLETED') &&
          selectedOffer && (
            <AppointmentSection
              request={request}
              selectedOffer={selectedOffer}
              currentRole="customer"
              language={language}
            />
          )}

        {/* Cancelled Notice */}
        {request.status === 'CANCELLED' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-1">
            <p className="text-xs font-bold text-rose-800">{t.status_CANCELLED}</p>
            <p className="text-xs text-rose-600">{t.requestCancelledNotice}</p>
          </div>
        )}

        {/* Offers Section */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              {t.offersReceivedTitle} ({offers.length})
            </h3>
            {(request.status === 'MATCHING' || request.status === 'OPEN') && (
              <span className="text-xs text-sky-600 font-semibold animate-pulse">
                {t.requestSearchingSubtitle}
              </span>
            )}
          </div>

          {offers.length === 0 ? (
            <div className="p-6 bg-white rounded-2xl border border-dashed border-slate-300 text-center space-y-2">
              <Clock className="w-8 h-8 text-sky-500 mx-auto animate-spin" />
              <p className="text-sm font-semibold text-slate-800">
                {t.requestSearchingSubtitle}
              </p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                {t.noOffersYet}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => {
                const isSelected = request.selectedOfferId
                  ? request.selectedOfferId === offer.id
                  : (request.status === 'PROVIDER_SELECTED' ||
                      request.status === 'ACCEPTED' ||
                      request.status === 'IN_PROGRESS' ||
                      request.status === 'COMPLETED') &&
                    offer.status === 'ACCEPTED';

                return (
                  <div
                    key={offer.id}
                    className={`bg-white rounded-2xl border p-4 transition-all ${
                      isSelected
                        ? 'border-2 border-emerald-500 shadow-md bg-emerald-50/20'
                        : 'border-slate-200 shadow-2xs hover:shadow-xs'
                    }`}
                  >
                    {/* Provider Name and Price */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
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
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{offer.availability}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-extrabold text-slate-900">
                          {formatOfferDisplayPrice(offer, language)}
                        </span>
                      </div>
                    </div>

                    {/* Offer Message */}
                    {offer.message && (
                      <p className="text-xs text-slate-600 mt-2.5 p-2 bg-slate-50 rounded-xl border border-slate-100">
                        {offer.message}
                      </p>
                    )}

                    {/* Customer Selection Action */}
                    <div className="pt-3">
                      {isSelected ? (
                        <div className="w-full min-h-[40px] rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-emerald-700" />
                          <span>{t.offerSelectedBadge}</span>
                        </div>
                      ) : offer.status === 'REJECTED' ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Бұл ұсыныс қабылданбады' : 'Предложение отклонено'}
                        </div>
                      ) : request.status === 'CANCELLED' ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Өтініш болдырмалды' : 'Заявка отменена'}
                        </div>
                      ) : request.status === 'COMPLETED' ||
                        request.status === 'PROVIDER_SELECTED' ||
                        request.status === 'ACCEPTED' ||
                        request.status === 'IN_PROGRESS' ? (
                        <div className="text-center text-xs text-slate-400 py-1">
                          {language === 'kz' ? 'Басқа маман таңдалған' : 'Выбран другой исполнитель'}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectOffer(offer)}
                          className="w-full min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>{t.selectOfferButton}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action: Create Another Request */}
      <div className="pt-6 pb-2">
        <button
          type="button"
          onClick={onNewSearch}
          className="w-full min-h-[48px] rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all"
        >
          <RotateCcw className="w-4 h-4 text-sky-600" />
          <span>{language === 'kz' ? 'Жаңа өтініш беру' : 'Создать новую заявку'}</span>
        </button>
      </div>

      {/* Demo Contact Modal */}
      {contactModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
                {contactModal.type === 'call' ? (
                  <Phone className="w-5 h-5" />
                ) : (
                  <MessageCircle className="w-5 h-5" />
                )}
              </div>
              <button
                onClick={() => setContactModal(null)}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">
                {contactModal.type === 'call' ? t.btnCall : t.btnWhatsapp} (ДЕМО)
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {contactModal.type === 'call'
                  ? t.demoCallNotice
                  : t.demoWhatsappNotice}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900">
                {contactModal.offer.providerName}
              </div>
              <div className="text-slate-600">
                Телефон (ДЕМО): {contactModal.offer.providerPhone}
              </div>
              <div className="text-slate-600">
                WhatsApp (ДЕМО): {contactModal.offer.providerWhatsapp}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setContactModal(null)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white font-semibold text-xs flex items-center justify-center hover:bg-slate-800 transition-colors"
            >
              {t.closeButton}
            </button>
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
      {selectedOffer && (
        <ReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          requestId={request.id}
          customerId={request.customerId}
          customerName={request.customerName}
          providerId={selectedOffer.providerId}
          providerName={selectedOffer.providerName}
          language={language}
          onReviewSubmitted={(review) => {
            setExistingReview(review);
            setRatingSuccessToast(true);
            setTimeout(() => setRatingSuccessToast(false), 4000);
          }}
        />
      )}

      {/* Rating Success Toast */}
      {ratingSuccessToast && (
        <div className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto p-3.5 bg-emerald-600 text-white rounded-2xl text-xs font-bold shadow-xl text-center flex items-center justify-center gap-2 animate-slideUp">
          <CheckCircle className="w-4 h-4 text-white shrink-0 stroke-[2.5]" />
          <span>{t.ratingSubmittedSuccess}</span>
        </div>
      )}
    </div>
  );
};
