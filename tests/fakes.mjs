// In-memory stand-ins for Firestore and Firebase Auth, matching the adapter interface in services/shared/store.js.

const clone = (x) => JSON.parse(JSON.stringify(x));

export function fakeStore() {
  const data = {};
  const seq = {};
  let n = 0;
  const col = (c) => (data[c] ??= {});
  const norm = (d) => clone(d); // Dates become ISO strings, like the real adapter
  return {
    data,
    async add(c, d) { const id = `id${++n}`; col(c)[id] = norm({ ...d, createdAt: new Date(Date.now() + n) }); return { id, ...col(c)[id] }; },
    async get(c, id) { return col(c)[id] ? { id, ...clone(col(c)[id]) } : null; },
    async set(c, id, d) { col(c)[id] = norm(d); return { id, ...col(c)[id] }; },
    async createOnce(c, id, d) { if (col(c)[id]) return false; col(c)[id] = norm(d); return true; },
    async update(c, id, patch) { if (!col(c)[id]) return null; Object.assign(col(c)[id], norm({ ...patch, updatedAt: new Date() })); return { id, ...clone(col(c)[id]) }; },
    async remove(c, id) { delete col(c)[id]; },
    async query(c, { where = [], orderBy, direction = 'desc', limit = 300 } = {}) {
      let rows = Object.entries(col(c)).map(([id, d]) => ({ id, ...clone(d) }));
      for (const [f, op, v] of where) { if (op !== '==') throw new Error('fake supports == only'); rows = rows.filter((r) => r[f] === v); }
      if (orderBy) rows.sort((a, b) => (a[orderBy] > b[orderBy] ? 1 : -1) * (direction === 'desc' ? -1 : 1));
      return rows.slice(0, limit);
    },
    async nextSequence(name) { seq[name] = (seq[name] || 0) + 1; return seq[name]; },
  };
}

/** Tokens look like "token:<uid>"; users carry email, email_verified, claims and disabled. */
export function fakeAuth() {
  const users = {};
  let n = 0;
  return {
    users,
    addUser(uid, props = {}) { users[uid] = { uid, email: '', emailVerified: true, claims: {}, disabled: false, ...props }; return users[uid]; },
    async verifyIdToken(token) {
      const uid = String(token).replace(/^token:/, '');
      const u = users[uid];
      if (!u || u.disabled || u.revoked) throw new Error('invalid');
      return { uid, email: u.email, email_verified: u.emailVerified, ...u.claims };
    },
    async createUser({ email, displayName }) {
      if (Object.values(users).some((u) => u.email === email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      const uid = `new${++n}`; users[uid] = { uid, email, displayName, emailVerified: false, claims: {}, disabled: false }; return users[uid];
    },
    async getUser(uid) { if (!users[uid]) throw new Error('nf'); return users[uid]; },
    async getUserByEmail(email) { const u = Object.values(users).find((x) => x.email === email); if (!u) throw new Error('nf'); return u; },
    async updateUser(uid, props) { Object.assign(users[uid], props); return users[uid]; },
    async setCustomUserClaims(uid, claims) { users[uid].claims = claims; },
    async revokeRefreshTokens(uid) { users[uid].revokedAt = Date.now(); },
    async generatePasswordResetLink(email) { return `https://example.test/reset?email=${encodeURIComponent(email)}`; },
  };
}

/** Sends one request through a service's router and returns { status, body, headers }. */
export async function call(app, method, path, { body, token, query = {}, ip = '1.2.3.4', contentType = 'application/json' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = contentType;
  headers['x-forwarded-for'] = ip;
  const [p, qs] = path.split('?');
  const q = { ...Object.fromEntries(new URLSearchParams(qs || '')), ...query };
  const out = { status: 0, body: null, headers: {} };
  const res = {
    set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
    status(s) { out.status = s; return res; },
    json(b) { out.body = clone(b); return res; },
  };
  await app.handle({ method, path: p, url: path, query: q, headers, body }, res);
  return out;
}

export function setupStaff(auth) {
  auth.addUser('admin1', { email: 'owner@test.co.za', claims: { role: 'admin' } });
  auth.addUser('staff1', { email: 'thabo@test.co.za', claims: { role: 'staff' } });
  auth.addUser('rando', { email: 'someone@test.co.za' });
  return { admin: 'token:admin1', staff: 'token:staff1', rando: 'token:rando' };
}
