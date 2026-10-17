import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Language } from '../types';
import { SERVICE_CATALOG, getService, groupName, serviceName } from '../data/serviceCatalog';
import { groupPhoto } from '../data/photos';
import { CategoryIcon } from './CategoryIcon';

interface ServicePickerProps {
  language: Language;
  selected: string[];
  onChange: (serviceIds: string[]) => void;
}

/** Lets a provider tick the services they offer, grouped by category, with search. */
export const ServicePicker: React.FC<ServicePickerProps> = ({ language, selected, onChange }) => {
  const lang = language === 'kz' ? 'kz' : 'ru';
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const groups = useMemo(
    () =>
      SERVICE_CATALOG.map((g) => ({
        group: g,
        services: q
          ? g.services.filter((s) => s.kz.toLowerCase().includes(q) || s.ru.toLowerCase().includes(q) || (s.keywords || []).some((k) => k.includes(q)))
          : g.services,
      })).filter((x) => x.services.length > 0),
    [q]
  );

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const found = getService(id);
            if (!found) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-sky-100 text-sky-900 text-xs font-semibold"
              >
                {serviceName(found.service, lang)}
                <X className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-500">
        <Search className="w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'kz' ? 'Қызметті іздеу' : 'Поиск услуги'}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden bg-white">
        {groups.map(({ group, services }) => {
          const isOpen = Boolean(q) || open === group.id;
          const count = group.services.filter((s) => selected.includes(s.id)).length;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen && !q ? null : group.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
              >
                <CategoryIcon emoji={group.emoji} color={group.color} photo={groupPhoto(group.id)} size="sm" />
                <span className="flex-1 text-sm font-semibold text-slate-800">{groupName(group, lang)}</span>
                {count > 0 && (
                  <span className="min-w-6 h-6 px-1.5 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">{count}</span>
                )}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="pb-2 px-2">
                  {group.licensed && (
                    <p className="mx-1 mb-1 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                      {lang === 'kz'
                        ? 'Бұл жұмыстарға лицензия, рұқсат немесе сертификат қажет болуы мүмкін. Тек құқығыңыз болса таңдаңыз; тапсырыс беруші құжаттарды сұрауы мүмкін.'
                        : 'Для этих работ может требоваться лицензия, допуск или сертификат. Выбирайте, только если они у вас есть; заказчик может попросить документы.'}
                    </p>
                  )}
                  {services.map((s) => {
                    const on = selected.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-pressed={on}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50"
                      >
                        <span
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                            on ? 'bg-sky-600 border-sky-600' : 'border-slate-300'
                          }`}
                        >
                          {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                        </span>
                        <span className="text-sm text-slate-800">{serviceName(s, lang)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
