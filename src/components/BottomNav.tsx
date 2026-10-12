import React from 'react';
import { Language } from '../types';
import { translations } from '../i18n/translations';
import { Search, ClipboardList, Briefcase } from 'lucide-react';

export type MainTab = 'home' | 'my-requests' | 'provider-mode';

interface BottomNavProps {
  activeTab: MainTab;
  language: Language;
  onTabChange: (tab: MainTab) => void;
  requestsCount: number;
  hasProviderProfile: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  language,
  onTabChange,
  requestsCount,
  hasProviderProfile,
}) => {
  const t = translations[language];

  return (
    <nav className="sticky bottom-0 z-40 w-full bg-white/95 backdrop-blur-md border-t border-slate-200">
      <div className="grid grid-cols-3 items-center h-16 max-w-md mx-auto px-2">
        {/* Tab 1: Home */}
        <button
          type="button"
          onClick={() => onTabChange('home')}
          className={`flex flex-col items-center justify-center min-h-[48px] py-1 transition-colors ${
            activeTab === 'home'
              ? 'text-sky-600 font-bold'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <Search className={`w-5 h-5 ${activeTab === 'home' ? 'stroke-[2.5]' : ''}`} />
          <span className="text-[11px] leading-tight tracking-tight mt-1 text-center line-clamp-2 max-w-full px-0.5">
            {t.navHome}
          </span>
        </button>

        {/* Tab 2: My Requests */}
        <button
          type="button"
          onClick={() => onTabChange('my-requests')}
          className={`relative flex flex-col items-center justify-center min-h-[48px] py-1 transition-colors ${
            activeTab === 'my-requests'
              ? 'text-sky-600 font-bold'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <div className="relative">
            <ClipboardList
              className={`w-5 h-5 ${activeTab === 'my-requests' ? 'stroke-[2.5]' : ''}`}
            />
            {requestsCount > 0 && (
              <span className="absolute -top-1 -right-2 w-4 h-4 rounded-full bg-sky-600 text-white text-[9px] font-extrabold flex items-center justify-center shadow-xs">
                {requestsCount}
              </span>
            )}
          </div>
          <span className="text-[11px] leading-tight tracking-tight mt-1 text-center line-clamp-2 max-w-full px-0.5">
            {t.navMyRequests}
          </span>
        </button>

        {/* Tab 3: Provider Mode */}
        <button
          type="button"
          onClick={() => onTabChange('provider-mode')}
          className={`relative flex flex-col items-center justify-center min-h-[48px] py-1 transition-colors ${
            activeTab === 'provider-mode'
              ? 'text-sky-600 font-bold'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <div className="relative">
            <Briefcase
              className={`w-5 h-5 ${activeTab === 'provider-mode' ? 'stroke-[2.5]' : ''}`}
            />
            {hasProviderProfile && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <span className="text-[11px] leading-tight tracking-tight mt-1 text-center line-clamp-2 max-w-full px-0.5">
            {t.navProviderMode}
          </span>
        </button>
      </div>
    </nav>
  );
};
