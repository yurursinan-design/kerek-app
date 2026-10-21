import { useEffect, useRef, useState } from 'react';
import type { BuildPayload } from './api';
import type { Texts } from './i18n';
import { shrinkPhoto } from './media';

interface Props {
  t: Texts;
  busy: boolean;
  error: string | null;
  onCreate(p: BuildPayload): void;
  onBack(): void;
}

const TYPES = ['salon', 'auto', 'clinic', 'courses', 'food', 'shop', 'other'];
const ORDER_TYPES = new Set(['food', 'shop']);

export default function Builder({ t, busy, error, onCreate, onBack }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('salon');
  const [text, setText] = useState('');
  const [staff, setStaff] = useState('');
  const [address, setAddress] = useState('');
  const [photo, setPhoto] = useState<{ data: string; mime: string; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, t.progress.length - 1)), 3500);
    return () => window.clearInterval(id);
  }, [busy, t.progress.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setProblem(t.needName);
    if (!photo && text.trim().length < 10) return setProblem(t.needInput);
    setProblem(null);
    onCreate({ name: name.trim(), type, text: text.trim(), photo: photo ? { data: photo.data, mime: photo.mime } : undefined, staff: ORDER_TYPES.has(type) ? '' : staff.trim(), address: address.trim() });
  };

  const field = 'mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[16px] outline-none focus:border-brand';
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-5 pb-12">
      <button type="button" onClick={onBack} className="text-[14px] font-medium text-brand">
        ‹ {t.back}
      </button>
      <h1 className="mt-3 text-[28px] leading-tight font-extrabold tracking-[-0.01em]">{t.buildTitle}</h1>
      <p className="mt-2 text-[15.5px] leading-relaxed text-mute">{t.buildSub}</p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block">
          <span className="text-[14px] font-semibold">{t.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t.namePh} className={field} />
        </label>

        <fieldset>
          <legend className="text-[14px] font-semibold">{t.type}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TYPES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                aria-pressed={type === k}
                className={`rounded-full border px-3 py-1.5 text-[14px] ${type === k ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}
              >
                {t.types[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                setPhoto(await shrinkPhoto(f, 1600));
              } catch {
                setProblem(t.photoFail);
              }
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-2">
              <img src={photo.url} alt="" className="size-20 rounded-lg object-cover" />
              <button type="button" onClick={() => file.current?.click()} className="text-[14px] font-medium text-brand">
                {t.photoChange}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => file.current?.click()} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-[16px] font-semibold text-white active:scale-[0.99]">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" strokeLinejoin="round" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              {t.photoBtn}
            </button>
          )}
          <label className="mt-3 block">
            <span className="text-[13.5px] text-mute">{t.orText}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} placeholder={t.textPh} className={`${field} resize-y`} />
          </label>
        </div>

        {!ORDER_TYPES.has(type) && (
          <label className="block">
            <span className="text-[14px] font-semibold">{t.staffLabel}</span>
            <input value={staff} onChange={(e) => setStaff(e.target.value)} maxLength={200} placeholder={t.staffPh} className={field} />
          </label>
        )}
        <label className="block">
          <span className="text-[14px] font-semibold">{t.addressLabel}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={80} className={field} />
        </label>

        {(problem || error) && <p className="rounded-xl bg-[#fde2e1] px-4 py-3 text-[14px] text-[#9b1c1c]">{problem || error}</p>}

        <button type="submit" disabled={busy} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-[16px] font-semibold text-white disabled:opacity-80">
          {busy ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {t.progress[step]}
            </>
          ) : (
            t.create
          )}
        </button>
      </form>
    </main>
  );
}
