import type { FunctionDeclaration } from '@google/genai';
import { addDays, checkBooking, daysBetween, dayHours, freeTimes, HORIZON_DAYS, isDate, localNow, nearestFree, nextId, toHHMM, toMin, type BookingProblem } from './calendar';
import { ALERT_TEXT, weekdayName } from './texts';
import type { Business, Order, OrderItem, Session } from './types';

/**
 * The assistant's tools. Free times, bookings and orders are worked out here from the session's
 * own calendar, never by the model, so it can't promise a time that is taken.
 */

export function toolDeclarations(b: Business): FunctionDeclaration[] {
  const handoff: FunctionDeclaration = {
    name: 'handoff_to_owner',
    description:
      'Передать разговор администратору (человеку): жалоба, конфликт, клиент просит человека, вопрос, на который нет ответа в данных, нестандартная просьба. После вызова скажи клиенту, что администратор скоро ответит здесь.',
    parametersJsonSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Коротко по-русски: что нужно клиенту (до 120 символов)' } },
      required: ['reason'],
    },
  };
  if (b.kind === 'order') {
    const productIds = b.products.map((p) => p.id);
    return [
      {
        name: 'create_order',
        description:
          'Оформить заказ, когда клиент выбрал товары и назвал дату, время, способ получения (самовывоз или доставка с адресом) и своё имя. Заказ уходит администратору на подтверждение.',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'string', enum: productIds },
                  qty: { type: 'number', description: 'Количество в единицах товара (кг, шт, набор)' },
                },
                required: ['product_id', 'qty'],
              },
            },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time: { type: 'string', description: 'HH:MM' },
            mode: { type: 'string', enum: ['pickup', 'delivery'] },
            address: { type: 'string', description: 'Адрес доставки, если доставка' },
            customer_name: { type: 'string' },
            note: { type: 'string', description: 'Надпись на торте или пожелания, если есть' },
          },
          required: ['items', 'date', 'time', 'mode', 'customer_name'],
        },
      },
      {
        name: 'list_customer_orders',
        description: 'Заказы этого клиента и их статус.',
        parametersJsonSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cancel_order',
        description: 'Отменить заказ клиента по его просьбе.',
        parametersJsonSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
      },
      handoff,
    ];
  }
  const serviceIds = b.services.map((s) => s.id);
  const staffIds = b.staff.map((s) => s.id);
  return [
    {
      name: 'find_free_slots',
      description: 'Свободное время для услуги на дату. Вызывай всегда, прежде чем называть клиенту время.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          service_id: { type: 'string', enum: serviceIds },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          staff_id: { type: 'string', enum: staffIds, description: 'Только если клиент хочет конкретного мастера' },
        },
        required: ['service_id', 'date'],
      },
    },
    {
      name: 'book_appointment',
      description: 'Записать клиента. Нужны услуга, дата, время и имя клиента.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          service_id: { type: 'string', enum: serviceIds },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM' },
          customer_name: { type: 'string' },
          staff_id: { type: 'string', enum: staffIds },
        },
        required: ['service_id', 'date', 'time', 'customer_name'],
      },
    },
    {
      name: 'list_customer_bookings',
      description: 'Действующие записи этого клиента.',
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'reschedule_booking',
      description: 'Перенести запись клиента на другое время (сначала проверь свободное время).',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          booking_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM' },
          staff_id: { type: 'string', enum: staffIds },
        },
        required: ['booking_id', 'date', 'time'],
      },
    },
    {
      name: 'cancel_booking',
      description: 'Отменить запись клиента по его просьбе.',
      parametersJsonSchema: { type: 'object', properties: { booking_id: { type: 'string' } }, required: ['booking_id'] },
    },
    handoff,
  ];
}

const PROBLEM_TEXT: Record<BookingProblem, string> = {
  unknown_service: 'Такой услуги нет.',
  unknown_staff: 'Этот мастер не делает эту услугу.',
  bad_date: 'Неверная дата или время.',
  past: 'Это время уже прошло или слишком близко.',
  too_far: `Запись открыта только на ${HORIZON_DAYS} дней вперёд.`,
  closed: 'В этот день заведение не работает.',
  outside_hours: 'Это время вне часов работы (услуга должна закончиться до закрытия).',
  busy: 'Это время уже занято.',
};

function cleanName(raw: unknown): string {
  return String(typeof raw === 'string' ? raw : '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function dayInfo(date: string) {
  return { date, weekday: weekdayName(date, 'ru') };
}

type Result = Record<string, unknown>;

export function runTool(session: Session, name: string, args: Record<string, unknown>, nowMs: number): Result {
  const b = session.business;
  const now = localNow(nowMs);
  switch (name) {
    case 'find_free_slots': {
      const serviceId = String(args.service_id ?? '');
      const date = String(args.date ?? '');
      const staffId = args.staff_id ? String(args.staff_id) : undefined;
      const service = b.services.find((s) => s.id === serviceId);
      if (!service) return { error: 'unknown_service' };
      if (!isDate(date)) return { error: 'bad_date', hint: 'Дата в формате YYYY-MM-DD' };
      if (date < now.date) return { error: 'past', today: now.date };
      if (daysBetween(now.date, date) > HORIZON_DAYS) return { error: 'too_far', message: PROBLEM_TEXT.too_far };
      if (!dayHours(b, date)) {
        const open: string[] = [];
        for (let d = 1; d <= 7 && open.length < 3; d++) if (dayHours(b, addDays(date, d))) open.push(addDays(date, d));
        return { ...dayInfo(date), closed: true, next_open_days: open.map(dayInfo) };
      }
      const perStaff = freeTimes(b, session.bookings, serviceId, date, now, staffId).map((s) => ({
        staff_id: s.staffId,
        name: b.staff.find((x) => x.id === s.staffId)?.name ?? '',
        free: s.times.map(toHHMM),
      }));
      const any = perStaff.some((s) => s.free.length);
      const result: Result = {
        ...dayInfo(date),
        service: service.ru,
        minutes: service.minutes,
        price: service.price,
        price_from: !!service.priceFrom,
        staff: perStaff,
      };
      if (!any) {
        result.no_free_time = true;
        result.nearest = nearestFree(b, session.bookings, serviceId, addDays(date, 1), 12 * 60, now, staffId).map((x) => ({ ...dayInfo(x.date), time: x.time }));
      }
      return result;
    }
    case 'book_appointment':
    case 'reschedule_booking': {
      const moving = name === 'reschedule_booking' ? session.bookings.find((x) => x.id === String(args.booking_id ?? '') && x.source === 'bot' && x.status === 'active') : undefined;
      if (name === 'reschedule_booking' && !moving) return { error: 'not_found', message: 'Запись не найдена.' };
      const serviceId = moving ? moving.serviceId : String(args.service_id ?? '');
      const customer = moving ? moving.customer : cleanName(args.customer_name);
      if (!customer) return { error: 'no_name', message: 'Спроси имя клиента.' };
      const date = String(args.date ?? '');
      const time = String(args.time ?? '');
      const staffId = args.staff_id ? String(args.staff_id) : undefined;
      const check = checkBooking(b, session.bookings, { serviceId, date, time, staffId, customer, ignoreId: moving?.id }, now);
      if ('problem' in check) {
        const wanted = toMin(time) ?? 12 * 60;
        const alternatives =
          check.problem === 'busy' || check.problem === 'outside_hours' || check.problem === 'past' || check.problem === 'closed'
            ? nearestFree(b, session.bookings.filter((x) => x.id !== moving?.id), serviceId, isDate(date) && date >= now.date ? date : now.date, wanted, now, staffId).map((x) => ({ ...dayInfo(x.date), time: x.time }))
            : [];
        return { error: check.problem, message: PROBLEM_TEXT[check.problem], alternatives };
      }
      const service = b.services.find((s) => s.id === serviceId)!;
      const start = toHHMM(toMin(time)!);
      let id: string;
      if (moving) {
        moving.date = date;
        moving.start = start;
        moving.staffId = check.staffId;
        delete moving.remindedAt;
        id = moving.id;
      } else {
        id = nextId(session, 'b');
        session.bookings.push({ id, serviceId, staffId: check.staffId, date, start, minutes: service.minutes, customer, source: 'bot', status: 'active', createdAt: nowMs });
      }
      const staff = b.staff.find((x) => x.id === check.staffId);
      return {
        ok: true,
        booking_id: id,
        ...dayInfo(date),
        time: start,
        service: service.ru,
        staff: staff ? `${staff.name} (${staff.role_ru})` : '',
        price: service.price,
        price_from: !!service.priceFrom,
        customer,
        address: b.address,
      };
    }
    case 'list_customer_bookings': {
      const mine = session.bookings.filter((x) => x.source === 'bot' && x.status === 'active');
      return {
        bookings: mine.map((x) => ({
          booking_id: x.id,
          ...dayInfo(x.date),
          time: x.start,
          service: b.services.find((s) => s.id === x.serviceId)?.ru ?? '',
          staff: b.staff.find((s) => s.id === x.staffId)?.name ?? '',
        })),
      };
    }
    case 'cancel_booking': {
      const x = session.bookings.find((y) => y.id === String(args.booking_id ?? '') && y.source === 'bot' && y.status === 'active');
      if (!x) return { error: 'not_found' };
      x.status = 'cancelled';
      return { ok: true, cancelled: x.id };
    }
    case 'create_order':
      return createOrder(session, args, nowMs);
    case 'list_customer_orders':
      return {
        orders: session.orders
          .filter((o) => o.source === 'bot')
          .map((o) => ({ order_id: o.id, status: o.status, ...dayInfo(o.date), time: o.time, total: o.total })),
      };
    case 'cancel_order': {
      const o = session.orders.find((y) => y.id === String(args.order_id ?? '') && y.source === 'bot');
      if (!o) return { error: 'not_found' };
      if (o.status === 'cancelled' || o.status === 'rejected') return { error: 'already_closed' };
      o.status = 'cancelled';
      for (const a of session.alerts) if (a.refId === o.id) a.done = true;
      return { ok: true, cancelled: o.id };
    }
    case 'handoff_to_owner': {
      const reason = String(args.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'вопрос клиента';
      session.alerts.push({ id: nextId(session, 'a'), at: nowMs, kind: 'handoff', ...prefixed(ALERT_TEXT.handoff(reason)), done: false });
      return { ok: true, note: 'Администратор получил уведомление и ответит в этом чате.' };
    }
    default:
      return { error: 'unknown_tool' };
  }
}

function prefixed(t: { ru: string; kz: string }) {
  return { text_ru: t.ru, text_kz: t.kz };
}

function createOrder(session: Session, args: Record<string, unknown>, nowMs: number): Result {
  const b = session.business;
  const now = localNow(nowMs);
  const rawItems = Array.isArray(args.items) ? args.items.slice(0, 10) : [];
  const items: OrderItem[] = [];
  const problems: string[] = [];
  const date = String(args.date ?? '');
  if (!isDate(date)) return { error: 'bad_date', hint: 'YYYY-MM-DD' };
  if (date < now.date) return { error: 'past', today: now.date };
  if (daysBetween(now.date, date) > HORIZON_DAYS) return { error: 'too_far' };
  const hours = dayHours(b, date);
  if (!hours) return { error: 'closed', message: 'В этот день не работаем.' };
  const t = toMin(args.time);
  if (t === null || t < hours[0] || t > hours[1] - 30) return { error: 'outside_hours', hours: `${toHHMM(hours[0])}–${toHHMM(hours[1])}` };
  if (date === now.date && t < now.minutes + 60) return { error: 'too_soon', message: 'К этому времени не успеем; минимум через час.' };
  for (const raw of rawItems) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const p = b.products.find((x) => x.id === String(r.product_id ?? ''));
    if (!p) {
      problems.push('unknown_product');
      continue;
    }
    let qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    qty = p.unit === 'кг' ? Math.min(10, Math.max(1, Math.round(qty * 2) / 2)) : Math.min(20, Math.max(1, Math.round(qty)));
    const days = daysBetween(now.date, date);
    if (!(p.available && days === 0) && days < p.leadDays) {
      problems.push(`${p.ru}: нужно ${p.leadDays} дн. на приготовление, самое раннее ${addDays(now.date, p.leadDays)}`);
      continue;
    }
    items.push({ productId: p.id, qty });
  }
  if (problems.length) return { error: 'cannot_order', problems };
  if (!items.length) return { error: 'no_items' };
  const customer = cleanName(args.customer_name);
  if (!customer) return { error: 'no_name', message: 'Спроси имя клиента.' };
  const mode = args.mode === 'delivery' ? 'delivery' : 'pickup';
  const address = String(args.address ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (mode === 'delivery' && !address) return { error: 'no_address', message: 'Спроси адрес доставки.' };
  if (mode === 'delivery' && !b.delivery) return { error: 'no_delivery', message: 'Доставки нет, только самовывоз.' };
  const subtotal = items.reduce((sum, it) => sum + (b.products.find((p) => p.id === it.productId)?.price ?? 0) * it.qty, 0);
  const delivery = mode === 'delivery' && b.delivery ? (subtotal >= b.delivery.freeFrom ? 0 : b.delivery.price) : 0;
  const order: Order = {
    id: nextId(session, 'o'),
    items,
    total: subtotal + delivery,
    date,
    time: toHHMM(t),
    mode,
    address: mode === 'delivery' ? address : '',
    note: String(args.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
    customer,
    source: 'bot',
    status: 'new',
    createdAt: nowMs,
  };
  session.orders.push(order);
  session.alerts.push({ id: nextId(session, 'a'), at: nowMs, kind: 'order', ...prefixed(ALERT_TEXT.newOrder), done: false, refId: order.id });
  const madeToOrder = items.some((it) => !b.products.find((p) => p.id === it.productId)?.available);
  return {
    ok: true,
    order_id: order.id,
    status: 'ждёт подтверждения администратора (обычно до 15 минут)',
    items: items.map((it) => {
      const p = b.products.find((x) => x.id === it.productId)!;
      return { name: p.ru, qty: it.qty, unit: p.unit, price: p.price, price_from: !!p.priceFrom };
    }),
    subtotal,
    delivery,
    total: order.total,
    ...dayInfo(date),
    time: order.time,
    mode,
    address: order.address,
    prepayment: madeToOrder ? 'Для тортов на заказ предоплата 50% через Kaspi после подтверждения' : '',
  };
}
