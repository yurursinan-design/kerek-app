import React from 'react';
import { AppNotification, Language } from '../types';
import { ArrowLeft, UserRound } from 'lucide-react';
import { NotificationBell } from './NotificationBell';

interface HeaderProps {
  currentScreen: 'home' | 'interpretation' | 'results';
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onBack: () => void;
  onHomeClick: () => void;
  onDataImported?: () => void;
  notifications?: AppNotification[];
  unreadCount?: number;
  currentUserId?: string;
  onSelectNotification?: (notif: AppNotification) => void;
  /** Phone login controls (cloud mode only) */
  showAccount?: boolean;
  phoneNumber?: string | null;
  onLoginClick?: () => void;
  /** Opens the profile tab (account, settings, logout) */
  onOpenProfile?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  language,
  onLanguageChange,
  onBack,
  onHomeClick,
  notifications = [],
  unreadCount = 0,
  currentUserId = '',
  onSelectNotification,
  showAccount = false,
  phoneNumber = null,
  onLoginClick,
  onOpenProfile,
}) => {
  const accountLabel = 'Профиль';
  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left slot: Back button or Brand logo */}
          <div className="flex items-center gap-2">
            {currentScreen !== 'home' ? (
              <button
                onClick={onBack}
                aria-label={language === 'kz' ? 'Артқа' : 'Назад'}
                className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-slate-700 hover:text-slate-900 active:scale-95 transition-transform"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : null}

            <button
              onClick={onHomeClick}
              className="flex items-center gap-2 text-left group transition-opacity hover:opacity-90"
            >
              {/* The app icon, so the header and the phone's home screen show the same mark */}
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="w-8 h-8" />
              <div>
                <span className="text-lg font-bold tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
                  Tapsyr
                </span>
                <span className="ml-1.5 text-[10px] uppercase font-semibold tracking-wider text-sky-600">
                  KZ
                </span>
              </div>
            </button>
          </div>

          {/* Right slot: Cloud/Demo Badge + Language Switcher RU / KZ */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => onLanguageChange('kz')}
                aria-pressed={language === 'kz'}
                className={`min-h-[40px] px-3 text-xs font-semibold rounded-md transition-all ${
                  language === 'kz'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                KZ
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange('ru')}
                aria-pressed={language === 'ru'}
                className={`min-h-[40px] px-3 text-xs font-semibold rounded-md transition-all ${
                  language === 'ru'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                RU
              </button>
            </div>

            {/* Account: "log in" when not verified, otherwise the profile tab */}
            {showAccount && (
              <button
                type="button"
                aria-label={accountLabel}
                onClick={() => (phoneNumber ? onOpenProfile?.() : onLoginClick?.())}
                className={`relative min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
                  phoneNumber ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <UserRound className="w-5 h-5" />
                {phoneNumber && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500" />}
              </button>
            )}

            {/* In-App Notifications Bell */}
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              language={language}
              currentUserId={currentUserId}
              onSelectNotification={onSelectNotification || (() => {})}
            />
          </div>
        </div>
      </header>

    </>
  );
};

