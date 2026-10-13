import { useEffect, useState } from 'react';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { storage } from './firebase';
import { safeMediaUrl } from './safeData';

/**
 * Request and chat files are stored by path only. The viewing address is asked from Cloud Storage
 * when the file is shown, so the security rules decide each time who may open it, and no
 * long-lived file link sits in documents other people can read. Older records that still carry a
 * link (and previews on this device) keep working.
 */
const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function isCloudPath(path: unknown): path is string {
  return typeof path === 'string' && /^(requests|chat)\//.test(path);
}

export function resolveStorageUrl(path: string): Promise<string> {
  const hit = resolved.get(path);
  if (hit) return Promise.resolve(hit);
  if (!storage) return Promise.resolve('');
  let p = pending.get(path);
  if (!p) {
    p = getDownloadURL(storageRef(storage, path))
      .then((url) => {
        const safe = safeMediaUrl(url);
        if (safe) resolved.set(path, safe);
        return safe;
      })
      .catch(() => '')
      .finally(() => pending.delete(path));
    pending.set(path, p);
  }
  return p;
}

interface MediaLike {
  id: string;
  storagePath?: string;
  downloadUrl?: string;
  previewUrl?: string;
}

/** Viewing address per item id: a stored link or local preview right away, cloud files once resolved. */
export function useMediaUrls(items: MediaLike[]): Record<string, string> {
  const initial = () => {
    const out: Record<string, string> = {};
    for (const it of items) {
      const direct = safeMediaUrl(it.downloadUrl) || safeMediaUrl(it.previewUrl) || (isCloudPath(it.storagePath) ? resolved.get(it.storagePath) || '' : '');
      if (direct) out[it.id] = direct;
    }
    return out;
  };
  const [urls, setUrls] = useState<Record<string, string>>(initial);
  const key = items.map((it) => `${it.id}:${it.storagePath || ''}:${it.downloadUrl ? 1 : 0}:${it.previewUrl || ''}`).join('|');

  useEffect(() => {
    let alive = true;
    setUrls(initial());
    for (const it of items) {
      if (safeMediaUrl(it.downloadUrl) || safeMediaUrl(it.previewUrl) || !isCloudPath(it.storagePath)) continue;
      resolveStorageUrl(it.storagePath).then((url) => {
        if (alive && url) setUrls((prev) => (prev[it.id] === url ? prev : { ...prev, [it.id]: url }));
      });
    }
    return () => {
      alive = false;
    };
    // items are compared by their key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
