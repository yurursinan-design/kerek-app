import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import {
  AppNotification,
  ExtractedNeed,
  Language,
  PendingAttachment,
  RequestAttachment,
  RequestLocation,
  ServiceRequest,
} from './types';
import { Header } from './components/Header';
import { BottomNav, MainTab } from './components/BottomNav';
import { HomeScreen } from './components/HomeScreen';
import { InterpretationScreen } from './components/InterpretationScreen';
// Screens after the first one load on demand, so the start screen opens faster on slow connections
const ResultScreen = lazy(() => import('./components/ResultScreen').then((m) => ({ default: m.ResultScreen })));
const MyRequestsScreen = lazy(() => import('./components/MyRequestsScreen').then((m) => ({ default: m.MyRequestsScreen })));
const ProviderModeScreen = lazy(() => import('./components/ProviderModeScreen').then((m) => ({ default: m.ProviderModeScreen })));
import type { ProviderTab } from './components/ProviderModeScreen';
import { RoleChooser, AppMode } from './components/RoleChooser';
import { InAppToast } from './components/InAppToast';
import { PhoneLoginModal, PhoneLoginReason } from './components/PhoneLoginModal';
import { onAuthStateChanged } from 'firebase/auth';
import { logoutToAnonymous, requiresPhoneLogin } from './services/phoneAuth';
import { startPushNotifications } from './services/pushNotifications';
import { ActiveJobsError, deleteMyAccount, RecentLoginRequiredError } from './services/account';
import { generateRequestId } from './services/ids';
import { localRepository } from './services/localRepository';
import {
  auth,
  repository,
  getCurrentUserId,
  checkClientRateLimit,
  getFriendlyErrorMessage,
  isFirebaseConfigured,
  ensureFirebaseAuth,
  parseServiceRequest,
  playNotificationSound,
  showBrowserNotificationIfGranted,
  analyzeRequestUnderstanding,
  understandingToExtractedNeed,
  RequestUnderstandingContext,
  offlineQueueService,
} from './services';
import {
  isCityOpen,
  normalizeCategoryId,
  normalizeCityId,
  getCategoryDisplayName,
  getCityDisplayName,
} from './services/taxonomy';
import { localizedText } from './services/safeData';

const LANGUAGE_KEY = 'kerek_language_v1';
// Where the user was in this browser tab, so a page refresh reopens the same screen
const NAV_KEY = 'kerek_nav_v1';
// Customer or provider side of the app, chosen on the first visit
const MODE_KEY = 'kerek_app_mode_v1';

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      // Kazakh and Russian only (Turkish was removed; a saved Turkish choice falls back to Kazakh)
      if (saved === 'kz' || saved === 'ru') return saved;
    } catch {}
    return 'kz';
  });

  // Remember the chosen language across visits and expose it to the browser (screen readers, translation)
  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {}
    document.documentElement.lang = language === 'kz' ? 'kk' : language;
  }, [language]);
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [appMode, setAppModeState] = useState<AppMode | null>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY);
      return v === 'customer' || v === 'provider' ? v : null;
    } catch {
      return null;
    }
  });
  const setAppMode = (mode: AppMode) => {
    setAppModeState(mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // storage unavailable: the choice lasts for this visit
    }
  };
  const [providerTab, setProviderTab] = useState<ProviderTab>('new');
  const [providerCounts, setProviderCounts] = useState<Record<ProviderTab, number>>({ new: 0, offers: 0, active: 0 });
  const [currentScreen, setCurrentScreen] = useState<'home' | 'interpretation' | 'results'>('home');
  const [extractedNeed, setExtractedNeed] = useState<ExtractedNeed | null>(null);
  const [activeRequest, setActiveRequest] = useState<ServiceRequest | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [customerRequests, setCustomerRequests] = useState<ServiceRequest[]>([]);
  // False until the customer's requests were loaded once (so "no requests yet" isn't shown while loading)
  const [customerRequestsLoaded, setCustomerRequestsLoaded] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  // Phone login: who is signed in, and the dialog that asks for a verified phone before publishing
  const [authUid, setAuthUid] = useState<string | null>(auth?.currentUser?.uid || null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(auth?.currentUser?.phoneNumber || null);
  const [phoneLogin, setPhoneLogin] = useState<PhoneLoginReason | null>(null);
  const afterPhoneLoginRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => {
      setAuthUid(user?.uid || null);
      setPhoneNumber(user?.phoneNumber || null);
    });
  }, []);

  /** Runs `action` now if the account may publish, otherwise after a successful phone login. */
  const withPhoneLogin = (reason: PhoneLoginReason, action: () => void) => {
    if (!requiresPhoneLogin()) {
      action();
      return;
    }
    afterPhoneLoginRef.current = action;
    setPhoneLogin(reason);
  };

  /** "Delete my account": a stale session confirms the number with a new code first, then deletion continues. */
  const handleDeleteAccount = async (): Promise<void> => {
    try {
      await deleteMyAccount();
      // Start over as a new anonymous visitor
      window.location.replace('/');
    } catch (err) {
      if (err instanceof RecentLoginRequiredError) {
        afterPhoneLoginRef.current = () => {
          handleDeleteAccount();
        };
        setPhoneLogin('delete');
        return;
      }
      if (err instanceof ActiveJobsError) {
        setAppError(
          language === 'kz'
            ? 'Сізде аяқталмаған жұмыс бар. Алдымен оны аяқтаңыз немесе тапсырыс берушімен келісіп болдырмаңыз.'
            : 'У вас есть незавершённая работа. Сначала завершите её или отмените по договорённости с заказчиком.'
        );
        return;
      }
      setAppError(getFriendlyErrorMessage(err, language));
    }
  };
  const [hasFatalFailedMutations, setHasFatalFailedMutations] = useState(false);

  // Monitor offline queue for fatal failed requests
  useEffect(() => {
    const unsubscribe = offlineQueueService.subscribeToQueueChange((queue) => {
      const hasFatal = queue.some(
        (m) => m.status === 'FAILED_FATAL' || m.status === 'FAILED_PERMANENT'
      );
      setHasFatalFailedMutations(hasFatal);
    });
    return () => unsubscribe();
  }, []);

  // In-App Notifications State
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeToastNotification, setActiveToastNotification] = useState<AppNotification | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const isInitialNotifFetchRef = useRef<boolean>(true);

  // The bell lists the notifications of the side the user is on
  const modeNotifications = notifications.filter((n) => (n.recipientRole || 'customer') === (appMode || 'customer'));
  const unreadCount = modeNotifications.filter((n) => !n.isRead).length;

  // Latest language and click handler for the listener, so a language switch doesn't restart it
  const languageRef = useRef(language);
  languageRef.current = language;
  const notificationClickRef = useRef<(n: AppNotification) => void>(() => {});

  // Realtime Notifications Listener (Single active subscription for the current authenticated user)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isMounted = true;
    // A different account (login, logout): its existing notifications are history, not new alerts
    isInitialNotifFetchRef.current = true;
    seenNotifIdsRef.current = new Set();

    const setupNotifSubscription = () => {
      const uid = getCurrentUserId();
      if (!uid) return;

      unsubscribe = repository.subscribeToNotifications(
        uid,
        (items) => {
          if (!isMounted) return;
          setNotifications(items);

          if (!isInitialNotifFetchRef.current && items.length > 0) {
            // Check for freshly arrived unread notifications
            const newUnreads = items.filter(
              (n) => !n.isRead && !seenNotifIdsRef.current.has(n.id)
            );
            if (newUnreads.length > 0) {
              const latest = newUnreads[0];
              seenNotifIdsRef.current.add(latest.id);
              setActiveToastNotification(latest);
              playNotificationSound(latest.type);
              showBrowserNotificationIfGranted(
                localizedText(latest.title, languageRef.current),
                localizedText(latest.body, languageRef.current),
                () => notificationClickRef.current(latest)
              );
            }
          } else if (isInitialNotifFetchRef.current) {
            // First load: populate seen IDs without triggering toasts for historic items
            items.forEach((n) => seenNotifIdsRef.current.add(n.id));
            isInitialNotifFetchRef.current = false;
          }
        },
        (err) => {
          console.warn('[App] Notifications subscription listener note:', err);
        }
      );
    };

    if (isFirebaseConfigured()) {
      ensureFirebaseAuth().finally(() => {
        if (isMounted) setupNotifSubscription();
      });
    } else {
      setupNotifSubscription();
    }

    return () => {
      isMounted = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {}
      }
    };
  }, [authUid]);

  // Security rule: Customer only sees their own requests!
  const refreshData = useCallback(async () => {
    try {
      const currentUserId = getCurrentUserId();
      const myRequests = await repository.getRequests({ customerId: currentUserId });
      // Newest first
      setCustomerRequests(
        [...myRequests].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      );
      setCustomerRequestsLoaded(true);
    } catch (err) {
      setCustomerRequestsLoaded(true);
      setAppError(getFriendlyErrorMessage(err, language));
    }
  }, [language]);

  // Initial load: await Firebase Auth if configured, so user ID and Firestore rules align
  useEffect(() => {
    let isMounted = true;
    if (isFirebaseConfigured()) {
      ensureFirebaseAuth().finally(() => {
        if (isMounted) refreshData();
      });
    } else {
      refreshData();
    }
    return () => {
      isMounted = false;
    };
  }, [refreshData, authUid]);

  // Trigger search & analysis using Request Understanding 2.0 (with AI Cloud Function merge)
  const handleSearch = async (
    query: string,
    attachments?: PendingAttachment[],
    location?: RequestLocation
  ) => {
    setIsAnalyzing(true);
    setAppError(null);

    // 1. Build Request Understanding 2.0 Context
    const context: RequestUnderstandingContext = {
      language,
      attachmentsPresent: {
        images: (attachments || []).filter((a) => a.mediaType === 'image').length,
        videos: (attachments || []).filter((a) => a.mediaType === 'video').length,
        audios: (attachments || []).filter((a) => a.mediaType === 'audio').length,
      },
      hasLocation: Boolean(location && location.latitude),
      location,
    };

    // 2. Perform Request Understanding 2.0
    const understanding = analyzeRequestUnderstanding(query, context);
    const need = understandingToExtractedNeed(understanding, query, language);
    need.pendingAttachments = attachments || [];
    need.location = location;

    try {
      // 3. Attempt optional Cloud AI parser merge if configured (non-blocking)
      const aiResponse = await parseServiceRequest(query);

      if (aiResponse.success && aiResponse.data) {
        const aiData = aiResponse.data;
        need.isAiParsed = true;
        if (aiData.cityId) {
          const canonicalCityId = normalizeCityId(aiData.cityId);
          need.cityId = canonicalCityId;
          need.city = getCityDisplayName(canonicalCityId, language);
        }
        if (aiData.categoryId) {
          const canonicalCategoryId = normalizeCategoryId(aiData.categoryId);
          need.categoryId = canonicalCategoryId;
          need.category = getCategoryDisplayName(canonicalCategoryId, language);
        }
        if (aiData.service) {
          need.service = aiData.service.trim();
        }
        if (aiData.urgency) {
          need.urgency = aiData.urgency;
        }
        if (typeof aiData.confidence === 'number' && aiData.confidence > need.confidence!) {
          need.confidence = aiData.confidence;
        }
      }
    } catch (err) {
      console.warn('[App] Cloud AI parser note (using local understanding):', err);
    } finally {
      setExtractedNeed(need);
      setIsAnalyzing(false);
      setCurrentScreen('interpretation');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Continue from interpretation: creates request in repository with customerId
  const submittingRequestRef = useRef(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const handleContinue = async (updatedNeed: ExtractedNeed) => {
    setExtractedNeed(updatedNeed);
    setAppError(null);

    if (requiresPhoneLogin()) {
      withPhoneLogin('request', () => handleContinue(updatedNeed));
      return;
    }

    const currentUserId = getCurrentUserId();

    if (!checkClientRateLimit(`create_request_${currentUserId}`, 1000)) {
      return;
    }
    // A second tap while the first request is still being sent (slow network) must not create a copy
    if (submittingRequestRef.current) return;
    submittingRequestRef.current = true;
    setIsSubmittingRequest(true);

    try {
      const rawText = (updatedNeed.originalQuery || updatedNeed.service || '').trim();
      // Pilot: requests are only created for an open city (Kyzylorda); anything else falls back to it
      const pilotCity = language === 'kz' ? 'Қызылорда' : 'Кызылорда';
      const askedCity = updatedNeed.city?.trim() || pilotCity;
      const city = isCityOpen(updatedNeed.cityId || askedCity) ? askedCity : pilotCity;
      const cityId = isCityOpen(updatedNeed.cityId) ? updatedNeed.cityId! : normalizeCityId(city);
      const category = updatedNeed.category?.trim() || (language === 'kz' ? 'Тұрмыстық техника жөндеу' : 'Ремонт бытовой техники');
      const categoryId = updatedNeed.categoryId || normalizeCategoryId(category);
      const service = (updatedNeed.service || rawText || category).trim();
      const text = rawText || service;

      const targetRequestId = generateRequestId();

      // Create the request first: storage only accepts files for a request that already exists
      // and belongs to the uploader, so nobody can claim someone else's request folder.
      let newReq = await repository.createRequest({
        id: targetRequestId,
        customerId: currentUserId,
        requestText: text,
        description: updatedNeed.description?.trim() || text,
        city,
        cityId,
        category,
        categoryId,
        ...(updatedNeed.serviceId ? { serviceId: updatedNeed.serviceId } : {}),
        service,
        date: updatedNeed.date?.trim() || (language === 'kz' ? 'Бүгін' : 'Сегодня'),
        budget: updatedNeed.budget?.trim() || (language === 'kz' ? 'Келісімді' : 'Договорная'),
        urgency: updatedNeed.urgency || 'normal',
        status: 'OPEN',
        ...(updatedNeed.location ? { location: updatedNeed.location } : {}),
        ...(updatedNeed.understanding ? { understanding: updatedNeed.understanding } : {}),
      });

      const uploadedAttachments: RequestAttachment[] = [];
      let failedUploads = 0;

      if (updatedNeed.pendingAttachments && updatedNeed.pendingAttachments.length > 0) {
        for (const [slot, item] of updatedNeed.pendingAttachments.entries()) {
          try {
            const uploaded = await repository.uploadRequestAttachment(
              newReq.id,
              {
                name: item.name,
                size: item.size,
                type: item.type,
                data: item.file || item.previewUrl,
              },
              currentUserId,
              slot
            );
            uploadedAttachments.push(uploaded);
          } catch (uploadErr) {
            // Skip the file instead of saving a link that only works on this phone
            console.warn('[App] uploadRequestAttachment failed, skipping file:', uploadErr);
            failedUploads++;
          }
        }

        if (uploadedAttachments.length > 0) {
          try {
            const withFiles = await repository.updateRequest(newReq.id, { attachments: uploadedAttachments });
            if (withFiles) newReq = withFiles;
          } catch (attachErr) {
            console.warn('[App] attaching uploaded files to request failed:', attachErr);
            failedUploads += uploadedAttachments.length;
          }
        }
      }

      setActiveRequest(newReq);
      await refreshData();

      if (failedUploads > 0) {
        setAppError(
          language === 'kz'
            ? `${failedUploads} файл жүктелмеді. Өтініш файлсыз жіберілді.`
            : `Не удалось загрузить файлов: ${failedUploads}. Заявка отправлена без них.`
        );
      }

      setCurrentScreen('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setAppError(getFriendlyErrorMessage(err, language));
    } finally {
      submittingRequestRef.current = false;
      setIsSubmittingRequest(false);
    }
  };

  // Back actions
  const handleBack = () => {
    if (appMode === 'provider') {
      // Provider side: "back" returns to the new-requests list
      if (providerTab !== 'new') setProviderTab('new');
      return;
    }
    if (activeTab !== 'home') {
      setActiveTab('home');
      setCurrentScreen('home');
      return;
    }

    if (currentScreen === 'results') {
      setCurrentScreen('interpretation');
    } else if (currentScreen === 'interpretation') {
      setCurrentScreen('home');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phone/browser back button: while the user is away from the start screen, keep one history
  // entry so "back" steps back inside the app instead of leaving it.
  const isAtRoot =
    !appMode || (appMode === 'provider' ? providerTab === 'new' : activeTab === 'home' && currentScreen === 'home');
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;

  const historyInitRef = useRef(false);
  useEffect(() => {
    if (!historyInitRef.current) {
      historyInitRef.current = true;
      // After a page refresh the browser keeps our extra entry; turn it back into a plain one
      // instead of stepping back (stepping back would undo the screen restored after the refresh)
      if (window.history.state && window.history.state.kerekNav) {
        window.history.replaceState(null, '');
      }
    }
    const ownsEntry = Boolean(window.history.state && window.history.state.kerekNav);
    if (!isAtRoot && !ownsEntry) {
      window.history.pushState({ kerekNav: true }, '');
    } else if (isAtRoot && ownsEntry) {
      // Returned to the start screen via an in-app button: drop the extra entry
      window.history.back();
    }
  }, [isAtRoot, activeTab, currentScreen]);

  // Keep the visible tab consistent with the chosen side of the app
  useEffect(() => {
    if (appMode === 'provider' && activeTab !== 'provider-mode') setActiveTab('provider-mode');
    if (appMode === 'customer' && activeTab === 'provider-mode') setActiveTab('home');
  }, [appMode, activeTab]);

  // The provider side needs a verified number; after logging out (or a lost session) go back to the customer side
  useEffect(() => {
    if (appMode === 'provider' && isFirebaseConfigured() && authUid && !phoneNumber) setAppMode('customer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, authUid, phoneNumber]);

  useEffect(() => {
    const onPopState = () => handleBackRef.current();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleHomeClick = () => {
    setActiveTab('home');
    setCurrentScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNewSearch = () => {
    setExtractedNeed(null);
    setActiveRequest(null);
    setActiveTab('home');
    setCurrentScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditSearch = () => {
    setCurrentScreen('interpretation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Switch tabs
  // Provider side: needs a verified phone number first
  const enterProviderMode = () => {
    withPhoneLogin('provider', () => {
      setAppMode('provider');
      setActiveTab('provider-mode');
      refreshData();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const enterCustomerMode = () => {
    setAppMode('customer');
    setActiveTab('home');
    if (currentScreen !== 'interpretation' && currentScreen !== 'results') setCurrentScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTabChange = (tab: MainTab) => {
    if (tab === 'provider-mode') {
      enterProviderMode();
      return;
    }
    setActiveTab(tab);
    // Tapping "Home" while already on the home tab (e.g. viewing a request) returns to the start screen;
    // coming from another tab keeps the request that was open there
    if (tab === 'home' && (activeTab === 'home' || (currentScreen !== 'interpretation' && currentScreen !== 'results'))) {
      setCurrentScreen('home');
    }
    refreshData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Select request from "My Requests"
  const handleSelectRequestFromHistory = (req: ServiceRequest) => {
    setActiveRequest(req);
    setExtractedNeed({
      city: req.city,
      category: req.category,
      service: req.service,
      date: req.date,
      budget: req.budget,
      urgency: req.urgency,
      originalQuery: req.requestText,
    });
    setActiveTab('home');
    setCurrentScreen('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Remember the current screen for this tab (sessionStorage: cleared when the tab is closed)
  useEffect(() => {
    try {
      const { pendingAttachments: _files, ...needWithoutFiles } = extractedNeed || ({} as ExtractedNeed);
      sessionStorage.setItem(
        NAV_KEY,
        JSON.stringify({
          activeTab,
          currentScreen,
          requestId: currentScreen === 'results' ? activeRequest?.id || null : null,
          need: currentScreen === 'interpretation' && extractedNeed ? needWithoutFiles : null,
        })
      );
    } catch {
      // storage unavailable: a refresh simply opens the start screen
    }
  }, [activeTab, currentScreen, activeRequest?.id, extractedNeed]);

  // After a refresh, reopen the screen the user was on. The saved place is read during the first
  // render, before the effect above overwrites it with the start screen.
  const [savedNav] = useState<{ activeTab?: MainTab; currentScreen?: string; requestId?: string | null; need?: ExtractedNeed | null } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
    } catch {
      return null;
    }
  });
  // While an open request is being reloaded after a refresh, show a spinner instead of the start screen
  const [restoringNav, setRestoringNav] = useState(() => Boolean(savedNav?.currentScreen === 'results' && savedNav?.requestId));
  const restoredNavRef = useRef(false);
  useEffect(() => {
    if (restoredNavRef.current) return;
    restoredNavRef.current = true;
    const saved = savedNav;
    if (!saved) return;
    const giveUp = setTimeout(() => setRestoringNav(false), 10000);
    (async () => {
      try {
        // Show the copy kept on this device right away; the request screen then loads the
        // current version from the cloud by itself
        if (saved.activeTab === 'home' && saved.currentScreen === 'results' && saved.requestId) {
          const cached = await localRepository.getRequest(saved.requestId).catch(() => null);
          if (cached) {
            handleSelectRequestFromHistory(cached);
            return;
          }
        }
        await auth?.authStateReady?.();
        if (saved.activeTab === 'my-requests') {
          setActiveTab('my-requests');
        } else if (saved.activeTab === 'provider-mode') {
          if (!requiresPhoneLogin()) setActiveTab('provider-mode');
        } else if (saved.currentScreen === 'results' && saved.requestId) {
          const req = await repository.getRequest(saved.requestId);
          if (req) handleSelectRequestFromHistory(req);
        } else if (saved.currentScreen === 'interpretation' && saved.need) {
          setExtractedNeed(saved.need);
          setCurrentScreen('interpretation');
        }
      } catch (err) {
        console.warn('[App] could not reopen the previous screen:', err);
      } finally {
        clearTimeout(giveUp);
        setRestoringNav(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle click on notification (from bell drawer or in-app toast)
  const handleNotificationClick = async (notif: AppNotification) => {
    // 1. Mark as read
    if (!notif.isRead) {
      try {
        await repository.markNotificationAsRead(notif.id);
      } catch {}
    }

    // 2. Dismiss toast if visible
    setActiveToastNotification(null);

    // 3. Role / screen navigation
    if (notif.recipientRole === 'provider') {
      handleTabChange('provider-mode');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Customer notifications: navigate to relevant request screen
    setAppMode('customer');
    if (notif.requestId) {
      try {
        const req = await repository.getRequest(notif.requestId);
        if (req) {
          handleSelectRequestFromHistory(req);
        }
      } catch (err) {
        console.warn('[App] Notification navigation note:', err);
      }
    }
  };

  notificationClickRef.current = handleNotificationClick;

  // Phone app: push messages for the signed-in account, in the screen language; tapping one opens
  // it like a tap in the notification list
  useEffect(() => {
    if (!authUid) return;
    void startPushNotifications(language === 'kz' ? 'kz' : 'ru', (data) =>
      notificationClickRef.current({
        id: data.notificationId || '',
        recipientUserId: authUid,
        recipientRole: data.recipientRole === 'provider' ? 'provider' : 'customer',
        type: 'CUSTOMER_NEW_MESSAGE',
        title: { kz: '', ru: '' },
        body: { kz: '', ru: '' },
        requestId: data.requestId || undefined,
        targetScreen: 'request_detail',
        isRead: !data.notificationId,
        createdAt: new Date().toISOString(),
      })
    );
  }, [authUid, language]);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-start sm:py-4">
      {/* Mobile Shell Container */}
      <div className="w-full max-w-md bg-white sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-200/80 min-h-screen sm:min-h-[780px] flex flex-col justify-between overflow-clip relative">
        {/* Unconfigured Firebase Local Mode Banner */}
        {!isFirebaseConfigured() && (
          <div className="sticky top-0 z-50 w-full bg-amber-500 text-slate-950 font-bold text-xs py-1.5 px-4 text-center shadow-xs">
            {language === 'kz'
              ? 'Жергілікті режим: деректер тек осы құрылғыда сақталады'
              : 'Локальный режим: данные хранятся только на этом устройстве'}
          </div>
        )}

        {/* Top Header */}
        <Header
          currentScreen={
            !appMode
              ? 'home'
              : appMode === 'provider'
              ? providerTab === 'new'
                ? 'home'
                : 'results'
              : activeTab !== 'home'
              ? 'results'
              : currentScreen
          }
          language={language}
          onLanguageChange={setLanguage}
          onBack={handleBack}
          onHomeClick={handleHomeClick}
          onDataImported={refreshData}
          notifications={modeNotifications}
          unreadCount={unreadCount}
          currentUserId={auth?.currentUser?.uid || getCurrentUserId()}
          onSelectNotification={handleNotificationClick}
          showAccount={isFirebaseConfigured()}
          phoneNumber={phoneNumber}
          onLoginClick={() => setPhoneLogin('header')}
          onLogout={async () => {
            try {
              await logoutToAnonymous();
              setAppMode('customer');
              setActiveTab('home');
              setCurrentScreen('home');
              setActiveRequest(null);
              setExtractedNeed(null);
            } catch (err) {
              setAppError(getFriendlyErrorMessage(err, language));
            }
          }}
          onDeleteAccount={handleDeleteAccount}
        />

        <PhoneLoginModal
          open={phoneLogin !== null}
          language={language}
          reason={phoneLogin || 'header'}
          onCancel={() => {
            afterPhoneLoginRef.current = null;
            setPhoneLogin(null);
          }}
          onSuccess={() => {
            const next = afterPhoneLoginRef.current;
            afterPhoneLoginRef.current = null;
            setPhoneLogin(null);
            setPhoneNumber(auth?.currentUser?.phoneNumber || null);
            setAuthUid(auth?.currentUser?.uid || null);
            if (next) next();
          }}
        />

        {/* Realtime In-App Notification Toast */}
        <InAppToast
          notification={activeToastNotification}
          language={language}
          onClick={handleNotificationClick}
          onDismiss={() => setActiveToastNotification(null)}
        />

        {/* Fatal Offline Mutation Warning */}
        {hasFatalFailedMutations && (
          <div className="mx-4 mt-3 p-3 bg-rose-50 border border-rose-300 rounded-2xl flex items-center justify-between text-xs text-rose-900 animate-fadeIn">
            <span className="font-semibold">
              ⚠️{' '}
              {language === 'kz'
                ? 'Кейбір өзгерістер жіберілмеді. Қайталап көріңіз.'
                : 'Некоторые изменения не отправлены. Повторите попытку.'}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  offlineQueueService.retryFailed().catch(() => {});
                }}
                className="ml-2 min-h-[36px] px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-[12px] transition-colors"
              >
                {language === 'kz' ? 'Қайталау' : 'Повторить'}
              </button>
              <button
                type="button"
                onClick={() => offlineQueueService.dismissFailed()}
                aria-label={language === 'kz' ? 'Жабу' : 'Закрыть'}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-rose-500 hover:text-rose-700 font-bold"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Global Error Banner if repository operation fails */}
        {appError && (
          <div className="mx-4 mt-3 p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-800 animate-fadeIn">
            <span>{appError}</span>
            <button
              onClick={() => setAppError(null)}
              className="text-rose-500 hover:text-rose-700 font-bold ml-2 px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Dynamic Screen View */}
        <main className="flex-1 flex flex-col">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center py-16" role="status" aria-label="…">
                <span className="w-6 h-6 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
          {!appMode && (
            <RoleChooser
              language={language}
              onChoose={(mode) => (mode === 'provider' ? enterProviderMode() : enterCustomerMode())}
            />
          )}
          {appMode && restoringNav && (
            <div className="flex-1 flex items-center justify-center py-16" role="status">
              <span className="w-6 h-6 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {appMode && !restoringNav && activeTab === 'home' && (
            <>
              {currentScreen === 'home' && (
                <HomeScreen
                  language={language}
                  onSearch={handleSearch}
                  isAnalyzing={isAnalyzing}
                  onOpenProviderMode={() => handleTabChange('provider-mode')}
                  onServiceRequest={(need) => handleContinue(need)}
                  isSubmitting={isSubmittingRequest}
                />
              )}

              {currentScreen === 'interpretation' && extractedNeed && (
                <InterpretationScreen
                  initialNeed={extractedNeed}
                  language={language}
                  onContinue={handleContinue}
                  onBack={handleBack}
                  isSubmitting={isSubmittingRequest}
                />
              )}

              {currentScreen === 'results' && extractedNeed && (
                <ResultScreen
                  need={extractedNeed}
                  request={activeRequest || undefined}
                  language={language}
                  onNewSearch={handleNewSearch}
                  onEditSearch={handleEditSearch}
                />
              )}
            </>
          )}

          {appMode && activeTab === 'my-requests' && (
            <MyRequestsScreen
              requests={customerRequests}
              loading={!customerRequestsLoaded}
              language={language}
              onSelectRequest={handleSelectRequestFromHistory}
              onCreateNewRequest={handleNewSearch}
            />
          )}

          {appMode && activeTab === 'provider-mode' && (
            <ProviderModeScreen
              language={language}
              tab={providerTab}
              onTabChange={setProviderTab}
              onCountsChange={setProviderCounts}
              onOfferSent={() => {
                refreshData();
              }}
              onProfileCreated={() => {
                refreshData();
              }}
            />
          )}
          </Suspense>
        </main>

        {/* Fixed Mobile Bottom Navigation */}
        {appMode && (
          <BottomNav
            mode={appMode}
            activeTab={activeTab}
            providerTab={providerTab}
            language={language}
            onTabChange={handleTabChange}
            onProviderTabChange={(tab) => {
              setProviderTab(tab);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSwitchMode={appMode === 'provider' ? enterCustomerMode : enterProviderMode}
            requestsCount={customerRequests.length}
            providerCounts={providerCounts}
          />
        )}
      </div>
    </div>
  );
}
