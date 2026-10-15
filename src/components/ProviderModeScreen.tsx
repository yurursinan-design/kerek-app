import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ReportButton } from './ReportButton';
import {
  formatDynamicBudget,
  formatDynamicDate,
  formatOfferDisplayPrice,
  Language,
  normalizeRequestStatus,
  OFFER_PAYMENT_METHODS,
  OfferPaymentMethod,
  OfferPriceType,
  paymentMethodLabel,
  Provider,
  ProviderOffer,
  ServiceRequest,
} from '../types';
import { translations } from '../i18n/translations';
import { getRequestDescription, getRequestTitle } from '../services/requestTitle';
import { repository, getCurrentUserId, checkClientRateLimit, getFriendlyErrorMessage, notificationService } from '../services';
import { isDebugMode } from '../services/debug';
import { auth } from '../services/firebase';
import {
  getCategoryDisplayName,
  getCityDisplayName,
  normalizeCategoryId,
  normalizeCityId,
  isCategoryMatch,
} from '../services/taxonomy';
import { ProviderProfileModal } from './ProviderProfileModal';
import { ProviderOnboarding } from './ProviderOnboarding';
import { ChatScreen } from './ChatScreen';
import { AppointmentSection } from './AppointmentSection';
import { RequestMediaView } from './RequestMediaView';
import { getGroup, groupName, providerGroupIds } from '../data/serviceCatalog';
import { Emoji3D } from './CategoryIcon';
import { RequestIcon } from './RequestIcon';
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
} from 'lucide-react';
import { requestWhenLabel } from '../services/dateFormat';

export type ProviderTab = 'new' | 'offers' | 'active';

interface ProviderModeScreenProps {
  language: Language;
  onOfferSent?: () => void;
  onProfileCreated?: () => void;
  /** When given, the tab is chosen from outside (the bottom navigation) and the inner tab bar is hidden */
  tab?: ProviderTab;
  onTabChange?: (tab: ProviderTab) => void;
  /** Reports how many items each tab holds, for badges in the bottom navigation */
  onCountsChange?: (counts: Record<ProviderTab, number>) => void;
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

// The master's usual offer extras, kept on this phone so the next offer starts with them
const OFFER_PREFS_KEY = 'kerek_offer_prefs';
function loadOfferPrefs(): { paymentMethods: OfferPaymentMethod[]; fixPledge: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFER_PREFS_KEY) || 'null');
    const methods = Array.isArray(raw?.paymentMethods)
      ? (raw.paymentMethods as unknown[]).filter((m): m is OfferPaymentMethod => OFFER_PAYMENT_METHODS.includes(m as OfferPaymentMethod))
      : [];
    return { paymentMethods: methods.length ? methods : [...OFFER_PAYMENT_METHODS], fixPledge: raw?.fixPledge === true };
  } catch {
    return { paymentMethods: [...OFFER_PAYMENT_METHODS], fixPledge: false };
  }
}
function saveOfferPrefs(prefs: { paymentMethods: OfferPaymentMethod[]; fixPledge: boolean }) {
  try {
    localStorage.setItem(OFFER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode or full storage: the choice just isn't remembered
  }
}

export const ProviderModeScreen: React.FC<ProviderModeScreenProps> = ({
  language,
  onOfferSent,
  onProfileCreated,
  tab,
  onTabChange,
  onCountsChange,
}) => {
  const t = translations[language];

  // Provider profile state
  const [provider, setProvider] = useState<Provider | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isProfilePreviewOpen, setIsProfilePreviewOpen] = useState(false);
  const [providerRating, setProviderRating] = useState<{ avg: number; count: number }>({ avg: 0, count: 0 });
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(null);

  // Profile fallbacks used when saving
  const [city, setCity] = useState(
    language === 'kz' ? 'Қызылорда' : 'Кызылорда'
  );
  const [category, setCategory] = useState(
    language === 'kz'
      ? 'Тұрмыстық техника жөндеу'
      : 'Ремонт бытовой техники'
  );

  // Open requests of the provider's city (live feed) and, watched one by one, the requests the
  // provider has offered on (a job they were chosen for is no longer in the open feed)
  const [feedRequests, setFeedRequests] = useState<ServiceRequest[]>([]);
  const [offeredRequests, setOfferedRequests] = useState<Record<string, ServiceRequest>>({});
  const requests = useMemo(() => {
    const merged = new Map<string, ServiceRequest>();
    feedRequests.forEach((r) => merged.set(r.id, r));
    Object.values(offeredRequests).forEach((r) => merged.set(r.id, r));
    return Array.from(merged.values());
  }, [feedRequests, offeredRequests]);
  const patchRequest = (id: string, patch: Partial<ServiceRequest>) => {
    setFeedRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setOfferedRequests((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  };
  const [dismissedReqIds, setDismissedReqIds] = useState<string[]>([]);
  const [sentOffersMap, setSentOffersMap] = useState<Record<string, ProviderOffer>>({});
  // Same map for the live request feed, which keeps one subscription for the whole screen
  const offersMapRef = useRef<Record<string, ProviderOffer>>({});
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    offersMapRef.current = sentOffersMap;
  }, [sentOffersMap]);

  // How the master takes payment and whether they give the 14-day free-fix pledge: remembered for the next offer
  const [offerPayments, setOfferPayments] = useState<OfferPaymentMethod[]>(() => loadOfferPrefs().paymentMethods);
  const [offerFixPledge, setOfferFixPledge] = useState<boolean>(() => loadOfferPrefs().fixPledge);

  // Offer modal state
  const [selectedRequestForOffer, setSelectedRequestForOffer] =
    useState<ServiceRequest | null>(null);
  const [offerPriceType, setOfferPriceType] = useState<OfferPriceType>('fixed');
  const [offerPriceAmount, setOfferPriceAmount] = useState('');
  const [offerTime, setOfferTime] = useState(
    language === 'kz'
      ? 'Бүгін, 40 минут ішінде'
      : 'Сегодня, в течение 40 минут'
  );
  const [offerMessage, setOfferMessage] = useState(
    language === 'kz'
      ? 'Құралдарым дайын, келіп сапалы жөндеп беремін.'
      : 'Готов подъехать со своим инструментом, дам гарантию на работу.'
  );
  // Tab state & Action loading
  const [internalTab, setInternalTab] = useState<ProviderTab>('new');
  const activeTab: ProviderTab = tab ?? internalTab;
  const setActiveTab = (next: ProviderTab) => (onTabChange ? onTabChange(next) : setInternalTab(next));
  const [actionLoadingReqId, setActionLoadingReqId] = useState<string | null>(null);

  const [notification, setNotification] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const requestsUnsubscribeRef = useRef<(() => void) | null>(null);
  const requestWatchersRef = useRef(new Map<string, () => void>());

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
    let stopOffers: (() => void) | null = null;
    const watchers = requestWatchersRef.current;

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
          setCity(myProv.city);
          setCategory(myProv.category);
        }

        // The provider's offers, live: an accepted or declined offer shows at once, and each
        // offered request is watched so a job the customer completes or cancels updates here
        if (!isMounted) return;
        stopOffers?.();
        stopOffers = repository.subscribeToOffers(
          { providerId: myProv.id, providerUserId: myProv.userId || myProv.id },
          (myOffers) => {
            if (!isMounted) return;
            const offersMap: Record<string, ProviderOffer> = {};
            myOffers.forEach((o) => {
              offersMap[o.requestId] = o;
            });
            offersMapRef.current = offersMap;
            setSentOffersMap(offersMap);
            syncRequestWatchers(offersMap);
          }
        );

        startRequestFeed(myProv, () => isMounted);

        try {
          const rating = await repository.getRatingSummary([myProv.id, myProv.userId || '']);
          if (isMounted) setProviderRating(rating);
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
      if (requestsUnsubscribeRef.current) {
        requestsUnsubscribeRef.current();
        requestsUnsubscribeRef.current = null;
      }
      stopOffers?.();
      watchers.forEach((stop) => stop());
      watchers.clear();
    };
  }, []);

  // One live watcher per offered request (declined offers lead nowhere and are not watched).
  // A request the provider can no longer read (another provider chosen, closed) drops out;
  // nothing is made up in its place.
  const syncRequestWatchers = (offersMap: Record<string, ProviderOffer>) => {
    const wanted = new Set(Object.keys(offersMap).filter((id) => offersMap[id]?.status !== 'REJECTED'));
    const dropFromOffered = (id: string) =>
      setOfferedRequests((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
    requestWatchersRef.current.forEach((stop, id) => {
      if (wanted.has(id)) return;
      stop();
      requestWatchersRef.current.delete(id);
      dropFromOffered(id);
    });
    wanted.forEach((id) => {
      if (requestWatchersRef.current.has(id)) return;
      const stop = repository.subscribeToRequest(id, (req) => {
        if (!mountedRef.current) return;
        if (req) setOfferedRequests((prev) => ({ ...prev, [id]: req }));
        else dropFromOffered(id);
      });
      requestWatchersRef.current.set(id, stop);
    });
  };

  // Live list of the provider's city requests (open ones; offered requests are watched separately)
  const startRequestFeed = (myProv: Provider, isAlive: () => boolean) => {
    // Clean up previous subscription if any
    if (requestsUnsubscribeRef.current) {
      requestsUnsubscribeRef.current();
      requestsUnsubscribeRef.current = null;
    }

    // Requests of the provider's city; the provider's groups (several since the full catalogue)
    // are matched on the device in the new-requests filter below
    const filter = {
      city: myProv.city,
      cityId: myProv.cityId ? (normalizeCityId(myProv.cityId) || myProv.cityId) : normalizeCityId(myProv.city),
    };

    const unsub = repository.subscribeToRequests(
      filter,
      async (matchingRequests) => {
        if (!isAlive()) return;
        setDebugError(null);
        setDebugInfo('✅ ' + matchingRequests.length + ' talep bulundu');

        if (isAlive()) {
          setFeedRequests(matchingRequests);
        }
      },
      (err: any) => {
        if (!isAlive()) return;
        const errMsg = 'FIRESTORE HATA: ' + (err?.code || '') + ' - ' + (err?.message || String(err));
        setDebugError(errMsg);
      }
    );

    requestsUnsubscribeRef.current = unsub;
  };

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
        ...(providerData.serviceIds ? { serviceIds: providerData.serviceIds } : {}),
        services: (providerData.services || '').trim(),
        priceRange: (providerData.priceRange || '').trim(),
        workingHours: (providerData.workingHours || '').trim() || '09:00 - 20:00',
        experienceYears: expYears,
        description: (providerData.description || '').trim(),
        ...(providerData.tradeLicense ? { tradeLicense: String(providerData.tradeLicense).trim() } : {}),
        verified: isAlreadyVerified, // Secure: false for new providers!
        isDemo: false,
      });

      setProvider(savedProvider);
      setIsEditingProfile(false);

      if (onProfileCreated) {
        onProfileCreated();
      }

      // Refresh the request feed for the updated profile (city may have changed)
      startRequestFeed(savedProvider, () => mountedRef.current);
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
    // Start empty (the inputs show examples as placeholders): every offer is written by the provider
    setOfferPriceAmount('');
    setOfferTime('');
    setOfferMessage('');
    const prefs = loadOfferPrefs();
    setOfferPayments(prefs.paymentMethods);
    setOfferFixPledge(prefs.fixPledge);
  };

  // Provider clicks "Не могу"
  const handleDismissRequest = (reqId: string) => {
    setDismissedReqIds((prev) => [...prev, reqId]);
  };

  // Submit Offer via repository
  // One send at a time: a second tap on a slow network waits for the first
  const [sendingOffer, setSendingOffer] = useState(false);
  const sendingOfferRef = useRef(false);
  const handleSendOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingOfferRef.current) return;
    sendingOfferRef.current = true;
    setSendingOffer(true);
    try {
      await sendOffer();
    } finally {
      sendingOfferRef.current = false;
      setSendingOffer(false);
    }
  };

  const sendOffer = async () => {
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
            : 'После осмотра';
      } else {
        const digits = offerPriceAmount.replace(/[^\d]/g, '');
        if (!digits) {
          setErrorMessage(
            language === 'kz'
              ? 'Бағасын көрсетіңіз'
              : 'Укажите примерную стоимость'
          );
          return;
        }
        const spaced = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        if (offerPriceType === 'from') {
          finalPrice =
            language === 'kz' ? `${spaced} ₸ бастап` : `от ${spaced} ₸`;
        } else {
          finalPrice = `${spaced} ₸`;
        }
      }

      if (offerPayments.length === 0) {
        setErrorMessage(language === 'kz' ? 'Төлем тәсілін таңдаңыз' : 'Выберите способ оплаты');
        return;
      }
      saveOfferPrefs({ paymentMethods: offerPayments, fixPledge: offerFixPledge });

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
        paymentMethods: offerPayments,
        fixPledge: offerFixPledge,
        status: 'PENDING',
      });

      // Update sent offers mapping
      setSentOffersMap((prev) => ({
        ...prev,
        [selectedRequestForOffer.id]: newOffer,
      }));

      // Ensure the request is always present in requests feed
      setFeedRequests((prev) => {
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
  const pCityId = provider?.cityId
    ? normalizeCityId(provider.cityId) || provider.cityId
    : provider?.city
    ? normalizeCityId(provider.city)
    : '';
  const pCatId = provider?.categoryId
    ? normalizeCategoryId(provider.categoryId)
    : provider?.category
    ? normalizeCategoryId(provider.category)
    : '';
  // All groups the provider works in (several since the full catalogue; legacy profiles have one)
  const pGroupIds = provider ? (providerGroupIds(provider).length ? providerGroupIds(provider).map((g) => normalizeCategoryId(g)) : pCatId ? [pCatId] : []) : [];

  const isAnonymousSession = Boolean(
    !auth?.currentUser ||
    auth.currentUser.isAnonymous ||
    getCurrentUserId().startsWith('usr-') ||
    getCurrentUserId() === 'temp-local-user-id'
  );

  // Status action handlers for "Start work" and "Finish work"
  const handleStartWork = async (requestId: string) => {
    if (!checkClientRateLimit(`start_work_${requestId}`, 800)) return;
    setActionLoadingReqId(requestId);
    try {
      const updated = await repository.updateRequestStatus(requestId, 'IN_PROGRESS');
      if (updated) {
        patchRequest(requestId, { status: 'IN_PROGRESS' });
        setNotification(
          language === 'kz'
            ? 'Жұмыс басталды'
            : 'Работа начата'
        );
        setTimeout(() => setNotification(null), 3500);
      }
    } catch (err) {
      setErrorMessage(getFriendlyErrorMessage(err, language));
      setTimeout(() => setErrorMessage(null), 4000);
    } finally {
      setActionLoadingReqId(null);
    }
  };

  // The provider reports the job finished; the customer confirms it and the request becomes COMPLETED
  const handleCompleteWork = async (requestId: string) => {
    if (!checkClientRateLimit(`complete_work_${requestId}`, 800)) return;
    setActionLoadingReqId(requestId);
    try {
      const doneAt = new Date().toISOString();
      const updated = await repository.updateRequest(requestId, { providerDoneAt: doneAt });
      if (updated) {
        patchRequest(requestId, { providerDoneAt: doneAt });
        notificationService.notifyProviderReportedDone(updated).catch(() => {});
        setNotification(
          language === 'kz'
            ? 'Тапсырыс берушіге хабар жіберілді. Ол растағанда жұмыс жабылады.'
            : 'Заказчику отправлено уведомление. Работа закроется после его подтверждения.'
        );
        setTimeout(() => setNotification(null), 4000);
      }
    } catch (err) {
      setErrorMessage(getFriendlyErrorMessage(err, language));
      setTimeout(() => setErrorMessage(null), 4000);
    } finally {
      setActionLoadingReqId(null);
    }
  };

  // 1. Tab: New Requests ("Yeni Talepler")
  const newRequests = requests.filter((r) => {
    const offer = sentOffersMap[r.id];
    if (offer) return false; // Already submitted an offer
    if (dismissedReqIds.includes(r.id) || r.status === 'CANCELLED') return false;

    const selfReq = isSelfRequest(r, provider, isAnonymousSession);
    if (selfReq) return false;

    const norm = normalizeRequestStatus(r.status);
    if (norm !== 'OPEN') return false;

    const rCityId = normalizeCityId(r.cityId || r.city) || r.cityId || 'unknown';
    const rCatId = normalizeCategoryId(r.categoryId || r.category) || 'unknown';

    if (pCityId && pGroupIds.length > 0) {
      if (rCityId !== pCityId) return false;
      const isCatMatched =
        rCatId === 'other' || pGroupIds.some((g) => rCatId === g || isCategoryMatch(rCatId, g));
      if (!isCatMatched) return false;
    }
    return true;
  });

  // 2. Tab: My Offers ("Tekliflerim")
  const myOffersRequests = requests.filter((r) => {
    const offer = sentOffersMap[r.id];
    if (!offer) return false;
    if (r.status === 'CANCELLED') return false;

    const norm = normalizeRequestStatus(r.status);
    if (
      offer.status === 'ACCEPTED' ||
      r.selectedOfferId === offer.id ||
      norm === 'PROVIDER_SELECTED' ||
      norm === 'IN_PROGRESS' ||
      norm === 'COMPLETED'
    ) {
      return false;
    }
    return true;
  });

  // 3. Tab: Active Jobs
  const activeJobRequests = requests.filter((r) => {
    const offer = sentOffersMap[r.id];
    if (!offer) return false;
    if (r.status === 'CANCELLED') return false;

    const norm = normalizeRequestStatus(r.status);
    if (norm === 'COMPLETED') return false;

    // Only jobs this provider was chosen for; another provider's job is not "active" here
    return offer.status === 'ACCEPTED' || r.selectedOfferId === offer.id;
  });

  // Jobs done through Tapsyr and roughly what they paid (paid to the master directly;
  // "after inspection" prices have no number, so they are not counted)
  const completedJobs = requests.filter((r) => {
    const offer = sentOffersMap[r.id];
    return !!offer && normalizeRequestStatus(r.status) === 'COMPLETED' && (offer.status === 'ACCEPTED' || r.selectedOfferId === offer.id);
  });
  const earnedTotal = completedJobs.reduce((sum, r) => {
    const offer = sentOffersMap[r.id];
    if (!offer || offer.priceType === 'inspection') return sum;
    const amount = Number((offer.price || '').replace(/[^\d]/g, ''));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const newCount = newRequests.length;
  const offersCount = myOffersRequests.length;
  const activeCount = activeJobRequests.length;
  useEffect(() => {
    onCountsChange?.({ new: newCount, offers: offersCount, active: activeCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCount, offersCount, activeCount]);

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
      {isDebugMode && debugError && (
        <div
          style={{
            background: '#dc2626',
            color: 'white',
            padding: '12px',
            margin: '8px',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
        >
          <strong>🔴 DEBUG:</strong> {debugError}
        </div>
      )}
      {isDebugMode && debugInfo && (
        <div
          style={{
            background: '#16a34a',
            color: 'white',
            padding: '12px',
            margin: '8px',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
        >
          <strong>ℹ️ DEBUG:</strong> {debugInfo}
        </div>
      )}
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
                            : 'Посмотреть профиль'
                        }
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>
                          {language === 'kz'
                            ? 'Профиль'
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
                            : 'Изменить'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {providerRating.count > 0 && (
                    <div className="pt-1.5 flex items-center gap-2">
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                        <span>
                          {providerRating.avg.toFixed(1)} / 5 ({providerRating.count} {t.reviewsCountUnit})
                        </span>
                      </div>
                    </div>
                  )}

                {providerGroupIds(provider).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {providerGroupIds(provider).map((gid) => {
                      const g = getGroup(normalizeCategoryId(gid));
                      return (
                        <span key={gid} className="inline-flex items-center gap-1 h-7 pl-1 pr-2.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
                          {g && <Emoji3D code={g.emoji} size={18} />}
                          {g ? groupName(g, language) : getCategoryDisplayName(gid, language)}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="text-xs text-slate-600 pt-1 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <strong className="text-slate-700">
                      {language === 'kz'
                        ? 'Уақыты:'
                        : 'Время:'}
                    </strong>{' '}
                    {provider.workingHours}
                  </span>
                  {provider.experienceYears !== undefined && provider.experienceYears > 0 && (
                    <span>
                      <strong className="text-slate-700">
                        {language === 'kz'
                          ? 'Тәжірибе:'
                          : 'Опыт:'}
                      </strong>{' '}
                      {provider.experienceYears} {t.experienceYearsUnit}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Provider Tabs Navigation (hidden when the bottom navigation picks the tab) */}
            <div className={`${tab ? 'hidden' : 'flex'} items-center p-1 bg-slate-100 rounded-2xl gap-1`}>
              <button
                type="button"
                onClick={() => setActiveTab('new')}
                className={`flex-1 py-2.5 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  activeTab === 'new'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {language === 'kz' ? 'Жаңа өтініштер' : 'Новые заявки'}
                </span>
                {newRequests.length > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      activeTab === 'new' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {newRequests.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('offers')}
                className={`flex-1 py-2.5 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  activeTab === 'offers'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {language === 'kz' ? 'Ұсыныстарым' : 'Мои предложения'}
                </span>
                {myOffersRequests.length > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      activeTab === 'offers' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {myOffersRequests.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`flex-1 py-2.5 px-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  activeTab === 'active'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                <span className="truncate">
                  {language === 'kz' ? 'Белсенді жұмыстар' : 'Активные заказы'}
                </span>
                {activeJobRequests.length > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      activeTab === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {activeJobRequests.length}
                  </span>
                )}
              </button>
            </div>

            {/* TAB 1: Yeni Talepler */}
            {activeTab === 'new' && (
              <div className="space-y-3">
                {newRequests.length === 0 ? (
                  <div className="p-8 bg-linear-to-b from-sky-50 to-white rounded-[28px] border border-sky-100 text-center space-y-3 animate-fadeUp">
                    <Emoji3D code="1f4e5" size={84} className="mx-auto animate-float" />
                    <h4 className="text-base font-bold text-slate-900">
                      {language === 'kz' ? 'Әзірге жаңа өтініш жоқ' : 'Пока новых заявок нет'}
                    </h4>
                    <p className="text-[13px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                      {language === 'kz'
                        ? 'Қалаңыздағы клиенттер сіздің қызметтеріңізге өтініш қалдырғанда, олар осында шығады.'
                        : 'Когда клиенты вашего города оставят заявку на ваши услуги, она появится здесь.'}
                    </p>
                  </div>
                ) : (
                  newRequests.map((req) => (
                    <div
                      key={req.id}
                      className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-sm shadow-slate-200/60 space-y-3 animate-fadeUp"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          <RequestIcon request={req} />
                          <div className="min-w-0">
                            <h4 className="text-[15px] font-bold text-slate-900 leading-snug">
                              {getRequestTitle(req, language)}
                            </h4>
                            {req.urgency === 'high' && (
                              <span className="mt-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <Flame className="w-3 h-3 text-amber-600" />
                                {t.urgencyHigh}
                              </span>
                            )}
                          </div>
                        </div>

                      </div>

                      {getRequestDescription(req) && (
                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[13px] text-slate-700 leading-relaxed">
                          {getRequestDescription(req)}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-sky-600" />
                          {getCityDisplayName(req.cityId || req.city, language) || req.city}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-sky-600" />
                          {requestWhenLabel(req.date, req.createdAt, language) || formatDynamicDate(req.date, language)}
                        </span>
                        {req.budget && (
                          <span className="flex items-center gap-1 font-bold text-sky-700">
                            <Wallet className="w-3.5 h-3.5" />
                            {formatDynamicBudget(req.budget, language)}
                          </span>
                        )}
                      </div>

                      {Boolean(req.attachments?.length || req.location) && (
                        <div className="pt-1 border-t border-slate-100">
                          <RequestMediaView
                            attachments={req.attachments}
                            location={req.location}
                            language={language}
                          />
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenOfferModal(req)}
                          className="min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{t.btnCanFulfill}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDismissRequest(req.id)}
                          className="min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <ThumbsDown className="w-3.5 h-3.5 text-slate-500" />
                          <span>{t.btnCannotFulfill}</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: Tekliflerim */}
            {activeTab === 'offers' && (
              <div className="space-y-3">
                {myOffersRequests.length === 0 ? (
                  <div className="p-8 bg-linear-to-b from-sky-50 to-white rounded-[28px] border border-sky-100 text-center space-y-3 animate-fadeUp">
                    <Emoji3D code="1f4e4" size={84} className="mx-auto animate-float" />
                    <h4 className="text-base font-bold text-slate-900">
                      {language === 'kz'
                        ? 'Жіберілген ұсыныстар жоқ'
                        : 'Нет отправленных предложений'}
                    </h4>
                    <p className="text-[13px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                      {language === 'kz'
                        ? '«Жаңа өтініштер» бөліміндегі сұраныстарға ұсыныс жіберіңіз.'
                        : 'Когда вы отправляете предложения на новые заявки, они будут отображаться здесь.'}
                    </p>
                  </div>
                ) : (
                  myOffersRequests.map((req) => {
                    const existingOffer = sentOffersMap[req.id];
                    return (
                      <div
                        key={req.id}
                        className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-sm shadow-slate-200/60 space-y-3 animate-fadeUp"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3 min-w-0">
                            <RequestIcon request={req} />
                            <div className="min-w-0">
                              <h4 className="text-[15px] font-bold text-slate-900 leading-snug">
                                {getRequestTitle(req, language)}
                              </h4>
                              {req.urgency === 'high' && (
                                <span className="mt-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                  <Flame className="w-3 h-3 text-amber-600" />
                                  {t.urgencyHigh}
                                </span>
                              )}
                            </div>
                          </div>

                        </div>

                        {getRequestDescription(req) && (
                          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[13px] text-slate-700 leading-relaxed">
                            {getRequestDescription(req)}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-sky-600" />
                            {getCityDisplayName(req.cityId || req.city, language) || req.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-sky-600" />
                            {requestWhenLabel(req.date, req.createdAt, language) || formatDynamicDate(req.date, language)}
                          </span>
                          {req.budget && (
                            <span className="flex items-center gap-1 font-bold text-sky-700">
                              <Wallet className="w-3.5 h-3.5" />
                              {formatDynamicBudget(req.budget, language)}
                            </span>
                          )}
                        </div>

                        {existingOffer && (
                          <div className="pt-2 border-t border-slate-100 space-y-2">
                            <div className="p-2.5 bg-sky-50 text-sky-900 rounded-xl text-xs font-bold flex items-center justify-between border border-sky-200">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle className="w-4 h-4 text-sky-600" />
                                <span>{t.alreadySentOffer}</span>
                              </div>
                              <span className="font-mono text-sky-950 font-extrabold">
                                {formatOfferDisplayPrice(existingOffer, language)}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-500 text-center font-medium bg-slate-50 p-2 rounded-lg">
                              {existingOffer.status === 'REJECTED'
                                ? (language === 'kz' ? 'Клиент басқа маманды таңдады' : 'Клиент выбрал другого мастера')
                                : (language === 'kz' ? 'Клиент қарастыруда...' : 'Ожидает ответа клиента...')}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* TAB 3: Active jobs */}
            {activeTab === 'active' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-slate-500">
                      {language === 'kz' ? 'Орындалған жұмыстар' : 'Выполнено заказов'}
                    </span>
                    <span className="block text-xl font-extrabold text-slate-900 mt-0.5">{completedJobs.length}</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-slate-500">
                      {language === 'kz' ? 'Tapsyr арқылы табыс' : 'Заработано через Tapsyr'}
                    </span>
                    <span className="block text-xl font-extrabold text-emerald-700 mt-0.5">
                      ≈ {String(earnedTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸
                    </span>
                  </div>
                </div>
                {activeJobRequests.length === 0 ? (
                  <div className="p-8 bg-linear-to-b from-sky-50 to-white rounded-[28px] border border-sky-100 text-center space-y-3 animate-fadeUp">
                    <Emoji3D code="1f4bc" size={84} className="mx-auto animate-float" />
                    <h4 className="text-base font-bold text-slate-900">
                      {language === 'kz'
                        ? 'Белсенді жұмыстар жоқ'
                        : 'Нет активных заказов'}
                    </h4>
                    <p className="text-[13px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                      {language === 'kz'
                        ? 'Клиент сіздің ұсынысыңызды қабылдағанда, тапсырыс осы жерге түседі және жұмыс күйін өзгерте аласыз.'
                        : 'Когда клиент примет ваше предложение, заказ появится здесь, и вы сможете обновлять статус работы.'}
                    </p>
                  </div>
                ) : (
                  activeJobRequests.map((req) => {
                    const existingOffer = sentOffersMap[req.id];
                    const normStatus = normalizeRequestStatus(req.status);

                    return (
                      <div
                        key={req.id}
                        className="bg-white rounded-3xl border border-emerald-200 p-4 shadow-sm shadow-emerald-100 space-y-3 relative overflow-hidden animate-fadeUp"
                      >
                        {/* Status Header Badge */}
                        <div className="flex items-center justify-between">
                          <RequestIcon request={req} size="sm" />
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                              normStatus === 'IN_PROGRESS'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                            {normStatus === 'IN_PROGRESS'
                              ? (language === 'kz' ? 'Жұмыс орындалуда' : 'Выполняется')
                              : (language === 'kz' ? 'Тапсырыс қабылданды' : 'Заказ принят')}
                          </span>
                        </div>

                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              {getRequestTitle(req, language)}
                            </h4>
                          </div>

                        </div>

                        {getRequestDescription(req) && (
                          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[13px] text-slate-700 leading-relaxed">
                            {getRequestDescription(req)}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-sky-600" />
                            {getCityDisplayName(req.cityId || req.city, language) || req.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-sky-600" />
                            {requestWhenLabel(req.date, req.createdAt, language) || formatDynamicDate(req.date, language)}
                          </span>
                          {req.budget && (
                            <span className="flex items-center gap-1 font-bold text-sky-700">
                              <Wallet className="w-3.5 h-3.5" />
                              {formatDynamicBudget(req.budget, language)}
                            </span>
                          )}
                        </div>

                        {Boolean(req.attachments?.length || req.location) && (
                          <div className="pt-1 border-t border-slate-100">
                            <RequestMediaView
                              attachments={req.attachments}
                              location={req.location}
                              language={language}
                            />
                          </div>
                        )}

                        {/* Payment happens directly between customer and provider */}
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {language === 'kz'
                            ? 'Төлемді тапсырыс берушіден тікелей аласыз (қолма-қол немесе аударым).'
                            : 'Оплату вы получаете напрямую от заказчика (наличными или переводом).'}
                        </p>

                        {/* Agreed Price */}
                        {existingOffer && (
                          <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              <span>{t.alreadySentOffer}</span>
                            </div>
                            <span className="font-mono text-emerald-900 font-bold">
                              {formatOfferDisplayPrice(existingOffer, language)}
                            </span>
                          </div>
                        )}

                        {/* Communication & Appointments */}
                        <div className="space-y-2 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => setActiveChatRequestId(req.id)}
                            className="w-full min-h-[42px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                          >
                            <MessageSquare className="w-4 h-4" />
                            <span>{t.chatWithCustomerBtn}</span>
                          </button>

                          {existingOffer && (
                            <AppointmentSection
                              request={req}
                              selectedOffer={existingOffer}
                              currentRole="provider"
                              language={language}
                            />
                          )}
                        </div>

                        {/* JOB STATUS ACTION BUTTONS */}
                        <div className="pt-2 border-t border-slate-200">
                          {normStatus === 'PROVIDER_SELECTED' && (
                            <button
                              type="button"
                              onClick={() => handleStartWork(req.id)}
                              disabled={actionLoadingReqId === req.id}
                              className="w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <Flame className="w-4 h-4" />
                              <span>
                                {actionLoadingReqId === req.id
                                  ? (language === 'kz' ? 'Жүктелуде...' : 'Загрузка...')
                                  : (language === 'kz' ? 'Жұмысты бастау' : 'Начать работу')}
                              </span>
                            </button>
                          )}

                          {normStatus === 'IN_PROGRESS' && req.providerDoneAt && (
                            <div className="w-full p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2">
                              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>
                                {language === 'kz'
                                  ? 'Тапсырыс берушінің растауы күтілуде'
                                  : 'Ожидается подтверждение заказчика'}
                              </span>
                            </div>
                          )}

                          {normStatus === 'IN_PROGRESS' && !req.providerDoneAt && (
                            <button
                              type="button"
                              onClick={() => handleCompleteWork(req.id)}
                              disabled={actionLoadingReqId === req.id}
                              className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>
                                {actionLoadingReqId === req.id
                                  ? (language === 'kz' ? 'Жүктелуде...' : 'Загрузка...')
                                  : (language === 'kz' ? 'Жұмысты аяқтау' : 'Завершить работу')}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
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
                <RequestIcon request={selectedRequestForOffer} size="sm" />
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {t.sendOfferModalTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequestForOffer(null)}
                data-dialog-close
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendOffer} className="space-y-3">
              {/* Target request snippet */}
              <div className="p-2.5 bg-slate-50 rounded-xl text-xs text-slate-600">
                <span className="font-bold text-slate-800 block">
                  {getRequestTitle(selectedRequestForOffer, language)} (
                  {getCityDisplayName(
                    selectedRequestForOffer.cityId || selectedRequestForOffer.city,
                    language
                  ) || selectedRequestForOffer.city}
                  )
                </span>
                {getRequestDescription(selectedRequestForOffer) && (
                  <span className="line-clamp-1 mt-0.5 block">{getRequestDescription(selectedRequestForOffer)}</span>
                )}
              </div>
              <div className="flex justify-end -my-2">
                <ReportButton language={language} targetType="request" targetId={selectedRequestForOffer.id} requestId={selectedRequestForOffer.id} />
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

              {/* How the master takes payment (always paid to the master directly) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  {language === 'kz' ? 'Төлем тәсілі' : 'Способ оплаты'}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_PAYMENT_METHODS.map((m) => {
                    const on = offerPayments.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setOfferPayments((prev) => (on ? prev.filter((x) => x !== m) : [...prev, m]))
                        }
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                          on ? 'bg-sky-50 border-sky-400 text-sky-800' : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        {on ? '✓ ' : ''}
                        {paymentMethodLabel(m, language)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 14-day free-fix pledge */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={offerFixPledge}
                  onChange={(e) => setOfferFixPledge(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0"
                />
                <span className="text-xs text-slate-800">
                  <span className="font-bold block">
                    {language === 'kz' ? '14 күн ішінде тегін түзетемін' : 'Бесплатно исправлю в течение 14 дней'}
                  </span>
                  <span className="text-[11px] text-slate-500 leading-snug block mt-0.5">
                    {language === 'kz'
                      ? 'Менің жұмысымда ақау шықса, 14 күн ішінде тегін түзетемін. Клиент бұл белгіні көреді.'
                      : 'Если в моей работе найдётся недочёт, исправлю бесплатно в течение 14 дней. Клиент увидит этот значок.'}
                  </span>
                </span>
              </label>

              {/* Submit */}
              <button
                type="submit"
                disabled={sendingOffer}
                className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-70 active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-sky-600/20 transition-all flex items-center justify-center gap-2"
              >
                {sendingOffer ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
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
