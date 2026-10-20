import { useEffect, useMemo, useRef, useState } from 'react';
import type { Booking, Order } from '../../functions/src/demo/types';
import type { DemoView } from './api';
import type { Texts, UiLang } from './i18n';
import { clock, localDate, money, waLink, waParts, weekdayIndex } from './util';

type Tab = 'calendar' | 'chat' | 'price' | 'summary';

interface Props {
  view: DemoView;
  t: Texts;
  lang: UiLang;
  busy: boolean;
  media: Record<string, string>;
  onAction(action: string, ref?: string, text?: string): void;
}

function Rich({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {waParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

export function Connect({ t, name }: { t: Texts; name: string }) {
  return (
    <section className="rounded-2xl bg-ink p-5 text-white">
      <h3 className="text-[19px] leading-tight font-bold">{t.connectTitle}</h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-white/80">{t.connectBody}</p>
      <a
        href={waLink(t.waText(name))}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-saffron px-4 font-semibold text-ink active:scale-[0.98]"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.4Z" />
        </svg>
        {t.connectBtn}
      </a>
    </section>
  );
}

function CalendarTab({ view, t, lang, busy, onAction, flashId }: { view: DemoView; t: Texts; lang: UiLang; busy: boolean; onAction: Props['onAction']; flashId: string | null }) {
  const b = view.business;
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => localDate(now, i));
  const latestBot = [...view.bookings].filter((x) => x.source === 'bot' && x.status === 'active').sort((a, c) => c.createdAt - a.createdAt)[0];
  const [day, setDay] = useState(latestBot?.date && days.includes(latestBot.date) ? latestBot.date : days[0]);
  useEffect(() => {
    if (latestBot && days.includes(latestBot.date)) setDay(latestBot.date);
    // Jump to the day of a newly made booking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestBot?.id, latestBot?.date, latestBot?.start]);

  const label = (d: string, i: number) => (i === 0 ? t.dayToday : i === 1 ? t.dayTomorrow : `${t.days[weekdayIndex(d)]} ${d.slice(8)}`);
  const ofDay = (d: string) => view.bookings.filter((x) => x.status === 'active' && x.date === d);
  const service = (x: Booking) => b.services.find((s) => s.id === x.serviceId);

  return (
    <div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d, i) => {
          const bot = ofDay(d).filter((x) => x.source === 'bot').length;
          const closed = !b.hours[weekdayIndex(d)];
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`relative shrink-0 rounded-xl border px-3 py-2 text-left transition ${day === d ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink'}`}
            >
              <div className="text-[13px] font-semibold">{label(d, i)}</div>
              <div className={`text-[11.5px] ${day === d ? 'text-white/70' : 'text-mute'}`}>{closed ? t.closed : t.count(ofDay(d).length)}</div>
              {bot > 0 && <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-saffron text-[11px] font-bold text-ink">{bot}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-3 space-y-4">
        {b.staff.map((st) => {
          const list = ofDay(day)
            .filter((x) => x.staffId === st.id)
            .sort((a, c) => a.start.localeCompare(c.start));
          return (
            <div key={st.id}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[14.5px] font-semibold">{st.name}</span>
                <span className="text-[12.5px] text-mute">{lang === 'kz' ? st.role_kz : st.role_ru}</span>
              </div>
              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] text-mute">{b.hours[weekdayIndex(day)] ? t.noBookings : t.closed}</div>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((x) => {
                    const s = service(x);
                    const bot = x.source === 'bot';
                    return (
                      <li
                        key={x.id}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 ${bot ? 'border border-brand/30 bg-brand-soft' : 'bg-white'} ${flashId === x.id ? 'flash' : ''}`}
                      >
                        <div className="w-12 shrink-0 text-[14px] font-semibold tabular-nums">{x.start}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px]">{s ? (lang === 'kz' ? s.kz : s.ru) : ''}</div>
                          <div className="flex items-center gap-1.5 text-[12.5px] text-mute">
                            <span className="truncate">{x.customer}</span>
                            {bot && <span className="shrink-0 rounded-full bg-brand px-1.5 py-px text-[10.5px] font-semibold text-white">{t.viaBot}</span>}
                          </div>
                        </div>
                        {bot &&
                          (x.remindedAt ? (
                            <span className="shrink-0 text-[11.5px] text-mute">✓ {t.reminded}</span>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => onAction('remind', x.id)} className="shrink-0 rounded-lg border border-brand/40 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-brand disabled:opacity-50">
                              {t.remind}
                            </button>
                          ))}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrdersTab({ view, t, lang, busy, onAction }: { view: DemoView; t: Texts; lang: UiLang; busy: boolean; onAction: Props['onAction'] }) {
  const b = view.business;
  const orders = [...view.orders].sort((a, c) => c.createdAt - a.createdAt);
  const status: Record<Order['status'], [string, string]> = {
    new: [t.orderNew, 'bg-saffron text-ink'],
    confirmed: [t.orderConfirmed, 'bg-[#dff3e4] text-[#1c6b33]'],
    rejected: [t.orderRejected, 'bg-[#fde2e1] text-[#9b1c1c]'],
    cancelled: [t.orderCancelled, 'bg-paper text-mute'],
  };
  return (
    <ul className="space-y-2">
      {orders.map((o) => (
        <li key={o.id} className={`rounded-xl p-3 ${o.source === 'bot' ? 'border border-brand/30 bg-brand-soft' : 'bg-white'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-[14px] font-semibold">
              {o.customer}
              {o.source === 'bot' && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-px align-middle text-[10.5px] font-semibold text-white">{t.viaBot}</span>}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${status[o.status][1]}`}>{status[o.status][0]}</span>
          </div>
          <ul className="mt-1.5 text-[13.5px]">
            {o.items.map((it) => {
              const p = b.products.find((x) => x.id === it.productId);
              return (
                <li key={it.productId}>
                  {p ? (lang === 'kz' ? p.kz : p.ru) : '—'} · {String(it.qty).replace('.', ',')} {p?.unit}
                </li>
              );
            })}
          </ul>
          {o.note && <div className="mt-1 text-[12.5px] text-mute">«{o.note}»</div>}
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] text-mute">
            <span>
              {o.date.slice(8)}.{o.date.slice(5, 7)} · {o.time}
            </span>
            <span>{o.mode === 'delivery' ? `${t.delivery}: ${o.address}` : t.pickup}</span>
            <span className="font-semibold text-ink">
              {t.total}: {money(o.total)}
            </span>
          </div>
          {o.status === 'new' && o.source === 'bot' && (
            <div className="mt-2.5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => onAction('confirm', o.id)} className="min-h-10 flex-1 rounded-lg bg-ink px-3 text-[14px] font-semibold text-white disabled:opacity-50">
                {t.confirm}
              </button>
              <button type="button" disabled={busy} onClick={() => onAction('reject', o.id)} className="min-h-10 rounded-lg border border-line bg-white px-3 text-[14px] disabled:opacity-50">
                {t.reject}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChatTab({ view, t, busy, media, onAction }: { view: DemoView; t: Texts; busy: boolean; media: Record<string, string>; onAction: Props['onAction'] }) {
  const [reply, setReply] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [view.messages.length]);
  if (!view.messages.length) return <p className="rounded-xl bg-white p-4 text-[14px] text-mute">{t.chatEmpty}</p>;
  const label = { customer: t.fromCustomer, bot: t.fromBot, owner: t.fromOwner };
  return (
    <div>
      <ol className="space-y-2">
        {view.messages.map((m) => (
          <li key={m.id} className={`rounded-xl px-3 py-2 text-[14px] ${m.from === 'customer' ? 'bg-white' : m.from === 'owner' ? 'bg-saffron-soft' : 'bg-brand-soft'}`}>
            <div className="mb-0.5 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide text-mute">
              <span className={m.from === 'bot' ? 'text-brand' : m.from === 'owner' ? 'text-[#8a5a00]' : ''}>{label[m.from]}</span>
              <span className="font-normal">{clock(m.at)}</span>
              {m.tookMs ? <span className="font-normal">· {(m.tookMs / 1000).toFixed(1).replace('.', ',')} {t.sec}</span> : null}
            </div>
            {m.kind === 'voice' && (
              <div className="text-[13px] text-mute">
                🎤 {t.voice}, 0:{String(m.seconds ?? 1).padStart(2, '0')}
                {m.note && <div className="mt-0.5 text-[14px] text-ink italic">«{m.note}»</div>}
              </div>
            )}
            {m.kind === 'photo' && (
              <div className="flex items-start gap-2 text-[13px] text-mute">
                {media[m.id] && <img src={media[m.id]} alt="" className="size-12 rounded-md object-cover" />}
                <span>
                  📷 {t.photo}
                  {m.note && <span className="block text-[14px] text-ink italic">{m.note}</span>}
                </span>
              </div>
            )}
            {m.text && <Rich text={m.text} />}
          </li>
        ))}
      </ol>
      <div ref={end} />
      <form
        className="sticky bottom-0 mt-3 bg-paper pt-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = reply.trim();
          if (!v || busy) return;
          setReply('');
          onAction('reply', undefined, v);
        }}
      >
        <div className="flex gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t.replyPlaceholder}
            maxLength={800}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-brand"
          />
          <button type="submit" disabled={busy || !reply.trim()} className="min-h-11 rounded-xl bg-ink px-4 font-semibold text-white disabled:opacity-40">
            ↑
          </button>
        </div>
        <p className="mt-1 text-[12px] text-mute">{t.replyHint}</p>
      </form>
    </div>
  );
}

function PriceTab({ view, t, lang }: { view: DemoView; t: Texts; lang: UiLang }) {
  const b = view.business;
  return (
    <div className="space-y-4 text-[14px]">
      <p className="rounded-xl bg-brand-soft px-3 py-2.5 text-[13.5px] text-brand">{t.priceIntro}</p>
      <section>
        <h4 className="mb-1.5 font-semibold">{b.kind === 'booking' ? t.services : t.products}</h4>
        <ul className="divide-y divide-line rounded-xl bg-white">
          {(b.kind === 'booking' ? b.services : b.products).map((x) => (
            <li key={x.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                {lang === 'kz' ? x.kz : x.ru}
                <span className="block text-[12px] text-mute">
                  {'minutes' in x ? `${x.minutes} ${t.min}` : x.available ? t.readyToday : t.preorder(x.leadDays)}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {x.priceFrom && lang === 'ru' ? `${t.from} ` : ''}
                {money(x.price)}
                {x.priceFrom && lang === 'kz' ? ` ${t.from}` : ''}
                {'unit' in x && x.unit === 'кг' ? ' / кг' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {b.staff.length > 0 && (
        <section>
          <h4 className="mb-1.5 font-semibold">{t.staff}</h4>
          <p className="text-mute">{b.staff.map((s) => `${s.name} (${lang === 'kz' ? s.role_kz : s.role_ru})`).join(', ')}</p>
        </section>
      )}
      <section>
        <h4 className="mb-1.5 font-semibold">{t.hours}</h4>
        <p className="text-mute">{b.hours.map((h, i) => `${t.days[i]} ${h ? `${h[0]}–${h[1]}` : t.closed}`).join(' · ')}</p>
      </section>
      <section>
        <h4 className="mb-1.5 font-semibold">{t.address}</h4>
        <p className="text-mute">{b.address}</p>
      </section>
      {b.facts.length > 0 && (
        <section>
          <h4 className="mb-1.5 font-semibold">{t.facts}</h4>
          <ul className="list-disc space-y-1 pl-5 text-mute">
            {b.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SummaryTab({ view, t }: { view: DemoView; t: Texts }) {
  const answers = view.messages.filter((m) => m.from === 'bot' && m.tookMs);
  const avg = answers.length ? answers.reduce((s, m) => s + (m.tookMs ?? 0), 0) / answers.length / 1000 : 0;
  const made = view.business.kind === 'booking' ? view.bookings.filter((x) => x.source === 'bot' && x.status === 'active').length : view.orders.filter((o) => o.source === 'bot').length;
  const handed = view.alerts.filter((a) => a.kind === 'handoff' || a.kind === 'no_consent' || a.kind === 'error').length;
  const tiles: [string, string][] = [
    [t.sumAnswers, String(answers.length)],
    [t.sumSpeed, answers.length ? `${avg.toFixed(1).replace('.', ',')} ${t.sec}` : '—'],
    [view.business.kind === 'booking' ? t.sumBookings : t.sumOrders, String(made)],
    [t.sumHanded, String(handed)],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white p-3">
            <div className="text-[26px] leading-none font-bold tabular-nums">{v}</div>
            <div className="mt-1.5 text-[12.5px] leading-snug text-mute">{k}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-mute">{t.sumNote}</p>
    </div>
  );
}

export default function Panel({ view, t, lang, busy, media, onAction }: Props) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [flashId, setFlashId] = useState<string | null>(null);
  const seen = useRef(new Set(view.bookings.filter((x) => x.source === 'bot').map((x) => x.id)));
  const b = view.business;
  const open = view.alerts.filter((a) => !a.done);

  // A booking the assistant just made is highlighted once
  useEffect(() => {
    const fresh = view.bookings.find((x) => x.source === 'bot' && !seen.current.has(x.id));
    for (const x of view.bookings) if (x.source === 'bot') seen.current.add(x.id);
    if (fresh) {
      setFlashId(fresh.id);
      const id = window.setTimeout(() => setFlashId(null), 1800);
      return () => window.clearTimeout(id);
    }
  }, [view.bookings]);

  const newOrders = view.orders.filter((o) => o.status === 'new' && o.source === 'bot').length;
  const tabs = useMemo(
    () =>
      [
        ['calendar', b.kind === 'booking' ? t.tabBookings : t.tabOrders, b.kind === 'order' ? newOrders : 0],
        ['chat', t.tabChat, 0],
        ['price', t.tabPrice, 0],
        ['summary', t.tabSummary, 0],
      ] as [Tab, string, number][],
    [b.kind, t, newOrders],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div className="shrink-0 border-b border-line bg-white px-4 pt-3 pb-2">
        <div className="text-[12.5px] text-mute">{t.panelTitle}</div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-[19px] font-bold">{b.name}</h2>
          {view.botPaused ? (
            <button type="button" disabled={busy} onClick={() => onAction('resume')} className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {t.resume}
            </button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[13px]">
          <span className={`size-2 rounded-full ${view.botPaused ? 'bg-saffron' : 'bg-wa-green'}`} />
          <span className={view.botPaused ? 'text-[#8a5a00]' : 'text-mute'}>{view.botPaused ? t.botPaused : t.botOn}</span>
        </div>
        <nav className="no-scrollbar -mx-4 mt-2 flex gap-1 overflow-x-auto px-4" role="tablist">
          {tabs.map(([id, name, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[14px] font-medium ${tab === id ? 'bg-brand-soft text-brand' : 'text-mute'}`}
            >
              {name}
              {count > 0 && <span className="ml-1 rounded-full bg-saffron px-1.5 text-[11px] font-bold text-ink">{count}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {open.length > 0 && (
          <ul className="mb-3 space-y-2">
            {open.slice(-3).map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-xl border border-saffron/60 bg-saffron-soft px-3 py-2.5">
                <span className="mt-0.5 text-[15px]" aria-hidden>
                  🔔
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{lang === 'kz' ? a.text_kz : a.text_ru}</span>
                <button
                  type="button"
                  className="shrink-0 text-[12.5px] font-semibold text-brand"
                  onClick={() => (a.kind === 'order' ? setTab('calendar') : a.kind === 'paused' || a.kind === 'handoff' || a.kind === 'no_consent' || a.kind === 'error' ? setTab('chat') : onAction('dismiss', a.id))}
                >
                  {a.kind === 'order' ? t.confirm : t.answer}
                </button>
              </li>
            ))}
          </ul>
        )}
        {tab === 'calendar' &&
          (b.kind === 'booking' ? (
            <CalendarTab view={view} t={t} lang={lang} busy={busy} onAction={onAction} flashId={flashId} />
          ) : (
            <OrdersTab view={view} t={t} lang={lang} busy={busy} onAction={onAction} />
          ))}
        {tab === 'chat' && <ChatTab view={view} t={t} busy={busy} media={media} onAction={onAction} />}
        {tab === 'price' && <PriceTab view={view} t={t} lang={lang} />}
        {tab === 'summary' && <SummaryTab view={view} t={t} />}
        <div className="mt-6">
          <Connect t={t} name={b.name} />
        </div>
      </div>
    </div>
  );
}
