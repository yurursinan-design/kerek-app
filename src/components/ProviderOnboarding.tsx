import { getFriendlyErrorMessage } from '../services';
import { auth } from '../services/firebase';
import React, { useState, useMemo, useEffect } from 'react';
import { Language, Provider } from '../types';
import { translations } from '../i18n/translations';
import { ALL_CITIES_LIST, CATEGORIES_LIST } from '../services/analyzer';
import { getService, groupName, serviceName } from '../data/serviceCatalog';
import { ServicePicker } from './ServicePicker';
import { normalizeCategoryId, normalizeCityId } from '../services/taxonomy';
import { ProviderProfileModal } from './ProviderProfileModal';
import {
  User,
  Phone,
  MapPin,
  Briefcase,
  Clock,
  Wallet,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Eye,
  Send,
  AlertCircle,
  Sparkles,
  Wrench,
  FileText,
  Award,
} from 'lucide-react';

export interface ProviderOnboardingProps {
  language: Language;
  initialProvider?: Provider | null;
  onSave: (data: Partial<Provider>) => Promise<void>;
  onCancel?: () => void;
}

export const ProviderOnboarding: React.FC<ProviderOnboardingProps> = ({
  language,
  initialProvider,
  onSave,
  onCancel,
}) => {
  const t = translations[language];

  // Current Step: 1, 2, 3, 4
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Form Fields State
  const [name, setName] = useState(initialProvider?.name || '');
  const [phone, setPhone] = useState(initialProvider?.phone || auth?.currentUser?.phoneNumber || '');
  const [whatsapp, setWhatsapp] = useState(initialProvider?.whatsapp || '');

  const [city, setCity] = useState(
    initialProvider?.city || (language === 'kz' ? 'Қызылорда' : 'Кызылорда')
  );
  // Profile fields start empty (placeholders show examples): pre-filled text would publish claims the provider never made
  const [district, setDistrict] = useState(initialProvider?.district || '');
  const [category, setCategory] = useState(
    initialProvider?.category ||
      (language === 'kz' ? 'Тұрмыстық техника жөндеу' : 'Ремонт бытовой техники')
  );
  const [services, setServices] = useState(initialProvider?.services || '');
  // Catalogue services the provider offers (the main category follows the first one picked)
  const [serviceIds, setServiceIds] = useState<string[]>(initialProvider?.serviceIds || []);
  useEffect(() => {
    const first = getService(serviceIds[0]);
    if (first) setCategory(groupName(first.group, language));
  }, [serviceIds, language]);

  const [experienceYears, setExperienceYears] = useState(
    initialProvider?.experienceYears !== undefined && initialProvider.experienceYears !== null
      ? String(initialProvider.experienceYears)
      : ''
  );
  const [workingHours, setWorkingHours] = useState(
    initialProvider?.workingHours || '09:00 - 20:00'
  );
  const [priceRange, setPriceRange] = useState(initialProvider?.priceRange || '');
  const [description, setDescription] = useState(initialProvider?.description || '');
  const [tradeLicense, setTradeLicense] = useState(initialProvider?.tradeLicense || '');

  // Constructed Preview Provider
  const previewProvider: Provider = useMemo(() => {
    let exp: number | undefined = undefined;
    const cleanExp = experienceYears.replace(/[^\d]/g, '');
    if (cleanExp) {
      const parsed = parseInt(cleanExp, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 70) {
        exp = parsed;
      }
    }

    return {
      id: initialProvider?.id || 'preview-provider-id',
      userId: initialProvider?.userId || 'preview-user-id',
      name: name.trim() || (language === 'kz' ? 'Шебер' : 'Мастер'),
      phone: phone.trim(),
      whatsapp: (whatsapp || phone).trim(),
      city: city.trim(),
      cityId: normalizeCityId(city),
      district: district.trim(),
      category: category.trim(),
      categoryId: normalizeCategoryId(category),
      services: services.trim(),
      priceRange: priceRange.trim(),
      workingHours: workingHours.trim() || '09:00 - 20:00',
      experienceYears: exp,
      description: description.trim(),
      // Trust badges are not self-assignable; they stay off until real verification exists
      verified: false,
      iinVerified: false,
      hasCertificate: false,
      tradeLicense: tradeLicense.trim() || initialProvider?.tradeLicense || '',
      isDemo: false,
    };
  }, [
    initialProvider,
    name,
    phone,
    whatsapp,
    city,
    district,
    category,
    services,
    experienceYears,
    workingHours,
    priceRange,
    description,
    tradeLicense,
    language,
  ]);

  // Validation per step
  const validateStep1 = (): boolean => {
    if (!name.trim() || name.trim().length < 2) {
      setStepError(t.nameMinLengthError);
      return false;
    }
    const cleanPhoneDigits = phone.replace(/[^\d+]/g, '');
    if (!cleanPhoneDigits || cleanPhoneDigits.length < 6) {
      setStepError(t.phoneMinLengthError);
      return false;
    }
    setStepError(null);
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!city.trim()) {
      setStepError(t.cityRequiredError);
      return false;
    }
    if (serviceIds.length === 0) {
      setStepError(language === 'kz' ? 'Кем дегенде бір қызметті таңдаңыз' : 'Выберите хотя бы одну услугу');
      return false;
    }
    setStepError(null);
    return true;
  };

  const validateStep3 = (): boolean => {
    setStepError(null);
    return true;
  };

  const handleNext = () => {
    setStepError(null);
    if (currentStep === 1) {
      if (validateStep1()) {
        setCurrentStep(2);
      }
    } else if (currentStep === 2) {
      if (validateStep2()) {
        setCurrentStep(3);
      }
    } else if (currentStep === 3) {
      if (validateStep3()) {
        setCurrentStep(4);
      }
    }
  };

  const handlePrev = () => {
    setStepError(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as 1 | 2 | 3 | 4);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep1() || !validateStep2() || !validateStep3()) {
      return;
    }

    setIsSubmitting(true);
    setStepError(null);

    let expYears: number | undefined = undefined;
    const cleanExp = experienceYears.replace(/[^\d]/g, '');
    if (cleanExp) {
      const parsed = parseInt(cleanExp, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 70) {
        expYears = parsed;
      }
    }

    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        whatsapp: (whatsapp || phone).trim(),
        city: city.trim(),
        district: district.trim(),
        category: category.trim(),
        serviceIds,
        services:
          services.trim() ||
          serviceIds
            .map((id) => getService(id))
            .filter(Boolean)
            .map((x) => serviceName(x!.service, language))
            .join(', '),
        priceRange: priceRange.trim(),
        workingHours: workingHours.trim() || '09:00 - 20:00',
        experienceYears: expYears,
        description: description.trim(),
        tradeLicense: tradeLicense.trim() || initialProvider?.tradeLicense || '',
      });
    } catch (err: any) {
      setStepError(getFriendlyErrorMessage(err, language));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step Meta
  const stepTitles = {
    1: { title: t.onboardingStep1Title, subtitle: t.onboardingStep1Subtitle },
    2: { title: t.onboardingStep2Title, subtitle: t.onboardingStep2Subtitle },
    3: { title: t.onboardingStep3Title, subtitle: t.onboardingStep3Subtitle },
    4: { title: t.onboardingStep4Title, subtitle: t.onboardingStep4Subtitle },
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4 animate-fadeIn">
      {/* Header & Step Indicator */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-50 text-sky-800 rounded-full text-xs font-bold font-mono">
            <Sparkles className="w-3.5 h-3.5 text-sky-600" />
            <span>
              {`${t.onboardingStepIndicator} ${currentStep} ${t.onboardingStepOf} 4`}
            </span>
          </div>

          {initialProvider && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
            >
              {language === 'kz' ? 'Артқа қайту' : 'Отмена'}
            </button>
          )}
        </div>

        {/* Step Progress Bar */}
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {[1, 2, 3, 4].map((stepNum) => {
            const isCompleted = stepNum < currentStep;
            const isCurrent = stepNum === currentStep;

            return (
              <div
                key={stepNum}
                onClick={() => {
                  if (stepNum < currentStep) {
                    setCurrentStep(stepNum as 1 | 2 | 3 | 4);
                  }
                }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  isCurrent
                    ? 'bg-sky-600 shadow-xs'
                    : isCompleted
                    ? 'bg-emerald-500 cursor-pointer'
                    : 'bg-slate-200'
                }`}
                title={`Step ${stepNum}`}
              />
            );
          })}
        </div>

        {/* Title and Subtitle */}
        <div className="pt-1">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight font-display">
            {stepTitles[currentStep].title}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {stepTitles[currentStep].subtitle}
          </p>
        </div>
      </div>

      {/* Error Message */}
      {stepError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-800 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{stepError}</span>
          </div>
          <button
            type="button"
            onClick={() => setStepError(null)}
            className="text-rose-500 font-bold px-1 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* STEP 1: Basic Info */}
      {currentStep === 1 && (
        <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-sky-600" />
              <span>{t.providerNameField}</span>
              <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (stepError) setStepError(null);
              }}
              placeholder={language === 'kz' ? 'Мысалы: Серік Ахметов / ТОО Сыр-Шебер' : 'Например: Мастер Серик / ТОО Сыр-Шебер'}
              className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-sky-600" />
                <span>{t.providerPhoneField}</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (stepError) setStepError(null);
                }}
                placeholder="+7 777 000 00 00"
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t.providerWhatsappField}</span>
              </label>
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+7 777 000 00 00"
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
            {language === 'kz'
              ? '💡 Телефон нөміріңіз тапсырыс қабылданғанға дейін клиенттерге жасырын болады.'
              : '💡 Ваш номер телефона будет скрыт от клиентов до тех пор, пока ваше предложение не примут.'}
          </p>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleNext}
              className="w-full min-h-[50px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-sky-600/20 flex items-center justify-center gap-2 transition-all"
            >
              <span>{t.btnNextStep}</span>
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Service Area */}
      {currentStep === 2 && (
        <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-600" />
                <span>{t.fieldCity}</span>
                <span className="text-rose-500">*</span>
              </label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full h-12 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              >
                {ALL_CITIES_LIST.map((c) => {
                  const cName = language === 'kz' ? c.kz : c.ru;
                  return (
                    <option key={c.ru} value={cName}>
                      {cName}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                <span>{t.providerDistrictField}</span>
              </label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder={language === 'kz' ? 'Астана даңғылы / Орталық' : 'Центр / Бостандыкский'}
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-sky-600" />
              <span>{language === 'kz' ? 'Қандай қызметтер көрсетесіз?' : 'Какие услуги вы оказываете?'}</span>
              <span className="text-rose-500">*</span>
            </label>
            <p className="text-[11px] text-slate-500">
              {language === 'kz'
                ? 'Бірнеше қызметті таңдай аласыз. Тек таңдалған қызметтер бойынша өтініштер келеді.'
                : 'Можно выбрать несколько. Заявки будут приходить только по выбранным услугам.'}
            </p>
            <ServicePicker
              language={language}
              selected={serviceIds}
              onChange={(ids) => {
                setServiceIds(ids);
                if (stepError) setStepError(null);
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-sky-600" />
              <span>{language === 'kz' ? 'Қосымша (міндетті емес)' : 'Дополнительно (необязательно)'}</span>
            </label>
            <input
              type="text"
              value={services}
              onChange={(e) => setServices(e.target.value)}
              placeholder={language === 'kz' ? 'Кір жуғыш машина, тоңазытқыш жөндеу' : 'Ремонт стиральных машин, замена деталей'}
              className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handlePrev}
              className="min-h-[50px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-bold text-sm flex items-center justify-center gap-1 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
              <span>{t.btnPrevStep}</span>
            </button>

            <button
              type="button"
              onClick={handleNext}
              className="flex-1 min-h-[50px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-sky-600/20 flex items-center justify-center gap-2 transition-all"
            >
              <span>{t.btnNextStep}</span>
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Professional Info */}
      {currentStep === 3 && (
        <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-sky-600" />
                <span>{t.providerExperienceField}</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={experienceYears}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, '');
                  setExperienceYears(digits.slice(0, 2));
                }}
                placeholder={t.providerExperiencePlaceholder}
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-600" />
                <span>{language === 'kz' ? 'Жұмыс кестесі' : 'График работы'}</span>
              </label>
              <input
                type="text"
                value={workingHours}
                onChange={(e) => setWorkingHours(e.target.value)}
                placeholder="09:00 - 20:00"
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-sky-600" />
                <span>{language === 'kz' ? 'Баға аралығы' : 'Диапазон цен'}</span>
              </label>
              <input
                type="text"
                value={priceRange}
                onChange={(e) => setPriceRange(e.target.value)}
                placeholder="5 000 – 15 000 ₸"
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-sky-600" />
              <span>{t.providerDescField}</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={language === 'kz' ? 'Тәжірибеңіз, құралдарыңыз және артықшылықтарыңыз туралы...' : 'Опыт, гарантия, выезд, инструменты...'}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white resize-none transition-colors"
            />
          </div>

          {/* Phase 3: Trust & Verification Section */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-600" />
                <span>{t.certificateFieldLabel}</span>
              </label>
              <input
                type="text"
                value={tradeLicense}
                onChange={(e) => setTradeLicense(e.target.value)}
                placeholder="CERT-2026-X89"
                className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handlePrev}
              className="min-h-[50px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-bold text-sm flex items-center justify-center gap-1 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
              <span>{t.btnPrevStep}</span>
            </button>

            <button
              type="button"
              onClick={handleNext}
              className="flex-1 min-h-[50px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-sky-600/20 flex items-center justify-center gap-2 transition-all"
            >
              <span>{t.btnNextStep}</span>
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Profile Preview & Confirmation */}
      {currentStep === 4 && (
        <div className="space-y-4">
          {/* Preview Banner */}
          <div className="p-3.5 bg-sky-50 border border-sky-100 rounded-2xl flex items-center gap-2.5 text-xs text-sky-900">
            <Sparkles className="w-4 h-4 text-sky-600 shrink-0" />
            <p className="font-medium leading-relaxed">
              {t.onboardingPreviewBanner}
            </p>
          </div>

          {/* Interactive Preview Card (Customer-facing View) */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-13 h-13 rounded-2xl bg-sky-600 text-white font-extrabold text-xl flex items-center justify-center shadow-md shadow-sky-600/20 font-display">
                  {(previewProvider.name || 'M').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 font-display">
                      {previewProvider.name}
                    </h3>
                    {previewProvider.verified && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                        <span>{t.verifiedProviderBadge}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 font-medium">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {previewProvider.city}
                      {previewProvider.district ? ` · ${previewProvider.district}` : ''}
                    </span>
                  </p>
                </div>
              </div>

              {/* View Full Modal Button */}
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 transition-colors"
                title={t.viewProviderProfile}
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <span>{language === 'kz' ? 'Анкета' : 'Анкета'}</span>
              </button>
            </div>

            {/* Experience & Category */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  {t.fieldCategory}
                </span>
                <p className="font-bold text-slate-800 truncate">
                  {previewProvider.category}
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-sky-50/70 border border-sky-100 space-y-0.5">
                <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider block">
                  {language === 'kz' ? 'Тәжірибе' : 'Стаж работы'}
                </span>
                <p className="font-bold text-sky-950">
                  {previewProvider.experienceYears
                    ? `${previewProvider.experienceYears} ${t.experienceYearsUnit}`
                    : language === 'kz' ? 'Көрсетілмеген' : 'Не указан'}
                </p>
              </div>
            </div>

            {/* Services */}
            {previewProvider.services && (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {t.servicesProvided}
                </span>
                <p className="text-slate-800 font-medium leading-relaxed">
                  {previewProvider.services}
                </p>
              </div>
            )}

            {/* Working Hours & Price */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-0.5">
                <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {language === 'kz' ? 'Жұмыс уақыты' : 'График'}
                </span>
                <p className="font-bold text-slate-800">
                  {previewProvider.workingHours}
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-0.5">
                <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                  <Wallet className="w-3 h-3" />
                  {language === 'kz' ? 'Бағасы' : 'Стоимость'}
                </span>
                <p className="font-bold text-sky-800">
                  {previewProvider.priceRange}
                </p>
              </div>
            </div>

            {/* Bio */}
            {previewProvider.description && (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {t.aboutProvider}
                </span>
                <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                  {previewProvider.description}
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handlePrev}
              className="min-h-[50px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-bold text-sm flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
              <span>{t.btnPrevStep}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="flex-1 min-h-[50px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{language === 'kz' ? 'Сақталуда...' : 'Сохранение...'}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{initialProvider ? t.updateProfileBtn : t.btnPublishProfile}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Full Customer-Facing Preview Modal */}
      <ProviderProfileModal
        provider={previewProvider}
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        language={language}
      />
    </div>
  );
};
