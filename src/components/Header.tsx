import React, { useState, useRef, useEffect } from 'react';
import { AppNotification, Language } from '../types';
import { ArrowLeft, Database, Download, Upload, X, CheckCircle, AlertCircle, Cloud, RefreshCw, ShieldAlert, ShieldCheck, Trash2, UserRound, LogOut } from 'lucide-react';
import { maskPhone } from '../services/phoneAuth';
import { isDebugMode } from '../services/debug';
import { exportLocalData, importLocalData, clearAllKerekLocalStorage, isFirebaseConfigured, resilientRepository, runFirebaseDiagnostics, getLatestDiagnosticReport } from '../services';
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
  /** SMS login controls (cloud mode only) */
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
  onDataImported,
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
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const accountLabel =
    language === 'kz' ? 'Аккаунт' : language === 'tr' ? 'Hesap' : 'Аккаунт';
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isCloud, setIsCloud] = useState<boolean>(() => resilientRepository.isCloudActive());
  const [diagReport, setDiagReport] = useState<any>(() => getLatestDiagnosticReport());
  const [isRunningDiag, setIsRunningDiag] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync cloud status periodically or when modal opens
  useEffect(() => {
    const update = () => {
      setIsCloud(resilientRepository.isCloudActive());
      setDiagReport(getLatestDiagnosticReport());
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleRunDiagnostic = async () => {
    setIsRunningDiag(true);
    try {
      const rep = await runFirebaseDiagnostics();
      setDiagReport(rep);
      setIsCloud(resilientRepository.isCloudActive());
    } finally {
      setIsRunningDiag(false);
    }
  };

  const handleExport = () => {
    exportLocalData();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const result = importLocalData(content);
        setImportStatus(result);
        if (result.success && onDataImported) {
          onDataImported();
        }
      }
    };
    reader.readAsText(file);
    // Reset file input value
    e.target.value = '';
  };

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
            {/* Developer-only CLOUD / Firebase or DEMO / Local Storage badge (opens diagnostics and data tools) */}
            {isDebugMode && (
            <button
              type="button"
              onClick={() => setShowDemoModal(true)}
              title={
                isCloud
                  ? (language === 'kz' ? 'Бұлтты Firebase режимі' : 'Облачный режим Firebase')
                  : (language === 'kz' ? 'Локалды құрылғы' : 'Локальное устройство')
              }
              className={`inline-flex items-center gap-1 px-2 py-1 active:scale-95 border rounded-md text-[9px] sm:text-[10px] font-bold tracking-tight transition-all ${
                isCloud
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 hover:bg-amber-100/80 text-amber-800 border-amber-200/90'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCloud ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'
                }`}
              />
              <span>{isCloud ? 'CLOUD / Firebase' : 'DEMO / Local Storage'}</span>
            </button>
            )}

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

            {/* SMS login: "log in" when not verified, otherwise the masked number with a log-out option */}
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
                      {language === 'kz' ? 'Расталған нөмір' : language === 'tr' ? 'Doğrulanmış numara' : 'Подтверждённый номер'}
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
                      <span>{language === 'kz' ? 'Шығу' : language === 'tr' ? 'Çıkış yap' : 'Выйти'}</span>
                    </button>

                    {onDeleteAccount && !confirmDelete && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full min-h-[40px] rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{language === 'kz' ? 'Аккаунтты жою' : language === 'tr' ? 'Hesabı sil' : 'Удалить аккаунт'}</span>
                      </button>
                    )}

                    {onDeleteAccount && confirmDelete && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
                        <p className="text-[11px] text-rose-900 leading-relaxed">
                          {language === 'kz'
                            ? 'Профиліңіз, байланыс деректеріңіз және аккаунтыңыз жойылады, ашық өтініштер жабылады. Мұны қайтару мүмкін емес.'
                            : language === 'tr'
                            ? 'Profiliniz, iletişim bilgileriniz ve hesabınız silinir, açık talepler kapanır. Bu işlem geri alınamaz.'
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
                            {language === 'kz' ? 'Жою' : language === 'tr' ? 'Sil' : 'Удалить'}
                          </button>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => setConfirmDelete(false)}
                            className="flex-1 min-h-[38px] rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold"
                          >
                            {language === 'kz' ? 'Болдырмау' : language === 'tr' ? 'Vazgeç' : 'Отмена'}
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

      {/* Cloud / Local Storage Info & Backup Modal */}
      {showDemoModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    isCloud
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {isCloud ? <Cloud className="w-5 h-5" /> : <Database className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {isCloud ? 'CLOUD / Firebase' : 'DEMO / Local Storage'}
                  </h3>
                  <span
                    className={`text-[10px] font-semibold ${
                      isCloud ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {isCloud
                      ? (language === 'kz' ? 'Бұлтты база белсенді' : 'Облачная база активна')
                      : (language === 'kz' ? 'Локалды құрылғы' : 'Локальное хранилище')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDemoModal(false);
                  setImportStatus(null);
                }}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {isCloud
                ? (language === 'kz'
                    ? 'Қолданба нақты Firebase Cloud Firestore дерекқорына қосылған. Өтініштер мен ұсыныстар бұлтта нақты уақытта қауіпсіз синхрондалады.'
                    : 'Приложение подключено к Cloud Firestore. Заявки, предложения и профили сохраняются в облаке и доступны между устройствами.')
                : (language === 'kz'
                    ? 'Қазіргі таңда деректеріңіз тек осы құрылғының браузерінде сақталады. Firebase конфигурациясы қосылған бойда қолданба автоматты түрде бұлтты режимге ауысады.'
                    : 'Ваши данные (заявки, предложения, профиль мастера) сохраняются только на этом устройстве в памяти браузера. Как только Firebase настроен, сервис переключится в облачный режим автоматически.')}
            </p>

            {/* Status message */}
            {importStatus && (
              <div
                className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  importStatus.success
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {importStatus.success ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{importStatus.message}</span>
              </div>
            )}

            {/* LIVE FIREBASE DIAGNOSTICS SECTION */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-sky-600" />
                  {language === 'kz' ? 'Firebase диагностикасы' : 'Диагностика Firebase'}
                </span>
                <button
                  type="button"
                  onClick={handleRunDiagnostic}
                  disabled={isRunningDiag}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg font-semibold text-[11px] text-slate-700 flex items-center gap-1 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRunningDiag ? 'animate-spin' : ''}`} />
                  <span>{isRunningDiag ? 'Тестілеу...' : (language === 'kz' ? 'Қайта тексеру' : 'Повторить тест')}</span>
                </button>
              </div>

              {diagReport ? (
                <div className="space-y-1.5 font-mono text-[11px] pt-1 border-t border-slate-200/70">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">1. Config:</span>
                    <span className={diagReport.config.ok ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                      {diagReport.config.ok ? `OK (${diagReport.config.projectId})` : 'MISSING'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">2. Anonymous Auth:</span>
                    <span className={diagReport.auth.ok ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                      {diagReport.auth.ok ? `OK (${diagReport.auth.uid?.substring(0, 6)}...)` : 'FAILED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">3. Connection Test:</span>
                    <span className={diagReport.connection.ok ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                      {diagReport.connection.ok ? 'OK' : 'FAILED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">4. Firestore Read:</span>
                    <span className={diagReport.firestoreRead.ok ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                      {diagReport.firestoreRead.ok ? 'OK' : 'FAILED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">5. Firestore Write:</span>
                    <span className={diagReport.firestoreWrite.ok ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                      {diagReport.firestoreWrite.ok ? 'OK' : 'FAILED'}
                    </span>
                  </div>
                  <div className="pt-1.5 text-[10px] text-slate-700 leading-tight border-t border-slate-200/60 font-sans">
                    <strong>{language === 'kz' ? 'Қауіпсіздік ережелері:' : 'Статус правил Firestore:'} </strong>
                    <span className={diagReport.securityRules.ok ? 'text-emerald-700 font-semibold' : 'text-amber-800'}>
                      {diagReport.securityRules.message}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 py-1">
                  {language === 'kz' ? 'Диагностика іске қосылуда...' : 'Диагностика запускается...'}
                </div>
              )}
            </div>

            {/* Backup Actions */}
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={handleExport}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4 text-slate-600" />
                <span>Export Local Data (JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4 text-slate-600" />
                <span>Import Local Data (JSON)</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />

              <button
                type="button"
                disabled={isResetting}
                onClick={() => {
                  console.log("RESET BUTONU TIKLANDI");
                  setIsResetting(true);
                  try {
                    if (typeof (window as any).resetKerekLocalStorage === 'function') {
                      (window as any).resetKerekLocalStorage();
                    } else {
                      clearAllKerekLocalStorage();
                    }
                    console.log("[KEREK] LocalStorage başarıyla sıfırlandı. Sayfa yenileniyor...");
                  } catch (err) {
                    console.error("[KEREK] Reset hatası:", err);
                    clearAllKerekLocalStorage();
                  }
                  setTimeout(() => {
                    window.location.reload();
                  }, 250);
                }}
                className={`w-full min-h-[42px] px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 border transition-all ${
                  isResetting
                    ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                    : 'bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border-rose-200'
                }`}
              >
                <Trash2 className={`w-4 h-4 ${isResetting ? 'text-white animate-spin' : 'text-rose-600'}`} />
                <span>
                  {isResetting
                    ? (language === 'kz'
                        ? 'Тазартылуда... Қайта жүктелуде'
                        : language === 'tr'
                        ? 'Sıfırlanıyor... Yenileniyor'
                        : 'Сброс... Перезагрузка')
                    : (language === 'kz'
                        ? 'LocalStorage толық тазалау (Reset)'
                        : language === 'tr'
                        ? 'LocalStorage Sıfırla (Tam Reset)'
                        : 'Полный сброс LocalStorage')}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowDemoModal(false);
                setImportStatus(null);
              }}
              className="w-full min-h-[42px] rounded-xl bg-slate-900 text-white font-semibold text-xs flex items-center justify-center hover:bg-slate-800 transition-colors"
            >
              {language === 'kz' ? 'Түсінікті' : 'Понятно'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

