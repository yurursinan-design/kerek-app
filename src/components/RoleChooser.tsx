import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Language } from '../types';
import { Emoji3D } from './CategoryIcon';

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
        <Emoji3D code="1f44b" size={72} eager className="mx-auto animate-float" style={{ ['--tilt' as string]: '12deg' }} />
        <h1 className="text-[26px] font-bold text-slate-900 font-display">{tx(TEXT.title)}</h1>
        <p className="text-base text-slate-600">{tx(TEXT.question)}</p>
      </div>

      {card('customer')}
      {card('provider')}

      <p className="text-center text-xs text-slate-500">{tx(TEXT.later)}</p>
    </div>
  );
};
