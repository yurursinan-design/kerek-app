import React, { useState, useEffect } from 'react';
import { ReportButton } from './ReportButton';
import { isTopMaster, Language, Provider, RatingSummary, Review } from '../types';
import { translations } from '../i18n/translations';
import { formatShortDate } from '../services/dateFormat';
import { repository, getCurrentUserId, getFriendlyErrorMessage } from '../services';
import { isFavorite, masterProfileLink, onFavoritesChange, toggleFavorite } from '../services/favorites';
import { toTelHref, toWhatsAppHref } from '../services/phoneLinks';
import { PortfolioGallery } from './PortfolioPhotos';
import { localReviewReply, replyToReview } from '../services/reviewsExtra';
import { getProviderStats, ProviderStats, responseTimeLabel, reviewsCountLabel, reviewsFromCustomersLabel } from '../services/publicStats';
import {
  X,
  Heart,
  Share2,
  Phone,
  MessageCircle,
  ShieldCheck,
  CheckCircle,
  MapPin,
  Clock,
  Wallet,
  Briefcase,
  Wrench,
  FileText,
  Star,
} from 'lucide-react';

interface ProviderProfileModalProps {
  provider: Provider | null;
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  /** Show call / WhatsApp buttons (a master the customer saved, worked with or got a link to) */
  showContacts?: boolean;
}

export const ProviderProfileModal: React.FC<ProviderProfileModalProps> = ({
  provider,
  isOpen,
  onClose,
  language,
  showContacts = false,
}) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [stats, setStats] = useState<ProviderStats | null>(null);
  // The master answering a review on their own profile
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [savedReplies, setSavedReplies] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    setStats(null);
    const uid = provider && !provider.isDemo ? provider.userId || provider.id : '';
    if (isOpen && uid) {
      getProviderStats(uid).then((st) => alive && setStats(st));
    }
    return () => {
      alive = false;
    };
    // The stats belong to the master's account, so only its id matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, provider?.id, provider?.userId, provider?.isDemo]);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    if (!provider?.id) return;
    setFavorite(isFavorite(provider.id));
    return onFavoritesChange(() => setFavorite(isFavorite(provider.id)));
  }, [provider?.id]);
  const [isLoadingReviews, setIsLoadingReviews] = useState<boolean>(false);
  // Counted on the server over all reviews (the list below shows the newest ones)
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (isOpen && provider?.id) {
      setIsLoadingReviews(true);
      const pId = provider.id.trim();
      const uId = provider.userId?.trim();

      const fetchReviewList = async () => {
        repository
          .getRatingSummary([pId, uId || ''])
          .then((summary) => {
            if (isMounted) setRatingSummary(summary);
          })
          .catch(() => {});
        try {
          const promises = [repository.getReviews({ providerId: pId })];
          if (uId && uId !== pId) {
            promises.push(repository.getReviews({ providerId: uId }));
          }
          const results = await Promise.all(promises);
          const merged = results.flat();
          const unique = Array.from(new Map(merged.map((r) => [r.id, r])).values());
          // Sort newest first
          unique.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
          if (isMounted) {
            setReviews(unique);
          }
        } catch (err) {
          console.warn('[ProviderProfileModal] Error fetching reviews:', err);
          if (isMounted) setReviews([]);
        } finally {
          if (isMounted) setIsLoadingReviews(false);
        }
      };

      fetchReviewList();
    } else {
      setReviews([]);
      setRatingSummary(null);
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, provider?.id, provider?.userId]);

  if (!isOpen || !provider) return null;

  const t = translations[language];

  // Rating from real reviews: the server count over all of them, or the loaded list until it arrives
  // Stars count each customer once (server); "N reviews" counts every published review
  const reviewsCount = ratingSummary ? ratingSummary.count : reviews.length;
  const totalReviews = ratingSummary?.reviews ?? reviewsCount;
  const ratingAvg = ratingSummary
    ? ratingSummary.avg
    : reviews.length > 0
    ? reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0) / reviews.length
    : 0;
  const averageRating = reviewsCount > 0 ? ratingAvg.toFixed(1) : null;

  // First letter of provider name for clean typography-based avatar
  const initialLetter = (provider.name || '').trim().charAt(0).toUpperCase() || 'M';

  // Format location: "Алматы · Бостандық ауданы" or "Кызылорда"
  const locationText = [provider.city, provider.district]
    .filter((part) => part && part.trim().length > 0)
    .join(' · ');

  // Format experience years according to language
  const formatExperience = (years?: number): string | null => {
    if (years === undefined || years === null || years <= 0) return null;
    if (language === 'kz') {
      return `${years} ${t.experienceYearsUnit}`;
    }
    // Russian formatting
    const mod10 = years % 10;
    const mod100 = years % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return `${years} год опыта`;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return `${years} года опыта`;
    }
    return `${years} лет опыта`;
  };

  const experienceText = formatExperience(provider.experienceYears);

  const me = getCurrentUserId();
  const isOwnProfile = Boolean(me && (provider.userId === me || provider.id === me));
  const telHref = showContacts && !isOwnProfile ? toTelHref(provider.phone) : null;
  const waHref = showContacts && !isOwnProfile ? toWhatsAppHref(provider.whatsapp || provider.phone) : null;

  const shareProfile = async () => {
    const link = masterProfileLink(provider.id);
    const text = language === 'kz' ? `${provider.name} — Tapsyr-дағы шебер` : `${provider.name} — мастер в Tapsyr`;
    try {
      if (navigator.share) {
        await navigator.share({ title: provider.name, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setShareNote(language === 'kz' ? 'Сілтеме көшірілді' : 'Ссылка скопирована');
    } catch {
      // closed share sheet or no clipboard access: show the link to copy by hand
      setShareNote(link);
    }
    window.setTimeout(() => setShareNote(null), 4000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col overflow-hidden animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-5 pb-4 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3.5">
            {/* Avatar Letter */}
            <div className="w-13 h-13 rounded-2xl bg-sky-600 text-white font-extrabold text-xl flex items-center justify-center shadow-md shadow-sky-600/20 font-display">
              {initialLetter}
            </div>

            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3
                  id="provider-modal-title"
                  className="text-base font-bold text-slate-900 font-display leading-tight"
                >
                  {provider.name}
                </h3>
                {provider.verified && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full"
                    title={t.verifiedProviderBadge}
                  >
                    <CheckCircle className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                    <span>{t.verifiedProviderBadge}</span>
                  </span>
                )}
                {provider.iinVerified && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3 text-sky-600 stroke-[2.5]" />
                    <span>{language === 'kz' ? 'Жеке басы тексерілген' : 'Личность проверена'}</span>
                  </span>
                )}
                {averageRating ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full"
                    title={`${averageRating} / 5`}
                  >
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    <span>
                      {averageRating} ({totalReviews})
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    <Star className="w-3 h-3 text-slate-400" />
                    <span>{language === 'kz' ? 'Баға жоқ' : 'Нет оценок'}</span>
                  </span>
                )}
                {isTopMaster({ avg: ratingAvg, count: reviewsCount }) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    🏆 {language === 'kz' ? 'Үздік шебер' : 'Лучший мастер'}
                  </span>
                )}
                {provider.isDemo && (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                    ДЕМО
                  </span>
                )}
              </div>

              {locationText && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-1 font-medium">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{locationText}</span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeButton}
            className="w-9 h-9 rounded-full bg-slate-200/70 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Save, share, contact */}
        <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2">
          {!isOwnProfile && !provider.isDemo && (
            <button
              type="button"
              aria-pressed={favorite}
              onClick={() => setFavorite(toggleFavorite({ id: provider.id, name: provider.name, category: provider.category }))}
              className={`h-9 px-3 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
                favorite ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Heart className={`w-4 h-4 ${favorite ? 'fill-rose-500 text-rose-500' : ''}`} />
              {favorite ? (language === 'kz' ? 'Таңдаулыда' : 'В избранном') : language === 'kz' ? 'Таңдаулыға' : 'В избранное'}
            </button>
          )}
          {!provider.isDemo && (
            <button
              type="button"
              onClick={shareProfile}
              className="h-9 px-3 rounded-full border border-slate-200 bg-white text-slate-700 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Share2 className="w-4 h-4" />
              {isOwnProfile
                ? language === 'kz' ? 'Профильмен бөлісу' : 'Поделиться профилем'
                : language === 'kz' ? 'Бөлісу' : 'Поделиться'}
            </button>
          )}
          {telHref && (
            <a href={telHref} className="h-9 px-3 rounded-full bg-sky-600 text-white text-xs font-bold inline-flex items-center gap-1.5">
              <Phone className="w-4 h-4" />
              {language === 'kz' ? 'Қоңырау' : 'Позвонить'}
            </a>
          )}
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 rounded-full bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
          {telHref && (
            <p className={`w-full text-[11px] leading-snug ${provider.phoneVerified ? 'text-emerald-700' : 'text-amber-700'}`}>
              {provider.phoneVerified
                ? language === 'kz'
                  ? '✓ Нөмір шебердің WhatsApp кодымен расталған нөмірі'
                  : '✓ Номер подтверждён кодом WhatsApp при входе мастера'
                : language === 'kz'
                  ? 'Бұл нөмірді шебер өзі жазған, ол расталмаған'
                  : 'Этот номер мастер указал сам, он не подтверждён'}
            </p>
          )}
          {shareNote && <p className="w-full text-[11px] text-slate-500 break-all">{shareNote}</p>}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto overscroll-contain space-y-4 text-xs">
          {/* Experience Badge (if provided) */}
          {experienceText && (
            <div className="p-3 rounded-2xl bg-sky-50 border border-sky-100 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Briefcase className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider block">
                  {language === 'kz' ? 'Тәжірибе' : 'Стаж работы'}
                </span>
                <span className="text-sm font-bold text-sky-950">
                  {experienceText}
                </span>
              </div>
            </div>
          )}

          {stats && (stats.completedJobs > 0 || stats.avgResponseMinutes !== null) && (
            <div className="flex flex-wrap gap-1.5">
              {stats.completedJobs > 0 && (
                <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
                  ✅ {language === 'kz'
                    ? `${stats.completedJobs} тапсырыс орындады`
                    : `${stats.completedJobs} ${stats.completedJobs % 10 === 1 && stats.completedJobs % 100 !== 11 ? 'выполненный заказ' : stats.completedJobs % 10 >= 2 && stats.completedJobs % 10 <= 4 && (stats.completedJobs % 100 < 10 || stats.completedJobs % 100 >= 20) ? 'выполненных заказа' : 'выполненных заказов'}`}
                </span>
              )}
              {stats.avgResponseMinutes !== null && (
                <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-sky-50 border border-sky-200 text-[11px] font-bold text-sky-800">
                  ⚡ {language === 'kz' ? 'Әдетте жауап береді:' : 'Обычно отвечает'} {responseTimeLabel(stats.avgResponseMinutes, language === 'kz' ? 'kz' : 'ru')}
                </span>
              )}
            </div>
          )}

          <PortfolioGallery provider={provider} language={language} />

          {/* Category */}
          {provider.category && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {t.fieldCategory}
              </span>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-slate-800 font-semibold text-xs flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-sky-600 shrink-0" />
                <span>{provider.category}</span>
              </div>
            </div>
          )}

          {/* Services */}
          {provider.services && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {t.servicesProvided}
              </span>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-700 font-medium text-xs leading-relaxed flex items-start gap-2">
                <Wrench className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <span>{provider.services}</span>
              </div>
            </div>
          )}

          {/* Working Hours & Price Range */}
          {(provider.workingHours || provider.priceRange) && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {t.generalInfo}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {provider.workingHours && (
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 space-y-0.5">
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {language === 'kz' ? 'Жұмыс уақыты' : 'График'}
                    </span>
                    <p className="text-xs font-bold text-slate-800">
                      {provider.workingHours}
                    </p>
                  </div>
                )}

                {provider.priceRange && (
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 space-y-0.5">
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                      <Wallet className="w-3 h-3 text-slate-400" />
                      {language === 'kz' ? 'Баға аралығы' : 'Диапазон цен'}
                    </span>
                    <p className="text-xs font-bold text-sky-800">
                      {provider.priceRange}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {provider.description && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {t.aboutProvider}
              </span>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-700 text-xs leading-relaxed flex items-start gap-2">
                <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <p className="whitespace-pre-line">{provider.description}</p>
              </div>
            </div>
          )}

          {/* Reviews & Ratings Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {t.reviewsSectionTitle}
              </span>
              {reviewsCount > 0 && averageRating && (
                <span className="text-[11px] font-bold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  <span>
                    {averageRating} / 5 ({reviewsCountLabel(totalReviews, language === 'kz' ? 'kz' : 'ru')})
                  </span>
                </span>
              )}
            </div>

            {/* Overall Rating Card if reviews exist */}
            {reviewsCount > 0 && averageRating && (
              <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200/80 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-slate-900 font-display leading-none">
                    {averageRating}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 ml-1">/ 5</span>
                  <div className="flex items-center gap-0.5 mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-3.5 h-3.5 ${
                          star <= Math.round(Number(averageRating))
                            ? 'fill-amber-400 text-amber-500'
                            : 'text-slate-300'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-800 block">
                    {reviewsFromCustomersLabel(totalReviews, reviewsCount, language === 'kz' ? 'kz' : 'ru')}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {language === 'kz' ? 'Әр клиент бір рет есептеледі · пікірлер тексерілген' : 'Каждый клиент учтён один раз · отзывы проверены'}
                  </span>
                </div>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoadingReviews ? (
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center gap-2 text-slate-500 text-xs">
                <span className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                <span>{language === 'kz' ? 'Пікірлер жүктелуде...' : 'Загрузка отзывов...'}</span>
              </div>
            ) : reviewsCount === 0 ? (
              /* Empty State */
              <div className="p-6 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200 text-center space-y-1.5 animate-fadeIn">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                  <Star className="w-4 h-4 stroke-1" />
                </div>
                <p className="text-xs font-bold text-slate-700">
                  {t.noReviewsYet}
                </p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                  {language === 'kz'
                    ? 'Тапсырыс орындалғаннан кейін клиенттер осында баға қалдыра алады'
                    : 'Клиенты смогут оставить оценку после завершения заказа'}
                </p>
              </div>
            ) : (
              /* Verified Reviews List */
              <div className="space-y-2.5">
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-sky-600 text-white text-[10px] font-extrabold flex items-center justify-center font-display shrink-0">
                          {(rev.customerName || 'К').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-900 block leading-tight">
                            {rev.customerName || (language === 'kz' ? 'Клиент' : 'Клиент')}
                          </span>
                          {rev.createdAt && (
                            <span className="text-[10px] text-slate-400">
                              {formatShortDate(rev.createdAt, language, { year: true })}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-lg text-amber-900 font-bold text-xs">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                        <span>{rev.rating} / 5</span>
                      </div>
                    </div>

                    {rev.comment && rev.comment.trim() && (
                      <p className="text-xs text-slate-800 bg-white p-2.5 rounded-xl border border-slate-100 leading-relaxed font-medium">
                        «{rev.comment.trim()}»
                      </p>
                    )}

                    {(() => {
                      const reply = savedReplies[rev.id] || rev.providerReply || localReviewReply(rev.id)?.text;
                      if (reply) {
                        return (
                          <div className="ml-2 pl-2.5 border-l-2 border-sky-200">
                            <span className="text-[10px] font-bold text-sky-700 block">
                              {language === 'kz' ? 'Шебердің жауабы' : 'Ответ мастера'}
                            </span>
                            <p className="text-xs text-slate-700 leading-relaxed">{reply}</p>
                          </div>
                        );
                      }
                      if (!isOwnProfile) return null;
                      if (replyingId !== rev.id) {
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingId(rev.id);
                              setReplyText('');
                              setReplyError(null);
                            }}
                            className="text-[11px] font-bold text-sky-700"
                          >
                            {language === 'kz' ? 'Жауап беру' : 'Ответить'}
                          </button>
                        );
                      }
                      return (
                        <div className="space-y-1.5">
                          <textarea
                            rows={2}
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value.slice(0, 1000))}
                            placeholder={language === 'kz' ? 'Мысалы: Рақмет! Тағы да қуана көмектесемін.' : 'Например: Спасибо! Буду рад помочь снова.'}
                            className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-sky-500 resize-none"
                          />
                          {replyError && <p className="text-[11px] text-rose-600">{replyError}</p>}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setReplyingId(null)}
                              className="flex-1 h-8 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold"
                            >
                              {language === 'kz' ? 'Болдырмау' : 'Отмена'}
                            </button>
                            <button
                              type="button"
                              disabled={replySaving || !replyText.trim()}
                              onClick={async () => {
                                setReplySaving(true);
                                setReplyError(null);
                                try {
                                  const saved = await replyToReview(rev.id, replyText);
                                  setSavedReplies((m) => ({ ...m, [rev.id]: saved.text }));
                                  setReplyingId(null);
                                } catch (err) {
                                  setReplyError(getFriendlyErrorMessage(err, language));
                                } finally {
                                  setReplySaving(false);
                                }
                              }}
                              className="flex-1 h-8 rounded-lg bg-sky-600 text-white text-[11px] font-bold disabled:opacity-50"
                            >
                              {language === 'kz' ? 'Жариялау' : 'Опубликовать'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 pt-2 border-t border-slate-100 bg-white">
          <div className="flex justify-center">
            <ReportButton language={language} targetType="provider" targetId={provider.userId || provider.id} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[46px] rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-800 font-bold text-xs transition-colors"
          >
            {t.closeButton}
          </button>
        </div>
      </div>
    </div>
  );
};
