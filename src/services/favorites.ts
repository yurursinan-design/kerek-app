import { PUBLIC_SITE_URL } from '../config/site';

// Masters the customer saved with the heart button, kept on this phone (like a contacts list).
// Only the id, name and category are stored; the profile itself is loaded when opened.

export interface FavoriteMaster {
  id: string;
  name: string;
  category?: string;
}

const KEY = 'kerek_favorite_masters';
const EVENT = 'kerek-favorites-changed';
const MAX = 50;

export function getFavorites(): FavoriteMaster[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is FavoriteMaster => !!x && typeof x.id === 'string' && x.id.length > 0 && typeof x.name === 'string')
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function isFavorite(id: string): boolean {
  return getFavorites().some((f) => f.id === id);
}

/** Adds or removes the master; returns whether they are a favourite now. */
export function toggleFavorite(master: FavoriteMaster): boolean {
  const list = getFavorites();
  const had = list.some((f) => f.id === master.id);
  const next = had
    ? list.filter((f) => f.id !== master.id)
    : [{ id: master.id, name: master.name.slice(0, 100), ...(master.category ? { category: master.category.slice(0, 100) } : {}) }, ...list].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode or full storage: nothing is remembered
  }
  window.dispatchEvent(new Event(EVENT));
  return !had;
}

export function onFavoritesChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Link that opens the master's profile in the web app at /app/ (the visitor logs in with their phone first). */
export function masterProfileLink(id: string): string {
  // Inside the phone app the page address is local, so links point to the website instead
  const origin = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(window.location.origin) || !/^https?:/.test(window.location.origin)
    ? PUBLIC_SITE_URL
    : window.location.origin;
  return `${origin}/app/?master=${encodeURIComponent(id)}`;
}
