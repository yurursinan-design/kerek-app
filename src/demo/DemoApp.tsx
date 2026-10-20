import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getApi, type BuildPayload, type DemoView, type Media } from './api';
import Builder from './Builder';
import Chat, { type Pending } from './Chat';
import Home from './Home';
import { TEXTS, type UiLang } from './i18n';
import { shrinkPhoto } from './media';
import Panel from './Panel';

const LANG_KEY = 'jauap_lang';
const DEMO_KEY = 'jauap_demo';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode: the demo still works, it just isn't remembered
  }
}

type Screen = 'home' | 'build' | 'demo';

/** Wide screens show the customer's phone and the owner's panel side by side */
function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
type HeldMedia = { voice?: Media & { seconds: number }; photo?: Media };

export default function DemoApp() {
  const [lang, setLang] = useState<UiLang>(() => (load(LANG_KEY) === 'kz' ? 'kz' : 'ru'));
  const t = TEXTS[lang];
  const [screen, setScreen] = useState<Screen>(() => (load(DEMO_KEY) ? 'demo' : 'home'));
  const [view, setView] = useState<DemoView | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [side, setSide] = useState<'client' | 'owner'>('client');
  const [toast, setToast] = useState<string | null>(null);
  const held = useRef<HeldMedia | null>(null);
  const wide = useWide();
  const seenOwner = useRef({ items: 0, alerts: 0 });

  useEffect(() => {
    document.documentElement.lang = lang === 'kz' ? 'kk' : 'ru';
    save(LANG_KEY, lang);
  }, [lang]);

  // Pick up the demo again after a reload
  useEffect(() => {
    const id = load(DEMO_KEY);
    if (!id) return;
    getApi()
      .then((api) => api.owner({ id, action: 'get' }))
      .then(setView)
      .catch(() => {
        save(DEMO_KEY, null);
        setScreen('home');
      });
  }, []);

  const errorText = useCallback(
    (err: unknown) => {
      const p = err instanceof ApiError ? err.problem : 'generic';
      return p === 'busy' ? t.errBusy : p === 'tooMany' ? t.errTooMany : p === 'expired' ? t.errExpired : t.errGeneric;
    },
    [t],
  );

  const items = (v: DemoView) => v.bookings.filter((x) => x.source === 'bot').length + v.orders.filter((o) => o.source === 'bot').length;
  const openAlerts = (v: DemoView) => v.alerts.filter((a) => !a.done).length;

  /** New state from the server; tells the visitor when something appeared in the owner's panel */
  const apply = (next: DemoView) => {
    if (view && side === 'client' && !wide) {
      if (items(next) > items(view)) setToast(next.business.kind === 'booking' ? t.toastBooking : t.toastOrder);
      else if (openAlerts(next) > openAlerts(view)) setToast(t.toastAlert);
    }
    setView(next);
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const start = async (template?: string, build?: BuildPayload) => {
    setHomeError(null);
    setBuildError(null);
    setStarting(template ?? 'custom');
    try {
      const api = await getApi();
      const v = await api.start({ template, build, lang });
      setView(v);
      setMedia({});
      setSide('client');
      seenOwner.current = { items: items(v), alerts: 0 };
      save(DEMO_KEY, v.id);
      setScreen('demo');
      window.scrollTo(0, 0);
    } catch (err) {
      if (build) setBuildError(err instanceof ApiError && err.problem === 'build' ? t.buildFail : errorText(err));
      else setHomeError(t.startFail);
    } finally {
      setStarting(null);
    }
  };

  const send = async (payload: { text?: string; button?: string; voice?: Media & { seconds: number }; photo?: Media }, show: Pending | null, url?: string) => {
    if (!view || waiting) return;
    setChatError(null);
    setPending(show);
    setWaiting(true);
    try {
      const api = await getApi();
      const next = await api.send({ id: view.id, ...payload });
      if (url) {
        const mine = [...next.messages].reverse().find((m) => m.from === 'customer' && m.kind);
        if (mine) setMedia((m) => ({ ...m, [mine.id]: url }));
      }
      // Media sent before consent is kept here and sent again with the consent tap
      if ((payload.voice || payload.photo) && next.consent !== 'given') held.current = { voice: payload.voice, photo: payload.photo };
      if (payload.button === 'consent_yes') held.current = null;
      apply(next);
    } catch (err) {
      setChatError(errorText(err));
    } finally {
      setPending(null);
      setWaiting(false);
    }
  };

  const ownerDo = async (action: string, ref?: string, text?: string) => {
    if (!view) return;
    setOwnerBusy(true);
    try {
      const api = await getApi();
      apply(await api.owner({ id: view.id, action, ref, text }));
    } catch (err) {
      setChatError(errorText(err));
    } finally {
      setOwnerBusy(false);
    }
  };

  const goHome = () => {
    save(DEMO_KEY, null);
    setView(null);
    setScreen('home');
    setToast(null);
    held.current = null;
  };

  const showOwner = () => {
    setSide('owner');
    setToast(null);
    if (view) seenOwner.current = { items: items(view), alerts: openAlerts(view) };
  };
  const badge = view && side === 'client' && !wide ? Math.max(0, items(view) - seenOwner.current.items) + Math.max(0, openAlerts(view) - seenOwner.current.alerts) : 0;

  const langSwitch = (
    <div className="flex shrink-0 rounded-lg border border-line bg-white p-0.5 text-[13px] font-semibold">
      {(['ru', 'kz'] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`rounded-md px-2.5 py-1 ${lang === l ? 'bg-ink text-white' : 'text-mute'}`}>
          {l === 'ru' ? 'Рус' : 'Қаз'}
        </button>
      ))}
    </div>
  );
  const logo = (
    <span className="font-mark text-[20px] font-bold tracking-tight text-ink">
      jauap<span className="text-saffron">.</span>
    </span>
  );

  if (screen !== 'demo' || !view) {
    return (
      <div className="min-h-dvh">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-4">
          {logo}
          {langSwitch}
        </header>
        {screen === 'build' ? (
          <Builder t={t} busy={starting === 'custom'} error={buildError} onCreate={(p) => void start(undefined, p)} onBack={() => setScreen('home')} />
        ) : screen === 'demo' ? (
          <p className="px-4 pt-16 text-center text-mute">{t.loading}</p>
        ) : (
          <Home t={t} lang={lang} starting={starting} error={homeError} onPick={(id) => void start(id)} onBuild={() => setScreen('build')} />
        )}
      </div>
    );
  }

  const suggestions = view.messages.length > 6 ? [] : (t.suggestions[view.business.template] ?? t.suggestions[view.business.kind]);
  const chat = (
    <Chat
      view={view}
      t={t}
      pending={pending}
      waiting={waiting}
      error={chatError}
      media={media}
      suggestions={suggestions}
      onText={(text) => void send({ text }, { text })}
      onVoice={(v) => void send({ voice: { data: v.data, mime: v.mime, seconds: v.seconds } }, { text: '', kind: 'voice', seconds: v.seconds, url: v.url }, v.url)}
      onPhoto={async (file) => {
        try {
          const p = await shrinkPhoto(file, 1280);
          void send({ photo: { data: p.data, mime: p.mime } }, { text: '', kind: 'photo', url: p.url }, p.url);
        } catch {
          setChatError(t.photoFail);
        }
      }}
      onButton={(id) => void send({ button: id, ...(id === 'consent_yes' && held.current ? held.current : {}) }, null)}
      onMicError={() => setChatError(t.micDenied)}
    />
  );
  const panel = <Panel view={view} t={t} lang={lang} busy={ownerBusy} media={media} onAction={(a, r, x) => void ownerDo(a, r, x)} />;

  return (
    <div className={wide ? 'flex min-h-dvh flex-col' : 'flex h-dvh flex-col'}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-white px-3 py-2 lg:border-0 lg:bg-transparent lg:px-6 lg:pt-4">
        <button type="button" onClick={goHome} className="shrink-0 rounded-lg px-1.5 py-1 text-[14px] font-medium text-brand">
          ‹ <span className="hidden sm:inline">{t.restart}</span>
        </button>
        <span className="hidden lg:inline">{logo}</span>
        <div className="mx-auto flex rounded-xl bg-paper p-1 lg:hidden" role="tablist">
          <button type="button" role="tab" aria-selected={side === 'client'} onClick={() => setSide('client')} className={`rounded-lg px-4 py-1.5 text-[14px] font-semibold ${side === 'client' ? 'bg-white text-ink shadow-sm' : 'text-mute'}`}>
            {t.tabClient}
          </button>
          <button type="button" role="tab" aria-selected={side === 'owner'} onClick={showOwner} className={`relative rounded-lg px-4 py-1.5 text-[14px] font-semibold ${side === 'owner' ? 'bg-white text-ink shadow-sm' : 'text-mute'}`}>
            {t.tabOwner}
            {badge > 0 && <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-saffron text-[11px] font-bold text-ink">{badge}</span>}
          </button>
        </div>
        <span className="hidden flex-1 lg:block" />
        {langSwitch}
      </header>

      {wide ? (
        <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 pb-10">
          <div className="h-[780px] w-[400px] shrink-0 overflow-hidden rounded-[40px] border-[10px] border-ink bg-ink shadow-[0_30px_70px_-30px_rgb(28_27_58/0.6)]">
            <div className="h-full overflow-hidden rounded-[30px]">{chat}</div>
          </div>
          <div className="h-[780px] min-w-0 flex-1 overflow-hidden rounded-3xl border border-line">{panel}</div>
        </div>
      ) : (
        // Phone: one side at a time
        <div className="relative min-h-0 flex-1">
          {side === 'client' ? chat : panel}
          {toast && side === 'client' && (
            <div className="absolute inset-x-3 top-16 z-10 flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-[14px] text-white shadow-lg">
              <span className="min-w-0 flex-1">{toast}</span>
              <button type="button" onClick={showOwner} className="shrink-0 rounded-lg bg-saffron px-3 py-1.5 font-semibold text-ink">
                {t.open}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
