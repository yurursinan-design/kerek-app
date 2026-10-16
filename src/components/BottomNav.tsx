import React from 'react';
import { Language } from '../types';
import { translations } from '../i18n/translations';
import { Search, ClipboardList, Briefcase, Send, Clock, ArrowLeftRight, UserRound } from 'lucide-react';
import type { AppMode } from './RoleChooser';
import type { ProviderTab } from './ProviderModeScreen';

export type MainTab = 'home' | 'my-requests' | 'provider-mode' | 'profile';

interface BottomNavProps {
  mode: AppMode;
  activeTab: MainTab;
  providerTab: ProviderTab;
  language: Language;
  onTabChange: (tab: MainTab) => void;
  onProviderTabChange: (tab: ProviderTab) => void;
  onSwitchMode: () => void;
  requestsCount: number;
  providerCounts: Record<ProviderTab, number>;
}

const L = {
  providerNew: { kz: 'Жаңа өтініштер', ru: 'Новые заявки' },
  providerOffers: { kz: 'Ұсыныстарым', ru: 'Мои предложения' },
  providerActive: { kz: 'Белсенді жұмыстар', ru: 'Активные заказы' },
  profile: { kz: 'Профиль', ru: 'Профиль' },
} as const;

interface ItemProps {
  active: boolean;
  activeClass: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  badgeClass?: string;
  onClick: () => void;
}

const NavItem: React.FC<ItemProps> = ({ active, activeClass, label, icon, badge, badgeClass, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`relative flex flex-col items-center justify-center min-h-[48px] py-1 transition-colors ${
      active ? `${activeClass} font-bold` : 'text-slate-500 hover:text-slate-800 font-medium'
    }`}
  >
    <div className="relative">
      {icon}
      {badge !== undefined && badge > 0 && (
        <span
          className={`absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center shadow-xs ${badgeClass}`}
        >
          {badge}
        </span>
      )}
    </div>
    <span className="text-[11px] leading-tight tracking-tight mt-1 text-center line-clamp-2 max-w-full px-0.5">{label}</span>
  </button>
);

/**
 * Bottom navigation. The customer side (blue) and the provider side (green) have their own items
 * and both end with the profile tab. Customers also get a button to the provider side; providers
 * switch back from the profile tab.
 */
export const BottomNav: React.FC<BottomNavProps> = ({
  mode,
  activeTab,
  providerTab,
  language,
  onTabChange,
  onProviderTabChange,
  onSwitchMode,
  requestsCount,
  providerCounts,
}) => {
  const t = translations[language];
  const lang = language;
  const tx = (entry: { kz: string; ru: string }) => entry[lang] || entry.ru;
  const iconClass = (active: boolean) => `w-5 h-5 ${active ? 'stroke-[2.5]' : ''}`;
  const onProfile = activeTab === 'profile';
  const providerActive = (tab: ProviderTab) => !onProfile && providerTab === tab;

  return (
    <nav
      className={`sticky bottom-0 z-40 w-full bg-white/95 backdrop-blur-md border-t-2 ${
        mode === 'provider' ? 'border-emerald-500' : 'border-sky-500'
      }`}
    >
      {mode === 'customer' ? (
        <div className="grid grid-cols-4 items-center h-16 max-w-md mx-auto px-1">
          <NavItem
            active={activeTab === 'home'}
            activeClass="text-sky-600"
            label={t.navHome}
            icon={<Search className={iconClass(activeTab === 'home')} />}
            onClick={() => onTabChange('home')}
          />
          <NavItem
            active={activeTab === 'my-requests'}
            activeClass="text-sky-600"
            label={t.navMyRequests}
            icon={<ClipboardList className={iconClass(activeTab === 'my-requests')} />}
            badge={requestsCount}
            badgeClass="bg-sky-600"
            onClick={() => onTabChange('my-requests')}
          />
          <NavItem
            active={false}
            activeClass=""
            label={t.navProviderMode}
            icon={<ArrowLeftRight className="w-5 h-5 text-emerald-600" />}
            onClick={onSwitchMode}
          />
          <NavItem
            active={onProfile}
            activeClass="text-sky-600"
            label={tx(L.profile)}
            icon={<UserRound className={iconClass(onProfile)} />}
            onClick={() => onTabChange('profile')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-4 items-center h-16 max-w-md mx-auto px-1">
          <NavItem
            active={providerActive('new')}
            activeClass="text-emerald-700"
            label={tx(L.providerNew)}
            icon={<Briefcase className={iconClass(providerActive('new'))} />}
            badge={providerCounts.new}
            badgeClass="bg-emerald-600"
            onClick={() => onProviderTabChange('new')}
          />
          <NavItem
            active={providerActive('offers')}
            activeClass="text-emerald-700"
            label={tx(L.providerOffers)}
            icon={<Send className={iconClass(providerActive('offers'))} />}
            badge={providerCounts.offers}
            badgeClass="bg-emerald-600"
            onClick={() => onProviderTabChange('offers')}
          />
          <NavItem
            active={providerActive('active')}
            activeClass="text-emerald-700"
            label={tx(L.providerActive)}
            icon={<Clock className={iconClass(providerActive('active'))} />}
            badge={providerCounts.active}
            badgeClass="bg-emerald-600"
            onClick={() => onProviderTabChange('active')}
          />
          <NavItem
            active={onProfile}
            activeClass="text-emerald-700"
            label={tx(L.profile)}
            icon={<UserRound className={iconClass(onProfile)} />}
            onClick={() => onTabChange('profile')}
          />
        </div>
      )}
    </nav>
  );
};
