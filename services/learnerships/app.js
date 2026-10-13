// Learnerships service: MICT SETA-funded intakes, applications, and applicant status checks.
// Owns the Firestore collections `intakes` and `learnershipApplications`.

import { createService, notFound, badRequest } from './shared/http.js';
import { v, parse } from './shared/validate.js';
import { ref, todaySA, filterStatus, byNewest } from './shared/util.js';
import { FORM_LIMIT, LOOKUP_LIMIT } from './shared/config.js';

export const TRACKS = {
  end_user_support: 'IT support and repairs',
  microsoft: 'Microsoft 365 and Azure',
  aws: 'Cloud with AWS',
  general: 'General IT',
};
export const QUALIFICATIONS = {
  matric: 'Matric (Grade 12)',
  higher_certificate: 'Higher certificate',
  diploma: 'Diploma',
  degree: 'Degree',
  other: 'Other',
};
export const INTAKE_STATUS = { upcoming: 'Opening soon', open: 'Open for applications', closed: 'Closed' };
export const APPLICATION_STATUS = {
  received: 'Received',
  shortlisted: 'Shortlisted',
  interview: 'Invited to interview',
  accepted: 'Accepted',
  waitlisted: 'On the waiting list',
  declined: 'Not successful',
  withdrawn: 'Withdrawn',
};
const CLOSED = ['accepted', 'declined', 'withdrawn'];

const INTAKES = 'intakes';
const APPLICATIONS = 'learnershipApplications';

const intakeShape = {
  title: v.string({ min: 3, max: 120 }),
  track: v.oneOf(Object.keys(TRACKS)),
  description: v.text({ max: 2000, optional: true }),
  location: v.string({ max: 120, optional: true }),
  startDate: v.date(),
  closingDate: v.date({ optional: true }),
  durationMonths: v.number({ integer: true, min: 1, max: 36, optional: true }),
  seats: v.number({ integer: true, min: 1, max: 500, optional: true }),
  stipend: v.string({ max: 120, optional: true }),
  certifications: v.list(v.string({ min: 2, max: 120 }), { max: 10, optional: true }),
  requirements: v.list(v.string({ min: 2, max: 200 }), { max: 15, optional: true }),
  status: v.oneOf(Object.keys(INTAKE_STATUS)),
};

const applicationShape = {
  intakeId: v.string({ max: 64, optional: true }),
  fullName: v.string({ min: 2, max: 120 }),
  phone: v.phone(),
  email: v.email(),
  town: v.string({ min: 2, max: 100 }),
  qualification: v.oneOf(Object.keys(QUALIFICATIONS)),
  track: v.oneOf([...Object.keys(TRACKS), 'unsure']),
  employed: v.bool(),
  motivation: v.text({ min: 20, max: 3000 }),
  consent: v.bool(),
};

const applicationUpdateShape = {
  status: v.oneOf(Object.keys(APPLICATION_STATUS), { optional: true }),
  notes: v.text({ max: 5000, optional: true }),
  intakeId: v.string({ max: 64, optional: true }),
};

function publicIntake(i) {
  return {
    id: i.id,
    title: i.title,
    track: i.track,
    trackLabel: TRACKS[i.track],
    description: i.description || '',
    location: i.location || '',
    startDate: i.startDate,
    closingDate: i.closingDate || null,
    durationMonths: i.durationMonths ?? null,
    seats: i.seats ?? null,
    stipend: i.stipend || '',
    certifications: i.certifications || [],
    requirements: i.requirements || [],
    status: i.status,
  };
}

export function createLearnershipsApp({ store, auth, now = () => new Date() }) {
  const app = createService({ name: 'learnerships', auth });

  const isAcceptingApplications = (intake) =>
    intake.status === 'open' && (!intake.closingDate || intake.closingDate >= todaySA(now()));

  // ---- Public ----

  app.get('/meta', { cache: 300 }, () => ({ tracks: TRACKS, qualifications: QUALIFICATIONS, intakeStatus: INTAKE_STATUS }));

  app.get('/intakes', { cache: 60 }, async () => {
    const all = await store.query(INTAKES, { limit: 100 });
    return {
      items: all
        .filter((i) => i.status === 'upcoming' || isAcceptingApplications(i))
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map(publicIntake),
    };
  });

  app.post('/applications', { rateLimit: FORM_LIMIT }, async ({ body }) => {
    const data = parse(applicationShape, body);
    if (data.consent !== true) throw badRequest('Some fields need attention.', { consent: 'Tick the box to let us store your details.' });
    let intakeTitle = '';
    if (data.intakeId) {
      const intake = await store.get(INTAKES, data.intakeId);
      if (!intake || !isAcceptingApplications(intake)) {
        throw badRequest('Some fields need attention.', { intakeId: 'This intake isn’t taking applications. Choose another, or apply to the general pool.' });
      }
      intakeTitle = intake.title;
    }
    const n = await store.nextSequence('learnershipApplications');
    const application = await store.add(APPLICATIONS, {
      ...data,
      intakeId: data.intakeId || '',
      intakeTitle,
      ref: ref('L', n),
      status: 'received',
      notes: '',
      history: [{ status: 'received', at: new Date().toISOString() }],
    });
    return { ref: application.ref, status: 'received', statusLabel: APPLICATION_STATUS.received };
  });

  app.get('/applications/status', { rateLimit: LOOKUP_LIMIT }, async ({ query }) => {
    const reference = String(query.ref || '').trim().toUpperCase();
    const email = String(query.email || '').trim().toLowerCase();
    if (!/^L-\d{4,}$/.test(reference) || !email.includes('@')) {
      throw badRequest('Enter your application reference (like L-0012) and the email you applied with.');
    }
    const [a] = await store.query(APPLICATIONS, { where: [['ref', '==', reference]], limit: 1 });
    if (!a || a.email !== email) throw notFound('We couldn’t find an application with that reference and email.');
    return {
      ref: a.ref,
      intakeTitle: a.intakeTitle || 'General applicant pool',
      status: a.status,
      statusLabel: APPLICATION_STATUS[a.status],
      submittedAt: a.createdAt,
    };
  });

  // ---- Staff ----

  app.get('/applications', { auth: 'staff' }, async ({ query }) => {
    let items = await store.query(APPLICATIONS, { orderBy: 'createdAt', limit: 1000 });
    items = filterStatus(items, query.status, { closed: CLOSED });
    if (query.intakeId) items = items.filter((a) => (query.intakeId === 'none' ? !a.intakeId : a.intakeId === query.intakeId));
    return { items: items.sort(byNewest) };
  });

  app.patch('/applications/:id', { auth: 'staff' }, async ({ params, body, user }) => {
    const changes = parse(applicationUpdateShape, body, { partial: true });
    const current = await store.get(APPLICATIONS, params.id);
    if (!current) throw notFound('That application doesn’t exist.');
    const patch = { ...changes, updatedBy: user.uid };
    if (changes.intakeId !== undefined) {
      if (changes.intakeId) {
        const intake = await store.get(INTAKES, changes.intakeId);
        if (!intake) throw badRequest('Some fields need attention.', { intakeId: 'That intake doesn’t exist.' });
        patch.intakeTitle = intake.title;
      } else {
        patch.intakeTitle = '';
      }
    }
    if (changes.status && changes.status !== current.status) {
      patch.history = [...(current.history || []), { status: changes.status, at: new Date().toISOString(), by: user.uid }];
    }
    return store.update(APPLICATIONS, params.id, patch);
  });

  app.delete('/applications/:id', { auth: 'admin' }, async ({ params }) => {
    await store.remove(APPLICATIONS, params.id);
    return { ok: true };
  });

  // ---- Intakes (administrators) ----

  const checkDates = (d) => {
    if (d.closingDate && d.startDate && d.closingDate > d.startDate) {
      throw badRequest('Some fields need attention.', { closingDate: 'Applications must close on or before the start date.' });
    }
  };

  app.get('/intakes/all', { auth: 'staff' }, async () => ({
    items: (await store.query(INTAKES, { limit: 200 })).sort((a, b) => b.startDate.localeCompare(a.startDate)),
  }));

  app.post('/intakes', { auth: 'admin' }, async ({ body }) => {
    const data = parse(intakeShape, body);
    checkDates(data);
    return store.add(INTAKES, data);
  });

  app.patch('/intakes/:id', { auth: 'admin' }, async ({ params, body }) => {
    const changes = parse(intakeShape, body, { partial: true });
    const current = await store.get(INTAKES, params.id);
    if (!current) throw notFound('That intake doesn’t exist.');
    checkDates({ ...current, ...changes });
    return store.update(INTAKES, params.id, changes);
  });

  app.delete('/intakes/:id', { auth: 'admin' }, async ({ params }) => {
    const linked = await store.query(APPLICATIONS, { where: [['intakeId', '==', params.id]], limit: 1 });
    if (linked.length) throw badRequest('This intake has applications. Close it instead of deleting it.');
    await store.remove(INTAKES, params.id);
    return { ok: true };
  });

  return app;
}
