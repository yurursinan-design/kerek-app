/**
 * Data written by other users (requests, messages, notifications) is shown on this device. These
 * helpers make sure a malformed value can't crash a screen or point at an outside website.
 */

/** This project's Cloud Storage bucket, set at build time (VITE_FIREBASE_STORAGE_BUCKET). */
function ownStorageBucket(): string {
  return String(import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
}

/**
 * Files we show come from our own Cloud Storage bucket, or are local previews on this device.
 * The links sit in documents other users write (messages, requests), so a link to anything else
 * is ignored: another Firebase project's bucket, on the same Google address, could serve a fake
 * login page, and an SVG "image" can carry scripts.
 */
export function isTrustedMediaUrl(url: unknown, bucket: string = ownStorageBucket()): url is string {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('blob:') || /^data:(image\/(png|jpeg|webp|gif)|audio\/|video\/)/.test(url)) {
    return true;
  }
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'firebasestorage.googleapis.com') {
      return Boolean(bucket) && u.pathname.startsWith(`/v0/b/${bucket}/o/`);
    }
    // Storage emulator during local development
    if (import.meta.env?.DEV && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true;
  } catch {
    return false;
  }
  return false;
}

export function safeMediaUrl(url: unknown): string {
  return isTrustedMediaUrl(url) ? url : '';
}

/** A string, or '' for anything else (numbers, objects, missing values). */
export function safeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coordinates as finite numbers, or null when the stored point is not usable. */
export function safeCoords(loc: unknown): { latitude: number; longitude: number; approximate: boolean } | null {
  if (!loc || typeof loc !== 'object') return null;
  const { latitude, longitude, approximate } = loc as Record<string, unknown>;
  const lat = typeof latitude === 'number' ? latitude : NaN;
  const lng = typeof longitude === 'number' ? longitude : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng, approximate: approximate === true };
}

/** Notification title or body in the screen language, falling back to Russian, then Kazakh. */
export function localizedText(value: unknown, language: string): string {
  if (!value || typeof value !== 'object') return safeText(value);
  const v = value as Record<string, unknown>;
  return safeText(v[language]) || safeText(v.ru) || safeText(v.kz);
}
