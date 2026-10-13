// GENERATED from services/shared by scripts/sync-shared.mjs. Do not edit here.
// Firestore adapter. Each service gets an object with the same small interface,
// so service logic can be tested with an in-memory fake (see tests/fakes.mjs).
//
//   add(col, data)            -> created doc with id and createdAt
//   get(col, id)              -> doc or null
//   set(col, id, data)        -> overwrites (or creates) a doc
//   createOnce(col, id, data) -> true if created, false if the doc already existed (atomic)
//   update(col, id, patch)    -> merged doc, or null if it doesn't exist
//   remove(col, id)
//   query(col, { where: [[field, '==', value]], orderBy, direction, limit }) -> docs
//   nextSequence(name)        -> 1, 2, 3 ... (atomic)
//
// Only index.js imports this file, so tests never need firebase-admin.

import { Timestamp, FieldValue } from 'firebase-admin/firestore';

function fromFirestore(snap) {
  if (!snap.exists) return null;
  const out = { id: snap.id };
  for (const [k, v] of Object.entries(snap.data())) out[k] = convert(v);
  return out;
}

function convert(v) {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(convert);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convert(x)]));
  return v;
}

export function firestoreStore(db) {
  return {
    async add(col, data) {
      const now = new Date();
      const ref = await db.collection(col).add({ ...data, createdAt: now });
      return { id: ref.id, ...data, createdAt: now.toISOString() };
    },
    async get(col, id) {
      return fromFirestore(await db.collection(col).doc(id).get());
    },
    async set(col, id, data) {
      await db.collection(col).doc(id).set(data);
      return { id, ...convert(data) };
    },
    async createOnce(col, id, data) {
      try {
        await db.collection(col).doc(id).create(data);
        return true;
      } catch (err) {
        if (err.code === 6) return false; // ALREADY_EXISTS
        throw err;
      }
    },
    async update(col, id, patch) {
      const ref = db.collection(col).doc(id);
      try {
        await ref.update({ ...patch, updatedAt: new Date() });
      } catch (err) {
        if (err.code === 5) return null; // NOT_FOUND
        throw err;
      }
      return fromFirestore(await ref.get());
    },
    async remove(col, id) {
      await db.collection(col).doc(id).delete();
    },
    async query(col, { where = [], orderBy, direction = 'desc', limit = 300 } = {}) {
      let q = db.collection(col);
      for (const [field, op, value] of where) q = q.where(field, op, value);
      if (orderBy) q = q.orderBy(orderBy, direction);
      q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map(fromFirestore);
    },
    async nextSequence(name) {
      const ref = db.collection('counters').doc(name);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = (snap.exists ? snap.data().value : 0) + 1;
        tx.set(ref, { value: next, updatedAt: FieldValue.serverTimestamp() });
        return next;
      });
    },
  };
}

export function firebaseAuthAdapter(auth) {
  return {
    verifyIdToken: (token) => auth.verifyIdToken(token, true),
    createUser: (props) => auth.createUser(props),
    getUser: (uid) => auth.getUser(uid),
    getUserByEmail: (email) => auth.getUserByEmail(email),
    updateUser: (uid, props) => auth.updateUser(uid, props),
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    generatePasswordResetLink: (email, settings) => auth.generatePasswordResetLink(email, settings),
  };
}
