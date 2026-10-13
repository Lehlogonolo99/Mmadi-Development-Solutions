import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContactApp } from '../services/contact/app.js';
import { fakeStore, fakeAuth, call, setupStaff } from './fakes.mjs';

function setup() {
  const store = fakeStore(); const auth = fakeAuth(); const t = setupStaff(auth);
  return { app: createContactApp({ store, auth }), t };
}

test('details default to the registered company info until an admin saves them', async () => {
  const { app, t } = setup();
  const d = await call(app, 'GET', '/api/contact/details');
  assert.equal(d.body.registrationNo, '2026/580350/07');
  assert.equal(d.body.phone, '');
  assert.equal((await call(app, 'PUT', '/api/contact/details', { token: t.staff, body: { phone: '015 555 0100' } })).status, 403);
  const saved = await call(app, 'PUT', '/api/contact/details', { token: t.admin, body: { phone: '015 555 0100', whatsapp: '072 555 0100', mapUrl: 'http://bad' } });
  assert.equal(saved.status, 400);
  const ok = await call(app, 'PUT', '/api/contact/details', { token: t.admin, body: { phone: '015 555 0100', hoursSummary: 'Mon to Sat, 08:00 to 17:00' } });
  assert.equal(ok.body.phone, '015 555 0100');
  assert.equal(ok.body.address[0], 'Stand No 10321');
});

test('messages need a phone or email; staff work the inbox', async () => {
  const { app, t } = setup();
  const msg = { name: 'Principal Maake', topic: 'quote', message: 'We need 20 school laptops serviced.', consent: true };
  const r = await call(app, 'POST', '/api/contact/messages', { body: msg });
  assert.ok(r.body.error.details.phone);
  assert.equal((await call(app, 'POST', '/api/contact/messages', { body: { ...msg, email: 'school@example.com' } })).status, 201);
  const inbox = await call(app, 'GET', '/api/contact/messages?status=open', { token: t.staff });
  assert.equal(inbox.body.items.length, 1);
  await call(app, 'PATCH', `/api/contact/messages/${inbox.body.items[0].id}`, { token: t.staff, body: { status: 'replied' } });
  assert.equal((await call(app, 'GET', '/api/contact/messages?status=open', { token: t.staff })).body.items.length, 0);
});
