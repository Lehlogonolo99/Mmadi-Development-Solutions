// Contact service: the business's public contact details and the general message inbox.
// Owns the Firestore collections `contactDetails` and `contactMessages`.

import { createService, notFound, badRequest } from './shared/http.js';
import { v, parse } from './shared/validate.js';
import { filterStatus, byNewest } from './shared/util.js';
import { FORM_LIMIT } from './shared/config.js';

export const TOPICS = {
  general: 'General question',
  quote: 'Quote for a business or school',
  partnership: 'Partnership or sponsorship',
  feedback: 'Feedback or complaint',
};
export const MESSAGE_STATUS = { new: 'New', in_progress: 'In progress', replied: 'Replied', closed: 'Closed' };
const CLOSED = ['replied', 'closed'];

const DETAILS = 'contactDetails';
const MESSAGES = 'contactMessages';

// From the CIPC registration. Shown until an administrator saves details in the portal.
const REGISTERED = {
  companyName: 'Mmadi Development Solutions (Pty) Ltd',
  registrationNo: '2026/580350/07',
  address: ['Stand No 10321', 'Ga-Moretsele Village', 'Jane Furse', '1085'],
};

const detailsShape = {
  phone: v.phone({ optional: true }),
  whatsapp: v.phone({ optional: true }),
  email: v.email({ optional: true }),
  address: v.list(v.string({ min: 1, max: 100 }), { max: 6, optional: true }),
  mapUrl: v.string({ max: 500, optional: true, pattern: /^https:\/\//, patternMessage: 'Must start with https://' }),
  hoursSummary: v.string({ max: 120, optional: true }),
};

const messageShape = {
  name: v.string({ min: 2, max: 100 }),
  phone: v.phone({ optional: true }),
  email: v.email({ optional: true }),
  topic: v.oneOf(Object.keys(TOPICS)),
  message: v.text({ min: 5, max: 3000 }),
  consent: v.bool(),
};

const messageUpdateShape = {
  status: v.oneOf(Object.keys(MESSAGE_STATUS), { optional: true }),
  assignedTo: v.string({ max: 128, optional: true }),
  notes: v.text({ max: 5000, optional: true }),
};

export function createContactApp({ store, auth }) {
  const app = createService({ name: 'contact', auth });

  async function details() {
    const saved = (await store.get(DETAILS, 'main')) || {};
    return {
      ...REGISTERED,
      phone: saved.phone || '',
      whatsapp: saved.whatsapp || '',
      email: saved.email || '',
      address: saved.address?.length ? saved.address : REGISTERED.address,
      mapUrl: saved.mapUrl || '',
      hoursSummary: saved.hoursSummary || '',
    };
  }

  // ---- Public ----

  app.get('/details', { cache: 300 }, details);

  app.get('/meta', { cache: 300 }, () => ({ topics: TOPICS }));

  app.post('/messages', { rateLimit: FORM_LIMIT }, async ({ body }) => {
    const data = parse(messageShape, body);
    const errors = {};
    if (data.consent !== true) errors.consent = 'Tick the box to let us store your details.';
    if (!data.phone && !data.email) errors.phone = 'Give a phone number or an email so we can reply.';
    if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
    await store.add(MESSAGES, { ...data, status: 'new', assignedTo: '', notes: '' });
    return { ok: true };
  });

  // ---- Staff ----

  app.get('/messages', { auth: 'staff' }, async ({ query }) => {
    const items = await store.query(MESSAGES, { orderBy: 'createdAt', limit: 500 });
    return { items: filterStatus(items, query.status, { closed: CLOSED }).sort(byNewest) };
  });

  app.patch('/messages/:id', { auth: 'staff' }, async ({ params, body, user }) => {
    const changes = parse(messageUpdateShape, body, { partial: true });
    const updated = await store.update(MESSAGES, params.id, { ...changes, updatedBy: user.uid });
    if (!updated) throw notFound('That message doesn’t exist.');
    return updated;
  });

  app.delete('/messages/:id', { auth: 'admin' }, async ({ params }) => {
    await store.remove(MESSAGES, params.id);
    return { ok: true };
  });

  // ---- Business details (administrators) ----

  app.put('/details', { auth: 'admin' }, async ({ body, user }) => {
    const data = parse(detailsShape, body);
    await store.set(DETAILS, 'main', { ...data, updatedBy: user.uid, updatedAt: new Date() });
    return details();
  });

  return app;
}
