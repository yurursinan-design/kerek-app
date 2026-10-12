import React, { useState, useRef, useEffect } from 'react';
import { formatShortDate } from '../services/dateFormat';
import { AppNotification, Language } from '../types';
import {
  Bell,
  CheckCheck,
  CheckCircle,
  MessageSquare,
  Sparkles,
  Star,
  Tag,
  X,
} from 'lucide-react';
import { repository } from '../services';
import { auth } from '../services/firebase';
import { localizedText } from '../services/safeData';

interface NotificationBellProps {
  notifications: AppNotification[];
  unreadCount: number;
  language: Language;
  currentUserId: string;
  onSelectNotification: (notif: AppNotification) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  unreadCount,
  language,
  currentUserId,
  onSelectNotification,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleItemClick = async (notif: AppNotification) => {
    if (!notif.isRead) {
      try {
        await repository.markNotificationAsRead(notif.id);
      } catch (err) {
        console.warn('[NotificationBell] Mark read error:', err);
      }
    }
    setIsOpen(false);
    onSelectNotification(notif);
  };

  const handleMarkAllRead = async () => {
    const effectiveUid = auth?.currentUser?.uid || currentUserId;
    if (!effectiveUid) return;
    try {
      await repository.markAllNotificationsAsRead(effectiveUid);
    } catch (err) {
      console.warn('[NotificationBell] Mark all read error:', err);
    }
  };

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
      if (diffMin < 1) {
        return language === 'kz' ? 'Жаңа ғана' : 'Только что';
      }
      if (diffMin < 60) {
        return language === 'kz' ? `${diffMin} мин бұрын` : `${diffMin} мин назад`;
      }
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) {
        return language === 'kz' ? `${diffHours} сағ бұрын` : `${diffHours} ч назад`;
      }
      return formatShortDate(date, language);
    } catch {
      return '';
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'CUSTOMER_NEW_OFFER':
      case 'PROVIDER_OFFER_ACCEPTED':
      case 'CUSTOMER_OFFER_ACCEPTED':
        return <Tag className="w-4 h-4 text-emerald-600" />;
      case 'CUSTOMER_NEW_MESSAGE':
      case 'PROVIDER_NEW_MESSAGE':
        return <MessageSquare className="w-4 h-4 text-sky-600" />;
      case 'CUSTOMER_WORK_COMPLETED':
      case 'PROVIDER_WORK_COMPLETED':
        return <CheckCircle className="w-4 h-4 text-indigo-600" />;
      case 'CUSTOMER_REVIEW_REQUIRED':
        return <Star className="w-4 h-4 text-amber-500 fill-amber-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={language === 'kz' ? 'Хабарламалар' : 'Уведомления'}
        className="relative min-h-[36px] min-w-[36px] p-1.5 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Drawer / Dropdown */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={language === 'kz' ? 'Хабарламалар тізімі' : 'Список уведомлений'}
          className="fixed inset-x-2 top-14 sm:absolute sm:inset-x-auto sm:-right-8 sm:top-11 z-50 w-auto sm:w-80 max-h-[85vh] sm:max-h-[500px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden animate-fadeIn"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900">
                {language === 'kz' ? 'Хабарламалар' : 'Уведомления'}
              </span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full">
                  +{unreadCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  title={language === 'kz' ? 'Барлығын оқылды деп белгілеу' : 'Прочитать все'}
                  className="p-1 text-xs text-sky-600 hover:text-sky-800 hover:bg-sky-50 rounded flex items-center gap-1 transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[11px] font-semibold">
                    {language === 'kz' ? 'Бәрін оқу' : 'Прочитать'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* List of Notifications */}
          <div className="overflow-y-auto divide-y divide-slate-100 max-h-[380px]">
            {notifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                  <Bell className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-slate-600">
                  {language === 'kz' ? 'Жаңа хабарламалар жоқ' : 'Нет новых уведомлений'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {language === 'kz'
                    ? 'Ұсыныстар мен хабарламалар осында көрінеді'
                    : 'Здесь будут появляться предложения и сообщения'}
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const titleText = localizedText(notif.title, language);
                const bodyText = localizedText(notif.body, language);

                return (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => handleItemClick(notif)}
                    className={`w-full p-3.5 text-left flex items-start gap-3 transition-colors ${
                      notif.isRead
                        ? 'bg-white hover:bg-slate-50'
                        : 'bg-sky-50/50 hover:bg-sky-50/80'
                    }`}
                  >
                    {/* Event Icon with Badge Dot */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="w-8 h-8 rounded-xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-center">
                        {getEventIcon(notif.type)}
                      </div>
                      {!notif.isRead && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sky-600 ring-2 ring-white" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1">
                        <h4
                          className={`text-xs truncate ${
                            notif.isRead ? 'font-semibold text-slate-800' : 'font-bold text-slate-900'
                          }`}
                        >
                          {titleText}
                        </h4>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {formatTime(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5 leading-snug">
                        {bodyText}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
