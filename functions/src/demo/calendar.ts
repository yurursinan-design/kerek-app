import type { Booking, Business, Order, Session } from './types';

/** Kazakhstan has one time zone, UTC+5, since March 2024 */
export const TZ_OFFSET_MIN = 5 * 60;
/** Free times are offered every half hour */
export const SLOT_STEP = 30;
/** How far ahead the assistant books */
export const HORIZON_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

export interface LocalNow {
  date: string;
  minutes: number;
  /** Monday = 0 */
  weekday: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localNow(nowMs: number): LocalNow {
  const d = new Date(nowMs + TZ_OFFSET_MIN * 60000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: (d.getUTCDay() + 6) % 7,
  };
}

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Monday = 0 */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** "9:30" or "09:30" → 570; anything else → null */
export function toMin(hhmm: unknown): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function toHHMM(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function dayHours(b: Business, date: string): [number, number] | null {
  const h = b.hours[weekdayOf(date)];
  if (!h) return null;
  const open = toMin(h[0]);
  const close = toMin(h[1]);
  return open !== null && close !== null && close > open ? [open, close] : null;
}

function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

/** Earliest bookable minute on a date: not in the past, and half an hour from now today */
function earliestOn(date: string, now: LocalNow, open: number): number {
  if (date !== now.date) return open;
  const soon = now.minutes + 30;
  return Math.max(open, Math.ceil(soon / SLOT_STEP) * SLOT_STEP);
}

export interface StaffTimes {
  staffId: string;
  times: number[];
}

/** Free start times for a service on a date, per staff member who does it. */
export function freeTimes(b: Business, bookings: Booking[], serviceId: string, date: string, now: LocalNow, staffId?: string): StaffTimes[] {
  const service = b.services.find((s) => s.id === serviceId);
  if (!service || !isDate(date) || date < now.date) return [];
  const hours = dayHours(b, date);
  if (!hours) return [];
  const [open, close] = hours;
  const from = earliestOn(date, now, open);
  const staffIds = service.staff.filter((id) => !staffId || id === staffId);
  return staffIds.map((id) => {
    const busy = bookings
      .filter((x) => x.status === 'active' && x.staffId === id && x.date === date)
      .map((x) => [toMin(x.start) ?? 0, x.minutes] as const);
    const times: number[] = [];
    for (let t = open; t + service.minutes <= close; t += SLOT_STEP) {
      if (t < from) continue;
      if (busy.some(([s, len]) => overlaps(t, service.minutes, s, len))) continue;
      times.push(t);
    }
    return { staffId: id, times };
  });
}

export type BookingProblem = 'unknown_service' | 'unknown_staff' | 'bad_date' | 'past' | 'too_far' | 'closed' | 'outside_hours' | 'busy';

export interface BookingRequest {
  serviceId: string;
  date: string;
  time: string;
  staffId?: string;
  customer: string;
  /** Booking being moved: its own time doesn't count as busy */
  ignoreId?: string;
}

/**
 * Checks a booking and picks the staff member (the one asked for, or whoever is free and least
 * busy that day). Returns the staff id or the reason it can't be booked.
 */
export function checkBooking(b: Business, bookings: Booking[], req: BookingRequest, now: LocalNow): { staffId: string } | { problem: BookingProblem } {
  const service = b.services.find((s) => s.id === req.serviceId);
  if (!service) return { problem: 'unknown_service' };
  if (req.staffId && !service.staff.includes(req.staffId)) return { problem: 'unknown_staff' };
  if (!isDate(req.date)) return { problem: 'bad_date' };
  const start = toMin(req.time);
  if (start === null) return { problem: 'bad_date' };
  if (req.date < now.date) return { problem: 'past' };
  if (daysBetween(now.date, req.date) > HORIZON_DAYS) return { problem: 'too_far' };
  const hours = dayHours(b, req.date);
  if (!hours) return { problem: 'closed' };
  if (start < hours[0] || start + service.minutes > hours[1]) return { problem: 'outside_hours' };
  if (req.date === now.date && start < now.minutes + 15) return { problem: 'past' };
  const others = bookings.filter((x) => x.id !== req.ignoreId);
  const candidates = service.staff.filter((id) => !req.staffId || id === req.staffId);
  const free = candidates.filter(
    (id) => !others.some((x) => x.status === 'active' && x.staffId === id && x.date === req.date && overlaps(start, service.minutes, toMin(x.start) ?? 0, x.minutes)),
  );
  if (!free.length) return { problem: 'busy' };
  const load = (id: string) => others.filter((x) => x.status === 'active' && x.staffId === id && x.date === req.date).length;
  free.sort((a, c) => load(a) - load(c));
  return { staffId: free[0] };
}

/** Nearest free times around a wanted time (same day first, then the next open days), for "that time is taken". */
export function nearestFree(b: Business, bookings: Booking[], serviceId: string, date: string, wanted: number, now: LocalNow, staffId?: string, count = 3): { date: string; time: string }[] {
  const out: { date: string; time: string }[] = [];
  for (let d = 0; d < 7 && out.length < count; d++) {
    const day = addDays(date, d);
    // Closest to the wanted time of day, on this day and the following ones
    const ordered = Array.from(new Set(freeTimes(b, bookings, serviceId, day, now, staffId).flatMap((s) => s.times)))
      .sort((x, y) => Math.abs(x - wanted) - Math.abs(y - wanted) || x - y);
    for (const t of ordered.slice(0, count - out.length)) out.push({ date: day, time: toHHMM(t) });
  }
  return out;
}

// --- Invented calendar, so the demo looks like a working business -------------------------------

/** Small deterministic random generator (mulberry32) */
export function seededRandom(seedText: string): () => number {
  let a = 0;
  for (let i = 0; i < seedText.length; i++) a = (Math.imul(a ^ seedText.charCodeAt(i), 2654435761) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_NAMES = ['Аружан', 'Дана', 'Гульнар', 'Айсулу', 'Жанар', 'Сауле', 'Асель', 'Ботагоз', 'Әсем', 'Ерлан', 'Нурлан', 'Бауыржан', 'Данияр', 'Арман', 'Ержан', 'Мейрам', 'Алия', 'Томирис'];

/** About 45% of each working day booked for the next ten days. */
export function seedBookings(b: Business, nowMs: number, seed: string): Booking[] {
  const rand = seededRandom(seed);
  const now = localNow(nowMs);
  const out: Booking[] = [];
  let n = 0;
  for (let d = 0; d < 10; d++) {
    const date = addDays(now.date, d);
    const hours = dayHours(b, date);
    if (!hours) continue;
    for (const st of b.staff) {
      const services = b.services.filter((s) => s.staff.includes(st.id));
      if (!services.length) continue;
      let t = hours[0];
      while (t < hours[1]) {
        const s = services[Math.floor(rand() * services.length)];
        if (rand() < 0.45 && t + s.minutes <= hours[1]) {
          out.push({
            id: `s${++n}`,
            serviceId: s.id,
            staffId: st.id,
            date,
            start: toHHMM(t),
            minutes: s.minutes,
            customer: SEED_NAMES[Math.floor(rand() * SEED_NAMES.length)],
            source: 'seed',
            status: 'active',
            createdAt: nowMs - Math.floor(rand() * 5 * DAY_MS),
          });
          t += Math.ceil(s.minutes / SLOT_STEP) * SLOT_STEP;
        } else {
          t += SLOT_STEP;
        }
      }
    }
  }
  return out;
}

/** A few earlier orders, so the order list isn't empty. */
export function seedOrders(b: Business, nowMs: number, seed: string): Order[] {
  if (b.kind !== 'order' || !b.products.length) return [];
  const rand = seededRandom(`${seed}:orders`);
  const now = localNow(nowMs);
  const out: Order[] = [];
  for (let i = 0; i < 3; i++) {
    const p = b.products[Math.floor(rand() * b.products.length)];
    const qty = p.unit === 'кг' ? 1 + Math.floor(rand() * 2) : 1;
    const mode = rand() < 0.5 ? 'pickup' : 'delivery';
    out.push({
      id: `o${i + 1}`,
      items: [{ productId: p.id, qty }],
      total: p.price * qty + (mode === 'delivery' && b.delivery ? b.delivery.price : 0),
      date: addDays(now.date, i),
      time: toHHMM(11 * 60 + Math.floor(rand() * 16) * 30),
      mode,
      address: mode === 'delivery' ? 'мкр. Акмешит' : '',
      note: '',
      customer: SEED_NAMES[Math.floor(rand() * SEED_NAMES.length)],
      source: 'seed',
      status: 'confirmed',
      createdAt: nowMs - Math.floor((i + 1) * 3600 * 1000 * (1 + rand() * 5)),
    });
  }
  return out;
}

export function nextId(session: Session, prefix: string): string {
  session.seq += 1;
  return `${prefix}${session.seq}`;
}
