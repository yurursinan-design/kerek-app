import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Language } from '../types';
import { hasPhoto } from '../data/photos';
import { Emoji3D, Photo } from './CategoryIcon';

export type AppMode = 'customer' | 'provider';

interface RoleChooserProps {
  language: Language;
  onChoose: (mode: AppMode) => void;
}

const TEXT = {
  title: { kz: 'Қош келдіңіз!', ru: 'Добро пожаловать!' },
  question: { kz: 'Не істегіңіз келеді?', ru: 'Что вы хотите сделать?' },
  customer: { kz: 'Маман іздеймін', ru: 'Ищу мастера' },
  customerSub: {
    kz: 'Өтініш қалдырып, шеберлерден ұсыныс алыңыз',
    ru: 'Оставьте заявку и получите предложения от мастеров',
  },
  provider: { kz: 'Қызмет көрсетемін', ru: 'Оказываю услуги' },
  providerSub: {
    kz: 'Өз қалаңыздан тапсырыстар алып, табыс табыңыз',
    ru: 'Получайте заказы в своём городе и зарабатывайте',
  },
  later: {
    kz: 'Кейін төменгі мәзірден ауыстыра аласыз.',
    ru: 'Позже можно переключиться в нижнем меню.',
  },
} as const;

/** First screen: the visitor picks the customer or the provider side of the app. */
export const RoleChooser: React.FC<RoleChooserProps> = ({ language, onChoose }) => {
  const lang = language === 'kz' ? 'kz' : 'ru';
  const tx = (entry: { kz: string; ru: string }) => entry[lang];

  const card = (mode: AppMode) => {
    const isCustomer = mode === 'customer';
    const photo = isCustomer ? 'role_customer' : 'role_master';
    if (hasPhoto(photo)) {
      return (
        <button
          type="button"
          onClick={() => onChoose(mode)}
          className="press relative w-full h-[200px] overflow-hidden text-left rounded-[28px] text-white shadow-xl shadow-slate-900/15 bg-slate-800 animate-fadeUp"
          style={{ animationDelay: isCustomer ? '120ms' : '220ms' }}
        >
          <Photo name={photo} eager className="absolute inset-0 w-full h-full object-[50%_30%]" />
          <span
            className={`absolute inset-0 bg-linear-to-t ${isCustomer ? 'from-sky-950/95 via-sky-900/45' : 'from-emerald-950/95 via-emerald-900/45'} to-transparent`}
            aria-hidden="true"
          />
          <span className="absolute inset-x-0 bottom-0 p-5 flex items-end gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-bold font-display leading-tight">{tx(isCustomer ? TEXT.customer : TEXT.provider)}</span>
              <span className="block mt-1 text-[13px] leading-snug text-white/85">{tx(isCustomer ? TEXT.customerSub : TEXT.providerSub)}</span>
            </span>
            <span className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${isCustomer ? 'bg-sky-500' : 'bg-emerald-500'}`}>
              <ChevronRight className="w-5 h-5" strokeWidth={2.5} />
            </span>
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onChoose(mode)}
        className={`press relative w-full overflow-hidden text-left p-5 pr-28 rounded-[28px] text-white shadow-xl animate-fadeUp ${
          isCustomer
            ? 'bg-linear-to-br from-sky-500 via-sky-600 to-indigo-600 shadow-sky-600/25'
            : 'bg-linear-to-br from-emerald-500 via-emerald-600 to-teal-700 shadow-emerald-600/25'
        }`}
        style={{ animationDelay: isCustomer ? '120ms' : '220ms' }}
      >
        <span className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" aria-hidden="true" />
        <Emoji3D
          code={isCustomer ? '1f50d' : '1f9d1-200d-1f527'}
          size={88}
          eager
          className="absolute right-3 top-1/2 -mt-11 animate-float drop-shadow-xl"
          style={{ ['--tilt' as string]: isCustomer ? '-6deg' : '5deg', animationDelay: isCustomer ? '0s' : '-2s' }}
        />
        <span className="relative block text-xl font-bold font-display leading-tight">{tx(isCustomer ? TEXT.customer : TEXT.provider)}</span>
        <span className={`relative block mt-1.5 text-[13px] leading-snug ${isCustomer ? 'text-sky-50' : 'text-emerald-50'}`}>
          {tx(isCustomer ? TEXT.customerSub : TEXT.providerSub)}
        </span>
        <span className="relative mt-4 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/20">
          <ChevronRight className="w-5 h-5" strokeWidth={2.5} />
        </span>
      </button>
    );
  };

  return (
    <div className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center space-y-5">
      <div className="text-center space-y-2 animate-fadeUp">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mx-auto w-16 h-16 rounded-2xl shadow-lg shadow-sky-900/15" />
        <h1 className="text-[26px] font-bold text-slate-900 font-display">{tx(TEXT.title)}</h1>
        <p className="text-base text-slate-600">{tx(TEXT.question)}</p>
      </div>

      {card('customer')}
      {card('provider')}

      <p className="text-center text-xs text-slate-500">{tx(TEXT.later)}</p>
    </div>
  );
};
