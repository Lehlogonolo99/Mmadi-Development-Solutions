// The container entry point: real HTTP through shared/server.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../services/shared/server.js';
import { createRepairsApp } from '../services/repairs/app.js';
import { fakeStore, fakeAuth } from './fakes.mjs';

test('the standalone server routes JSON requests and answers health checks', async () => {
  const server = serve(createRepairsApp({ store: fakeStore(), auth: fakeAuth() }), { port: 0, name: 'repairs' });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const created = await fetch(`${base}/api/repairs/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Abigail Ratau', phone: '072 555 0101', category: 'phone', device: 'Samsung A14', problem: 'Screen cracked', consent: true }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).jobNo, 'J-0001');
    const track = await fetch(`${base}/api/repairs/track?job=J-0001&phone=0725550101`);
    assert.equal((await track.json()).status, 'booked');
    const bad = await fetch(`${base}/api/repairs/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
