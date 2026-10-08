import React, { useState, useRef, useEffect } from 'react';
import { AppNotification, Language } from '../types';
import { ArrowLeft, Database, Download, Upload, X, CheckCircle, AlertCircle, Cloud, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { exportLocalData, importLocalData, isFirebaseConfigured, resilientRepository, runFirebaseDiagnostics, getLatestDiagnosticReport } from '../services';
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
}) => {
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isCloud, setIsCloud] = useState<boolean>(() => resilientRepository.isCloudActive());
  const [diagReport, setDiagReport] = useState<any>(() => getLatestDiagnosticReport());
  const [isRunningDiag, setIsRunningDiag] = useState<boolean>(false);
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
                aria-label="Назад"
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
            {/* Clickable CLOUD / Firebase or DEMO / Local Storage badge */}
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

            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => onLanguageChange('kz')}
                className={`min-h-[36px] px-2.5 text-xs font-semibold rounded-md transition-all ${
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
                className={`min-h-[36px] px-2.5 text-xs font-semibold rounded-md transition-all ${
                  language === 'ru'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                RU
              </button>
            </div>

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

