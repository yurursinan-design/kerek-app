/**
 * Files of device mode (no cloud) kept in this browser's IndexedDB, so photos, voice notes and
 * documents still open after the page is reloaded (a blob: address lives only as long as the
 * page). Emptied on logout with the rest of the device copy.
 */
const DB_NAME = 'kerek-device-files';
const STORE = 'files';
const urls = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** A data: address turned back into a file, or null when it isn't one. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const raw = m[3] ? atob(m[4]) : decodeURIComponent(m[4]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  } catch {
    return null;
  }
}

/** Saves the file under its storage path; false when this browser has no usable IndexedDB. */
export async function saveDeviceFile(path: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, path);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

/** Viewing address for a saved file ('' when there is none on this device). */
export async function deviceFileUrl(path: string): Promise<string> {
  const hit = urls.get(path);
  if (hit) return hit;
  const db = await openDb();
  if (!db) return '';
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return url;
}

export async function clearDeviceFiles(): Promise<void> {
  urls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  urls.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
