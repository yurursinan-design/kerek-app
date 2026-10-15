import React, { useState, useEffect, useRef } from 'react';
import { Language, normalizeRequestStatus, Review } from '../types';
import { translations } from '../i18n/translations';
import { repository, getFriendlyErrorMessage, getCurrentUserId } from '../services';
import { auth } from '../services/firebase';
import { Star, X, CheckCircle, Loader2 } from 'lucide-react';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  customerId: string;
  customerName: string;
  providerId: string;
  providerName: string;
  language: Language;
  onReviewSubmitted: (review: Review) => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  requestId,
  customerId,
  customerName,
  providerId,
  providerName,
  language,
  onReviewSubmitted,
}) => {
  const t = translations[language];
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSelfReview = Boolean(
    customerId &&
    providerId &&
    (customerId.trim() === providerId.trim() ||
     (auth?.currentUser?.uid && providerId.trim() === auth.currentUser.uid) ||
     (getCurrentUserId() && providerId.trim() === getCurrentUserId()))
  );

  // When modal opens, verify COMPLETED status in Firestore/repository
  // Latest close handler from the parent (the status check below runs once per opening)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !requestId) return;
    let isMounted = true;
    const verifyStatus = async () => {
      try {
        const fresh = await repository.getRequest(requestId);
        if (fresh && isMounted) {
          const canonical = normalizeRequestStatus(fresh.status);
          if (canonical !== 'COMPLETED') {
            setErrorMessage(
              language === 'kz'
                ? 'Тек аяқталған тапсырысқа баға беруге болады'
                : 'Оценивать можно только завершенные заказы'
            );
            setTimeout(() => {
              if (isMounted) onCloseRef.current();
            }, 1800);
          }
        }
      } catch (err) {
        console.warn('[ReviewModal] Verify request status note:', err);
      }
    };
    verifyStatus();
    return () => {
      isMounted = false;
    };
  }, [isOpen, requestId, language]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSelfReview) {
      setErrorMessage(
        language === 'kz'
          ? 'Орындаушы өзіне баға бере алмайды'
          : 'Исполнитель не может оценивать самого себя'
      );
      return;
    }

    if (rating < 1 || rating > 5) {
      setErrorMessage(t.selectRatingPrompt);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Fetch fresh request from Firestore/repository to verify true status
      const freshReq = await repository.getRequest(requestId);
      const canonicalStatus = normalizeRequestStatus(freshReq?.status);

      // Verify request is strictly COMPLETED
      if (!freshReq || canonicalStatus !== 'COMPLETED') {
        setErrorMessage(
          language === 'kz'
            ? 'Тек аяқталған тапсырысқа баға беруге болады'
            : 'Оценивать можно только завершенные заказы'
        );
        setIsSubmitting(false);
        return;
      }

      const created = await repository.createReview({
        id: requestId,
        requestId,
        customerId,
        customerName: customerName || (language === 'kz' ? 'Клиент' : 'Клиент'),
        providerId,
        providerName,
        rating,
        comment: comment.trim(),
        createdAt: new Date().toISOString(),
      });

      onReviewSubmitted(created);
      onClose();
    } catch (err) {
      setErrorMessage(getFriendlyErrorMessage(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeRating = hoverRating || rating;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 max-h-[92vh] flex flex-col overflow-hidden animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-5 pb-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <h3
              id="review-modal-title"
              className="text-base font-bold text-slate-900 font-display leading-tight"
            >
              {t.rateProviderModalTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {providerName}
            </p>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {isSelfReview && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 font-medium flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {language === 'kz'
                  ? 'Орындаушы өзіне баға бере алмайды (тапсырыс беруші мен орындаушы бір).'
                  : 'Исполнитель не может оценивать самого себя (аккаунты заказчика и исполнителя совпадают).'}
              </span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium animate-fadeIn">
              {errorMessage}
            </div>
          )}

          {/* Prompt */}
          <div className="text-center pt-1 pb-2">
            <p className="text-xs text-slate-600 font-medium">
              {t.rateProviderModalSubtitle}
            </p>

            {/* 1-5 Interactive Star Selection */}
            <div className="flex items-center justify-center gap-2 pt-3 pb-1">
              {[1, 2, 3, 4, 5].map((starValue) => {
                const isFilled = starValue <= activeRating;
                return (
                  <button
                    key={starValue}
                    type="button"
                    onClick={() => {
                      setRating(starValue);
                      setErrorMessage(null);
                    }}
                    onMouseEnter={() => setHoverRating(starValue)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1.5 focus:outline-none active:scale-95 transition-transform"
                    aria-label={`${starValue} / 5`}
                  >
                    <Star
                      className={`w-9 h-9 transition-colors ${
                        isFilled
                          ? 'fill-amber-400 text-amber-500 stroke-[1.5]'
                          : 'fill-slate-100 text-slate-300 stroke-[1.5]'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <span className="text-xs font-bold text-amber-900 block mt-1">
              {rating > 0
                ? `${rating} / 5`
                : t.selectRatingPrompt}
            </span>
          </div>

          {/* Optional Comment */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <label htmlFor="review-comment">
                {language === 'kz' ? 'Пікір (міндетті емес)' : 'Отзыв (необязательно)'}
              </label>
              <span className="text-slate-400 font-normal">
                {comment.length}/500
              </span>
            </div>
            <textarea
              id="review-comment"
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t.rateProviderCommentPlaceholder}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:bg-white resize-none transition-colors"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={rating === 0 || isSubmitting || isSelfReview}
              className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md shadow-sky-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>...</span>
                </>
              ) : (
                <span>{t.submitRatingBtn}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
