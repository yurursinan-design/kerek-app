import type { Texts, UiLang } from './i18n';
import { PHOTOS } from './util';

interface Props {
  t: Texts;
  lang: UiLang;
  starting: string | null;
  error: string | null;
  onPick(template: string): void;
  onBuild(): void;
}

const DEMOS: { id: string; name: string; ru: string; kz: string }[] = [
  { id: 'salon', name: 'Nur Beauty', ru: 'Салон красоты', kz: 'Сұлулық салоны' },
  { id: 'auto', name: 'Тұлпар Авто', ru: 'Автосервис и шиномонтаж', kz: 'Автосервис және шиномонтаж' },
  { id: 'cake', name: 'Tätti', ru: 'Кондитерская, торты на заказ', kz: 'Кондитерлік, тапсырыспен торттар' },
];

export default function Home({ t, lang, starting, error, onPick, onBuild }: Props) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-12 sm:pt-12">
      <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div>
          <p className="text-[14px] font-medium text-brand">{t.tag}</p>
          <h1 className="mt-2 text-[34px] leading-[1.08] font-extrabold tracking-[-0.02em] text-balance sm:text-[48px]">{t.heroTitle}</h1>
          <p className="mt-4 max-w-[34rem] text-[16.5px] leading-relaxed text-mute">{t.heroSub}</p>
        </div>

        {/* A message at 02:14 and the instant answer: the whole idea in one look */}
        <div className="wa-wall mx-auto w-full max-w-sm rounded-[28px] border-[6px] border-ink p-4 shadow-[0_24px_60px_-28px_rgb(28_27_58/0.55)]">
          <div className="mx-auto mb-3 w-fit rounded-md bg-white/90 px-2.5 py-1 text-[12px] text-wa-meta">02:14</div>
          <div className="flex justify-end">
            <div className="tail-out relative rounded-lg rounded-tr-none bg-wa-out px-2.5 py-1.5 text-[15px] text-wa-text shadow-sm">
              {t.heroAsk}
              <span className="ml-2 text-[11px] text-wa-meta">02:14</span>
            </div>
          </div>
          <div className="hero-typing mt-2 flex w-fit gap-1 rounded-lg bg-white px-3 py-3 shadow-sm" aria-hidden>
            <span className="typing-dot size-2 rounded-full bg-wa-meta" />
            <span className="typing-dot size-2 rounded-full bg-wa-meta" />
            <span className="typing-dot size-2 rounded-full bg-wa-meta" />
          </div>
          <div className="hero-answer mt-2 flex">
            <div className="tail-in relative max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[15px] text-wa-text shadow-sm">
              {t.heroAnswer}
              <span className="ml-2 text-[11px] text-wa-meta">02:14</span>
            </div>
          </div>
        </div>
      </div>

      <h2 className="mt-12 text-[20px] leading-snug font-bold sm:text-[24px]">{t.pickTitle}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {DEMOS.map((d) => (
          <button
            key={d.id}
            type="button"
            disabled={!!starting}
            onClick={() => onPick(d.id)}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand/50 active:scale-[0.99] disabled:opacity-60"
          >
            <img src={PHOTOS[d.id]} alt="" className="size-20 shrink-0 rounded-xl object-cover" loading="lazy" />
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-bold">{d.name}</span>
              <span className="block text-[14px] text-mute">{lang === 'kz' ? d.kz : d.ru}</span>
              <span className="mt-1 inline-block rounded-full bg-paper px-2 py-0.5 text-[11.5px] text-mute">{t.demo}</span>
            </span>
            <span className="pr-1 text-[22px] text-brand" aria-hidden>
              {starting === d.id ? '…' : '›'}
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={!!starting}
          onClick={onBuild}
          className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-brand/50 bg-brand-soft p-3 text-left transition active:scale-[0.99] disabled:opacity-60"
        >
          <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-brand text-white">
            <svg viewBox="0 0 24 24" className="size-9" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-bold text-brand">{t.customTitle}</span>
            <span className="block text-[14px] leading-snug text-ink/75">{t.customSub}</span>
          </span>
          <span className="pr-1 text-[22px] text-brand" aria-hidden>
            ›
          </span>
        </button>
      </div>
      {error && <p className="mt-4 rounded-xl bg-[#fde2e1] px-4 py-3 text-[14px] text-[#9b1c1c]">{error}</p>}
      <p className="mt-8 text-[14px] text-mute">{t.priceLine}</p>
    </main>
  );
}
