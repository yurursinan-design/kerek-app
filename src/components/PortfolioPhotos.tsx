import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Language, Provider } from '../types';
import { deletePortfolioPhoto, freePortfolioSlot, getPortfolioPhotos, uploadPortfolioPhoto } from '../services/portfolio';
import { getFriendlyErrorMessage } from '../services';

const MAX_PHOTOS = 8;

/** The master's work photos on their profile; read-only for customers. */
export const PortfolioGallery: React.FC<{ provider: Provider; language: Language }> = ({ provider, language }) => {
  const [photos, setPhotos] = useState<{ slot: string; url: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const slotsKey = (provider.portfolio || []).join(',');

  useEffect(() => {
    let alive = true;
    const uid = provider.userId || provider.id;
    if (!uid || !provider.portfolio?.length) {
      setPhotos([]);
      return;
    }
    getPortfolioPhotos(uid, provider.portfolio).then((rows) => alive && setPhotos(rows));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, provider.userId, slotsKey]);

  if (photos.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
        {language === 'kz' ? 'Жұмыс фотолары' : 'Фото работ'}
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {photos.map((p) => (
          <button key={p.slot} type="button" onClick={() => setOpen(p.url)} className="aspect-square rounded-xl overflow-hidden bg-slate-100">
            <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <img src={open} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
};

/** On the master's own card: add or remove work photos (up to 8). */
export const PortfolioEditor: React.FC<{
  provider: Provider;
  language: Language;
  /** Saves the new list of filled slots on the profile */
  onSave: (portfolio: string[]) => Promise<void>;
}> = ({ provider, language, onSave }) => {
  const uid = provider.userId || provider.id;
  const [photos, setPhotos] = useState<{ slot: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const slotsKey = (provider.portfolio || []).join(',');

  useEffect(() => {
    let alive = true;
    if (!uid || !provider.portfolio?.length) {
      setPhotos([]);
      return;
    }
    getPortfolioPhotos(uid, provider.portfolio).then((rows) => alive && setPhotos(rows));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, slotsKey]);

  const add = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (input.current) input.current.value = '';
    if (!file || !uid) return;
    const used = provider.portfolio || [];
    const slot = freePortfolioSlot(used);
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPortfolioPhoto(uid, slot, file);
      await onSave([...used, slot]);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, language));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slot: string) => {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave((provider.portfolio || []).filter((s) => s !== slot));
      await deletePortfolioPhoto(uid, slot);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, language));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">{language === 'kz' ? 'Жұмыс фотолары' : 'Фото работ'}</span>
        <span className="text-[10px] text-slate-400">
          {photos.length}/{MAX_PHOTOS} · {language === 'kz' ? 'клиенттер профильде көреді' : 'клиенты видят в профиле'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {photos.map((p) => (
          <div key={p.slot} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
            <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => remove(p.slot)}
              disabled={busy}
              aria-label={language === 'kz' ? 'Жою' : 'Удалить'}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {(provider.portfolio || []).length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="aspect-square rounded-xl border-2 border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold disabled:opacity-50"
          >
            {busy ? (
              <span className="w-5 h-5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <ImagePlus className="w-5 h-5" />
                {language === 'kz' ? 'Қосу' : 'Добавить'}
              </>
            )}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={add} />
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
};
