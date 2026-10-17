import React, { useState, useEffect } from 'react';
import { ExtractedNeed, Language, Urgency, PendingAttachment, RequestLocation } from '../types';
import { translations } from '../i18n/translations';
import { ALL_CITIES_LIST } from '../services/analyzer';
import { SERVICE_CATALOG, getGroup, getService, groupName, searchServices } from '../data/serviceCatalog';
import { isCityOpen, normalizeCategoryId, normalizeCityId } from '../services/taxonomy';
import { RequestMediaView } from './RequestMediaView';
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Briefcase, Calendar, Check, Edit3, FilePenLine, Flame, HelpCircle, Info, Loader2, MapPin, Send, Smartphone, Sparkles, Tag, Wallet, Wrench } from 'lucide-react';
import { CategoryIcon, Emoji3D, Photo } from './CategoryIcon';
import { requestVisual } from './RequestIcon';

interface InterpretationScreenProps {
  initialNeed: ExtractedNeed;
  language: Language;
  onContinue: (updatedNeed: ExtractedNeed) => void;
  onBack: () => void;
  /** The request is being sent: buttons wait */
  isSubmitting?: boolean;
}

// Pilot: a city that isn't open yet (e.g. the text mentions Almaty) falls back to Kyzylorda
function openCityOr(c: string, language: Language): string {
  return c.trim() && !isCityOpen(c) ? (language === 'kz' ? 'Қызылорда' : 'Кызылорда') : c;
}

export const InterpretationScreen: React.FC<InterpretationScreenProps> = ({
  initialNeed,
  language,
  onContinue,
  onBack,
  isSubmitting = false,
}) => {
  const t = translations[language];

  // Confidence threshold: >= 70% qualifies for direct confirmation card only if city and category are recognized
  const hasRecognizedCity = Boolean((initialNeed.city || '').trim() && normalizeCityId(initialNeed.city));
  const hasRecognizedCategory = Boolean(
    (initialNeed.category || '').trim() &&
    normalizeCategoryId(initialNeed.category) &&
    normalizeCategoryId(initialNeed.category) !== 'other'
  );
  const isHighConfidence = Boolean((initialNeed.confidence ?? 0.95) >= 0.7 && hasRecognizedCity && hasRecognizedCategory);

  // If high-confidence result, start in clean confirmation mode.
  // If low confidence (<0.7) or missing city/category, open manual editable form directly.
  const [isEditingManual, setIsEditingManual] = useState<boolean>(!isHighConfidence);
  const [formError, setFormError] = useState<string | null>(null);

  // Editable form state
  // A closed city falls back to Kyzylorda, with a note
  const [city, setCity] = useState(openCityOr(initialNeed.city || '', language));
  const [closedCityNotice, setClosedCityNotice] = useState(Boolean((initialNeed.city || '').trim() && !isCityOpen(initialNeed.city)));
  // Shown with the catalogue's name for the group, so the list below has it selected
  const [category, setCategory] = useState(() => {
    const g = getGroup(normalizeCategoryId(initialNeed.categoryId || initialNeed.category || ''));
    return g ? groupName(g, language) : initialNeed.category || '';
  });
  const visual = requestVisual({ serviceId: initialNeed.serviceId, categoryId: initialNeed.categoryId, category: category || initialNeed.category });
  const [service, setService] = useState(initialNeed.service);
  const [date, setDate] = useState(initialNeed.date);
  const [budget, setBudget] = useState(initialNeed.budget);
  const [urgency, setUrgency] = useState<Urgency>(initialNeed.urgency);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>(
    initialNeed.pendingAttachments || []
  );
  const [location, setLocation] = useState<RequestLocation | undefined>(
    initialNeed.location
  );

  // Smart Clarification Question state (non-blocking)
  const [clarificationInput, setClarificationInput] = useState<string>('');
  const [addedClarifications, setAddedClarifications] = useState<string[]>([]);
  const [clarificationToast, setClarificationToast] = useState<boolean>(false);

  // Synchronize state when initialNeed prop changes
  useEffect(() => {
    setCity(openCityOr(initialNeed.city || '', language));
    setClosedCityNotice(Boolean((initialNeed.city || '').trim() && !isCityOpen(initialNeed.city)));
    setCategory(initialNeed.category || '');
    setService(initialNeed.service);
    setDate(initialNeed.date);
    setBudget(initialNeed.budget);
    setUrgency(initialNeed.urgency);
    setPendingAttachments(initialNeed.pendingAttachments || []);
    setLocation(initialNeed.location);
    const hasCity = Boolean((initialNeed.city || '').trim() && normalizeCityId(initialNeed.city));
    const hasCat = Boolean(
      (initialNeed.category || '').trim() &&
      normalizeCategoryId(initialNeed.category) &&
      normalizeCategoryId(initialNeed.category) !== 'other'
    );
    setIsEditingManual(!((initialNeed.confidence ?? 0.95) >= 0.7 && hasCity && hasCat));
    setFormError(null);
    // Only a new request resets the form; switching the language must not
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNeed]);

  const handleAddClarification = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = clarificationInput.trim();
    if (!clean) return;
    setAddedClarifications((prev) => [...prev, clean]);
    setClarificationInput('');
    setClarificationToast(true);
    setTimeout(() => setClarificationToast(false), 3000);
  };

  // Invokes existing createRequest flow only upon explicit customer confirmation
  const handleProceed = () => {
    const finalCity = (city || '').trim() || openCityOr(initialNeed.city || '', language).trim();
    const resolvedCityId = normalizeCityId(finalCity);
    if (!finalCity || !resolvedCityId) {
      setFormError(
        language === 'kz'
          ? 'Қаланы таңдау міндетті'
          : 'Необходимо выбрать город'
      );
      setIsEditingManual(true);
      return;
    }

    const finalCategory = (category || '').trim() || (initialNeed.category || '').trim();
    const resolvedCategoryId = normalizeCategoryId(finalCategory);
    if (!finalCategory || !resolvedCategoryId || resolvedCategoryId === 'other') {
      setFormError(
        language === 'kz'
          ? 'Санатты таңдау міндетті'
          : 'Необходимо выбрать категорию'
      );
      setIsEditingManual(true);
      return;
    }

    setFormError(null);

    // The corrected need is put together in one place: the title stays a short title, added details
    // go to the full description (nothing is cut off), and catalogue data recognised for another
    // category or title is not carried over
    const finalService =
      (service || '').trim() ||
      initialNeed.service ||
      initialNeed.originalQuery ||
      finalCategory;
    const baseDescription = (initialNeed.description || initialNeed.originalQuery || finalService).trim();
    const finalDescription = [baseDescription, ...addedClarifications].filter(Boolean).join('\n').slice(0, 5000);
    const categoryChanged = resolvedCategoryId !== normalizeCategoryId(initialNeed.categoryId || initialNeed.category || '');
    const serviceEdited = finalService !== (initialNeed.service || '').trim();
    let serviceId: string | undefined = initialNeed.serviceId;
    if (serviceId && (serviceEdited || getService(serviceId)?.group.id !== resolvedCategoryId)) serviceId = undefined;
    if (!serviceId && serviceEdited) {
      serviceId = searchServices(finalService, 20).find((m) => m.group.id === resolvedCategoryId)?.service.id;
    }
    const understanding = initialNeed.understanding
      ? {
          ...initialNeed.understanding,
          city: finalCity,
          cityId: resolvedCityId,
          category: finalCategory,
          categoryId: resolvedCategoryId,
          service: finalService.slice(0, 300),
          serviceId,
          description: finalDescription,
          // Questions were suggested for the category that was recognised, not the chosen one
          ...(categoryChanged ? { suggestedQuestions: [] } : {}),
        }
      : undefined;

    onContinue({
      ...initialNeed,
      city: finalCity,
      cityId: resolvedCityId,
      category: finalCategory,
      categoryId: resolvedCategoryId,
      serviceId,
      service: finalService,
      description: finalDescription,
      date: (date || '').trim() || initialNeed.date || (language === 'kz' ? 'Бүгін' : 'Сегодня'),
      budget:
        (budget || '').trim() || initialNeed.budget || (language === 'kz' ? 'Келісімді' : 'Договорная'),
      urgency,
      pendingAttachments,
      location,
      understanding,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleProceed();
  };

  const formatUrgencyLabel = (u: Urgency) => {
    if (u === 'high') return t.urgencyHigh;
    if (u === 'low') return t.urgencyLow;
    return t.urgencyNormal;
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col min-h-[calc(100dvh-56px)] justify-between">
      <div className="space-y-4">
        {/* --- 1. AI CONFIRMATION CARD (When confidence >= 0.70 and user hasn't toggled edit) --- */}
        {!isEditingManual && isHighConfidence ? (
          <div className="space-y-4 animate-fadeIn">
            {/* Header */}
            <div className="text-center pt-1">
              {visual.photo ? <Photo name={visual.photo} eager className="mx-auto mb-3 w-20 h-20 rounded-3xl shadow-md animate-popIn" /> : <Emoji3D code={visual.emoji} size={72} eager className="mx-auto mb-2 animate-popIn" />}
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight font-display">
                {t.aiConfirmTitle}
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {t.aiConfirmSubtitle}
              </p>
            </div>

            {/* Structured Card */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm shadow-slate-200/60 p-4 space-y-3.5">
              {/* Items List */}
              <div className="space-y-3">
                {/* City */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      {t.fieldCity}
                    </span>
                    <span className="text-base font-bold text-slate-900 font-display">
                      {city}
                    </span>
                    {closedCityNotice && (
                      <span className="block text-xs text-amber-700 mt-0.5 leading-snug">
                        {language === 'kz'
                          ? 'Tapsyr әзірге тек Қызылордада жұмыс істейді. Басқа қалалар жақында ашылады.'
                          : 'Tapsyr пока работает только в Кызылорде. Другие города откроются позже.'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Category */}
                <div className="flex items-start gap-3">
                  <CategoryIcon emoji={visual.emoji} color={visual.color} photo={visual.photo} size="xs" />
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      {t.fieldCategory}
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {category}
                    </span>
                  </div>
                </div>

                {/* Service */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Wrench className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      {t.fieldService}
                    </span>
                    <span className="text-sm font-bold text-slate-900 leading-snug">
                      {service}
                    </span>
                  </div>
                </div>

                {/* Brand / Model if detected */}
                {Boolean(initialNeed.understanding?.detectedBrand || initialNeed.understanding?.detectedModel) && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Smartphone className="w-4 h-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                        {t.detectedBrandLabel}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {[initialNeed.understanding?.detectedBrand, initialNeed.understanding?.detectedModel].filter(Boolean).join(' ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Detected Problem if present */}
                {Boolean(initialNeed.understanding?.detectedProblem) && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                        {t.detectedProblemLabel}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {initialNeed.understanding?.detectedProblem}
                      </span>
                    </div>
                  </div>
                )}

                {/* Date & Preferred Time */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Calendar className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      {t.fieldDate}
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {date} {initialNeed.understanding?.preferredTime ? `· ${initialNeed.understanding.preferredTime}` : ''}
                    </span>
                  </div>
                </div>

                {/* Urgency */}
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    initialNeed.understanding?.urgency === 'emergency'
                      ? 'bg-red-100 text-red-600 animate-pulse'
                      : 'bg-rose-50 text-rose-600'
                  }`}>
                    <Flame className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                      {t.fieldUrgency}
                    </span>
                    {initialNeed.understanding?.urgency === 'emergency' ? (
                      <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-md mt-0.5 bg-red-600 text-white shadow-xs animate-pulse">
                        ⚠️ {t.urgencyEmergency}
                      </span>
                    ) : (
                      <span
                        className={`inline-block text-xs font-bold px-2 py-0.5 rounded-md mt-0.5 ${
                          urgency === 'high'
                            ? 'bg-rose-100 text-rose-800'
                            : urgency === 'low'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {formatUrgencyLabel(urgency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Original User Query quote */}
              <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-100 text-xs text-slate-600 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                  {t.originalQueryLabel}
                </span>
                <p className="italic text-slate-800 font-medium">
                  «{initialNeed.originalQuery}»
                </p>
              </div>

              {/* Smart Clarification Questions (Non-blocking assistant) */}
              {Boolean(initialNeed.understanding?.suggestedQuestions && initialNeed.understanding.suggestedQuestions.length > 0) && (
                <div className="p-3.5 bg-sky-50/70 border border-sky-200 rounded-2xl space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900">
                    <HelpCircle className="w-4 h-4 text-sky-600" />
                    <span>{t.smartQuestionsTitle}</span>
                  </div>

                  <div className="space-y-1.5">
                    {initialNeed.understanding?.suggestedQuestions?.map((q, idx) => (
                      <div key={idx} className="text-xs text-slate-700 font-medium flex items-start gap-1.5">
                        <span className="text-sky-600 font-bold shrink-0">•</span>
                        <span>{q}</span>
                      </div>
                    ))}
                  </div>

                  {addedClarifications.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-sky-100">
                      {addedClarifications.map((ans, idx) => (
                        <div key={idx} className="text-xs bg-white text-emerald-800 px-2 py-1 rounded-lg border border-emerald-200 flex items-center gap-1.5 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{ans}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleAddClarification} className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={clarificationInput}
                      onChange={(e) => setClarificationInput(e.target.value)}
                      placeholder={t.addClarificationPlaceholder}
                      className="flex-1 h-9 px-3 text-xs bg-white border border-sky-200 rounded-xl focus:outline-none focus:border-sky-500 text-slate-800 placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={!clarificationInput.trim()}
                      className="h-9 px-3 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-semibold text-xs rounded-xl flex items-center gap-1 transition"
                    >
                      <span>{t.btnSubmitClarification}</span>
                      <Send className="w-3 h-3" />
                    </button>
                  </form>

                  {clarificationToast && (
                    <div className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>{t.clarificationAddedNotice}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Request 2.0 Media & Location Preview */}
              {(pendingAttachments.length > 0 ||
                location ||
                initialNeed.understanding?.hasLocation ||
                (initialNeed.understanding?.attachmentsPresent &&
                  (initialNeed.understanding.attachmentsPresent.images > 0 ||
                    initialNeed.understanding.attachmentsPresent.videos > 0 ||
                    initialNeed.understanding.attachmentsPresent.audios > 0))) && (
                <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      {t.reqAttachmentsSectionTitle}
                    </span>
                    {/* Attachment awareness count badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {((initialNeed.understanding?.attachmentsPresent?.images ?? 0) > 0 ||
                        pendingAttachments.filter((a) => a.mediaType === 'image').length > 0) && (
                        <span className="text-[10px] font-semibold bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          📷 {Math.max(
                            initialNeed.understanding?.attachmentsPresent?.images ?? 0,
                            pendingAttachments.filter((a) => a.mediaType === 'image').length
                          )} {language === 'kz' ? 'фото' : 'фото'}
                        </span>
                      )}
                      {((initialNeed.understanding?.attachmentsPresent?.videos ?? 0) > 0 ||
                        pendingAttachments.filter((a) => a.mediaType === 'video').length > 0) && (
                        <span className="text-[10px] font-semibold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          🎥 {Math.max(
                            initialNeed.understanding?.attachmentsPresent?.videos ?? 0,
                            pendingAttachments.filter((a) => a.mediaType === 'video').length
                          )} {language === 'kz' ? 'видео' : 'видео'}
                        </span>
                      )}
                      {((initialNeed.understanding?.attachmentsPresent?.audios ?? 0) > 0 ||
                        pendingAttachments.filter((a) => a.mediaType === 'audio').length > 0) && (
                        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          🎤 {Math.max(
                            initialNeed.understanding?.attachmentsPresent?.audios ?? 0,
                            pendingAttachments.filter((a) => a.mediaType === 'audio').length
                          )} {language === 'kz' ? 'аудио' : 'аудио'}
                        </span>
                      )}
                      {(Boolean(location) || Boolean(initialNeed.understanding?.hasLocation)) && (
                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          📍 {language === 'kz' ? 'Орналасқан жер' : 'Локация'}
                        </span>
                      )}
                    </div>
                  </div>
                  <RequestMediaView
                    attachments={pendingAttachments}
                    location={location}
                    language={language}
                    onRemoveAttachment={(id) =>
                      setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
                    }
                    onRemoveLocation={() => setLocation(undefined)}
                    isEditable={true}
                  />
                </div>
              )}

              {/* Question & Confirm / Edit Actions */}
              <div className="pt-2 space-y-2.5">
                <div className="text-center font-bold text-sm text-slate-900">
                  {t.aiIsCorrectQuestion}
                </div>

                {/* Primary: Yes, continue (Creates Request in Firestore) */}
                <button
                  type="button"
                  onClick={handleProceed}
                  disabled={isSubmitting}
                  className="w-full min-h-[52px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-70 text-white font-bold text-base flex items-center justify-center gap-2 shadow-md shadow-sky-600/25 active:scale-[0.99] transition"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  <span>{t.aiConfirmBtn}</span>
                  {!isSubmitting && <ArrowRight className="w-5 h-5 stroke-[2.5]" />}
                </button>

                {/* Secondary: Edit / Customize manually */}
                <button
                  type="button"
                  onClick={() => setIsEditingManual(true)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:bg-slate-50 bg-white text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition active:scale-[0.99]"
                >
                  <Edit3 className="w-4 h-4 text-slate-500" />
                  <span>{t.aiEditBtn}</span>
                </button>

                {/* Back button */}
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full min-h-[40px] text-slate-500 hover:text-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t.backButton}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* --- 2. EDITABLE MANUAL FORM (Low confidence, AI error, or User clicked "Өзгерту") --- */
          <div className="space-y-4 animate-fadeIn">
            {/* Header */}
            <div className="text-center pt-1">
              <span className="mx-auto mb-3 w-16 h-16 rounded-3xl bg-sky-50 text-sky-700 flex items-center justify-center animate-popIn"><FilePenLine className="w-7 h-7" /></span>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight font-display">
                {t.interpretationTitle}
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {t.interpretationSubtitle}
              </p>
            </div>

            {/* Low confidence warning banner (if AI ran with confidence < 70%) */}
            {initialNeed.isAiParsed && (initialNeed.confidence ?? 0) < 0.7 && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5 shadow-2xs">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold block text-amber-950">
                    {t.aiLowConfidenceNotice}
                  </span>
                  <span className="text-amber-700 block">
                    {language === 'kz'
                      ? `Дәлдік: ${Math.round((initialNeed.confidence || 0) * 100)}%. Мәліметтерді қолмен растаңыз.`
                      : `Точность: ${Math.round((initialNeed.confidence || 0) * 100)}%. Пожалуйста, проверьте данные вручную.`}
                  </span>
                </div>
              </div>
            )}

            {/* AI fallback notice if offline or error occurred */}
            {!initialNeed.isAiParsed && initialNeed.aiError && (
              <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <span className="font-medium">
                  {t.aiErrorNotice}
                </span>
              </div>
            )}

            {/* Original Query Display */}
            <div className="p-3 bg-slate-100/80 rounded-xl border border-slate-200/80 text-xs text-slate-700">
              <span className="font-semibold text-slate-500 block mb-1">
                {t.originalQueryLabel}
              </span>
              <p className="italic text-slate-800 font-medium">
                «{initialNeed.originalQuery}»
              </p>
            </div>

            {/* Request 2.0 Media & Location Preview */}
            {(pendingAttachments.length > 0 || location) && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                  {t.reqAttachmentsSectionTitle}
                </span>
                <RequestMediaView
                  attachments={pendingAttachments}
                  location={location}
                  language={language}
                  onRemoveAttachment={(id) =>
                    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
                  }
                  onRemoveLocation={() => setLocation(undefined)}
                  isEditable={true}
                />
              </div>
            )}

            {/* Validation Error Banner */}
            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl flex items-center gap-2 text-xs text-rose-800 font-semibold animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Editable Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* 1. Город / Қала */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-600" />
                  <span>{t.fieldCity}</span>
                  <span className="text-rose-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <select
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      setFormError(null);
                    }}
                    className={`w-full h-11 px-3 bg-slate-50 border rounded-lg text-sm font-semibold text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white ${
                      !city ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                    }`}
                  >
                    <option value="">
                      {language === 'kz' ? '-- Қаланы таңдаңыз --' : '-- Выберите город --'}
                    </option>
                    {ALL_CITIES_LIST.map((c) => {
                      const cityName = language === 'kz' ? c.kz : c.ru;
                      const open = isCityOpen(c.ru);
                      return (
                        <option key={c.ru} value={cityName} disabled={!open}>
                          {open ? cityName : `${cityName} — ${language === 'kz' ? 'жақында' : 'скоро'}`}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* 2. Категория / Санат */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-sky-600" />
                  <span>{t.fieldCategory}</span>
                  <span className="text-rose-500 font-bold">*</span>
                </label>
                <div className="space-y-2">
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setFormError(null);
                    }}
                    className={`w-full h-11 px-3 bg-slate-50 border rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white ${
                      !category ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                    }`}
                  >
                    <option value="">
                      {language === 'kz' ? '-- Санатты таңдаңыз --' : '-- Выберите категорию --'}
                    </option>
                    {SERVICE_CATALOG.map((g) => {
                      const catName = groupName(g, language);
                      return (
                        <option key={g.id} value={catName}>
                          {catName}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* 3. Что нужно / Не қажет */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-sky-600" />
                  <span>{t.fieldService}</span>
                </label>
                <input
                  type="text"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder={t.fieldService}
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white"
                />
              </div>

              {/* 4. Дата / Күні */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-sky-600" />
                  <span>{t.fieldDate}</span>
                </label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {[
                      language === 'kz' ? 'Бүгін' : 'Сегодня',
                      language === 'kz' ? 'Ертең' : 'Завтра',
                      language === 'kz' ? 'Осы аптада' : 'На этой неделе',
                    ].map((quickDate) => (
                      <button
                        key={quickDate}
                        type="button"
                        onClick={() => setDate(quickDate)}
                        className={`min-h-[32px] px-2.5 text-xs rounded-md transition ${
                          date === quickDate
                            ? 'bg-sky-600 text-white font-medium'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {quickDate}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 5. Бюджет */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-sky-600" />
                  <span>{t.fieldBudget}</span>
                </label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {[
                      language === 'kz' ? 'Келісімді' : 'Договорная',
                      'до 10 000 ₸',
                      'до 50 000 ₸',
                      'до 150 000 ₸',
                    ].map((bVal) => (
                      <button
                        key={bVal}
                        type="button"
                        onClick={() => setBudget(bVal)}
                        className={`min-h-[32px] px-2.5 text-xs rounded-md transition ${
                          budget === bVal
                            ? 'bg-sky-600 text-white font-medium'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {bVal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 6. Urgency selector */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t.fieldUrgency}</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUrgency('high')}
                    className={`min-h-[40px] px-2 text-xs font-semibold rounded-lg border transition ${
                      urgency === 'high'
                        ? 'bg-amber-50 border-amber-400 text-amber-900 shadow-2xs'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.urgencyHigh}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency('normal')}
                    className={`min-h-[40px] px-2 text-xs font-semibold rounded-lg border transition ${
                      urgency === 'normal'
                        ? 'bg-sky-50 border-sky-400 text-sky-900 shadow-2xs'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.urgencyNormal}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency('low')}
                    className={`min-h-[40px] px-2 text-xs font-semibold rounded-lg border transition ${
                      urgency === 'low'
                        ? 'bg-slate-200 border-slate-400 text-slate-900 shadow-2xs'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.urgencyLow}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full min-h-[52px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-70 text-white font-bold text-base flex items-center justify-center gap-2 shadow-md shadow-sky-600/20 active:scale-[0.99] transition"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                  <span>{t.continueButton}</span>
                  <ArrowRight className="w-5 h-5 stroke-[2.5]" />
                </button>

                {isHighConfidence && (
                  <button
                    type="button"
                    onClick={() => setIsEditingManual(false)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                    <span>{language === 'kz' ? 'AI қорытындысына оралу' : 'Вернуться к карточке AI'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onBack}
                  className="w-full min-h-[44px] rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>{t.backButton}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
