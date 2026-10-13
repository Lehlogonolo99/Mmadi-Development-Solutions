import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearnershipsApp } from '../services/learnerships/app.js';
import { fakeStore, fakeAuth, call, setupStaff } from './fakes.mjs';

const now = () => new Date('2026-10-13T07:00:00Z');
function setup() {
  const store = fakeStore(); const auth = fakeAuth(); const t = setupStaff(auth);
  return { app: createLearnershipsApp({ store, auth, now }), store, t };
}
const intake = { title: '2027 IT Support Learnership', track: 'end_user_support', startDate: '2027-02-01', closingDate: '2026-12-15', seats: 20, status: 'open', certifications: ['MICT SETA NQF 5', 'AWS Certified Cloud Practitioner'] };
const application = { fullName: 'Karabo Phala', phone: '071 555 0144', email: 'Karabo@Example.com', town: 'Ga-Moretsele', qualification: 'matric', track: 'aws', employed: false, motivation: 'I have always fixed phones for my family and want to learn cloud.', consent: true };

test('admins publish intakes; the public sees open and upcoming ones', async () => {
  const { app, t } = setup();
  assert.equal((await call(app, 'POST', '/api/learnerships/intakes', { token: t.staff, body: intake })).status, 403);
  const bad = await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: { ...intake, closingDate: '2027-03-01' } });
  assert.equal(bad.status, 400);
  await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: intake });
  await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: { ...intake, title: 'Old intake', status: 'closed' } });
  await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: { ...intake, title: 'Expired', closingDate: '2026-10-01' } });
  const pub = await call(app, 'GET', '/api/learnerships/intakes');
  assert.deepEqual(pub.body.items.map((i) => i.title), ['2027 IT Support Learnership']);
});

test('apply to an intake, then check status by reference and email', async () => {
  const { app, t } = setup();
  const i = await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: intake });
  const r = await call(app, 'POST', '/api/learnerships/applications', { body: { ...application, intakeId: i.body.id } });
  assert.equal(r.status, 201);
  assert.equal(r.body.ref, 'L-0001');
  const list = await call(app, 'GET', '/api/learnerships/applications', { token: t.staff });
  await call(app, 'PATCH', `/api/learnerships/applications/${list.body.items[0].id}`, { token: t.staff, body: { status: 'shortlisted', notes: 'Strong motivation' } });
  const s = await call(app, 'GET', '/api/learnerships/applications/status?ref=l-0001&email=karabo@example.com');
  assert.equal(s.body.statusLabel, 'Shortlisted');
  assert.equal(s.body.intakeTitle, '2027 IT Support Learnership');
  assert.equal(s.body.notes, undefined);
  assert.equal((await call(app, 'GET', '/api/learnerships/applications/status?ref=L-0001&email=other@example.com')).status, 404);
});

test('applications to closed intakes are refused; general pool works', async () => {
  const { app, t } = setup();
  const closed = await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: { ...intake, status: 'closed' } });
  const r = await call(app, 'POST', '/api/learnerships/applications', { body: { ...application, intakeId: closed.body.id } });
  assert.ok(r.body.error.details.intakeId);
  const pool = await call(app, 'POST', '/api/learnerships/applications', { body: application, ip: '7.7.7.7' });
  assert.equal(pool.status, 201);
  const short = await call(app, 'POST', '/api/learnerships/applications', { body: { ...application, motivation: 'too short' }, ip: '6.6.6.6' });
  assert.ok(short.body.error.details.motivation);
});

test('intakes with applications cannot be deleted', async () => {
  const { app, t } = setup();
  const i = await call(app, 'POST', '/api/learnerships/intakes', { token: t.admin, body: intake });
  await call(app, 'POST', '/api/learnerships/applications', { body: { ...application, intakeId: i.body.id } });
  assert.equal((await call(app, 'DELETE', `/api/learnerships/intakes/${i.body.id}`, { token: t.admin })).status, 400);
});
