import React, { useState } from 'react';
import { Language } from '../types';
import { translations } from '../i18n/translations';
import { Mic, MicOff, Search, Sparkles, Briefcase, ChevronRight } from 'lucide-react';

interface HomeScreenProps {
  language: Language;
  onSearch: (query: string) => void;
  isAnalyzing: boolean;
  onOpenProviderMode: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  language,
  onSearch,
  isAnalyzing,
  onOpenProviderMode,
}) => {
  const t = translations[language];
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || isAnalyzing) return;
    onSearch(query.trim());
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    // Smooth submit or pre-fill
    onSearch(example);
  };

  const handleMicClick = () => {
    // Check Web Speech API support safely without missing Window type error
    const win = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      // Visual feedback for non-functional MVP mic
      setSpeechNotice(t.micNotSupported);
      setTimeout(() => setSpeechNotice(null), 3500);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = language === 'kz' ? 'kk-KZ' : 'ru-RU';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListening(true);
      setSpeechNotice(t.micListening);

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setQuery(transcript);
        }
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.onend = () => {
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechNotice(null);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-6">
      <div className="space-y-5">
        {/* Top Kazakhstan Accent Banner */}
        <div className="text-center pt-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-50 border border-sky-100 rounded-full text-xs font-semibold text-sky-800 mb-2.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>{t.tagline}</span>
          </div>

          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight font-display mb-1.5">
            {t.headline}
          </h1>
          <p className="text-sm text-slate-600 max-w-xs mx-auto leading-relaxed">
            {t.subheadline}
          </p>
        </div>

        {/* Provider Entry Point Banner */}
        <button
          type="button"
          onClick={onOpenProviderMode}
          className="w-full p-3.5 bg-gradient-to-r from-sky-50 via-slate-50 to-amber-50/50 hover:from-sky-100/70 border border-sky-200/80 rounded-2xl flex items-center justify-between text-left transition-all active:scale-[0.99] shadow-2xs group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
                {t.providerEntryBanner}
              </div>
              <div className="text-xs text-slate-500">
                {t.providerEntrySubtext}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-sky-600 transition-colors shrink-0" />
        </button>

        {/* Search Input Box */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 focus-within:border-sky-500 shadow-sm transition-all overflow-hidden">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.inputPlaceholder}
              rows={4}
              className="w-full p-4 pr-14 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Microphone Button in the bottom right of the input */}
            <div className="absolute right-3 bottom-3 flex items-center gap-1">
              <button
                type="button"
                onClick={handleMicClick}
                title={t.micTooltip}
                className={`min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95'
                }`}
                aria-label={t.micTooltip}
              >
                {isListening ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Speech / notice feedback */}
          {speechNotice && (
            <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800 flex items-center gap-2 animate-fadeIn">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
              <span>{speechNotice}</span>
            </div>
          )}

          {/* Primary Action Button: "Найти решение" / "Шешім табу" */}
          <button
            type="submit"
            disabled={!query.trim() || isAnalyzing}
            className={`w-full min-h-[52px] rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.99] ${
              !query.trim() || isAnalyzing
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
            }`}
          >
            {isAnalyzing ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{t.analyzing}</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5 stroke-[2.5]" />
                <span>{t.searchButton}</span>
              </>
            )}
          </button>
        </form>

        {/* Examples Section */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{t.examplesTitle}</span>
          </div>

          <div className="flex flex-col gap-2">
            {t.examples.map((example, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleExampleClick(example)}
                className="w-full text-left p-3.5 bg-white hover:bg-sky-50/60 active:bg-sky-100 border border-slate-200/90 rounded-xl transition-all group flex items-start justify-between gap-3 shadow-2xs"
              >
                <span className="text-sm font-medium text-slate-700 group-hover:text-sky-900 leading-snug">
                  «{example}»
                </span>
                <span className="shrink-0 text-sky-600 opacity-60 group-hover:opacity-100 text-xs font-semibold mt-0.5">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="text-center text-xs text-slate-400 py-3 border-t border-slate-100">
        <span>КЕРЕК 2026 · Қазақстан · Екі жақты маркетплейс MVP</span>
      </footer>
    </div>
  );
};

