import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../functions/src/demo/types';
import type { DemoView } from './api';
import type { Texts } from './i18n';
import { startRecording, type Recording } from './media';
import { clock, initials, waParts } from './util';

export interface Pending {
  text: string;
  kind?: 'voice' | 'photo';
  url?: string;
  seconds?: number;
}

interface Props {
  view: DemoView;
  t: Texts;
  pending: Pending | null;
  waiting: boolean;
  error: string | null;
  media: Record<string, string>;
  suggestions: string[];
  onText(text: string): void;
  onVoice(v: { data: string; mime: string; seconds: number; url: string }): void;
  onPhoto(file: File): void;
  onButton(id: string): void;
  onMicError(): void;
}

const Icon = {
  send: (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6l.01 6.53L15 12 3.41 13.87z" />
    </svg>
  ),
  mic: (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  reply: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
    </svg>
  ),
};

function Ticks({ read, sending }: { read: boolean; sending?: boolean }) {
  if (sending)
    return (
      <svg viewBox="0 0 16 16" className="size-3.5 text-wa-meta" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2 1.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 18 12" className={`h-3 w-[18px] ${read ? 'text-wa-tick' : 'text-wa-meta'}`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="m1 6.5 3.2 3.2L11 2.5M7 9.5l.4.3L14.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Wave({ seed }: { seed: number }) {
  const bars = Array.from({ length: 26 }, (_, i) => 4 + Math.round(Math.abs(Math.sin(seed * 7.3 + i * 1.7)) * 14));
  return (
    <div className="flex h-6 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-wa-meta/60" style={{ height: h }} />
      ))}
    </div>
  );
}

function VoiceBody({ seconds, url, seed }: { seconds: number; url?: string; seed: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  return (
    <div className="flex w-56 items-center gap-2 py-1">
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center rounded-full text-wa-meta disabled:opacity-40"
        disabled={!url}
        aria-label="play"
        onClick={() => {
          if (!url) return;
          audio.current ??= new Audio(url);
          void audio.current.play();
        }}
      >
        {Icon.play}
      </button>
      <Wave seed={seed} />
      <span className="text-[11px] text-wa-meta tabular-nums">0:{String(seconds).padStart(2, '0')}</span>
    </div>
  );
}

function Text({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {waParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

function Bubble({ m, out, first, read, url, sending }: { m: Pick<ChatMessage, 'text' | 'kind' | 'seconds' | 'at'> & { id: string }; out: boolean; first: boolean; read: boolean; url?: string; sending?: boolean }) {
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} ${first ? 'mt-2' : 'mt-0.5'}`}>
      <div
        className={`relative max-w-[82%] rounded-lg px-2 pt-1.5 pb-1 text-[14.5px] leading-[1.35] text-wa-text shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] ${out ? 'bg-wa-out' : 'bg-white'} ${
          first ? (out ? 'tail-out rounded-tr-none' : 'tail-in rounded-tl-none') : ''
        }`}
      >
        {m.kind === 'photo' && (
          <div className="mb-1 -mx-1 -mt-0.5 overflow-hidden rounded-md bg-black/5">
            {url ? <img src={url} alt="" className="max-h-64 w-60 object-cover" /> : <div className="grid h-32 w-60 place-items-center text-wa-meta">{Icon.camera}</div>}
          </div>
        )}
        {m.kind === 'voice' ? <VoiceBody seconds={m.seconds ?? 1} url={url} seed={m.at % 97} /> : m.text ? <Text text={m.text} /> : null}
        <span className="float-right mt-1.5 ml-2 flex translate-y-0.5 items-center gap-1 text-[11px] leading-none text-wa-meta">
          {clock(m.at)}
          {out && <Ticks read={read} sending={sending} />}
        </span>
      </div>
    </div>
  );
}

export default function Chat({ view, t, pending, waiting, error, media, suggestions, onText, onVoice, onPhoto, onButton, onMicError }: Props) {
  const [text, setText] = useState('');
  const [rec, setRec] = useState<Recording | null>(null);
  const [recStart, setRecStart] = useState(0);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const b = view.business;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [view.messages.length, pending, waiting]);

  useEffect(() => {
    if (!rec) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [rec]);

  const stopAndSend = async (r: Recording) => {
    setRec(null);
    const voice = await r.stop().catch(() => null);
    if (voice) onVoice(voice);
  };

  const startRec = async () => {
    try {
      let current: Recording | null = null;
      current = await startRecording(() => current && void stopAndSend(current));
      setRec(current);
      setRecStart(Date.now());
      setNow(Date.now());
    } catch {
      onMicError();
    }
  };

  const send = () => {
    const v = text.trim();
    if (!v || waiting) return;
    setText('');
    onText(v);
  };

  const msgs = view.messages;
  const lastCustomerIndex = msgs.map((m) => m.from).lastIndexOf('customer');
  const repliedAfter = (i: number) => msgs.slice(i + 1).some((m) => m.from !== 'customer');

  return (
    <div className="flex h-full min-h-0 flex-col bg-wa-bg">
      <header className="flex shrink-0 items-center gap-3 bg-wa px-3 py-2.5 text-white">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white/90 font-semibold text-wa uppercase">{initials(b.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] leading-tight font-medium">{b.name}</div>
          <div className="truncate text-[12.5px] leading-tight text-white/85">{waiting ? t.typing : t.online}</div>
        </div>
        <svg viewBox="0 0 24 24" className="size-5 opacity-90" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </header>

      <div ref={scroller} className="wa-wall min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-2 sm:px-4">
        <div className="mx-auto mb-2 w-fit rounded-md bg-white/90 px-2.5 py-1 text-[12px] text-wa-meta shadow-sm">{t.today}</div>
        <div className="mx-auto mb-3 max-w-[90%] rounded-md bg-wa-note px-3 py-1.5 text-center text-[12.5px] leading-snug text-[#54656f] shadow-sm">{t.notice}</div>

        {msgs.map((m, i) => {
          const out = m.from === 'customer';
          const first = i === 0 || (msgs[i - 1].from === 'customer') !== out;
          const active = !!m.buttons?.length && !msgs.slice(i + 1).some((x) => x.from === 'customer') && !waiting;
          return (
            <div key={m.id}>
              <Bubble m={m} out={out} first={first} read={out && (repliedAfter(i) || i < lastCustomerIndex)} url={media[m.id]} />
              {m.buttons?.length ? (
                <div className="mt-0.5 flex max-w-[82%] flex-col gap-0.5">
                  {m.buttons.map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      disabled={!active}
                      onClick={() => onButton(btn.id)}
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[14px] font-medium text-wa-btn shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] transition active:bg-[#f0f2f5] disabled:text-wa-btn/45"
                    >
                      {Icon.reply}
                      {btn.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {pending && (
          <Bubble
            m={{ id: 'pending', text: pending.text, kind: pending.kind, seconds: pending.seconds, at: Date.now() }}
            out
            first={!msgs.length || msgs[msgs.length - 1].from !== 'customer'}
            read={false}
            sending
            url={pending.url}
          />
        )}
        {waiting && (
          <div className="mt-2 flex">
            <div className="tail-in relative flex gap-1 rounded-lg rounded-tl-none bg-white px-3 py-3 shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]" aria-label={t.typing}>
              <span className="typing-dot size-2 rounded-full bg-wa-meta" />
              <span className="typing-dot size-2 rounded-full bg-wa-meta" />
              <span className="typing-dot size-2 rounded-full bg-wa-meta" />
            </div>
          </div>
        )}
        {error && <div className="mx-auto mt-3 w-fit max-w-[90%] rounded-md bg-[#fde2e1] px-3 py-1.5 text-center text-[12.5px] text-[#9b1c1c]">{error}</div>}
      </div>

      {!rec && suggestions.length > 0 && (
        <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto bg-wa-bg px-3 pt-1.5 pb-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={waiting}
              onClick={() => onText(s)}
              className="shrink-0 rounded-full border border-wa-btn/25 bg-white px-3 py-1.5 text-[13px] text-wa-btn shadow-sm active:bg-[#f0f2f5] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2 bg-wa-bg px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {rec ? (
          <div className="flex min-h-12 flex-1 items-center gap-3 rounded-3xl bg-white px-3 shadow-sm">
            <button type="button" className="text-wa-meta" aria-label="cancel" onClick={() => (rec.cancel(), setRec(null))}>
              {Icon.trash}
            </button>
            <span className="rec-pulse size-2.5 rounded-full bg-[#ea0038]" />
            <span className="text-[15px] text-wa-text tabular-nums">0:{String(Math.min(59, Math.floor((now - recStart) / 1000))).padStart(2, '0')}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-wa-meta">{t.recording}</span>
          </div>
        ) : (
          <div className="flex min-h-12 flex-1 items-center rounded-3xl bg-white pr-2 pl-4 shadow-sm">
            <textarea
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t.placeholder}
              maxLength={1000}
              className="max-h-28 min-w-0 flex-1 resize-none bg-transparent py-3 text-[16px] leading-snug text-wa-text outline-none placeholder:text-wa-meta focus-visible:outline-none"
            />
            <button type="button" className="grid size-9 place-items-center text-wa-meta" aria-label={t.photo} onClick={() => fileInput.current?.click()} disabled={waiting}>
              {Icon.camera}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onPhoto(f);
              }}
            />
          </div>
        )}
        <button
          type="button"
          aria-label={text.trim() || rec ? 'send' : t.voice}
          disabled={waiting && !rec}
          onClick={() => (rec ? void stopAndSend(rec) : text.trim() ? send() : void startRec())}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-wa-green text-white shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          {text.trim() || rec ? Icon.send : Icon.mic}
        </button>
      </div>
    </div>
  );
}
