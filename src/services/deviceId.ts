import { Capacitor } from '@capacitor/core';

/**
 * Which phone the app runs on, sent with the login so the server can notice two accounts of one
 * person (a master reviewing their own work from a second number). The server stores only a one-way
 * hash of it (functions/src/signals.ts); it names no person.
 * - Android app: the phone's Android ID, which stays the same when the app's data is cleared or the
 *   app is reinstalled, so a second account can't be hidden that way
 * - browser: a random id the site keeps, forgotten when the site's data is cleared
 */
const KEY = 'tapsyr_device_id_v1';
const VALID = /^[A-Za-z0-9-]{16,64}$/;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function browserId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && VALID.test(saved)) return saved;
    const id = randomId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage unavailable: no id is sent, the review check just has one signal less
    return '';
  }
}

export async function getDeviceId(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import('@capacitor/device');
      const id = `a-${String((await Device.getId()).identifier || '').replace(/[^A-Za-z0-9-]/g, '')}`;
      if (VALID.test(id)) return id;
    } catch {
      // plugin missing in an older app build: the app's own id below
    }
  }
  return browserId();
}
