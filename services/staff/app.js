// Staff service: employee accounts, roles and deactivation, plus the one-time owner setup.
// Owns the Firestore collections `staff` and `staffMeta`, and the role custom claims in Firebase Auth.
//
// Roles are stored as a custom claim { role: 'admin' | 'staff' } that every other service checks.
// Deactivating an employee disables their Firebase Auth account and revokes their sessions,
// which locks them out of every service at once.

import { createService, notFound, badRequest, forbidden, conflict } from './shared/http.js';
import { v, parse } from './shared/validate.js';
import { ROLES } from './shared/auth.js';

export const AREAS = {
  general: 'General',
  repairs: 'Repairs',
  cafe: 'Internet café',
  learnerships: 'Learnerships',
};

const STAFF = 'staff';
const META = 'staffMeta';

const employeeShape = {
  name: v.string({ min: 2, max: 100 }),
  email: v.email(),
  role: v.oneOf(ROLES),
  area: v.oneOf(Object.keys(AREAS)),
};

const employeeUpdateShape = {
  name: v.string({ min: 2, max: 100, optional: true }),
  role: v.oneOf(ROLES, { optional: true }),
  area: v.oneOf(Object.keys(AREAS), { optional: true }),
  active: v.bool({ optional: true }),
};

const bootstrapShape = { name: v.string({ min: 2, max: 100 }) };

function randomPassword() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

/**
 * ownerEmail: the only address allowed to create the first administrator (env OWNER_EMAIL).
 * portalUrl:  where password setup links send people afterwards (env PORTAL_URL, optional).
 */
export function createStaffApp({ store, auth, ownerEmail = '', portalUrl = '' }) {
  const app = createService({ name: 'staff', auth });
  const owner = String(ownerEmail).trim().toLowerCase();

  const setupLink = (email) =>
    auth.generatePasswordResetLink(email, portalUrl ? { url: portalUrl } : undefined).catch(() => null);

  async function bootstrapDone() {
    return Boolean(await store.get(META, 'bootstrap'));
  }

  // ---- Any signed-in account ----

  /** Tells the portal who is signed in, and whether this account may run first-time setup. */
  app.get('/me', { auth: 'signed-in' }, async ({ user }) => {
    const profile = await store.get(STAFF, user.uid);
    if (user.role && profile?.active) return { staff: true, profile: { ...profile, role: user.role } };
    const canBootstrap = Boolean(owner) && user.email === owner && !(await bootstrapDone());
    return { staff: false, deactivated: profile ? !profile.active : false, canBootstrap, emailVerified: user.emailVerified };
  });

  app.post('/bootstrap', { auth: 'signed-in', created: false }, async ({ user, body }) => {
    const { name } = parse(bootstrapShape, body);
    if (!owner) throw forbidden('Setup isn’t configured. Set OWNER_EMAIL for the staff service.');
    if (user.email !== owner) throw forbidden('Only the owner’s email can create the first administrator.');
    if (!user.emailVerified) throw forbidden('Verify your email address first, using the link we sent you.');
    // createOnce is atomic, so two simultaneous setup attempts can't both succeed.
    const claimed = await store.createOnce(META, 'bootstrap', { claimedBy: user.uid, claimedAt: new Date() });
    if (!claimed) throw conflict('Setup has already been completed.');

    await auth.setCustomUserClaims(user.uid, { role: 'admin' });
    const profile = { name, email: user.email, role: 'admin', area: 'general', active: true, createdAt: new Date(), createdBy: user.uid };
    await store.set(STAFF, user.uid, profile);
    return { ok: true };
  });

  // ---- Staff ----

  /** Active colleagues, for assigning work. */
  app.get('/directory', { auth: 'staff' }, async () => {
    const all = await store.query(STAFF, { limit: 500 });
    return {
      items: all.filter((p) => p.active).map(({ id, name, area, role }) => ({ uid: id, name, area, role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // ---- Administrators ----

  app.get('/employees', { auth: 'admin' }, async () => {
    const all = await store.query(STAFF, { limit: 500 });
    return {
      items: all.map((p) => ({ uid: p.id, ...p, id: undefined }))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    };
  });

  app.post('/employees', { auth: 'admin' }, async ({ body, user }) => {
    const data = parse(employeeShape, body);

    let account = await auth.getUserByEmail(data.email).catch(() => null);
    if (account && (await store.get(STAFF, account.uid))) {
      throw conflict('This person is already an employee. Find them in the list to reactivate or edit them.');
    }
    if (account) {
      await auth.updateUser(account.uid, { displayName: data.name, disabled: false });
    } else {
      account = await auth.createUser({ email: data.email, displayName: data.name, password: randomPassword() });
    }
    await auth.setCustomUserClaims(account.uid, { role: data.role });

    const profile = { ...data, active: true, createdAt: new Date(), createdBy: user.uid };
    await store.set(STAFF, account.uid, profile);
    return {
      employee: { uid: account.uid, ...profile, createdAt: profile.createdAt.toISOString() },
      setupLink: await setupLink(data.email),
    };
  });

  app.patch('/employees/:uid', { auth: 'admin' }, async ({ params, body, user }) => {
    const changes = parse(employeeUpdateShape, body, { partial: true });
    const current = await store.get(STAFF, params.uid);
    if (!current) throw notFound('That employee doesn’t exist.');

    const self = params.uid === user.uid;
    if (self && ((changes.role && changes.role !== current.role) || changes.active === false)) {
      throw badRequest('You can’t change your own role or deactivate yourself. Ask another administrator.');
    }

    const next = { ...current, ...changes };
    const accessChanged = next.role !== current.role || next.active !== current.active;

    await auth.updateUser(params.uid, {
      ...(changes.name ? { displayName: changes.name } : {}),
      ...(changes.active !== undefined ? { disabled: !changes.active } : {}),
    });
    if (accessChanged) {
      await auth.setCustomUserClaims(params.uid, next.active ? { role: next.role } : {});
      await auth.revokeRefreshTokens(params.uid); // takes effect everywhere on their next request
    }

    const updated = await store.update(STAFF, params.uid, { ...changes, updatedBy: user.uid });
    return { uid: params.uid, ...updated, id: undefined };
  });

  app.post('/employees/:uid/setup-link', { auth: 'admin', created: false }, async ({ params }) => {
    const current = await store.get(STAFF, params.uid);
    if (!current) throw notFound('That employee doesn’t exist.');
    if (!current.active) throw badRequest('Reactivate this employee before sending them a link.');
    const link = await setupLink(current.email);
    if (!link) throw badRequest('A link couldn’t be created. Check the email address is correct.');
    return { link };
  });

  return app;
}
