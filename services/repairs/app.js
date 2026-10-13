// Repairs service: device repair bookings, public job tracking, and the repair price list.
// Owns the Firestore collections `repairJobs` and `repairCatalogue`.

import { createService, notFound, badRequest } from './shared/http.js';
import { v, parse, phoneKey } from './shared/validate.js';
import { ref, filterStatus, byNewest } from './shared/util.js';
import { FORM_LIMIT, LOOKUP_LIMIT } from './shared/config.js';

export const CATEGORIES = {
  phone: 'Phone repair',
  computer: 'Laptop or PC repair',
  software: 'Software install or update',
  unlock: 'Phone or account unlock',
  other: 'Something else',
};

export const JOB_STATUS = {
  booked: 'Booked, waiting for the device',
  received: 'Device received',
  diagnosing: 'Being diagnosed',
  awaiting_approval: 'Quote sent, waiting for your approval',
  in_repair: 'Being repaired',
  ready: 'Ready for collection',
  collected: 'Collected',
  cancelled: 'Cancelled',
};
const CLOSED = ['collected', 'cancelled'];

const JOBS = 'repairJobs';
const CATALOGUE = 'repairCatalogue';

const bookingShape = {
  name: v.string({ min: 2, max: 100 }),
  phone: v.phone(),
  email: v.email({ optional: true }),
  category: v.oneOf(Object.keys(CATEGORIES)),
  device: v.string({ min: 2, max: 120 }),
  problem: v.text({ min: 5, max: 2000 }),
  hasProofOfOwnership: v.bool({ optional: true }),
  consent: v.bool(),
};

const jobUpdateShape = {
  status: v.oneOf(Object.keys(JOB_STATUS), { optional: true }),
  quote: v.number({ min: 0, max: 100000, optional: true }),
  assignedTo: v.string({ max: 128, optional: true }),
  notes: v.text({ max: 5000, optional: true }),
  customerNote: v.string({ max: 300, optional: true }),
};

const catalogueShape = {
  name: v.string({ min: 2, max: 100 }),
  category: v.oneOf(Object.keys(CATEGORIES)),
  description: v.string({ max: 300, optional: true }),
  priceFrom: v.number({ min: 0, max: 100000, optional: true }),
  priceTo: v.number({ min: 0, max: 100000, optional: true }),
  turnaround: v.string({ max: 60, optional: true }),
  active: v.bool({ optional: true, default: true }),
  sort: v.number({ integer: true, min: 0, max: 999, optional: true, default: 100 }),
};

/** What the public sees when tracking a job: no notes, staff names or contact details. */
function publicJob(job) {
  return {
    jobNo: job.jobNo,
    device: job.device,
    category: job.category,
    status: job.status,
    statusLabel: JOB_STATUS[job.status],
    quote: job.quote ?? null,
    customerNote: job.customerNote || null,
    history: (job.history || []).map((h) => ({ status: h.status, label: JOB_STATUS[h.status], at: h.at })),
    createdAt: job.createdAt,
  };
}

export function createRepairsApp({ store, auth }) {
  const app = createService({ name: 'repairs', auth });

  // ---- Public ----

  app.get('/meta', { cache: 300 }, () => ({ categories: CATEGORIES, statuses: JOB_STATUS }));

  app.get('/catalogue', { cache: 60 }, async () => {
    const items = await store.query(CATALOGUE, { where: [['active', '==', true]], limit: 200 });
    return {
      items: items
        .sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name))
        .map(({ id, name, category, description, priceFrom, priceTo, turnaround }) =>
          ({ id, name, category, description: description || '', priceFrom: priceFrom ?? null, priceTo: priceTo ?? null, turnaround: turnaround || '' })),
    };
  });

  app.post('/bookings', { rateLimit: FORM_LIMIT }, async ({ body }) => {
    const data = parse(bookingShape, body);
    if (data.consent !== true) throw badRequest('Some fields need attention.', { consent: 'Tick the box to let us store your details.' });
    if (data.category === 'unlock' && data.hasProofOfOwnership !== true) {
      throw badRequest('Some fields need attention.', {
        hasProofOfOwnership: 'We can only unlock devices when you bring ID and proof of ownership.',
      });
    }
    const n = await store.nextSequence('repairJobs');
    const now = new Date().toISOString();
    const job = await store.add(JOBS, {
      ...data,
      jobNo: ref('J', n),
      phoneKey: phoneKey(data.phone),
      status: 'booked',
      history: [{ status: 'booked', at: now }],
      assignedTo: '',
      notes: '',
    });
    return { jobNo: job.jobNo, status: job.status, statusLabel: JOB_STATUS.booked };
  });

  // Tracking needs the job number AND the phone number used to book, so job numbers alone reveal nothing.
  app.get('/track', { rateLimit: LOOKUP_LIMIT }, async ({ query }) => {
    const jobNo = String(query.job || '').trim().toUpperCase().replace(/^J-?/, 'J-');
    const key = phoneKey(query.phone);
    if (!/^J-\d{4,}$/.test(jobNo) || key.length < 9) {
      throw badRequest('Enter your job number (like J-0012) and the phone number you booked with.');
    }
    const [job] = await store.query(JOBS, { where: [['jobNo', '==', jobNo]], limit: 1 });
    if (!job || job.phoneKey !== key) throw notFound('We couldn’t find a job with that number and phone number.');
    return publicJob(job);
  });

  // ---- Staff ----

  app.get('/jobs', { auth: 'staff' }, async ({ query }) => {
    const jobs = await store.query(JOBS, { orderBy: 'createdAt', limit: 500 });
    return { items: filterStatus(jobs, query.status, { closed: CLOSED }).sort(byNewest) };
  });

  app.get('/jobs/:id', { auth: 'staff' }, async ({ params }) => {
    const job = await store.get(JOBS, params.id);
    if (!job) throw notFound('That job doesn’t exist.');
    return job;
  });

  app.patch('/jobs/:id', { auth: 'staff' }, async ({ params, body, user }) => {
    const changes = parse(jobUpdateShape, body, { partial: true });
    const job = await store.get(JOBS, params.id);
    if (!job) throw notFound('That job doesn’t exist.');
    const patch = { ...changes, updatedBy: user.uid };
    if (changes.status && changes.status !== job.status) {
      patch.history = [...(job.history || []), { status: changes.status, at: new Date().toISOString(), by: user.uid }];
    }
    return store.update(JOBS, params.id, patch);
  });

  app.delete('/jobs/:id', { auth: 'admin' }, async ({ params }) => {
    if (!(await store.get(JOBS, params.id))) throw notFound('That job doesn’t exist.');
    await store.remove(JOBS, params.id);
    return { ok: true };
  });

  // ---- Price list (administrators) ----

  app.get('/catalogue/all', { auth: 'staff' }, async () => ({
    items: (await store.query(CATALOGUE, { limit: 300 })).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100)),
  }));

  const checkRange = (d) => {
    if (d.priceFrom != null && d.priceTo != null && d.priceTo < d.priceFrom) {
      throw badRequest('Some fields need attention.', { priceTo: 'Must be the same as or more than the starting price.' });
    }
  };

  app.post('/catalogue', { auth: 'admin' }, async ({ body }) => {
    const data = parse(catalogueShape, body);
    checkRange(data);
    return store.add(CATALOGUE, data);
  });

  app.patch('/catalogue/:id', { auth: 'admin' }, async ({ params, body }) => {
    const changes = parse(catalogueShape, body, { partial: true });
    const current = await store.get(CATALOGUE, params.id);
    if (!current) throw notFound('That price list item doesn’t exist.');
    checkRange({ ...current, ...changes });
    return store.update(CATALOGUE, params.id, changes);
  });

  app.delete('/catalogue/:id', { auth: 'admin' }, async ({ params }) => {
    await store.remove(CATALOGUE, params.id);
    return { ok: true };
  });

  return app;
}
