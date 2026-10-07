import React, { useState, useEffect, useCallback } from 'react';
import { ExtractedNeed, Language, ServiceRequest } from './types';
import { Header } from './components/Header';
import { BottomNav, MainTab } from './components/BottomNav';
import { HomeScreen } from './components/HomeScreen';
import { InterpretationScreen } from './components/InterpretationScreen';
import { ResultScreen } from './components/ResultScreen';
import { MyRequestsScreen } from './components/MyRequestsScreen';
import { ProviderModeScreen } from './components/ProviderModeScreen';
import { analyzeRequestLocally } from './services/analyzer';
import {
  repository,
  getCurrentUserId,
  checkClientRateLimit,
  getFriendlyErrorMessage,
  isFirebaseConfigured,
  ensureFirebaseAuth,
  parseServiceRequest,
} from './services';
import {
  normalizeCategoryId,
  normalizeCityId,
  getCategoryDisplayName,
  getCityDisplayName,
} from './services/taxonomy';

export default function App() {
  const [language, setLanguage] = useState<Language>('kz');
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [currentScreen, setCurrentScreen] = useState<'home' | 'interpretation' | 'results'>('home');
  const [extractedNeed, setExtractedNeed] = useState<ExtractedNeed | null>(null);
  const [activeRequest, setActiveRequest] = useState<ServiceRequest | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [customerRequests, setCustomerRequests] = useState<ServiceRequest[]>([]);
  const [hasProviderProfile, setHasProviderProfile] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  // Security rule: Customer only sees their own requests!
  const refreshData = useCallback(async () => {
    try {
      const currentUserId = getCurrentUserId();
      const myRequests = await repository.getRequests({ customerId: currentUserId });
      setCustomerRequests(myRequests);

      const allProviders = await repository.getProviders();
      const customProv = allProviders.some((p) => !p.isDemo);
      setHasProviderProfile(customProv);
    } catch (err) {
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
  }, [refreshData]);

  // Trigger search & analysis using Gemini AI parser (with reliable fallback)
  const handleSearch = async (query: string) => {
    setIsAnalyzing(true);
    setAppError(null);

    // Baseline local parsing (instant, non-blocking fallback)
    const localParsed = analyzeRequestLocally(query, language);

    try {
      // 1. Invoke AI Request Parser abstraction
      const aiResponse = await parseServiceRequest(query);

      if (aiResponse.success && aiResponse.data) {
        const aiData = aiResponse.data;

        // 2. Validate and canonicalize against frontend taxonomy
        const canonicalCityId = normalizeCityId(aiData.cityId || localParsed.cityId);
        const canonicalCategoryId = normalizeCategoryId(aiData.categoryId || localParsed.categoryId);

        const localizedCity = getCityDisplayName(canonicalCityId, language);
        const localizedCategory = getCategoryDisplayName(canonicalCategoryId, language);

        const validUrgency =
          aiData.urgency === 'high' || aiData.urgency === 'normal' || aiData.urgency === 'low'
            ? aiData.urgency
            : localParsed.urgency;

        const serviceText = (aiData.service || localParsed.service || query).trim();

        const combinedNeed: ExtractedNeed = {
          city: localizedCity,
          cityId: canonicalCityId,
          category: localizedCategory,
          categoryId: canonicalCategoryId,
          service: serviceText,
          date: localParsed.date || (language === 'kz' ? 'Бүгін' : 'Сегодня'),
          budget: localParsed.budget || (language === 'kz' ? 'Келісімді' : 'Договорная'),
          urgency: validUrgency,
          originalQuery: query.trim(),
          confidence: aiData.confidence,
          isAiParsed: true,
        };

        setExtractedNeed(combinedNeed);
      } else {
        // AI parser returned error, rate limit, or was offline
        const fallbackNeed: ExtractedNeed = {
          ...localParsed,
          originalQuery: query.trim(),
          isAiParsed: false,
          aiError: aiResponse.error?.message || null,
        };
        setExtractedNeed(fallbackNeed);
      }
    } catch (err) {
      console.warn('[App] AI search fallback:', err);
      const fallbackNeed: ExtractedNeed = {
        ...localParsed,
        originalQuery: query.trim(),
        isAiParsed: false,
        aiError: getFriendlyErrorMessage(err, language),
      };
      setExtractedNeed(fallbackNeed);
    } finally {
      setIsAnalyzing(false);
      setCurrentScreen('interpretation');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Continue from interpretation: creates request in repository with customerId
  const handleContinue = async (updatedNeed: ExtractedNeed) => {
    setExtractedNeed(updatedNeed);
    setAppError(null);

    const currentUserId = getCurrentUserId();

    if (!checkClientRateLimit(`create_request_${currentUserId}`, 1000)) {
      return;
    }

    try {
      const rawText = (updatedNeed.originalQuery || updatedNeed.service || '').trim();
      const city = updatedNeed.city?.trim() || (language === 'kz' ? 'Қызылорда' : 'Кызылорда');
      const cityId = updatedNeed.cityId || normalizeCityId(city);
      const category = updatedNeed.category?.trim() || (language === 'kz' ? 'Тұрмыстық техника жөндеу' : 'Ремонт бытовой техники');
      const categoryId = updatedNeed.categoryId || normalizeCategoryId(category);
      const service = (updatedNeed.service || rawText || category).trim();
      const text = rawText || service;

      // Repository handles ID generation (REQ-000001), storage, and matching demo offers
      const newReq = await repository.createRequest({
        customerId: currentUserId,
        requestText: text,
        description: text,
        city,
        cityId,
        category,
        categoryId,
        service,
        date: updatedNeed.date?.trim() || (language === 'kz' ? 'Бүгін' : 'Сегодня'),
        budget: updatedNeed.budget?.trim() || (language === 'kz' ? 'Келісімді' : 'Договорная'),
        urgency: updatedNeed.urgency || 'normal',
        status: 'OPEN',
      });

      setActiveRequest(newReq);
      await refreshData();

      setCurrentScreen('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setAppError(getFriendlyErrorMessage(err, language));
    }
  };

  // Back actions
  const handleBack = () => {
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
  const handleTabChange = (tab: MainTab) => {
    setActiveTab(tab);
    if (tab === 'home' && currentScreen !== 'interpretation' && currentScreen !== 'results') {
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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-start sm:py-4">
      {/* Mobile Shell Container */}
      <div className="w-full max-w-md bg-white sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-200/80 min-h-screen sm:min-h-[780px] flex flex-col justify-between overflow-hidden relative">
        {/* Top Header */}
        <Header
          currentScreen={activeTab !== 'home' ? 'results' : currentScreen}
          language={language}
          onLanguageChange={setLanguage}
          onBack={handleBack}
          onHomeClick={handleHomeClick}
          onDataImported={refreshData}
        />

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
          {activeTab === 'home' && (
            <>
              {currentScreen === 'home' && (
                <HomeScreen
                  language={language}
                  onSearch={handleSearch}
                  isAnalyzing={isAnalyzing}
                  onOpenProviderMode={() => handleTabChange('provider-mode')}
                />
              )}

              {currentScreen === 'interpretation' && extractedNeed && (
                <InterpretationScreen
                  initialNeed={extractedNeed}
                  language={language}
                  onContinue={handleContinue}
                  onBack={handleBack}
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

          {activeTab === 'my-requests' && (
            <MyRequestsScreen
              requests={customerRequests}
              language={language}
              onSelectRequest={handleSelectRequestFromHistory}
              onCreateNewRequest={handleNewSearch}
            />
          )}

          {activeTab === 'provider-mode' && (
            <ProviderModeScreen
              language={language}
              onOfferSent={() => {
                refreshData();
              }}
            />
          )}
        </main>

        {/* Fixed Mobile Bottom Navigation */}
        <BottomNav
          activeTab={activeTab}
          language={language}
          onTabChange={handleTabChange}
          requestsCount={customerRequests.length}
          hasProviderProfile={hasProviderProfile}
        />
      </div>
    </div>
  );
}
