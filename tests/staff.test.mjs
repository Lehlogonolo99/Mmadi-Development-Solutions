import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaffApp } from '../services/staff/app.js';
import { createRepairsApp } from '../services/repairs/app.js';
import { fakeStore, fakeAuth, call } from './fakes.mjs';

function setup() {
  const store = fakeStore(); const auth = fakeAuth();
  auth.addUser('owner', { email: 'owner@test.co.za', emailVerified: false });
  auth.addUser('intruder', { email: 'intruder@test.co.za' });
  return { app: createStaffApp({ store, auth, ownerEmail: 'Owner@Test.co.za' }), store, auth };
}

test('only the verified owner can bootstrap, and only once', async () => {
  const { app, auth, store } = setup();
  const me = await call(app, 'GET', '/api/staff/me', { token: 'token:owner' });
  assert.equal(me.body.staff, false);
  assert.equal(me.body.canBootstrap, true);
  assert.equal((await call(app, 'GET', '/api/staff/me', { token: 'token:intruder' })).body.canBootstrap, false);

  assert.equal((await call(app, 'POST', '/api/staff/bootstrap', { token: 'token:intruder', body: { name: 'X Y' } })).status, 403);
  const unverified = await call(app, 'POST', '/api/staff/bootstrap', { token: 'token:owner', body: { name: 'Lehlogonolo Mmadi' } });
  assert.equal(unverified.status, 403);
  assert.match(unverified.body.error.message, /Verify/);

  auth.users.owner.emailVerified = true;
  assert.equal((await call(app, 'POST', '/api/staff/bootstrap', { token: 'token:owner', body: { name: 'Lehlogonolo Mmadi' } })).status, 200);
  assert.deepEqual(auth.users.owner.claims, { role: 'admin' });
  assert.equal(store.data.staff.owner.role, 'admin');
  assert.equal((await call(app, 'POST', '/api/staff/bootstrap', { token: 'token:owner', body: { name: 'Again' } })).status, 409);

  const after = await call(app, 'GET', '/api/staff/me', { token: 'token:owner' });
  assert.equal(after.body.staff, true);
  assert.equal(after.body.profile.name, 'Lehlogonolo Mmadi');
});

async function withAdmin() {
  const ctx = setup();
  ctx.auth.users.owner.emailVerified = true;
  await call(ctx.app, 'POST', '/api/staff/bootstrap', { token: 'token:owner', body: { name: 'Lehlogonolo Mmadi' } });
  return ctx;
}

test('admin adds an employee, who can then use other services', async () => {
  const { app, auth, store } = await withAdmin();
  const r = await call(app, 'POST', '/api/staff/employees', { token: 'token:owner', body: { name: 'Thabo Sekhukhune', email: 'Thabo@Test.co.za', role: 'staff', area: 'repairs' } });
  assert.equal(r.status, 201);
  assert.match(r.body.setupLink, /reset/);
  const uid = r.body.employee.uid;
  assert.deepEqual(auth.users[uid].claims, { role: 'staff' });
  assert.equal(auth.users[uid].email, 'thabo@test.co.za');

  const repairs = createRepairsApp({ store, auth });
  assert.equal((await call(repairs, 'GET', '/api/repairs/jobs', { token: `token:${uid}` })).status, 200);
  assert.equal((await call(app, 'GET', '/api/staff/employees', { token: `token:${uid}` })).status, 403);
  assert.equal((await call(app, 'GET', '/api/staff/directory', { token: `token:${uid}` })).body.items.length, 2);

  const dup = await call(app, 'POST', '/api/staff/employees', { token: 'token:owner', body: { name: 'Thabo', email: 'thabo@test.co.za', role: 'staff', area: 'repairs' } });
  assert.equal(dup.status, 409);
});

test('deactivating an employee disables them everywhere; reactivating restores access', async () => {
  const { app, auth, store } = await withAdmin();
  const { body: { employee: { uid } } } = await call(app, 'POST', '/api/staff/employees', { token: 'token:owner', body: { name: 'Thabo Sekhukhune', email: 'thabo@test.co.za', role: 'staff', area: 'repairs' } });
  const off = await call(app, 'PATCH', `/api/staff/employees/${uid}`, { token: 'token:owner', body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(auth.users[uid].disabled, true);
  assert.deepEqual(auth.users[uid].claims, {});
  assert.ok(auth.users[uid].revokedAt);
  const repairs = createRepairsApp({ store, auth });
  assert.equal((await call(repairs, 'GET', '/api/repairs/jobs', { token: `token:${uid}` })).status, 401);

  await call(app, 'PATCH', `/api/staff/employees/${uid}`, { token: 'token:owner', body: { active: true, role: 'admin' } });
  assert.equal(auth.users[uid].disabled, false);
  assert.deepEqual(auth.users[uid].claims, { role: 'admin' });
});

test('admins cannot demote or deactivate themselves', async () => {
  const { app } = await withAdmin();
  assert.equal((await call(app, 'PATCH', '/api/staff/employees/owner', { token: 'token:owner', body: { active: false } })).status, 400);
  assert.equal((await call(app, 'PATCH', '/api/staff/employees/owner', { token: 'token:owner', body: { role: 'staff' } })).status, 400);
  assert.equal((await call(app, 'PATCH', '/api/staff/employees/owner', { token: 'token:owner', body: { area: 'cafe' } })).status, 200);
});

test('bootstrap is refused when no owner email is configured', async () => {
  const store = fakeStore(); const auth = fakeAuth();
  auth.addUser('u', { email: 'a@b.co' });
  const app = createStaffApp({ store, auth, ownerEmail: '' });
  assert.equal((await call(app, 'POST', '/api/staff/bootstrap', { token: 'token:u', body: { name: 'A B' } })).status, 403);
});
