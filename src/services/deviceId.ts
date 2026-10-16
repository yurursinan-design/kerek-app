/**
 * A random id this phone keeps for the app. It is sent with the login so the server can notice two
 * accounts of one person used on the same phone (a master reviewing their own work from a second
 * number). The server stores only a one-way hash of it (functions/src/signals.ts). It names no
 * person and is forgotten when the app's data is cleared.
 */
const KEY = 'tapsyr_device_id_v1';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9-]{16,64}$/.test(saved)) return saved;
    const id = randomId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage unavailable: no id is sent, the review check just has one signal less
    return '';
  }
}
