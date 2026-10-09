import React, { useState, useEffect } from 'react';
import {
  formatDynamicBudget,
  formatDynamicDate,
  formatOfferDisplayPrice,
  Language,
  OfferPriceType,
  Provider,
  ProviderOffer,
  Review,
  ServiceRequest,
} from '../types';
import { translations } from '../i18n/translations';
import { repository, getCurrentUserId, checkClientRateLimit, getFriendlyErrorMessage } from '../services';
import { auth } from '../services/firebase';
import { ALL_CITIES_LIST, CATEGORIES_LIST } from '../services/analyzer';
import {
  getCategoryDisplayName,
  getCityDisplayName,
  normalizeCategoryId,
  normalizeCityId,
} from '../services/taxonomy';
import { ProviderProfileModal } from './ProviderProfileModal';
import { ProviderOnboarding } from './ProviderOnboarding';
import { ChatScreen } from './ChatScreen';
import { AppointmentSection } from './AppointmentSection';
import { RequestMediaView } from './RequestMediaView';
import {
  Briefcase,
  CheckCircle,
  MapPin,
  Calendar,
  Send,
  X,
  Edit3,
  Flame,
  ThumbsDown,
  Clock,
  Wallet,
  Star,
  UserCheck,
  MessageSquare,
  ShieldCheck,
  Award,
} from 'lucide-react';

interface ProviderModeScreenProps {
  language: Language;
  onOfferSent?: () => void;
  onProfileCreated?: () => void;
}

function isSelfRequest(
  req: ServiceRequest | null,
  prov: Provider | null,
  isAnonymousSession: boolean
): boolean {
  if (!prov || !req) return false;
  // 1. Phone number match: definitely same person across any session
  const pPhone = (prov.phone || '').replace(/\D/g, '');
  const cPhone = (req.customerPhone || '').replace(/\D/g, '');
  if (pPhone && cPhone && pPhone === cPhone) {
    return true;
  }
  // 2. Real (non-anonymous) authenticated accounts: strict UID ownership
  if (!isAnonymousSession && req.customerId) {
    if (req.customerId === prov.id || req.customerId === prov.userId) {
      return true;
    }
  }
  return false;
}

export const ProviderModeScreen: React.FC<ProviderModeScreenProps> = ({
  language,
  onOfferSent,
  onProfileCreated,
}) => {
  const t = translations[language];

  // Provider profile state
  const [provider, setProvider] = useState<Provider | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isProfilePreviewOpen, setIsProfilePreviewOpen] = useState(false);
  const [providerReviews, setProviderReviews] = useState<Review[]>([]);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(null);

  // Registration Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [city, setCity] = useState(
    language === 'kz' ? 'Қызылорда' : language === 'tr' ? 'Kızılorda' : 'Кызылорда'
  );
  const [district, setDistrict] = useState(
    language === 'kz' ? 'Орталық' : language === 'tr' ? 'Merkez' : 'Центр'
  );
  const [category, setCategory] = useState(
    language === 'kz'
      ? 'Тұрмыстық техника жөндеу'
      : language === 'tr'
      ? 'Beyaz Eşya Tamiri'
      : 'Ремонт бытовой техники'
  );
  const [services, setServices] = useState('Ремонт стиральных машин, бойлеров');
  const [priceRange, setPriceRange] = useState('от 8 000 ₸');
  const [workingHours, setWorkingHours] = useState('09:00 - 20:00');
  const [experienceYears, setExperienceYears] = useState('5');
  const [description, setDescription] = useState('Мастер с опытом работы более 5 лет.');

  // Requests state (Matching provider's profile)
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [dismissedReqIds, setDismissedReqIds] = useState<string[]>([]);
  const [sentOffersMap, setSentOffersMap] = useState<Record<string, ProviderOffer>>({});

  // Offer modal state
  const [selectedRequestForOffer, setSelectedRequestForOffer] =
    useState<ServiceRequest | null>(null);
  const [offerPriceType, setOfferPriceType] = useState<OfferPriceType>('fixed');
  const [offerPriceAmount, setOfferPriceAmount] = useState('15 000');
  const [offerTime, setOfferTime] = useState(
    language === 'kz'
      ? 'Бүгін, 40 минут ішінде'
      : language === 'tr'
      ? 'Bugün, 40 dakika içinde'
      : 'Сегодня, в течение 40 минут'
  );
  const [offerMessage, setOfferMessage] = useState(
    language === 'kz'
      ? 'Құралдарым дайын, келіп сапалы жөндеп беремін.'
      : language === 'tr'
      ? 'Takımlarım hazır, gelip kaliteli şekilde tamir ederim.'
      : 'Готов подъехать со своим инструментом, дам гарантию на работу.'
  );
  const [notification, setNotification] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePriceAmountChange = (val: string) => {
    const digitsOnly = val.replace(/[^\d]/g, '');
    if (!digitsOnly) {
      setOfferPriceAmount('');
      return;
    }
    const spaced = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    setOfferPriceAmount(spaced);
  };

  // Load provider profile and matching requests
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      const uid = getCurrentUserId();
      // Look up current authenticated user's provider profile directly by UID
      let myProv = await repository.getProvider(uid);
      if (!myProv || myProv.isDemo) {
        // Fallback: search custom providers matching user's UID or existing profile
        const allProviders = await repository.getProviders();
        myProv = allProviders.find((p) => !p.isDemo && (p.id === uid || p.userId === uid)) || null;
      }

      if (myProv) {
        if (isMounted) {
          setProvider(myProv);
          setName(myProv.name);
          setPhone(myProv.phone);
          setWhatsapp(myProv.whatsapp);
          setCity(myProv.city);
          setDistrict(myProv.district);
          setCategory(myProv.category);
          setServices(myProv.services);
          setPriceRange(myProv.priceRange);
          setWorkingHours(myProv.workingHours);
          setExperienceYears(
            myProv.experienceYears !== undefined && myProv.experienceYears !== null
              ? String(myProv.experienceYears)
              : ''
          );
          setDescription(myProv.description);
        }

        // REQUEST SECURITY: Provider should only see requests matching their provider profile!
        // City and category match (canonical cityId & categoryId bridge languages)
        const matchingRequests = await repository.getRequests({
          city: myProv.city,
          cityId: myProv.cityId || normalizeCityId(myProv.city),
          category: myProv.category,
          categoryId: myProv.categoryId || normalizeCategoryId(myProv.category),
        });

        // Load existing offers sent by this provider
        const myOffers = await repository.getOffers({
          providerId: myProv.id,
          providerUserId: myProv.userId || myProv.id,
        });
        const offersMap: Record<string, ProviderOffer> = {};
        myOffers.forEach((o) => {
          offersMap[o.requestId] = o;
        });

        // Ensure all requests that this provider has submitted offers for are included!
        const offeredReqIds = Object.keys(offersMap);
        const existingReqIds = new Set(matchingRequests.map((r) => r.id));
        const missingReqPromises = offeredReqIds
          .filter((id) => !existingReqIds.has(id))
          .map(async (id) => {
            const fetched = await repository.getRequest(id);
            if (fetched) return fetched;
            // Fallback shell from existing offer if getRequest returns null (e.g. permission-denied fallback)
            const off = offersMap[id];
            if (off) {
              const fallbackReq: ServiceRequest = {
                id,
                customerId: '',
                customerName: language === 'kz' ? 'Клиент' : 'Клиент',
                requestText: off.message || (language === 'kz' ? 'Өтініш' : 'Заявка клиента'),
                service: language === 'kz' ? 'Тапсырыс' : 'Услуга',
                city: myProv.city,
                cityId: myProv.cityId,
                category: myProv.category,
                categoryId: myProv.categoryId,
                date: language === 'kz' ? 'Бүгін' : 'Сегодня',
                budget: off.price,
                urgency: 'normal',
                status: off.status === 'ACCEPTED' ? 'PROVIDER_SELECTED' : 'OPEN',
                createdAt: off.createdAt || new Date().toISOString(),
                selectedOfferId: off.status === 'ACCEPTED' ? off.id : undefined,
              };
              return fallbackReq;
            }
            return null;
          });

        const missingReqs = (await Promise.all(missingReqPromises)).filter(
          (r): r is ServiceRequest => r !== null
        );

        const combinedRequests = [...matchingRequests, ...missingReqs];

        if (isMounted) {
          setRequests(combinedRequests);
          setSentOffersMap(offersMap);
        }

        try {
          const revs = await repository.getReviews({ providerId: myProv.id });
          if (isMounted) setProviderReviews(revs);
        } catch {}
      } else {
        if (isMounted) {
          setIsEditingProfile(true);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Save profile via repository
  const handleSaveProfileData = async (providerData: Partial<Provider>) => {
    if (!checkClientRateLimit('save_provider_profile', 800)) return;

    try {
      const uid = getCurrentUserId();
      // Provider document ID is strictly the user's Auth UID
      const providerId = uid;
      const targetCategory = (providerData.category || category).trim();
      const targetCity = (providerData.city || city).trim();
      const catId = normalizeCategoryId(targetCategory);
      const cId = normalizeCityId(targetCity);

      let expYears: number | undefined = undefined;
      if (providerData.experienceYears !== undefined && providerData.experienceYears !== null) {
        expYears = Number(providerData.experienceYears);
      }

      // Important Rule 3: verified cannot be self-granted by new provider!
      // New provider registration starts with verified: false.
      // If editing an existing provider, preserve their existing verified status.
      const isAlreadyVerified = provider?.verified ?? false;

      const savedProvider = await repository.createProvider({
        id: providerId,
        userId: uid,
        name: (providerData.name || '').trim(),
        phone: (providerData.phone || '').trim(),
        whatsapp: (providerData.whatsapp || providerData.phone || '').trim(),
        city: targetCity,
        cityId: cId,
        district: (providerData.district || '').trim(),
        category: targetCategory,
        categoryId: catId,
        services: (providerData.services || '').trim(),
        priceRange: (providerData.priceRange || '').trim(),
        workingHours: (providerData.workingHours || '').trim() || '09:00 - 20:00',
        experienceYears: expYears,
        description: (providerData.description || '').trim(),
        verified: isAlreadyVerified, // Secure: false for new providers!
        isDemo: false,
      });

      setProvider(savedProvider);
      setIsEditingProfile(false);

      if (onProfileCreated) {
        onProfileCreated();
      }

      // Refresh matching requests for this updated profile, preserving any previously offered requests
      const matchingRequests = await repository.getRequests({
        city: savedProvider.city,
        cityId: savedProvider.cityId || cId,
        category: savedProvider.category,
        categoryId: savedProvider.categoryId || catId,
      });
      setRequests((prev) => {
        const existingOffered = prev.filter((r) => sentOffersMap[r.id]);
        const map = new Map<string, ServiceRequest>();
        matchingRequests.forEach((r) => map.set(r.id, r));
        existingOffered.forEach((r) => {
          if (!map.has(r.id)) map.set(r.id, r);
        });
        return Array.from(map.values());
      });
    } catch (err) {
      setErrorMessage(getFriendlyErrorMessage(err, language));
      setTimeout(() => setErrorMessage(null), 4000);
      throw err;
    }
  };

  // Provider clicks "Могу выполнить"
  const handleOpenOfferModal = (req: ServiceRequest) => {
    setSelectedRequestForOffer(req);
    setOfferPriceType('fixed');
    setOfferPriceAmount('15 000');
    setOfferTime(language === 'kz' ? 'Бүгін, 40 минут ішінде' : 'Сегодня, в течение 40 минут');
    setOfferMessage(
      language === 'kz'
        ? 'Құралдарым дайын, келіп сапалы жөндеп беремін.'
        : 'Готов подъехать со своим инструментом, дам гарантию на работу.'
    );
  };

  // Provider clicks "Не могу"
  const handleDismissRequest = (reqId: string) => {
    setDismissedReqIds((prev) => [...prev, reqId]);
  };

  // Submit Offer via repository
  const handleSendOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequestForOffer || !provider) return;

    if (!checkClientRateLimit(`send_offer_${selectedRequestForOffer.id}`, 800)) return;

    const isAnonymousSession = Boolean(
      !auth?.currentUser ||
      auth.currentUser.isAnonymous ||
      getCurrentUserId().startsWith('usr-') ||
      getCurrentUserId() === 'temp-local-user-id'
    );
    if (isSelfRequest(selectedRequestForOffer, provider, isAnonymousSession)) {
      setErrorMessage(
        language === 'kz'
          ? 'Өз өтінішіңізге ұсыныс жібере алмайсыз'
          : language === 'tr'
          ? 'Kendi talebinize teklif gönderemezsiniz'
          : 'Вы не можете отправлять предложение на свою собственную заявку'
      );
      return;
    }

    try {
      let finalPrice = '';
      if (offerPriceType === 'inspection') {
        finalPrice =
          language === 'kz'
            ? 'Қарап көрген соң'
            : language === 'tr'
            ? 'Keşif sonrası'
            : 'После осмотра';
      } else {
        const digits = offerPriceAmount.replace(/[^\d]/g, '');
        if (!digits) {
          setErrorMessage(
            language === 'kz'
              ? 'Бағасын көрсетіңіз'
              : language === 'tr'
              ? 'Fiyat belirtin'
              : 'Укажите примерную стоимость'
          );
          return;
        }
        const spaced = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        if (offerPriceType === 'from') {
          finalPrice = `от ${spaced} ₸`;
        } else {
          finalPrice = `${spaced} ₸`;
        }
      }

      const newOffer = await repository.createOffer({
        requestId: selectedRequestForOffer.id,
        providerId: provider.id,
        providerName: provider.name,
        providerPhone: provider.phone,
        providerWhatsapp: provider.whatsapp,
        isDemo: false,
        price: finalPrice,
        priceType: offerPriceType,
        availability: offerTime.trim(),
        message: offerMessage.trim(),
        status: 'PENDING',
        iinVerified: provider.iinVerified,
        hasCertificate: provider.hasCertificate,
      });

      // Update sent offers mapping
      setSentOffersMap((prev) => ({
        ...prev,
        [selectedRequestForOffer.id]: newOffer,
      }));

      // Ensure the request is always present in requests feed
      setRequests((prev) => {
        if (!prev.some((r) => r.id === selectedRequestForOffer.id)) {
          return [selectedRequestForOffer, ...prev];
        }
        return prev;
      });

      setSelectedRequestForOffer(null);

      setNotification(t.offerSentSuccess);
      setTimeout(() => setNotification(null), 3500);

      if (onOfferSent) onOfferSent();
    } catch (err) {
      setErrorMessage(getFriendlyErrorMessage(err, language));
      setTimeout(() => setErrorMessage(null), 4000);
    }
  };

  // Filter requests that are active and not dismissed, matching provider's canonical profile
  const pCityId = provider?.cityId || (provider?.city ? normalizeCityId(provider.city) : '');
  const pCatId = provider?.categoryId || (provider?.category ? normalizeCategoryId(provider.category) : '');

  const isAnonymousSession = Boolean(
    !auth?.currentUser ||
    auth.currentUser.isAnonymous ||
    getCurrentUserId().startsWith('usr-') ||
    getCurrentUserId() === 'temp-local-user-id'
  );

  const visibleRequests = requests.filter((r) => {
    if (dismissedReqIds.includes(r.id) || r.status === 'CANCELLED') return false;
    // If an offer was already sent to this request, always keep it visible in provider feed
    if (sentOffersMap[r.id]) {
      return true;
    }
    // Providers cannot bid on their own genuine customer requests
    if (isSelfRequest(r, provider, isAnonymousSession)) {
      return false;
    }
    if (pCityId && pCatId) {
      const rCityId = r.cityId || normalizeCityId(r.city);
      const rCatId = r.categoryId || normalizeCategoryId(r.category);
      if (rCityId !== pCityId || rCatId !== pCatId) return false;
    }
    return true;
  });

  if (activeChatRequestId) {
    return (
      <div className="w-full max-w-xl mx-auto px-0 sm:px-4 py-2 sm:py-5">
        <ChatScreen
          requestId={activeChatRequestId}
          language={language}
          onBack={() => setActiveChatRequestId(null)}
          userRole="provider"
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-5">
      <div className="space-y-4">
        {/* Banner notification */}
        {notification && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs font-semibold text-emerald-900 flex items-center gap-2 shadow-xs animate-fadeIn">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{notification}</span>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-300 rounded-2xl text-xs font-semibold text-rose-900 flex items-center justify-between shadow-xs animate-fadeIn">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-rose-500 font-bold px-1">
              ✕
            </button>
          </div>
        )}

        {/* 1. Provider Onboarding & Profile Editing Flow */}
        {isEditingProfile ? (
          <ProviderOnboarding
            language={language}
            initialProvider={provider}
            onSave={handleSaveProfileData}
            onCancel={provider ? () => setIsEditingProfile(false) : undefined}
          />
        ) : (
          /* 2. Provider Dashboard */
          <div className="space-y-4">
            {/* Provider Profile Summary Header */}
            {provider && (
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                      {t.providerDashboardTitle}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <h3 className="text-base font-bold text-slate-900">
                        {provider.name}
                      </h3>
                      {provider.verified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full" title={t.verifiedProviderBadge}>
                          <CheckCircle className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                          <span>{t.verifiedProviderBadge}</span>
                        </span>
                      )}
                      {provider.iinVerified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full" title={t.iinVerifiedBadge}>
                          <ShieldCheck className="w-3 h-3 text-sky-600 stroke-[2.5]" />
                          <span>{t.iinVerifiedBadge}</span>
                        </span>
                      )}
                      {provider.hasCertificate && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded-full" title={t.certifiedMasterBadge}>
                          <Award className="w-3 h-3 text-purple-600 stroke-[2.5]" />
                          <span>{t.certifiedMasterBadge}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {getCityDisplayName(provider.cityId || provider.city, language) || provider.city}{' '}
                      {provider.district ? `· ${provider.district}` : ''}
                    </p>
                  </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsProfilePreviewOpen(true)}
                        className="min-h-[36px] px-2.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                        title={
                          language === 'kz'
                            ? 'Профильді көру'
                            : language === 'tr'
                            ? 'Profili Görüntüle'
                            : 'Посмотреть профиль'
                        }
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>
                          {language === 'kz'
                            ? 'Профиль'
                            : language === 'tr'
                            ? 'Profil'
                            : 'Профиль'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsEditingProfile(true)}
                        className="min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>
                          {language === 'kz'
                            ? 'Өңдеу'
                            : language === 'tr'
                            ? 'Düzenle'
                            : 'Изменить'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {providerReviews.length > 0 && (
                    <div className="pt-1.5 flex items-center gap-2">
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                        <span>
                          {(providerReviews.reduce((a, b) => a + (Number(b.rating) || 0), 0) / providerReviews.length).toFixed(1)} / 5 ({providerReviews.length} {t.reviewsCountUnit})
                        </span>
                      </div>
                    </div>
                  )}

                <div className="text-xs text-slate-600 pt-1 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <strong className="text-slate-700">ID:</strong> {provider.id}
                  </span>
                  <span>
                    <strong className="text-slate-700">
                      {language === 'kz'
                        ? 'Санат:'
                        : language === 'tr'
                        ? 'Kategori:'
                        : 'Категория:'}
                    </strong>{' '}
                    {getCategoryDisplayName(provider.categoryId || provider.category, language) || provider.category}
                  </span>
                  <span>
                    <strong className="text-slate-700">
                      {language === 'kz'
                        ? 'Уақыты:'
                        : language === 'tr'
                        ? 'Saat:'
                        : 'Время:'}
                    </strong>{' '}
                    {provider.workingHours}
                  </span>
                  {provider.experienceYears !== undefined && provider.experienceYears > 0 && (
                    <span>
                      <strong className="text-slate-700">
                        {language === 'kz'
                          ? 'Тәжірибе:'
                          : language === 'tr'
                          ? 'Deneyim:'
                          : 'Опыт:'}
                      </strong>{' '}
                      {provider.experienceYears} {t.experienceYearsUnit}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* "Новые заявки" Header */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 tracking-tight font-display">
                  {t.newRequestsHeader}
                </h3>
                <p className="text-xs text-slate-500">
                  {visibleRequests.length}{' '}
                  {language === 'kz'
                    ? 'сәйкес өтініш табылды'
                    : language === 'tr'
                    ? 'uygun talep bulundu'
                    : 'подходящих заявок'}
                </p>
              </div>
            </div>

            {/* Requests Feed - Spec:
                Show: Request ID, Service, City, Date, Budget, Urgency, Customer request text.
                Do NOT expose customer's phone number yet. */}
            {visibleRequests.length === 0 ? (
              <div className="p-8 bg-white rounded-3xl border border-dashed border-slate-300 text-center space-y-3">
                <Clock className="w-10 h-10 text-slate-400 mx-auto" />
                <h4 className="text-sm font-bold text-slate-800">
                  {t.noMatchingRequests}
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  {language === 'kz'
                    ? 'Сіздің қалаңыз бен санатыңызға сәйкес клиент сұраныс берген бойда, осы жерде ұсыныс жасау түймесі шығады.'
                    : language === 'tr'
                    ? 'Şehrinizde ve kategorinizde yeni bir talep açıldığında burada anında fiyat ve varış süresi teklifi gönderebilirsiniz.'
                    : 'Когда клиенты оформят заявку в вашем городе и категории, вы сможете моментально отправить им цену и время выезда.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRequests.map((req) => {
                  const existingOffer = sentOffersMap[req.id];

                  return (
                    <div
                      key={req.id}
                      className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3"
                    >
                      {/* Spec: Request ID, Urgency, Service */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                              {req.id}
                            </span>
                            {req.urgency === 'high' && (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Flame className="w-3 h-3 text-amber-600" />
                                {t.urgencyHigh}
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 mt-1">
                            {req.service}
                          </h4>
                        </div>

                        {/* Spec: Budget */}
                        {req.budget && (
                          <div className="text-right">
                            <span className="text-xs text-slate-400 block">
                              {t.fieldBudget}
                            </span>
                            <span className="text-xs font-bold text-sky-700">
                              {formatDynamicBudget(req.budget, language)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Spec: Customer Request Text (Private: customer phone NOT exposed) */}
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 italic">
                        «{req.requestText}»
                      </div>

                      {/* Spec: City, Date */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-sky-600" />
                          {getCityDisplayName(req.cityId || req.city, language) || req.city}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-sky-600" />
                          {formatDynamicDate(req.date, language)}
                        </span>
                      </div>

                      {/* Request 2.0 Media Attachments & Location for Provider */}
                      {Boolean(req.attachments?.length || req.location) && (
                        <div className="pt-1 border-t border-slate-100">
                          <RequestMediaView
                            attachments={req.attachments}
                            location={req.location}
                            language={language}
                          />
                        </div>
                      )}

                      {/* Provider Actions: "Могу выполнить" & "Не могу" */}
                      <div className="pt-2 border-t border-slate-100">
                        {existingOffer ? (
                          <div className="space-y-2">
                            {/* Kaspi Escrow Notification for Provider */}
                            {(req.paymentStatus === 'held_in_escrow' || existingOffer.paymentStatus === 'held_in_escrow') && (
                              <div className="p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-2 text-xs font-bold text-emerald-900 shadow-2xs">
                                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span>
                                  {language === 'kz'
                                    ? 'Төлем Kaspi кепілдік қорында бұғатталды. Жұмысқа сенімді кірісе аласыз.'
                                    : language === 'tr'
                                    ? 'Ödeme Kaspi havuzunda kilitlendi. İşe güvenle başlayabilirsiniz.'
                                    : 'Оплата заблокирована в резерве Kaspi. Можете смело приступать к работе.'}
                                </span>
                              </div>
                            )}

                            <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                                <span>{t.alreadySentOffer}</span>
                              </div>
                              <span className="font-mono text-emerald-900 font-bold">
                                {formatOfferDisplayPrice(existingOffer, language)}
                              </span>
                            </div>

                            {(existingOffer.status === 'ACCEPTED' ||
                              req.selectedOfferId === existingOffer.id ||
                              req.status === 'PROVIDER_SELECTED' ||
                              req.status === 'IN_PROGRESS' ||
                              req.status === 'COMPLETED') && (
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveChatRequestId(req.id)}
                                  className="w-full min-h-[42px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                  <span>{t.chatWithCustomerBtn}</span>
                                </button>

                                <AppointmentSection
                                  request={req}
                                  selectedOffer={existingOffer}
                                  currentRole="provider"
                                  language={language}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenOfferModal(req)}
                              className="min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{t.btnCanFulfill}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDismissRequest(req.id)}
                              className="min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-all"
                            >
                              <ThumbsDown className="w-3.5 h-3.5 text-slate-500" />
                              <span>{t.btnCannotFulfill}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Offer Modal ("Могу выполнить" Form: Price, Arrival/completion time, Message) */}
      {selectedRequestForOffer && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
                  {selectedRequestForOffer.id}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {t.sendOfferModalTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequestForOffer(null)}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendOffer} className="space-y-3">
              {/* Target request snippet */}
              <div className="p-2.5 bg-slate-50 rounded-xl text-xs text-slate-600">
                <span className="font-bold text-slate-800 block">
                  {selectedRequestForOffer.service} (
                  {getCityDisplayName(
                    selectedRequestForOffer.cityId || selectedRequestForOffer.city,
                    language
                  ) || selectedRequestForOffer.city}
                  )
                </span>
                <span className="italic line-clamp-1 mt-0.5 block">
                  «{selectedRequestForOffer.requestText}»
                </span>
              </div>

              {/* Price Type Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  {t.priceTypeLabel}
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setOfferPriceType('fixed')}
                    className={`py-2 px-1 text-center rounded-lg text-xs font-bold transition-all ${
                      offerPriceType === 'fixed'
                        ? 'bg-white text-sky-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.priceType_fixed}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOfferPriceType('from')}
                    className={`py-2 px-1 text-center rounded-lg text-xs font-bold transition-all ${
                      offerPriceType === 'from'
                        ? 'bg-white text-sky-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.priceType_from}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOfferPriceType('inspection')}
                    className={`py-2 px-1 text-center rounded-lg text-xs font-bold transition-all ${
                      offerPriceType === 'inspection'
                        ? 'bg-white text-sky-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.priceType_inspection}
                  </button>
                </div>
              </div>

              {/* Price Input or Inspection Notice */}
              {offerPriceType !== 'inspection' ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {offerPriceType === 'from' ? t.fromPriceFieldLabel : t.fixedPriceFieldLabel}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={offerPriceAmount}
                      onChange={(e) => handlePriceAmountChange(e.target.value)}
                      placeholder="15 000"
                      className="w-full h-11 pl-3 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">
                      ₸
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium leading-relaxed">
                  {t.inspectionNotice}
                </div>
              )}

              {/* Arrival / Completion Time */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {t.offerTimeField}
                </label>
                <input
                  type="text"
                  required
                  value={offerTime}
                  onChange={(e) => setOfferTime(e.target.value)}
                  placeholder={t.offerTimePlaceholder}
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white"
                />
              </div>

              {/* Message */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {t.offerMessageField}
                </label>
                <textarea
                  rows={2}
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder={t.offerMessagePlaceholder}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-sky-500 focus:bg-white resize-none"
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-sky-600/20 transition-all flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>{t.btnSendOffer}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Provider Profile Preview Modal */}
      {provider && (
        <ProviderProfileModal
          provider={provider}
          isOpen={isProfilePreviewOpen}
          onClose={() => setIsProfilePreviewOpen(false)}
          language={language}
        />
      )}
    </div>
  );
};
