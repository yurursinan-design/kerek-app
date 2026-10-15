/**
 * Logout empties the device copy of the user's data, including what is kept only in memory
 * (private mode, storage full). Before, data written while storage refused it came back after
 * logout from memory, e.g. the previous person's request and phone number.
 */
import { localRepository } from '../src/services/localRepository';
import { clearPersonalLocalData } from '../src/services/storage';

let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

// Browser storage that is full: every write is refused
const disk = new Map<string, string>();
let full = false;
(globalThis as any).localStorage = {
  get length() {
    return disk.size;
  },
  key: (i: number) => Array.from(disk.keys())[i] ?? null,
  getItem: (k: string) => (disk.has(k) ? disk.get(k)! : null),
  setItem: (k: string, v: string) => {
    if (full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    disk.set(k, String(v));
  },
  removeItem: (k: string) => disk.delete(k),
  clear: () => disk.clear(),
};

async function main() {
  // 1. Normal storage: saved, readable, gone after logout
  const a = await localRepository.createRequest({ requestText: 'Кран течёт', city: 'Алматы', cityId: 'almaty', category: 'Сантехника', customerName: 'Айгүл' } as any);
  assert(Boolean(await localRepository.getRequest(a.id)), 'Request is saved on the device');
  clearPersonalLocalData();
  assert((await localRepository.getRequest(a.id)) === null, 'Logout removes the saved request');

  // 2. Storage full: kept in memory for this session, gone after logout
  full = true;
  const b = await localRepository.createRequest({ requestText: 'Розетка искрит', city: 'Алматы', cityId: 'almaty', category: 'Электрика', customerName: 'Бауыржан' } as any);
  assert(Boolean(await localRepository.getRequest(b.id)), 'With storage full the request is still readable in this session');
  clearPersonalLocalData();
  assert((await localRepository.getRequest(b.id)) === null, 'Logout also empties the in-memory copy');
  full = false;

  // 3. A value refused earlier doesn't hide a newer saved one
  const c = await localRepository.createRequest({ requestText: 'Дверь скрипит', city: 'Алматы', cityId: 'almaty', category: 'Мелкий ремонт', customerName: 'Дана' } as any);
  await localRepository.updateRequest(c.id, { requestText: 'Дверь не закрывается' } as any);
  assert((await localRepository.getRequest(c.id))?.requestText === 'Дверь не закрывается', 'Latest saved value is read');

  console.log(failed ? `\nLOGOUT DEVICE CLEAN-UP: ${failed} FAILED` : '\nLOGOUT DEVICE CLEAN-UP: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Logout clean-up test error:', err);
  process.exit(1);
});
