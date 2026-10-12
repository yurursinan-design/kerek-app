import React, { useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, Loader2, MapPin, X } from 'lucide-react';
import { ExtractedNeed, Language, PendingAttachment, RequestLocation, Urgency, sanitizeFileName, validateRequestAttachment } from '../types';
import { CatalogGroup, CatalogService, groupName, serviceName } from '../data/serviceCatalog';
import { CANONICAL_CITIES } from '../services/taxonomy';
import { CategoryIcon } from './CategoryIcon';

interface RequestWizardProps {
  language: Language;
  group: CatalogGroup;
  service: CatalogService;
  /** Pre-selected city (e.g. from the last request) */
  defaultCityId?: string;
  onCancel: () => void;
  onSubmit: (need: ExtractedNeed) => void;
}

type Lang = 'kz' | 'ru';
const T = {
  step: { kz: 'Қадам', ru: 'Шаг' },
  of: { kz: '/', ru: 'из' },
  back: { kz: 'Артқа', ru: 'Назад' },
  next: { kz: 'Келесі', ru: 'Далее' },
  skip: { kz: 'Өткізіп жіберу', ru: 'Пропустить' },
  send: { kz: 'Өтінішті жіберу', ru: 'Отправить заявку' },
  close: { kz: 'Жабу', ru: 'Закрыть' },
  describeTitle: { kz: 'Не істеу керек?', ru: 'Что нужно сделать?' },
  describeHint: {
    kz: 'Қысқаша жазыңыз: не бұзылды, қандай көлем, ерекше тілектер. Фото шеберге бағаны тез айтуға көмектеседі.',
    ru: 'Кратко опишите: что случилось, какой объём, особые пожелания. Фото помогают мастеру быстрее назвать цену.',
  },
  describePlaceholder: { kz: 'Мысалы: асүйдегі кран ағып тұр, ауыстыру керек', ru: 'Например: на кухне течёт кран, нужно заменить' },
  addPhoto: { kz: 'Фото қосу', ru: 'Добавить фото' },
  whenTitle: { kz: 'Қашан керек?', ru: 'Когда нужно?' },
  whereTitle: { kz: 'Қай қалада?', ru: 'В каком городе?' },
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
  freeNote: {
    kz: 'Өтініш тегін. Шеберлер ұсыныс жібереді, сіз өзіңізге ыңғайлысын таңдайсыз.',
    ru: 'Заявка бесплатна. Мастера пришлют предложения, вы выберете подходящее.',
  },
} as const;

const WHEN_OPTIONS: { id: string; kz: string; ru: string; urgency: Urgency }[] = [
  { id: 'urgent', kz: 'Шұғыл, қазір', ru: 'Срочно, сейчас', urgency: 'high' },
  { id: 'today', kz: 'Бүгін', ru: 'Сегодня', urgency: 'high' },
  { id: 'tomorrow', kz: 'Ертең', ru: 'Завтра', urgency: 'normal' },
  { id: 'week', kz: 'Осы аптада', ru: 'На этой неделе', urgency: 'normal' },
  { id: 'flexible', kz: 'Келісім бойынша', ru: 'По договорённости', urgency: 'low' },
];

const BUDGET_OPTIONS: { id: string; kz: string; ru: string }[] = [
  { id: 'negotiable', kz: 'Келісімді', ru: 'Договорная' },
  { id: 'lt10', kz: '10 000 ₸ дейін', ru: 'До 10 000 ₸' },
  { id: '10to30', kz: '10 000 – 30 000 ₸', ru: '10 000 – 30 000 ₸' },
  { id: '30to100', kz: '30 000 – 100 000 ₸', ru: '30 000 – 100 000 ₸' },
  { id: 'gt100', kz: '100 000 ₸ жоғары', ru: 'Более 100 000 ₸' },
];

const STEPS = 5;

/** Step-by-step request for a chosen service: details → when → city → budget → review. */
export const RequestWizard: React.FC<RequestWizardProps> = ({ language, group, service, defaultCityId, onCancel, onSubmit }) => {
  const lang: Lang = language === 'kz' ? 'kz' : 'ru';
  const tx = (e: { kz: string; ru: string }) => e[lang];

  const [step, setStep] = useState(0);
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState<PendingAttachment[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string>(defaultCityId || '');
  const [location, setLocation] = useState<RequestLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [budget, setBudget] = useState<string | null>(null);
  const [customBudget, setCustomBudget] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  const svcName = serviceName(service, lang);
  const city = CANONICAL_CITIES.find((c) => c.id === cityId);
  const whenOpt = WHEN_OPTIONS.find((w) => w.id === when);
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

  const submit = () => {
    const cityName = city ? (lang === 'kz' ? city.nameKz : city.nameRu) : '';
    const text = details.trim();
    onSubmit({
      city: cityName,
      cityId: cityId || undefined,
      category: groupName(group, lang),
      categoryId: group.id,
      serviceId: service.id,
      service: svcName,
      date: whenOpt ? tx(whenOpt) : '',
      budget: budgetLabel || (lang === 'kz' ? 'Келісімді' : 'Договорная'),
      urgency: whenOpt?.urgency || 'normal',
      originalQuery: text ? `${svcName}: ${text}` : svcName,
      pendingAttachments: photos,
      ...(location ? { location } : {}),
    });
  };

  const chip = (selected: boolean) =>
    `min-h-[48px] px-4 rounded-2xl border-2 text-sm font-semibold text-left transition-all active:scale-[0.99] ${
      selected ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
    }`;

  return (
    <div className="w-full max-w-md mx-auto px-4 py-4 flex-1 flex flex-col">
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={addPhotos} />

      {/* Top bar: service, progress */}
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
          aria-label={tx(T.back)}
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <CategoryIcon icon={group.icon} color={group.color} size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{svcName}</div>
            <div className="text-[11px] text-slate-500">
              {tx(T.step)} {step + 1} {tx(T.of)} {STEPS}
            </div>
          </div>
        </div>
        <button type="button" onClick={onCancel} aria-label={tx(T.close)} className="w-10 h-10 flex items-center justify-center text-slate-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-6">
        <div className="h-full bg-sky-600 rounded-full transition-all duration-300" style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
      </div>

      <div className="flex-1 space-y-4">
        {step === 0 && (
          <>
            <h2 className="text-2xl font-extrabold text-slate-900 font-display">{tx(T.describeTitle)}</h2>
            <p className="text-sm text-slate-500 leading-relaxed">{tx(T.describeHint)}</p>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={5}
              placeholder={tx(T.describePlaceholder)}
              className="w-full p-4 bg-white border-2 border-slate-200 focus:border-sky-500 rounded-2xl text-base text-slate-900 outline-none resize-none"
            />
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
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
                className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold hover:border-sky-400 hover:text-sky-700"
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
            <h2 className="text-2xl font-extrabold text-slate-900 font-display">{tx(T.whenTitle)}</h2>
            <div className="grid gap-2">
              {WHEN_OPTIONS.map((w) => (
                <button key={w.id} type="button" onClick={() => setWhen(w.id)} className={chip(when === w.id)}>
                  <span className="flex items-center justify-between">
                    {tx(w)}
                    {when === w.id && <Check className="w-5 h-5 text-sky-600" />}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-2xl font-extrabold text-slate-900 font-display">{tx(T.whereTitle)}</h2>
            <div className="grid grid-cols-2 gap-2">
              {CANONICAL_CITIES.map((c) => (
                <button key={c.id} type="button" onClick={() => setCityId(c.id)} className={chip(cityId === c.id)}>
                  {lang === 'kz' ? c.nameKz : c.nameRu}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={detectLocation}
              disabled={locating}
              className={`w-full min-h-[48px] rounded-2xl border-2 px-4 text-sm font-semibold flex items-center gap-2 ${
                location ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : location ? <Check className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
              {location ? tx(T.locationAdded) : tx(T.location)}
            </button>
            <p className="text-xs text-slate-500 leading-relaxed">{tx(T.locationNote)}</p>
            {photoError && <p className="text-xs text-rose-600">{photoError}</p>}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-2xl font-extrabold text-slate-900 font-display">{tx(T.budgetTitle)}</h2>
            <div className="grid gap-2">
              {BUDGET_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBudget(b.id);
                    setCustomBudget('');
                  }}
                  className={chip(budget === b.id && !customBudget.trim())}
                >
                  <span className="flex items-center justify-between">
                    {tx(b)}
                    {budget === b.id && !customBudget.trim() && <Check className="w-5 h-5 text-sky-600" />}
                  </span>
                </button>
              ))}
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={customBudget}
              onChange={(e) => setCustomBudget(e.target.value.replace(/[^\d ]/g, '').slice(0, 12))}
              placeholder={tx(T.budgetCustom)}
              className="w-full h-12 px-4 bg-white border-2 border-slate-200 focus:border-sky-500 rounded-2xl text-base outline-none"
            />
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-2xl font-extrabold text-slate-900 font-display">{tx(T.reviewTitle)}</h2>
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
              {[
                { label: tx(T.service), value: svcName, to: -1 },
                { label: tx(T.details), value: details.trim() || '—', to: 0 },
                { label: tx(T.photos), value: photos.length ? String(photos.length) : '—', to: 0 },
                { label: tx(T.when), value: whenOpt ? tx(whenOpt) : '—', to: 1 },
                { label: tx(T.city), value: city ? (lang === 'kz' ? city.nameKz : city.nameRu) : '—', to: 2 },
                { label: tx(T.budget), value: budgetLabel || '—', to: 3 },
              ].map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{row.label}</div>
                    <div className="text-sm font-semibold text-slate-900 break-words">{row.value}</div>
                  </div>
                  {row.to >= 0 && (
                    <button type="button" onClick={() => setStep(row.to)} className="text-xs font-bold text-sky-700 shrink-0 min-h-[32px]">
                      {tx(T.edit)}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 text-center">{tx(T.freeNote)}</p>
          </>
        )}
      </div>

      <div className="pt-5 pb-2">
        {step < STEPS - 1 ? (
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep(step + 1)}
            className="w-full min-h-[52px] rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-sky-600/20 transition-all"
          >
            {step === 0 && !details.trim() && photos.length === 0 ? tx(T.skip) : tx(T.next)}
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            className="w-full min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
          >
            <Check className="w-5 h-5" />
            {tx(T.send)}
          </button>
        )}
      </div>
    </div>
  );
};
