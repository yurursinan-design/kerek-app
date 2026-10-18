// A master's work photos: up to 8 pictures in fixed slots (p0 … p7). In the cloud they live in
// Storage under providers/{uid}/portfolio/{slot}; the profile lists the filled slots. Without a
// cloud connection (device mode) they are kept on this phone.
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { isFirebaseConfigured, storage } from './firebase';
import { cleanImageForUpload } from './imageClean';
import { PORTFOLIO_SLOTS } from '../types';

const MAX_BYTES = 5 * 1024 * 1024;
const localKey = (uid: string, slot: string) => `kerek_portfolio_${uid}_${slot}`;
const cloud = () => (isFirebaseConfigured() && storage ? storage : null);

export function isPortfolioSlot(slot: string): boolean {
  return (PORTFOLIO_SLOTS as readonly string[]).includes(slot);
}

/** The first slot not in use, or null when all 8 are taken. */
export function freePortfolioSlot(used: string[] = []): string | null {
  return PORTFOLIO_SLOTS.find((s) => !used.includes(s)) || null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function uploadPortfolioPhoto(uid: string, slot: string, file: Blob): Promise<void> {
  if (!isPortfolioSlot(slot)) throw new Error('Validation Error: portfolio slot');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Validation Error: Тек JPG, PNG немесе WEBP фото / Только фото JPG, PNG или WEBP');
  }
  // Redrawn first: drops hidden location data and shrinks big photos
  const clean = await cleanImageForUpload(file);
  if (clean.size > MAX_BYTES) throw new Error('Validation Error: Фото тым үлкен (5 МБ дейін) / Фото слишком большое (до 5 МБ)');
  const st = cloud();
  if (st) {
    await uploadBytes(storageRef(st, `providers/${uid}/portfolio/${slot}`), clean, { contentType: clean.type });
    return;
  }
  localStorage.setItem(localKey(uid, slot), await blobToDataUrl(clean));
}

export async function deletePortfolioPhoto(uid: string, slot: string): Promise<void> {
  if (!isPortfolioSlot(slot)) return;
  const st = cloud();
  try {
    if (st) await deleteObject(storageRef(st, `providers/${uid}/portfolio/${slot}`));
    else localStorage.removeItem(localKey(uid, slot));
  } catch {
    // already gone: nothing to delete
  }
}

/** Picture addresses for the profile's filled slots; a photo that can't be loaded is skipped. */
export async function getPortfolioPhotos(uid: string, slots: string[] = []): Promise<{ slot: string; url: string }[]> {
  const st = cloud();
  const rows = await Promise.all(
    slots.filter(isPortfolioSlot).map(async (slot) => {
      try {
        const url = st
          ? await getDownloadURL(storageRef(st, `providers/${uid}/portfolio/${slot}`))
          : localStorage.getItem(localKey(uid, slot)) || '';
        return url ? { slot, url } : null;
      } catch {
        return null;
      }
    })
  );
  return rows.filter((r): r is { slot: string; url: string } => r !== null);
}

/** Account deletion: every slot goes, filled or not. */
export async function deleteAllPortfolioPhotos(uid: string): Promise<void> {
  await Promise.all(PORTFOLIO_SLOTS.map((slot) => deletePortfolioPhoto(uid, slot)));
}
