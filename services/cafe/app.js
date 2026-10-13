// Internet café service: opening hours, price list, and bookings for computers and help desk services.
// Owns the Firestore collections `cafeSettings`, `cafePrices` and `cafeBookings`.

import { createService, notFound, badRequest } from './shared/http.js';
import { v, parse, phoneKey } from './shared/validate.js';
import { ref, todaySA, addDays, filterStatus, byNewest } from './shared/util.js';
import { FORM_LIMIT, LOOKUP_LIMIT } from './shared/config.js';

export const SERVICES = {
  computer: 'Computer and internet use',
  printing: 'Printing, scanning or copying',
  cv: 'CV typing and formatting',
  online_application: 'Help with an online application',
};

export const BOOKING_STATUS = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Didn’t arrive',
};
const CLOSED = ['completed', 'cancelled', 'no_show'];

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_OF_WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const BOOKING_WINDOW_DAYS = 30;

const SETTINGS = 'cafeSettings';
const PRICES = 'cafePrices';
const BOOKINGS = 'cafeBookings';

const hoursShape = v.object({
  day: v.oneOf(DAYS),
  closed: v.bool(),
  open: v.time({ optional: true }),
  close: v.time({ optional: true }),
});

const settingsShape = {
  hours: v.list(hoursShape, { max: 7 }),
  notice: v.string({ max: 300, optional: true }),
};

const priceShape = {
  item: v.string({ min: 2, max: 100 }),
  unit: v.string({ min: 1, max: 40 }),
  price: v.number({ min: 0, max: 10000 }),
  service: v.oneOf(Object.keys(SERVICES)),
  sort: v.number({ integer: true, min: 0, max: 999, optional: true, default: 100 }),
  active: v.bool({ optional: true, default: true }),
};

const bookingShape = {
  name: v.string({ min: 2, max: 100 }),
  phone: v.phone(),
  email: v.email({ optional: true }),
  service: v.oneOf(Object.keys(SERVICES)),
  date: v.date(),
  time: v.time(),
  duration: v.oneOf([30, 60, 90, 120], { optional: true, default: 60 }),
  notes: v.text({ max: 1000, optional: true }),
  consent: v.bool(),
};

const bookingUpdateShape = {
  status: v.oneOf(Object.keys(BOOKING_STATUS), { optional: true }),
  notes: v.text({ max: 1000, optional: true }),
  staffNotes: v.text({ max: 5000, optional: true }),
};

const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function validateHours(hours) {
  const seen = new Set();
  const errors = {};
  hours.forEach((h, i) => {
    if (seen.has(h.day)) errors[`hours[${i}].day`] = 'Each day can only appear once.';
    seen.add(h.day);
    if (!h.closed) {
      if (!h.open || !h.close) errors[`hours[${i}]`] = 'Give an opening and closing time, or mark the day closed.';
      else if (toMinutes(h.close) <= toMinutes(h.open)) errors[`hours[${i}].close`] = 'Closing time must be after opening time.';
    }
  });
  if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
  return DAYS.map((day) => hours.find((h) => h.day === day)).filter(Boolean);
}

export function createCafeApp({ store, auth, now = () => new Date() }) {
  const app = createService({ name: 'cafe', auth });

  async function settings() {
    const s = await store.get(SETTINGS, 'main');
    return { hours: s?.hours || [], notice: s?.notice || '' };
  }

  // ---- Public ----

  app.get('/info', { cache: 60 }, async () => {
    const [s, prices] = await Promise.all([
      settings(),
      store.query(PRICES, { where: [['active', '==', true]], limit: 200 }),
    ]);
    return {
      ...s,
      services: SERVICES,
      prices: prices
        .sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.item.localeCompare(b.item))
        .map(({ id, item, unit, price, service }) => ({ id, item, unit, price, service })),
    };
  });

  app.post('/bookings', { rateLimit: FORM_LIMIT }, async ({ body }) => {
    const data = parse(bookingShape, body);
    if (data.consent !== true) throw badRequest('Some fields need attention.', { consent: 'Tick the box to let us store your details.' });

    const today = todaySA(now());
    const last = addDays(today, BOOKING_WINDOW_DAYS);
    if (data.date < today || data.date > last) {
      throw badRequest('Some fields need attention.', { date: `Choose a date between today and ${last}.` });
    }

    const { hours } = await settings();
    if (hours.length) {
      const day = DAY_OF_WEEK[new Date(`${data.date}T00:00:00Z`).getUTCDay()];
      const h = hours.find((x) => x.day === day);
      if (!h || h.closed) throw badRequest('Some fields need attention.', { date: 'We’re closed on that day.' });
      const start = toMinutes(data.time);
      if (start < toMinutes(h.open) || start + data.duration > toMinutes(h.close)) {
        throw badRequest('Some fields need attention.', { time: `On that day we’re open ${h.open} to ${h.close}.` });
      }
    }

    const n = await store.nextSequence('cafeBookings');
    const booking = await store.add(BOOKINGS, {
      ...data,
      ref: ref('C', n),
      phoneKey: phoneKey(data.phone),
      status: 'requested',
      staffNotes: '',
    });
    return { ref: booking.ref, status: booking.status, statusLabel: BOOKING_STATUS.requested };
  });

  app.get('/bookings/status', { rateLimit: LOOKUP_LIMIT }, async ({ query }) => {
    const reference = String(query.ref || '').trim().toUpperCase();
    const key = phoneKey(query.phone);
    if (!/^C-\d{4,}$/.test(reference) || key.length < 9) throw badRequest('Enter your booking reference (like C-0012) and phone number.');
    const [b] = await store.query(BOOKINGS, { where: [['ref', '==', reference]], limit: 1 });
    if (!b || b.phoneKey !== key) throw notFound('We couldn’t find a booking with that reference and phone number.');
    return { ref: b.ref, service: b.service, date: b.date, time: b.time, duration: b.duration, status: b.status, statusLabel: BOOKING_STATUS[b.status] };
  });

  // ---- Staff ----

  app.get('/bookings', { auth: 'staff' }, async ({ query }) => {
    let items = await store.query(BOOKINGS, { orderBy: 'createdAt', limit: 500 });
    items = filterStatus(items, query.status, { closed: CLOSED });
    if (query.date) items = items.filter((b) => b.date === query.date);
    return { items: items.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || byNewest(a, b)) };
  });

  app.patch('/bookings/:id', { auth: 'staff' }, async ({ params, body, user }) => {
    const changes = parse(bookingUpdateShape, body, { partial: true });
    const updated = await store.update(BOOKINGS, params.id, { ...changes, updatedBy: user.uid });
    if (!updated) throw notFound('That booking doesn’t exist.');
    return updated;
  });

  app.delete('/bookings/:id', { auth: 'admin' }, async ({ params }) => {
    await store.remove(BOOKINGS, params.id);
    return { ok: true };
  });

  // ---- Settings and prices (administrators) ----

  app.put('/settings', { auth: 'admin' }, async ({ body, user }) => {
    const data = parse(settingsShape, body);
    const hours = validateHours(data.hours).map((h) => (h.closed ? { day: h.day, closed: true } : h));
    await store.set(SETTINGS, 'main', { hours, notice: data.notice || '', updatedBy: user.uid, updatedAt: new Date() });
    return { hours, notice: data.notice || '' };
  });

  app.get('/prices', { auth: 'staff' }, async () => ({
    items: (await store.query(PRICES, { limit: 300 })).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100)),
  }));

  app.post('/prices', { auth: 'admin' }, async ({ body }) => store.add(PRICES, parse(priceShape, body)));

  app.patch('/prices/:id', { auth: 'admin' }, async ({ params, body }) => {
    const updated = await store.update(PRICES, params.id, parse(priceShape, body, { partial: true }));
    if (!updated) throw notFound('That price doesn’t exist.');
    return updated;
  });

  app.delete('/prices/:id', { auth: 'admin' }, async ({ params }) => {
    await store.remove(PRICES, params.id);
    return { ok: true };
  });

  return app;
}
