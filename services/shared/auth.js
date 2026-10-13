// Verifies Firebase ID tokens and enforces staff roles.
// Roles live in custom claims set by the staff service: { role: 'admin' | 'staff' }.
// Deactivated employees are disabled in Firebase Auth and their tokens revoked,
// so verifyIdToken(token, true) rejects them immediately.

import { HttpError } from './errors.js';

export const ROLES = ['staff', 'admin'];

/** need: 'signed-in' (any valid account), 'staff' (staff or admin), or 'admin'. */
export async function authenticate(req, authAdapter, need) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');

  let token;
  try {
    token = await authAdapter.verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'unauthorized', 'Your session has ended. Sign in again.');
  }

  const user = {
    uid: token.uid,
    email: String(token.email || '').toLowerCase(),
    emailVerified: token.email_verified === true,
    role: ROLES.includes(token.role) ? token.role : null,
  };

  if (need === 'signed-in') return user;
  if (!user.role) throw new HttpError(403, 'forbidden', 'This account doesn’t have staff access.');
  if (need === 'admin' && user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Only administrators can do that.');
  return user;
}
