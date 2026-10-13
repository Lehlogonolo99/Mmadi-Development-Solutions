import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepairsApp } from '../services/repairs/app.js';
import { fakeStore, fakeAuth, call, setupStaff } from './fakes.mjs';

function setup() {
  const store = fakeStore(); const auth = fakeAuth(); const t = setupStaff(auth);
  return { app: createRepairsApp({ store, auth }), store, auth, t };
}
const booking = { name: 'Abigail Ratau', phone: '072 555 0101', category: 'phone', device: 'Samsung A14', problem: 'Screen cracked', consent: true };

test('a customer books a repair and gets a job number', async () => {
  const { app, store } = setup();
  const r = await call(app, 'POST', '/api/repairs/bookings', { body: booking });
  assert.equal(r.status, 201);
  assert.equal(r.body.jobNo, 'J-0001');
  const second = await call(app, 'POST', '/api/repairs/bookings', { body: booking, ip: '5.5.5.5' });
  assert.equal(second.body.jobNo, 'J-0002');
  const saved = Object.values(store.data.repairJobs)[0];
  assert.equal(saved.status, 'booked');
  assert.equal(saved.phoneKey, '725550101');
});

test('bookings are validated and unknown fields rejected', async () => {
  const { app } = setup();
  const r = await call(app, 'POST', '/api/repairs/bookings', { body: { ...booking, name: '', phone: 'abc', status: 'ready' } });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.body.error.details).sort(), ['name', 'phone', 'status']);
  const noConsent = await call(app, 'POST', '/api/repairs/bookings', { body: { ...booking, consent: false } });
  assert.equal(noConsent.status, 400);
  const text = await call(app, 'POST', '/api/repairs/bookings', { body: booking, contentType: 'text/plain' });
  assert.equal(text.status, 415);
});

test('unlock bookings require proof of ownership', async () => {
  const { app } = setup();
  const r = await call(app, 'POST', '/api/repairs/bookings', { body: { ...booking, category: 'unlock' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.hasProofOfOwnership);
  const ok = await call(app, 'POST', '/api/repairs/bookings', { body: { ...booking, category: 'unlock', hasProofOfOwnership: true } });
  assert.equal(ok.status, 201);
});

test('tracking needs the matching phone number and hides internal fields', async () => {
  const { app, t } = setup();
  const { body: { jobNo } } = await call(app, 'POST', '/api/repairs/bookings', { body: booking });
  const jobs = await call(app, 'GET', '/api/repairs/jobs', { token: t.staff });
  await call(app, 'PATCH', `/api/repairs/jobs/${jobs.body.items[0].id}`, { token: t.staff, body: { status: 'in_repair', notes: 'secret internal note', quote: 850 } });

  const wrong = await call(app, 'GET', `/api/repairs/track?job=${jobNo}&phone=0825550101`);
  assert.equal(wrong.status, 404);
  const ok = await call(app, 'GET', '/api/repairs/track?job=j0001&phone=%2B27725550101');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'in_repair');
  assert.equal(ok.body.quote, 850);
  assert.equal(ok.body.history.length, 2);
  assert.equal(JSON.stringify(ok.body).includes('secret'), false);
  assert.equal(ok.body.phone, undefined);
});

test('staff endpoints require a staff token; price list edits require admin', async () => {
  const { app, t } = setup();
  assert.equal((await call(app, 'GET', '/api/repairs/jobs')).status, 401);
  assert.equal((await call(app, 'GET', '/api/repairs/jobs', { token: t.rando })).status, 403);
  assert.equal((await call(app, 'GET', '/api/repairs/jobs', { token: 'token:nobody' })).status, 401);
  assert.equal((await call(app, 'GET', '/api/repairs/jobs', { token: t.staff })).status, 200);
  const item = { name: 'Screen replacement', category: 'phone', priceFrom: 450, priceTo: 1800 };
  assert.equal((await call(app, 'POST', '/api/repairs/catalogue', { token: t.staff, body: item })).status, 403);
  assert.equal((await call(app, 'POST', '/api/repairs/catalogue', { token: t.admin, body: { ...item, priceTo: 100 } })).status, 400);
  assert.equal((await call(app, 'POST', '/api/repairs/catalogue', { token: t.admin, body: item })).status, 201);
  const pub = await call(app, 'GET', '/api/repairs/catalogue');
  assert.equal(pub.body.items.length, 1);
  assert.match(pub.headers['cache-control'], /public/);
});

test('status filter: open hides collected and cancelled', async () => {
  const { app, t } = setup();
  await call(app, 'POST', '/api/repairs/bookings', { body: booking });
  await call(app, 'POST', '/api/repairs/bookings', { body: booking });
  const all = await call(app, 'GET', '/api/repairs/jobs', { token: t.staff });
  await call(app, 'PATCH', `/api/repairs/jobs/${all.body.items[0].id}`, { token: t.staff, body: { status: 'collected' } });
  const open = await call(app, 'GET', '/api/repairs/jobs?status=open', { token: t.staff });
  assert.equal(open.body.items.length, 1);
});

test('unknown routes and wrong methods', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'GET', '/api/repairs/nope')).status, 404);
  const r = await call(app, 'DELETE', '/api/repairs/bookings');
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'POST');
});

test('booking form is rate limited per address', async () => {
  const { app } = setup();
  let last;
  for (let i = 0; i < 9; i++) last = await call(app, 'POST', '/api/repairs/bookings', { body: booking, ip: '9.9.9.9' });
  assert.equal(last.status, 429);
  assert.equal((await call(app, 'POST', '/api/repairs/bookings', { body: booking, ip: '8.8.8.8' })).status, 201);
});
