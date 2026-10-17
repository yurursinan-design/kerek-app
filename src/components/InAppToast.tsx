import React, { useEffect, useState } from 'react';
import { AppNotification, Language } from '../types';
import { Bell, ChevronRight, X } from 'lucide-react';
import { localizedText } from '../services/safeData';

interface InAppToastProps {
  notification: AppNotification | null;
  language: Language;
  onClick: (notif: AppNotification) => void;
  onDismiss: () => void;
}

export const InAppToast: React.FC<InAppToastProps> = ({
  notification,
  language,
  onClick,
  onDismiss,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (notification) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300); // Wait for transition before cleanup
      }, 4500);

      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [notification, onDismiss]);

  if (!notification) return null;

  const title = localizedText(notification.title, language);
  const body = localizedText(notification.body, language);

  return (
    <div
      role="alert"
      className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-sm transition duration-300 ease-out ${
        isVisible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
      }`}
    >
      <div
        onClick={() => {
          setIsVisible(false);
          onClick(notification);
        }}
        className="w-full bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-xl border border-slate-700/60 flex items-start gap-3 cursor-pointer hover:bg-slate-900 active:scale-[0.99] transition group"
      >
        {/* Animated Bell Icon */}
        <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0 mt-0.5 text-sky-400 group-hover:scale-110 transition-transform">
          <Bell className="w-4 h-4 animate-bounce" />
        </div>

        {/* Text Details */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-white truncate">{title}</h4>
            <span className="text-[10px] text-sky-400 font-semibold tracking-wide ml-1 shrink-0 uppercase">
              {language === 'kz' ? 'Жаңа' : 'Новое'}
            </span>
          </div>
          <p className="text-[11px] text-slate-300 line-clamp-2 mt-0.5 leading-snug">
            {body}
          </p>
        </div>

        {/* Navigation Indicator & Close */}
        <div className="flex items-center gap-1 shrink-0 mt-1">
          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white group-hover:translate-x-0.5 transition" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsVisible(false);
              setTimeout(onDismiss, 300);
            }}
            aria-label="Жабу"
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
