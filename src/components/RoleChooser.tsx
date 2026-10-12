import React from 'react';
import { Briefcase, Search } from 'lucide-react';
import { Language } from '../types';

export type AppMode = 'customer' | 'provider';

interface RoleChooserProps {
  language: Language;
  onChoose: (mode: AppMode) => void;
}

const TEXT = {
  title: { kz: 'Қош келдіңіз!', ru: 'Добро пожаловать!', tr: 'Hoş geldiniz!' },
  question: { kz: 'Не істегіңіз келеді?', ru: 'Что вы хотите сделать?', tr: 'Ne yapmak istiyorsunuz?' },
  customer: { kz: 'Маман іздеймін', ru: 'Ищу мастера', tr: 'Hizmet arıyorum' },
  customerSub: {
    kz: 'Өтініш қалдырып, шеберлерден ұсыныс алыңыз',
    ru: 'Оставьте заявку и получите предложения от мастеров',
    tr: 'Talep bırakın, ustalardan teklif alın',
  },
  provider: { kz: 'Қызмет көрсетемін', ru: 'Оказываю услуги', tr: 'Hizmet veriyorum' },
  providerSub: {
    kz: 'Өз қалаңыздан тапсырыстар алып, табыс табыңыз',
    ru: 'Получайте заказы в своём городе и зарабатывайте',
    tr: 'Şehrinizden iş alın, kazanın',
  },
  later: {
    kz: 'Кейін төменгі мәзірден ауыстыра аласыз.',
    ru: 'Позже можно переключиться в нижнем меню.',
    tr: 'Daha sonra alttaki menüden değiştirebilirsiniz.',
  },
} as const;

/** First screen: the visitor picks the customer or the provider side of the app. */
export const RoleChooser: React.FC<RoleChooserProps> = ({ language, onChoose }) => {
  const lang = language as 'kz' | 'ru' | 'tr';
  const tx = (entry: { kz: string; ru: string; tr: string }) => entry[lang] || entry.ru;

  return (
    <div className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-extrabold text-slate-900 font-display">{tx(TEXT.title)}</h1>
        <p className="text-base text-slate-600">{tx(TEXT.question)}</p>
      </div>

      <button
        type="button"
        onClick={() => onChoose('customer')}
        className="w-full text-left p-5 rounded-3xl bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white shadow-lg shadow-sky-600/20 transition-all flex items-center gap-4"
      >
        <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          <Search className="w-6 h-6" />
        </span>
        <span>
          <span className="block text-lg font-bold">{tx(TEXT.customer)}</span>
          <span className="block text-sm text-sky-100 leading-snug">{tx(TEXT.customerSub)}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onChoose('provider')}
        className="w-full text-left p-5 rounded-3xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-4"
      >
        <span className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          <Briefcase className="w-6 h-6" />
        </span>
        <span>
          <span className="block text-lg font-bold">{tx(TEXT.provider)}</span>
          <span className="block text-sm text-emerald-100 leading-snug">{tx(TEXT.providerSub)}</span>
        </span>
      </button>

      <p className="text-center text-xs text-slate-500">{tx(TEXT.later)}</p>
    </div>
  );
};
