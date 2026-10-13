import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCafeApp } from '../services/cafe/app.js';
import { fakeStore, fakeAuth, call, setupStaff } from './fakes.mjs';

// Fixed clock: Tuesday 13 October 2026, 09:00 in South Africa.
const now = () => new Date('2026-10-13T07:00:00Z');
function setup() {
  const store = fakeStore(); const auth = fakeAuth(); const t = setupStaff(auth);
  return { app: createCafeApp({ store, auth, now }), store, t };
}
const weekHours = [
  { day: 'mon', closed: false, open: '08:00', close: '17:00' },
  { day: 'tue', closed: false, open: '08:00', close: '17:00' },
  { day: 'sun', closed: true },
];
const booking = { name: 'Karabo Phala', phone: '071 555 0144', service: 'computer', date: '2026-10-13', time: '10:00', duration: 60, consent: true };

test('admin sets hours; invalid hours are rejected', async () => {
  const { app, t } = setup();
  const bad = await call(app, 'PUT', '/api/cafe/settings', { token: t.admin, body: { hours: [{ day: 'mon', closed: false, open: '17:00', close: '08:00' }] } });
  assert.equal(bad.status, 400);
  assert.equal((await call(app, 'PUT', '/api/cafe/settings', { token: t.staff, body: { hours: weekHours } })).status, 403);
  const ok = await call(app, 'PUT', '/api/cafe/settings', { token: t.admin, body: { hours: weekHours, notice: 'Load-shedding: we have backup power.' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.hours.map((h) => h.day), ['mon', 'tue', 'sun']);
  const info = await call(app, 'GET', '/api/cafe/info');
  assert.equal(info.body.notice, 'Load-shedding: we have backup power.');
});

test('bookings must fall inside opening hours and the booking window', async () => {
  const { app, t } = setup();
  await call(app, 'PUT', '/api/cafe/settings', { token: t.admin, body: { hours: weekHours } });
  const past = await call(app, 'POST', '/api/cafe/bookings', { body: { ...booking, date: '2026-10-12' } });
  assert.ok(past.body.error.details.date);
  const far = await call(app, 'POST', '/api/cafe/bookings', { body: { ...booking, date: '2026-12-25' }, ip: '2.2.2.2' });
  assert.ok(far.body.error.details.date);
  const sunday = await call(app, 'POST', '/api/cafe/bookings', { body: { ...booking, date: '2026-10-18' }, ip: '3.3.3.3' });
  assert.match(sunday.body.error.details.date, /closed/);
  const late = await call(app, 'POST', '/api/cafe/bookings', { body: { ...booking, time: '16:30' }, ip: '4.4.4.4' });
  assert.ok(late.body.error.details.time);
  const ok = await call(app, 'POST', '/api/cafe/bookings', { body: booking, ip: '5.5.5.5' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.ref, 'C-0001');
});

test('customer checks a booking; staff confirm it', async () => {
  const { app, t } = setup();
  await call(app, 'POST', '/api/cafe/bookings', { body: booking });
  const list = await call(app, 'GET', '/api/cafe/bookings?status=open', { token: t.staff });
  assert.equal(list.body.items.length, 1);
  await call(app, 'PATCH', `/api/cafe/bookings/${list.body.items[0].id}`, { token: t.staff, body: { status: 'confirmed' } });
  const s = await call(app, 'GET', '/api/cafe/bookings/status?ref=c-0001&phone=0715550144');
  assert.equal(s.body.status, 'confirmed');
  assert.equal((await call(app, 'GET', '/api/cafe/bookings/status?ref=C-0001&phone=0000000000')).status, 404);
});

test('price list: admins manage, public sees active items only', async () => {
  const { app, t } = setup();
  const a = await call(app, 'POST', '/api/cafe/prices', { token: t.admin, body: { item: 'Internet', unit: 'per 30 minutes', price: 10, service: 'computer' } });
  await call(app, 'POST', '/api/cafe/prices', { token: t.admin, body: { item: 'Colour print', unit: 'per page', price: 5, service: 'printing', active: false } });
  assert.equal(a.status, 201);
  const info = await call(app, 'GET', '/api/cafe/info');
  assert.deepEqual(info.body.prices.map((p) => p.item), ['Internet']);
});
