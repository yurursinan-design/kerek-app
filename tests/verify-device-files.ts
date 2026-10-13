/**
 * Device mode (no cloud): photos and files are kept in IndexedDB, so they open again after the
 * page is reloaded (a blob: address only lives as long as the page), and logout removes them.
 */
import './helpers/deviceMode';
import 'fake-indexeddb/auto';
import { resolveObjectURL } from 'node:buffer';
import { localRepository } from '../src/services/localRepository';
import { clearPersonalLocalData } from '../src/services/storage';
import { deviceFileUrl } from '../src/services/deviceFiles';
import { resolveStorageUrl } from '../src/services/storageUrls';

let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

async function bytesAt(url: string): Promise<string> {
  const blob = url ? resolveObjectURL(url) : undefined;
  return blob ? Buffer.from(await blob.arrayBuffer()).toString('utf8') : '';
}

async function main() {
  const req = await localRepository.createRequest({ requestText: 'Кран течёт', city: 'Алматы', cityId: 'almaty', category: 'Сантехника', customerName: 'Айгүл' } as any);

  // 1. A picked photo (Blob) is stored on the device, not as a page-only address
  const photo = new Blob(['photo-bytes'], { type: 'image/jpeg' });
  const att = await localRepository.uploadRequestAttachment(req.id, { name: 'kran.jpg', size: photo.size, type: 'image/jpeg', data: photo });
  assert(att.downloadUrl === '', 'No page-only blob: address is stored in the request');
  const url = await deviceFileUrl(att.storagePath);
  assert(url.startsWith('blob:') && (await bytesAt(url)) === 'photo-bytes', 'The photo itself is read back from IndexedDB');
  assert((await resolveStorageUrl(att.storagePath)) === url, 'Screens get the address through the same path as cloud files');

  // 2. A data: address (small files) is stored as a file too
  const dataUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
  const att2 = await localRepository.uploadRequestAttachment(req.id, { name: 'a.png', size: 9, type: 'image/png', data: dataUrl });
  assert(att2.downloadUrl === '' && (await bytesAt(await deviceFileUrl(att2.storagePath))) === 'png-bytes', 'A data: address is kept as a file');

  // 3. Logout removes the files
  clearPersonalLocalData();
  await new Promise((r) => setTimeout(r, 100));
  assert((await deviceFileUrl(att.storagePath)) === '', 'Logout removes the device files');

  console.log(failed ? `\nDEVICE FILES: ${failed} FAILED` : '\nDEVICE FILES: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Device files test error:', err);
  process.exit(1);
});
