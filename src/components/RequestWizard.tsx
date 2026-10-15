import React, { useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { ExtractedNeed, Language, PendingAttachment, RequestLocation, Urgency, sanitizeFileName, validateRequestAttachment } from '../types';
import { CatalogGroup, CatalogService, groupName, serviceName } from '../data/serviceCatalog';
import { CANONICAL_CITIES, PILOT_CITY_ID, isCityOpen } from '../services/taxonomy';
import { CategoryIcon, Emoji3D, tone } from './CategoryIcon';

interface RequestWizardProps {
  language: Language;
  group: CatalogGroup;
  service: CatalogService;
  /** Pre-selected city (e.g. from the last request) */
  defaultCityId?: string;
  onCancel: () => void;
  onSubmit: (need: ExtractedNeed) => void;
  /** The request is being sent */
  submitting?: boolean;
}

type Lang = 'kz' | 'ru';
const T = {
  licenseNote: {
    kz: 'Бұл жұмыс түріне лицензия, рұқсат немесе сертификат қажет болуы мүмкін (мысалы, газ, электр, медициналық күтім, заң қызметі). Келісер алдында маманнан құжаттарын көрсетуді сұраңыз.',
    ru: 'Для этого вида работ может требоваться лицензия, допуск или сертификат (например, газ, электрика, медицинский уход, юридические услуги). Перед тем как договориться, попросите мастера показать документы.',
  },
  step: { kz: 'Қадам', ru: 'Шаг' },
  of: { kz: '/', ru: 'из' },
  back: { kz: 'Артқа', ru: 'Назад' },
  next: { kz: 'Келесі', ru: 'Далее' },
  skip: { kz: 'Өткізіп жіберу', ru: 'Пропустить' },
  send: { kz: 'Өтінішті жіберу', ru: 'Отправить заявку' },
  close: { kz: 'Жабу', ru: 'Закрыть' },
  describeTitle: { kz: 'Не істеу керек?', ru: 'Что нужно сделать?' },
  quickLabel: { kz: 'Тез таңдау', ru: 'Быстрый выбор' },
  describeHint: {
    kz: 'Қысқаша жазыңыз: не бұзылды, қандай көлем, ерекше тілектер. Фото шеберге бағаны тез айтуға көмектеседі.',
    ru: 'Кратко опишите: что случилось, какой объём, особые пожелания. Фото помогают мастеру быстрее назвать цену.',
  },
  describePlaceholder: { kz: 'Мысалы: асүйдегі кран ағып тұр, ауыстыру керек', ru: 'Например: на кухне течёт кран, нужно заменить' },
  addPhoto: { kz: 'Фото қосу', ru: 'Добавить фото' },
  whenTitle: { kz: 'Қашан керек?', ru: 'Когда нужно?' },
  whereTitle: { kz: 'Қай қалада?', ru: 'В каком городе?' },
  partOfDayTitle: { kz: 'Қай уақытта ыңғайлы? (міндетті емес)', ru: 'В какое время удобно? (необязательно)' },
  soon: { kz: 'Жақында', ru: 'Скоро' },
  pilotNote: {
    kz: 'Tapsyr әзірге тек Қызылордада жұмыс істейді. Басқа қалалар жақында ашылады.',
    ru: 'Tapsyr пока работает только в Кызылорде. Другие города откроются позже.',
  },
  location: { kz: 'Нақты орынды қосу (міндетті емес)', ru: 'Добавить точное место (необязательно)' },
  locationAdded: { kz: 'Орын қосылды', ru: 'Место добавлено' },
  locationNote: {
    kz: 'Шеберлерге тек шамамен орын көрсетіледі. Нақты мекенжай тек сіз таңдаған шеберге ашылады.',
    ru: 'Мастерам показывается только примерное место. Точный адрес видит только выбранный вами мастер.',
  },
  locationFailed: { kz: 'Орынды анықтау мүмкін болмады', ru: 'Не удалось определить место' },
  budgetTitle: { kz: 'Бюджет қандай?', ru: 'Какой бюджет?' },
  budgetCustom: { kz: 'Өз сомаңыз (₸)', ru: 'Своя сумма (₸)' },
  reviewTitle: { kz: 'Тексеріп, жіберіңіз', ru: 'Проверьте и отправьте' },
  service: { kz: 'Қызмет', ru: 'Услуга' },
  details: { kz: 'Сипаттама', ru: 'Описание' },
  when: { kz: 'Уақыты', ru: 'Когда' },
  city: { kz: 'Қала', ru: 'Город' },
  budget: { kz: 'Бюджет', ru: 'Бюджет' },
  photos: { kz: 'Фото', ru: 'Фото' },
  edit: { kz: 'Өзгерту', ru: 'Изменить' },
  tags: { kz: 'Таңдалғаны', ru: 'Выбрано' },
  freeNote: {
    kz: 'Өтініш тегін. Шеберлер ұсыныс жібереді, сіз өзіңізге ыңғайлысын таңдайсыз.',
    ru: 'Заявка бесплатна. Мастера пришлют предложения, вы выберете подходящее.',
  },
} as const;

const WHEN_OPTIONS: { id: string; kz: string; ru: string; urgency: Urgency; emoji: string }[] = [
  { id: 'urgent', kz: 'Шұғыл, қазір', ru: 'Срочно, сейчас', urgency: 'high', emoji: '1f6a8' },
  { id: 'today', kz: 'Бүгін', ru: 'Сегодня', urgency: 'high', emoji: '2600-fe0f' },
  { id: 'tomorrow', kz: 'Ертең', ru: 'Завтра', urgency: 'normal', emoji: '1f305' },
  { id: 'week', kz: 'Осы аптада', ru: 'На этой неделе', urgency: 'normal', emoji: '1f4c5' },
  { id: 'flexible', kz: 'Келісім бойынша', ru: 'По договорённости', urgency: 'low', emoji: '1f91d' },
];

// Optional time of day for anything but "right now"
const PART_OF_DAY: { id: string; kz: string; ru: string }[] = [
  { id: 'morning', kz: 'таңертең', ru: 'утром' },
  { id: 'day', kz: 'күндіз', ru: 'днём' },
  { id: 'evening', kz: 'кешке', ru: 'вечером' },
];

/** 3D icon shown next to each step's title */
const STEP_EMOJI = ['1f4dd', '23f0', '1f3d9-fe0f', '1f4b0', '1f4cb'];

const BUDGET_OPTIONS: { id: string; kz: string; ru: string }[] = [
  { id: 'negotiable', kz: 'Келісімді', ru: 'Договорная' },
  { id: 'lt10', kz: '10 000 ₸ дейін', ru: 'До 10 000 ₸' },
  { id: '10to30', kz: '10 000 – 30 000 ₸', ru: '10 000 – 30 000 ₸' },
  { id: '30to100', kz: '30 000 – 100 000 ₸', ru: '30 000 – 100 000 ₸' },
  { id: 'gt100', kz: '100 000 ₸ жоғары', ru: 'Более 100 000 ₸' },
];

const STEPS = 5;

/** Step-by-step request for a chosen service: details → when → city → budget → review. */
export const RequestWizard: React.FC<RequestWizardProps> = ({ language, group, service, defaultCityId, onCancel, onSubmit, submitting = false }) => {
  const lang: Lang = language === 'kz' ? 'kz' : 'ru';
  const tx = (e: { kz: string; ru: string }) => e[lang];

  const [step, setStep] = useState(0);
  const [details, setDetails] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PendingAttachment[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [partOfDay, setPartOfDay] = useState<string | null>(null);
  // Pilot: only open cities can be chosen; Kyzylorda is preselected
  const [cityId, setCityId] = useState<string>(defaultCityId && isCityOpen(defaultCityId) ? defaultCityId : PILOT_CITY_ID);
  const [location, setLocation] = useState<RequestLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [budget, setBudget] = useState<string | null>(null);
  const [customBudget, setCustomBudget] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  const svcName = serviceName(service, lang);
  const city = CANONICAL_CITIES.find((c) => c.id === cityId);
  const whenOpt = WHEN_OPTIONS.find((w) => w.id === when);
  const dayPart = when !== 'urgent' ? PART_OF_DAY.find((p) => p.id === partOfDay) : undefined;
  const whenLabel = whenOpt ? (dayPart ? `${tx(whenOpt)}, ${tx(dayPart)}` : tx(whenOpt)) : '';
  const budgetLabel = customBudget.trim()
    ? `${customBudget.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`
    : budget
    ? tx(BUDGET_OPTIONS.find((b) => b.id === budget)!)
    : '';

  const canNext = [true, Boolean(when), Boolean(cityId), Boolean(budget || customBudget.trim()), true][step];

  const addPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const next: PendingAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const v = validateRequestAttachment({ name: file.name, size: file.size, type: file.type }, 'image');
      if (!v.isValid) {
        setPhotoError(lang === 'kz' ? `${file.name}: файл қабылданбады` : `${file.name}: файл не подходит`);
        continue;
      }
      next.push({
        id: `pending_img_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        name: sanitizeFileName(file.name),
        size: file.size,
        type: file.type || 'image/jpeg',
        mediaType: 'image',
        previewUrl: URL.createObjectURL(file),
        file,
      });
    }
    setPhotos((prev) => [...prev, ...next].slice(0, 10));
    if (photoInput.current) photoInput.current.value = '';
  };

  const detectLocation = () => {
    if (!('geolocation' in navigator)) {
      setPhotoError(tx(T.locationFailed));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
      },
      () => {
        setLocating(false);
        setPhotoError(tx(T.locationFailed));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const tagText = tags.join(', ');
  const toggleTag = (label: string) => setTags((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));

  const submit = () => {
    const cityName = city ? (lang === 'kz' ? city.nameKz : city.nameRu) : '';
    const text = [tagText, details.trim()].filter(Boolean).join('. ');
    onSubmit({
      city: cityName,
      cityId: cityId || undefined,
      category: groupName(group, lang),
      categoryId: group.id,
      serviceId: service.id,
      service: svcName,
      date: whenLabel,
      budget: budgetLabel || (lang === 'kz' ? 'Келісімді' : 'Договорная'),
      urgency: whenOpt?.urgency || 'normal',
      originalQuery: text ? `${svcName}: ${text}` : svcName,
      pendingAttachments: photos,
      ...(location ? { location } : {}),
    });
  };

  const chip = (selected: boolean) =>
    `press min-h-[52px] px-4 rounded-2xl border-2 text-[15px] font-semibold text-left transition-colors ${
      selected ? 'border-sky-500 bg-sky-50 text-sky-900 shadow-sm shadow-sky-100' : 'border-slate-200 bg-white text-slate-700'
    }`;

  const tick = (selected: boolean) => (
    <span
      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
        selected ? 'bg-sky-600 scale-100' : 'border-2 border-slate-200 scale-90'
      }`}
    >
      {selected && <Check className="w-3.5 h-3.5 text-white animate-popIn" strokeWidth={3.5} />}
    </span>
  );

  const heading = (title: string, hint?: string) => (
    <div className="flex items-center gap-3.5">
      <span className="w-16 h-16 rounded-3xl bg-linear-to-br from-sky-50 to-indigo-100 flex items-center justify-center shrink-0">
        <Emoji3D code={STEP_EMOJI[step]} size={44} eager className="animate-popIn" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[22px] leading-tight font-bold text-slate-900 font-display">{title}</h2>
        {hint && <p className="mt-1 text-[13px] text-slate-500 leading-snug">{hint}</p>}
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-md mx-auto px-4 py-4 flex-1 flex flex-col">
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={addPhotos} />

      {/* Top bar: service, progress */}
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
          aria-label={tx(T.back)}
          className="press w-11 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
        </button>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <CategoryIcon emoji={service.emoji} color={group.color} size="sm" eager />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{svcName}</div>
            <div className="text-[11px] font-semibold text-slate-500">
              {tx(T.step)} {step + 1} {tx(T.of)} {STEPS}
            </div>
          </div>
        </div>
        <button type="button" onClick={onCancel} aria-label={tx(T.close)} className="w-11 h-11 flex items-center justify-center text-slate-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex gap-1.5 mb-6" aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
            <span
              className="block h-full rounded-full bg-linear-to-r from-sky-500 to-indigo-500 transition-all duration-500 ease-out"
              style={{ width: i <= step ? '100%' : '0%' }}
            />
          </span>
        ))}
      </div>

      <div key={step} className="flex-1 space-y-5 animate-stepIn">
        {step === 0 && (
          <>
            {heading(tx(T.describeTitle), tx(T.describeHint))}
            {group.quick.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{tx(T.quickLabel)}</div>
                <div className="flex flex-wrap gap-2">
                  {group.quick.map((q) => {
                    const label = tx(q);
                    const on = tags.includes(label);
                    return (
                      <button
                        key={q.ru}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleTag(label)}
                        className={`press h-10 px-4 rounded-full border-2 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
                          on ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {on && <Check className="w-4 h-4" strokeWidth={3} />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={4}
              placeholder={tx(T.describePlaceholder)}
              className="w-full p-4 bg-white border-2 border-slate-200 focus:border-sky-500 rounded-2xl text-base text-slate-900 outline-none resize-none transition-colors"
            />
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative w-20 h-20 rounded-2xl overflow-hidden border border-slate-200 animate-popIn">
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
                      setPhotos((prev) => prev.filter((x) => x.id !== p.id));
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center"
                    aria-label="×"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="press w-20 h-20 rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/60 text-sky-700 flex flex-col items-center justify-center gap-1 text-[11px] font-bold"
              >
                <Camera className="w-5 h-5" />
                {tx(T.addPhoto)}
              </button>
            </div>
            {photoError && <p className="text-xs text-rose-600">{photoError}</p>}
          </>
        )}

        {step === 1 && (
          <>
            {heading(tx(T.whenTitle))}
            <div className="grid gap-2 stagger">
              {WHEN_OPTIONS.map((w, i) => (
                <button key={w.id} type="button" onClick={() => setWhen(w.id)} className={chip(when === w.id)} style={{ ['--i' as string]: i }}>
                  <span className="flex items-center gap-3">
                    <Emoji3D code={w.emoji} size={30} eager />
                    <span className="flex-1">{tx(w)}</span>
                    {tick(when === w.id)}
                  </span>
                </button>
              ))}
            </div>
            {when && when !== 'urgent' && (
              <div className="space-y-2 animate-fadeIn">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{tx(T.partOfDayTitle)}</div>
                <div className="flex flex-wrap gap-2">
                  {PART_OF_DAY.map((p) => {
                    const on = partOfDay === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPartOfDay(on ? null : p.id)}
                        className={`press h-10 px-4 rounded-full border-2 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
                          on ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {on && <Check className="w-4 h-4" strokeWidth={3} />}
                        {tx(p)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {heading(tx(T.whereTitle))}
            <div className="grid grid-cols-2 gap-2 stagger">
              {CANONICAL_CITIES.map((c, i) => {
                const open = isCityOpen(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => open && setCityId(c.id)}
                    disabled={!open}
                    className={`${chip(cityId === c.id)} ${open ? '' : 'opacity-50 cursor-not-allowed'}`}
                    style={{ ['--i' as string]: i }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{lang === 'kz' ? c.nameKz : c.nameRu}</span>
                      {cityId === c.id && <Check className="w-4.5 h-4.5 text-sky-600 shrink-0 animate-popIn" strokeWidth={3} />}
                      {!open && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 shrink-0">{tx(T.soon)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{tx(T.pilotNote)}</p>
            <button
              type="button"
              onClick={detectLocation}
              disabled={locating}
              className={`press w-full min-h-[56px] rounded-2xl border-2 px-3 text-sm font-semibold flex items-center gap-3 text-left ${
                location ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Emoji3D code="1f4cd" size={30} eager />
              <span className="flex-1">{location ? tx(T.locationAdded) : tx(T.location)}</span>
              {locating ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : location ? <Check className="w-5 h-5 text-emerald-600" strokeWidth={3} /> : null}
            </button>
            <p className="text-xs text-slate-500 leading-relaxed">{tx(T.locationNote)}</p>
            {photoError && <p className="text-xs text-rose-600">{photoError}</p>}
          </>
        )}

        {step === 3 && (
          <>
            {heading(tx(T.budgetTitle))}
            <div className="grid gap-2 stagger">
              {BUDGET_OPTIONS.map((b, i) => {
                const on = budget === b.id && !customBudget.trim();
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setBudget(b.id);
                      setCustomBudget('');
                    }}
                    className={chip(on)}
                    style={{ ['--i' as string]: i }}
                  >
                    <span className="flex items-center justify-between gap-3">
                      {tx(b)}
                      {tick(on)}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={customBudget}
              onChange={(e) => setCustomBudget(e.target.value.replace(/[^\d ]/g, '').slice(0, 12))}
              placeholder={tx(T.budgetCustom)}
              className="w-full h-[52px] px-4 bg-white border-2 border-slate-200 focus:border-sky-500 rounded-2xl text-base outline-none transition-colors"
            />
          </>
        )}

        {step === 4 && (
          <>
            {heading(tx(T.reviewTitle))}
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm shadow-slate-200/60">
              <div className={`flex items-center gap-3 p-4 bg-linear-to-br ${tone(group.color).tile}`}>
                <Emoji3D code={service.emoji} size={52} eager />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold text-slate-900 leading-tight">{svcName}</div>
                  <div className={`text-xs font-semibold ${tone(group.color).text}`}>{groupName(group, lang)}</div>
                </div>
                <button type="button" onClick={onCancel} className="text-xs font-bold text-sky-700 shrink-0 min-h-[32px]">
                  {tx(T.edit)}
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  { label: tx(T.details), value: [tagText, details.trim()].filter(Boolean).join('. ') || '—', to: 0 },
                  { label: tx(T.photos), value: photos.length ? String(photos.length) : '—', to: 0 },
                  { label: tx(T.when), value: whenLabel || '—', to: 1 },
                  { label: tx(T.city), value: city ? (lang === 'kz' ? city.nameKz : city.nameRu) : '—', to: 2 },
                  { label: tx(T.budget), value: budgetLabel || '—', to: 3 },
                ].map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{row.label}</div>
                      <div className="text-sm font-semibold text-slate-900 break-words">{row.value}</div>
                    </div>
                    <button type="button" onClick={() => setStep(row.to)} className="text-xs font-bold text-sky-700 shrink-0 min-h-[32px]">
                      {tx(T.edit)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-100">
              <Emoji3D code="2728" size={22} eager />
              <p className="text-xs text-emerald-900 leading-relaxed">{tx(T.freeNote)}</p>
            </div>
            {group.licensed && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                <Emoji3D code="1f4dc" size={22} eager />
                <p className="text-xs text-amber-900 leading-relaxed">{tx(T.licenseNote)}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="pt-5 pb-2">
        {step < STEPS - 1 ? (
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep(step + 1)}
            className="press w-full min-h-[54px] rounded-2xl bg-linear-to-r from-sky-600 to-indigo-600 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-sky-600/25"
          >
            {step === 0 && !details.trim() && photos.length === 0 && tags.length === 0 ? tx(T.skip) : tx(T.next)}
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="press relative overflow-hidden w-full min-h-[54px] rounded-2xl bg-linear-to-r from-emerald-500 to-teal-600 disabled:opacity-80 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
          >
            <span className="absolute inset-0 animate-shimmer" aria-hidden="true" />
            {submitting ? <Loader2 className="relative w-5 h-5 animate-spin" /> : <Check className="relative w-5 h-5" strokeWidth={3} />}
            <span className="relative">{tx(T.send)}</span>
          </button>
        )}
      </div>
    </div>
  );
};
