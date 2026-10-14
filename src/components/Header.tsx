import React, { useState } from 'react';
import { AppNotification, Language } from '../types';
import { ArrowLeft, Trash2, UserRound, LogOut } from 'lucide-react';
import { maskPhone } from '../services/phoneAuth';
import { NotificationBell } from './NotificationBell';
import { LegalLinks } from './LegalModal';
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM } from '../config/support';

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
  onLogout?: () => void;
  /** Deletes the account; rejects with a message to show if it fails */
  onDeleteAccount?: () => Promise<void>;
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
  onLogout,
  onDeleteAccount,
}) => {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const accountLabel = 'Аккаунт';
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
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 flex items-center justify-center shadow-xs">
                <span className="text-white font-extrabold text-base font-display tracking-tight">
                  К
                </span>
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
                  КЕРЕК
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

            {/* Phone login: "log in" when not verified, otherwise the masked number with a log-out option */}
            {showAccount && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={accountLabel}
                  aria-expanded={showAccountMenu}
                  onClick={() => (phoneNumber ? setShowAccountMenu((v) => !v) : onLoginClick?.())}
                  className={`relative min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
                    phoneNumber ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <UserRound className="w-5 h-5" />
                  {phoneNumber && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500" />}
                </button>
                {phoneNumber && showAccountMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 space-y-2">
                    <div className="text-[11px] text-slate-500">
                      {language === 'kz' ? 'Расталған нөмір' : 'Подтверждённый номер'}
                    </div>
                    <div className="text-sm font-bold text-slate-900">{maskPhone(phoneNumber)}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAccountMenu(false);
                        onLogout?.();
                      }}
                      className="w-full min-h-[40px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{language === 'kz' ? 'Шығу' : 'Выйти'}</span>
                    </button>

                    {onDeleteAccount && !confirmDelete && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full min-h-[40px] rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{language === 'kz' ? 'Аккаунтты жою' : 'Удалить аккаунт'}</span>
                      </button>
                    )}

                    {onDeleteAccount && confirmDelete && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
                        <p className="text-[11px] text-rose-900 leading-relaxed">
                          {language === 'kz'
                            ? 'Профиліңіз, байланыс деректеріңіз және аккаунтыңыз жойылады, ашық өтініштер жабылады. Мұны қайтару мүмкін емес.'
                            : 'Профиль, контактные данные и аккаунт будут удалены, открытые заявки закроются. Это нельзя отменить.'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={async () => {
                              setDeleting(true);
                              try {
                                await onDeleteAccount();
                                setShowAccountMenu(false);
                              } finally {
                                setDeleting(false);
                                setConfirmDelete(false);
                              }
                            }}
                            className="flex-1 min-h-[38px] rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold"
                          >
                            {language === 'kz' ? 'Жою' : 'Удалить'}
                          </button>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => setConfirmDelete(false)}
                            className="flex-1 min-h-[38px] rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold"
                          >
                            {language === 'kz' ? 'Болдырмау' : 'Отмена'}
                          </button>
                        </div>
                      </div>
                    )}

                    {(SUPPORT_TELEGRAM || SUPPORT_EMAIL) && (
                      <a
                        href={SUPPORT_TELEGRAM ? `https://t.me/${SUPPORT_TELEGRAM}` : `mailto:${SUPPORT_EMAIL}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full min-h-[44px] rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 text-center leading-[44px]"
                      >
                        {language === 'kz' ? 'Көмек және қолдау' : 'Помощь и поддержка'}
                      </a>
                    )}
                    <LegalLinks language={language} className="block text-[10px] text-slate-500 text-center leading-relaxed pt-1" />
                  </div>
                )}
              </div>
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

