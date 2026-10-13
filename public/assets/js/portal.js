// Staff portal. Sign-in uses Firebase Authentication; everything else goes through the
// microservices at /api/<service>, which check the signed-in employee's role on every request.
import { getFirebase } from './firebase.js';
import { api, ApiError, esc, rand, formatDate, formatDateTime } from './api.js';

const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

// ---------- labels ----------
const L = {
  repairCategory: { phone: 'Phone repair', computer: 'Laptop or PC', software: 'Software', unlock: 'Unlock', other: 'Other' },
  jobStatus: { booked: 'Booked', received: 'Received', diagnosing: 'Diagnosing', awaiting_approval: 'Awaiting approval', in_repair: 'In repair', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled' },
  cafeService: { computer: 'Computer use', printing: 'Printing', cv: 'CV typing', online_application: 'Online application' },
  bookingStatus: { requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'Didn’t arrive' },
  appStatus: { received: 'Received', shortlisted: 'Shortlisted', interview: 'Interview', accepted: 'Accepted', waitlisted: 'Waiting list', declined: 'Declined', withdrawn: 'Withdrawn' },
  track: { end_user_support: 'IT support and repairs', microsoft: 'Microsoft 365 and Azure', aws: 'Cloud with AWS', general: 'General IT', unsure: 'Not sure yet' },
  qual: { matric: 'Matric', higher_certificate: 'Higher certificate', diploma: 'Diploma', degree: 'Degree', other: 'Other' },
  intakeStatus: { upcoming: 'Opening soon', open: 'Open', closed: 'Closed' },
  topic: { general: 'General question', quote: 'Quote request', partnership: 'Partnership', feedback: 'Feedback' },
  msgStatus: { new: 'New', in_progress: 'In progress', replied: 'Replied', closed: 'Closed' },
  role: { staff: 'Staff', admin: 'Administrator' },
  area: { general: 'General', repairs: 'Repairs', cafe: 'Internet café', learnerships: 'Learnerships' },
  day: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
};

const state = { fb: null, user: null, me: null, directory: [], filters: {}, ready: false };

// ---------- helpers ----------
function toast(message, kind = 'ok') {
  toastEl.textContent = message;
  toastEl.className = `toast is-visible is-${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.className = 'toast'; }, 4500);
}

const options = (map, selected, blank) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '')
  + Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');

const isAdmin = () => state.me?.role === 'admin';
const route = () => location.hash.replace(/^#\/?/, '').split('?')[0];
const go = (r) => { if (route() === r) render(); else location.hash = `#/${r}`; };

function authMessage(err) {
  const map = {
    'auth/invalid-credential': 'That email and password don’t match an account.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-disabled': 'This account has been deactivated. Speak to an administrator.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Use a password of at least 8 characters.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
  };
  return map[err?.code] || err?.message || 'Something went wrong. Try again.';
}

/** Calls a service as the signed-in employee. */
async function call(path, opts = {}) {
  const token = await state.user.getIdToken();
  try {
    return await api(path, { ...opts, token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      toast('Your session has ended. Sign in again.', 'error');
      await state.fb.authMod.signOut(state.fb.auth);
    }
    throw err;
  }
}

function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = text; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/** Shows an API validation error, naming each field by its label. */
function showFormError(form, err) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const box = form.querySelector('.form-error');
  const parts = Object.entries(err?.details || {}).map(([key, message]) => {
    const el = form.elements[key.split(/[.[]/)[0]];
    if (el?.setAttribute) el.setAttribute('aria-invalid', 'true');
    const label = el?.closest?.('label')?.firstChild?.textContent?.trim() || key;
    return `${label}: ${message}`;
  });
  if (box) box.textContent = parts.length ? parts.join(' ') : (err?.message || authMessage(err));
}

const logo = (white) => `<img src="/assets/img/logo-tile${white ? '-white' : ''}.svg" alt="" width="40" height="40">`;

// ---------- signed-out screens ----------
function authFrame(title, intro, body) {
  root.className = 'auth';
  root.innerHTML = `
    <main class="auth__card">
      <a class="auth__brand" href="/">${logo()}<span>Mmadi <small>Staff portal</small></span></a>
      <h1>${title}</h1>
      ${intro ? `<p class="muted">${intro}</p>` : ''}
      ${body}
    </main>`;
}

function renderLogin() {
  authFrame('Sign in', 'For Mmadi Development Solutions employees.', `
    <form id="login" class="stack">
      <label class="field">Email<input name="email" type="email" autocomplete="username" required></label>
      <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn--primary" type="submit">Sign in</button>
      <p class="form-error" role="alert"></p>
    </form>
    <p class="auth__links"><a href="#/forgot">Forgot your password?</a></p>`);
  const form = document.getElementById('login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    form.querySelector('.form-error').textContent = '';
    busy(btn, true, 'Signing in…');
    try {
      await state.fb.authMod.signInWithEmailAndPassword(state.fb.auth, form.email.value.trim(), form.password.value);
    } catch (err) {
      form.querySelector('.form-error').textContent = authMessage(err);
      busy(btn, false);
    }
  });
}

function renderForgot() {
  authFrame('Reset your password', 'We’ll email you a link to choose a new password.', `
    <form id="forgot" class="stack">
      <label class="field">Email<input name="email" type="email" autocomplete="username" required></label>
      <button class="btn btn--primary" type="submit">Email me a reset link</button>
    </form>
    <p class="auth__links"><a href="#/">Back to sign in</a></p>`);
  const form = document.getElementById('forgot');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(form.querySelector('button'), true, 'Sending…');
    try { await state.fb.authMod.sendPasswordResetEmail(state.fb.auth, form.email.value.trim()); } catch { /* same reply either way */ }
    form.outerHTML = '<p class="notice">If that email belongs to a staff account, a reset link is on its way. Check your inbox and spam folder.</p>';
  });
}

const savedName = {
  get() { try { return sessionStorage.getItem('mmadi-setup-name') || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem('mmadi-setup-name', v); } catch { /* storage unavailable */ } },
};

/** First-time setup, step 1: the owner creates their sign-in and verifies their email. */
function renderSetup() {
  authFrame('Set up the staff portal', 'For the business owner, once. Use the owner email configured for the staff service.', `
    <form id="setup" class="stack">
      <label class="field">Your full name<input name="name" autocomplete="name" required minlength="2" maxlength="100"></label>
      <label class="field">Owner email<input name="email" type="email" autocomplete="username" required></label>
      <label class="field">Choose a password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
      <button class="btn btn--primary" type="submit">Create my account</button>
      <p class="form-error" role="alert"></p>
    </form>
    <p class="auth__links"><a href="#/">Back to sign in</a></p>`);
  const form = document.getElementById('setup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { auth, authMod } = state.fb;
    const btn = form.querySelector('button');
    busy(btn, true, 'Creating…');
    savedName.set(form.name.value.trim());
    try {
      const cred = await authMod.createUserWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
      await authMod.updateProfile(cred.user, { displayName: form.name.value.trim() });
      await authMod.sendEmailVerification(cred.user);
    } catch (err) {
      form.querySelector('.form-error').textContent = authMessage(err);
      busy(btn, false);
    }
  });
}

/** First-time setup, step 2: once verified, the staff service makes this account the first administrator. */
function renderFinishSetup() {
  const verified = state.user.emailVerified;
  authFrame('Finish setting up', verified
    ? 'Your email is verified. Create the first administrator account to open the portal.'
    : `We sent a verification link to <strong>${esc(state.user.email)}</strong>. Open it, then come back here and continue.`, `
    <form id="finish" class="stack">
      <label class="field">Your full name<input name="name" required minlength="2" maxlength="100" value="${esc(savedName.get() || state.user.displayName || '')}"></label>
      <button class="btn btn--primary" type="submit">${verified ? 'Create administrator' : 'I’ve verified my email, continue'}</button>
      <p class="form-error" role="alert"></p>
    </form>
    <div class="auth__row">
      ${verified ? '' : '<button class="link-btn link-btn--dark" type="button" id="resend">Send the link again</button>'}
      <button class="link-btn link-btn--dark" type="button" id="out">Sign out</button>
    </div>`);
  const form = document.getElementById('finish');
  document.getElementById('out').addEventListener('click', () => state.fb.authMod.signOut(state.fb.auth));
  document.getElementById('resend')?.addEventListener('click', async () => {
    try { await state.fb.authMod.sendEmailVerification(state.user); toast('Verification email sent.'); }
    catch (err) { toast(authMessage(err), 'error'); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const errEl = form.querySelector('.form-error');
    errEl.textContent = '';
    busy(btn, true, 'Checking…');
    try {
      await state.user.reload();
      if (!state.user.emailVerified) {
        errEl.textContent = 'Your email isn’t verified yet. Open the link in the email we sent, then try again.';
        busy(btn, false);
        return;
      }
      await state.user.getIdToken(true);
      await call('staff/bootstrap', { method: 'POST', body: { name: form.name.value.trim() } });
      await state.user.getIdToken(true); // pick up the new administrator role
      toast('You’re the administrator. Add your employees next.');
      location.hash = '#/employees';
      await loadMe();
    } catch (err) {
      errEl.textContent = err.message;
      busy(btn, false);
    }
  });
}

function renderBlocked(title, text) {
  authFrame(title, text, '<div class="stack"><button class="btn btn--ghost" id="out" type="button">Sign out</button></div>');
  document.getElementById('out').addEventListener('click', () => state.fb.authMod.signOut(state.fb.auth));
}

// ---------- signed-in shell ----------
const NAV = () => [
  ['Repairs', [['repairs', 'Repair jobs'], ['repairs/prices', 'Repair prices']]],
  ['Internet café', [['cafe', 'Bookings'], ['cafe/settings', 'Hours and prices']]],
  ['Learnerships', [['learnerships', 'Applications'], ['learnerships/intakes', 'Intakes']]],
  ['Messages', [['messages', 'Contact messages']]],
  ...(isAdmin() ? [['Administration', [['employees', 'Employees'], ['settings', 'Business details']]]] : []),
];

function shell(active, content) {
  root.className = 'app';
  root.innerHTML = `
    <header class="side">
      <a class="side__brand" href="/">${logo(true)}<span>Mmadi<small>Staff portal</small></span></a>
      <nav class="side__nav" aria-label="Portal">
        ${NAV().map(([group, links]) => `
          <div class="side__group">
            <p class="side__label">${group}</p>
            ${links.map(([href, label]) => `<a href="#/${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
          </div>`).join('')}
      </nav>
      <div class="side__me">
        <a class="side__name" href="#/account">${esc(state.me.name)}</a>
        <span class="side__role">${esc(L.role[state.me.role])}</span>
        <button type="button" class="link-btn" id="signout">Sign out</button>
      </div>
    </header>
    <main class="main" id="main">${content}</main>`;
  document.getElementById('signout').addEventListener('click', () => state.fb.authMod.signOut(state.fb.auth));
}

const staffName = (uid) => (uid ? state.directory.find((p) => p.uid === uid)?.name || 'Former employee' : 'Unassigned');
const staffOptions = (selected) => `<option value="">Unassigned</option>${state.directory.map((p) => `<option value="${esc(p.uid)}"${p.uid === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;

// ---------- generic list page ----------
/**
 * listPage({ key, active, title, intro, actions, filters, load, columns, empty, open })
 * filters: [[value, label], ...] for status chips (first is the default)
 * load(filter) -> items; columns: [[heading, item => html], ...]; open(item, reload)
 */
function listPage(cfg) {
  const filter = state.filters[cfg.key] ?? cfg.filters?.[0]?.[0] ?? 'all';
  shell(cfg.active, `
    <div class="page-head page-head--row">
      <div><h1>${cfg.title}</h1>${cfg.intro ? `<p class="muted">${cfg.intro}</p>` : ''}</div>
      ${cfg.actions || ''}
    </div>
    ${cfg.filters ? `<div class="chips" role="group" aria-label="Filter">${cfg.filters.map(([v, l]) => `<button type="button" class="chip" data-filter="${esc(v)}" aria-pressed="${v === filter}">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="list" id="list"><p class="muted">Loading…</p></div>
    <dialog class="panel" id="panel"></dialog>`);

  let items = [];
  const list = document.getElementById('list');
  const draw = () => {
    if (!items.length) { list.innerHTML = `<p class="empty">${cfg.empty}</p>`; return; }
    list.innerHTML = `<table class="table">
      <thead><tr>${cfg.columns.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${items.map((it, i) => `<tr data-i="${i}" tabindex="0">${cfg.columns.map(([, f]) => `<td>${f(it)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  };
  const reload = async () => {
    try {
      items = await cfg.load(state.filters[cfg.key] ?? filter);
      draw();
    } catch (err) {
      list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  };
  document.querySelector('.chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filters[cfg.key] = b.dataset.filter;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    list.innerHTML = '<p class="muted">Loading…</p>';
    reload();
  });
  const openRow = (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || (e.type === 'keydown' && e.key !== 'Enter')) return;
    cfg.open(items[Number(tr.dataset.i)], reload);
  };
  list.addEventListener('click', openRow);
  list.addEventListener('keydown', openRow);
  reload();
  return { reload };
}

/**
 * panel(title, bodyHtml, { save, remove, wide }) opens the dialog with a form.
 * save(form) is called on submit and should throw ApiError on validation problems.
 */
function panel(title, body, { save, saveLabel = 'Save changes', remove, removeLabel = 'Delete', wide } = {}) {
  const dlg = document.getElementById('panel');
  dlg.classList.toggle('panel--wide', Boolean(wide));
  dlg.innerHTML = `
    <form class="panel__body" novalidate>
      <div class="panel__head"><h2>${title}</h2><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div>
      ${body}
      <p class="form-error" role="alert"></p>
      <div class="panel__actions">
        ${save ? `<button class="btn btn--primary" type="submit">${saveLabel}</button>` : ''}
        ${remove ? `<button class="btn btn--danger" type="button" data-remove>${removeLabel}</button>` : ''}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Saving…');
    try { await save(form); dlg.close(); }
    catch (err) { showFormError(form, err); }
    finally { busy(btn, false); }
  });
  dlg.querySelector('[data-remove]')?.addEventListener('click', async () => {
    if (!confirm('Delete this permanently? This can’t be undone.')) return;
    try { await remove(); dlg.close(); } catch (err) { showFormError(form, err); }
  });
  dlg.showModal();
  return form;
}

const facts = (rows) => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const pill = (status, label) => `<span class="status status--${esc(status)}">${esc(label || status)}</span>`;
const who = (name, sub) => `<strong>${esc(name)}</strong>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
const tel = (n) => (n ? `<a href="tel:${esc(n.replace(/[^\d+]/g, ''))}">${esc(n)}</a>` : '');
const mail = (e) => (e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : '');
const val = (form, name) => form.elements[name]?.value.trim() ?? '';
const lines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);

// ---------- Repairs ----------
function renderRepairs() {
  listPage({
    key: 'repairs', active: 'repairs', title: 'Repair jobs', intro: 'Bookings from the website and walk-ins. Customers can track these with their job number.',
    filters: [['open', 'Open'], ...Object.entries(L.jobStatus), ['all', 'All']],
    load: async (f) => (await call('repairs/jobs', { query: { status: f } })).items,
    empty: 'No jobs with this status.',
    columns: [
      ['Job', (j) => who(j.jobNo, formatDateTime(j.createdAt))],
      ['Customer', (j) => who(j.name, j.phone)],
      ['Device', (j) => who(j.device, L.repairCategory[j.category])],
      ['Assigned to', (j) => esc(staffName(j.assignedTo))],
      ['Status', (j) => pill(j.status, L.jobStatus[j.status])],
    ],
    open: (j, reload) => panel(`${esc(j.jobNo)}: ${esc(j.device)}`, `
      ${j.category === 'unlock' ? '<p class="warn">Before unlocking, check the customer’s ID and proof of ownership (receipt, contract or a letter from the previous owner). Don’t unlock devices reported lost or stolen.</p>' : ''}
      ${facts([['Customer', esc(j.name)], ['Phone', tel(j.phone)], j.email && ['Email', mail(j.email)], ['Request', esc(L.repairCategory[j.category])], ['Booked', esc(formatDateTime(j.createdAt))]])}
      <p class="message">${esc(j.problem)}</p>
      <div class="grid-2">
        <label class="field">Status<select name="status">${options(L.jobStatus, j.status)}</select></label>
        <label class="field">Assigned to<select name="assignedTo">${staffOptions(j.assignedTo)}</select></label>
      </div>
      <label class="field">Quote (rand)<input name="quote" type="number" min="0" step="0.01" value="${j.quote ?? ''}"></label>
      <label class="field">Note for the customer <span class="hint-inline">shown on the tracking page</span><input name="customerNote" maxlength="300" value="${esc(j.customerNote || '')}"></label>
      <label class="field">Internal notes<textarea name="notes" rows="3" maxlength="5000">${esc(j.notes || '')}</textarea></label>
      ${j.history?.length ? `<details class="history"><summary>History</summary><ol>${j.history.map((h) => `<li>${esc(L.jobStatus[h.status])}, ${esc(formatDateTime(h.at))}${h.by ? ` by ${esc(staffName(h.by))}` : ''}</li>`).join('')}</ol></details>` : ''}`, {
      save: async (f) => {
        const q = val(f, 'quote');
        await call(`repairs/jobs/${j.id}`, { method: 'PATCH', body: {
          status: f.status.value, assignedTo: f.assignedTo.value, notes: val(f, 'notes'), customerNote: val(f, 'customerNote'),
          quote: q === '' ? null : Number(q),
        } });
        toast('Job updated.'); reload();
      },
      remove: isAdmin() ? async () => { await call(`repairs/jobs/${j.id}`, { method: 'DELETE' }); toast('Job deleted.'); reload(); } : null,
    }),
  });
}

function catalogueForm(i = {}) {
  return `
    <label class="field">Name<input name="name" required maxlength="100" value="${esc(i.name || '')}"></label>
    <div class="grid-2">
      <label class="field">Category<select name="category">${options(L.repairCategory, i.category || 'phone')}</select></label>
      <label class="field">Turnaround<input name="turnaround" maxlength="60" value="${esc(i.turnaround || '')}" placeholder="e.g. Same day"></label>
    </div>
    <div class="grid-2">
      <label class="field">Price from (rand)<input name="priceFrom" type="number" min="0" step="0.01" value="${i.priceFrom ?? ''}"></label>
      <label class="field">Price to (rand)<input name="priceTo" type="number" min="0" step="0.01" value="${i.priceTo ?? ''}"></label>
    </div>
    <label class="field">Short description<input name="description" maxlength="300" value="${esc(i.description || '')}"></label>
    <div class="grid-2">
      <label class="field">Order on the page<input name="sort" type="number" min="0" max="999" step="1" value="${i.sort ?? 100}"></label>
      <label class="check check--field"><input type="checkbox" name="active"${i.active === false ? '' : ' checked'}> <span>Show on the website</span></label>
    </div>`;
}

function readCatalogue(f) {
  const num = (n) => (val(f, n) === '' ? null : Number(val(f, n)));
  return {
    name: val(f, 'name'), category: f.category.value, turnaround: val(f, 'turnaround'), description: val(f, 'description'),
    priceFrom: num('priceFrom'), priceTo: num('priceTo'), sort: Number(val(f, 'sort') || 100), active: f.active.checked,
  };
}

function renderRepairPrices() {
  const page = listPage({
    key: 'catalogue', active: 'repairs/prices', title: 'Repair prices',
    intro: 'Starting prices shown on the Repairs page. Leave the price empty to show “Quoted after diagnosis”.',
    actions: isAdmin() ? '<button class="btn btn--primary" id="add" type="button">Add price</button>' : '',
    load: async () => (await call('repairs/catalogue/all')).items,
    empty: 'No prices yet. The website says every repair is quoted after diagnosis.',
    columns: [
      ['Item', (i) => who(i.name, i.description)],
      ['Category', (i) => esc(L.repairCategory[i.category])],
      ['Price', (i) => (i.priceFrom != null ? `${rand(i.priceFrom)}${i.priceTo != null ? ` to ${rand(i.priceTo)}` : '+'}` : '<span class="muted">Quoted</span>')],
      ['On website', (i) => (i.active === false ? pill('inactive', 'Hidden') : pill('active', 'Shown'))],
    ],
    open: (i, reload) => {
      if (!isAdmin()) return;
      panel(`Edit ${esc(i.name)}`, catalogueForm(i), {
        save: async (f) => { await call(`repairs/catalogue/${i.id}`, { method: 'PATCH', body: readCatalogue(f) }); toast('Price updated.'); reload(); },
        remove: async () => { await call(`repairs/catalogue/${i.id}`, { method: 'DELETE' }); toast('Price deleted.'); reload(); },
      });
    },
  });
  document.getElementById('add')?.addEventListener('click', () => panel('Add a repair price', catalogueForm(), {
    saveLabel: 'Add price',
    save: async (f) => { await call('repairs/catalogue', { method: 'POST', body: readCatalogue(f) }); toast('Price added.'); page.reload(); },
  }));
}

// ---------- Café ----------
function renderCafe() {
  listPage({
    key: 'cafe', active: 'cafe', title: 'Café bookings', intro: 'Requests from the website. Confirm them with the customer by phone or SMS.',
    filters: [['open', 'Open'], ...Object.entries(L.bookingStatus), ['all', 'All']],
    load: async (f) => (await call('cafe/bookings', { query: { status: f } })).items,
    empty: 'No bookings with this status.',
    columns: [
      ['When', (b) => who(formatDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' }), `${b.time}${b.service === 'computer' ? `, ${b.duration} min` : ''}`)],
      ['Customer', (b) => who(b.name, b.phone)],
      ['Service', (b) => esc(L.cafeService[b.service])],
      ['Reference', (b) => esc(b.ref)],
      ['Status', (b) => pill(b.status, L.bookingStatus[b.status])],
    ],
    open: (b, reload) => panel(`${esc(b.ref)}: ${esc(b.name)}`, `
      ${facts([['Phone', tel(b.phone)], b.email && ['Email', mail(b.email)], ['Service', esc(L.cafeService[b.service])], ['When', `${esc(formatDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }))} at ${esc(b.time)}`], b.service === 'computer' && ['Duration', `${b.duration} minutes`]])}
      ${b.notes ? `<p class="message">${esc(b.notes)}</p>` : ''}
      <label class="field">Status<select name="status">${options(L.bookingStatus, b.status)}</select></label>
      <label class="field">Internal notes<textarea name="staffNotes" rows="3" maxlength="5000">${esc(b.staffNotes || '')}</textarea></label>`, {
      save: async (f) => { await call(`cafe/bookings/${b.id}`, { method: 'PATCH', body: { status: f.status.value, staffNotes: val(f, 'staffNotes') } }); toast('Booking updated.'); reload(); },
      remove: isAdmin() ? async () => { await call(`cafe/bookings/${b.id}`, { method: 'DELETE' }); toast('Booking deleted.'); reload(); } : null,
    }),
  });
}

function priceForm(p = {}) {
  return `
    <label class="field">Item<input name="item" required maxlength="100" value="${esc(p.item || '')}" placeholder="e.g. Colour print"></label>
    <div class="grid-2">
      <label class="field">Price (rand)<input name="price" type="number" min="0" step="0.01" required value="${p.price ?? ''}"></label>
      <label class="field">Per<input name="unit" required maxlength="40" value="${esc(p.unit || '')}" placeholder="e.g. per page"></label>
    </div>
    <div class="grid-2">
      <label class="field">Group<select name="service">${options(L.cafeService, p.service || 'computer')}</select></label>
      <label class="field">Order on the page<input name="sort" type="number" min="0" max="999" value="${p.sort ?? 100}"></label>
    </div>
    <label class="check check--field"><input type="checkbox" name="active"${p.active === false ? '' : ' checked'}> <span>Show on the website</span></label>`;
}
const readPrice = (f) => ({ item: val(f, 'item'), price: Number(val(f, 'price')), unit: val(f, 'unit'), service: f.service.value, sort: Number(val(f, 'sort') || 100), active: f.active.checked });

async function renderCafeSettings() {
  shell('cafe/settings', `
    <div class="page-head"><h1>Hours and prices</h1><p class="muted">What the Internet café page shows. Bookings are only accepted inside these hours.</p></div>
    <section class="card card--wide" id="hours-card"><p class="muted">Loading…</p></section>
    <div class="page-head page-head--row page-head--sub">
      <h2>Price list</h2>
      ${isAdmin() ? '<button class="btn btn--primary" id="add-price" type="button">Add price</button>' : ''}
    </div>
    <div class="list" id="list"><p class="muted">Loading…</p></div>
    <dialog class="panel" id="panel"></dialog>`);

  const info = await api('cafe/info').catch(() => ({ hours: [], notice: '' }));
  const card = document.getElementById('hours-card');
  const dis = isAdmin() ? '' : ' disabled';
  card.innerHTML = `
    <form id="hours-form" class="stack stack--tight" novalidate>
      <h2>Opening hours</h2>
      <table class="hours-edit">
        <thead><tr><th>Day</th><th>Open</th><th>From</th><th>To</th></tr></thead>
        <tbody>${Object.entries(L.day).map(([d, label]) => {
          const h = info.hours.find((x) => x.day === d) || { closed: true };
          return `<tr data-day="${d}">
            <th scope="row">${label}</th>
            <td><input type="checkbox" name="${d}-open" aria-label="Open on ${label}"${h.closed ? '' : ' checked'}${dis}></td>
            <td><input type="time" name="${d}-from" value="${esc(h.open || '08:00')}" aria-label="${label} opening time"${dis}></td>
            <td><input type="time" name="${d}-to" value="${esc(h.close || '17:00')}" aria-label="${label} closing time"${dis}></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <label class="field">Notice on the café page <span class="hint-inline">optional, e.g. holiday hours</span><input name="notice" maxlength="300" value="${esc(info.notice || '')}"${dis}></label>
      <p class="form-error" role="alert"></p>
      ${isAdmin() ? '<div><button class="btn btn--primary" type="submit">Save hours</button></div>' : '<p class="hint">Only administrators can change hours.</p>'}
    </form>`;
  const hf = document.getElementById('hours-form');
  hf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = hf.querySelector('button[type=submit]');
    busy(btn, true, 'Saving…');
    const hours = Object.keys(L.day).map((d) => (hf.elements[`${d}-open`].checked
      ? { day: d, closed: false, open: hf.elements[`${d}-from`].value, close: hf.elements[`${d}-to`].value }
      : { day: d, closed: true }));
    try {
      await call('cafe/settings', { method: 'PUT', body: { hours, notice: val(hf, 'notice') } });
      hf.querySelector('.form-error').textContent = '';
      toast('Opening hours saved.');
    } catch (err) {
      const d = err.details || {};
      hf.querySelector('.form-error').textContent = Object.keys(d).length
        ? Object.entries(d).map(([k, v]) => { const m = /hours\[(\d)\]/.exec(k); return `${m ? L.day[Object.keys(L.day)[m[1]]] || '' : k}: ${v}`; }).join(' ')
        : err.message;
    } finally { busy(btn, false); }
  });

  const list = document.getElementById('list');
  const load = async () => {
    try {
      const { items } = await call('cafe/prices');
      list.innerHTML = items.length ? `<table class="table"><thead><tr><th>Item</th><th>Group</th><th>Price</th><th>On website</th></tr></thead><tbody>${items.map((p, i) => `
        <tr data-i="${i}" tabindex="0"><td>${who(p.item)}</td><td>${esc(L.cafeService[p.service])}</td><td>${rand(p.price)} <span class="sub">${esc(p.unit)}</span></td><td>${p.active === false ? pill('inactive', 'Hidden') : pill('active', 'Shown')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="empty">No prices yet. The café page asks customers to check at the counter.</p>';
      const open = (e) => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr || !isAdmin() || (e.type === 'keydown' && e.key !== 'Enter')) return;
        const p = items[Number(tr.dataset.i)];
        panel(`Edit ${esc(p.item)}`, priceForm(p), {
          save: async (f) => { await call(`cafe/prices/${p.id}`, { method: 'PATCH', body: readPrice(f) }); toast('Price updated.'); load(); },
          remove: async () => { await call(`cafe/prices/${p.id}`, { method: 'DELETE' }); toast('Price deleted.'); load(); },
        });
      };
      list.onclick = open; list.onkeydown = open;
    } catch (err) { list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  };
  load();
  document.getElementById('add-price')?.addEventListener('click', () => panel('Add a café price', priceForm(), {
    saveLabel: 'Add price',
    save: async (f) => { await call('cafe/prices', { method: 'POST', body: readPrice(f) }); toast('Price added.'); load(); },
  }));
}

// ---------- Learnerships ----------
let intakeCache = [];
async function intakes() {
  intakeCache = (await call('learnerships/intakes/all')).items;
  return intakeCache;
}

function renderApplications() {
  intakes().catch(() => {});
  listPage({
    key: 'applications', active: 'learnerships', title: 'Learnership applications', intro: 'Applicants can check their status online with their reference and email.',
    filters: [['open', 'Open'], ...Object.entries(L.appStatus), ['all', 'All']],
    load: async (f) => (await call('learnerships/applications', { query: { status: f } })).items,
    empty: 'No applications with this status.',
    columns: [
      ['Applicant', (a) => who(a.fullName, a.ref)],
      ['Intake', (a) => esc(a.intakeTitle || 'General pool')],
      ['Background', (a) => who(L.qual[a.qualification], `${a.town}${a.employed ? ', employed' : ''}`)],
      ['Interest', (a) => esc(L.track[a.track])],
      ['Status', (a) => pill(a.status, L.appStatus[a.status])],
    ],
    open: (a, reload) => panel(esc(a.fullName), `
      ${facts([['Reference', esc(a.ref)], ['Phone', tel(a.phone)], ['Email', mail(a.email)], ['Town', esc(a.town)], ['Qualification', esc(L.qual[a.qualification])], ['Interest', esc(L.track[a.track])], ['Employed', a.employed ? 'Yes' : 'No'], ['Applied', esc(formatDateTime(a.createdAt))]])}
      <h3 class="small-head">Why they want to work in IT</h3>
      <p class="message">${esc(a.motivation)}</p>
      <div class="grid-2">
        <label class="field">Status<select name="status">${options(L.appStatus, a.status)}</select></label>
        <label class="field">Intake<select name="intakeId"><option value="">General pool</option>${intakeCache.map((i) => `<option value="${esc(i.id)}"${i.id === a.intakeId ? ' selected' : ''}>${esc(i.title)}</option>`).join('')}</select></label>
      </div>
      <label class="field">Internal notes<textarea name="notes" rows="3" maxlength="5000" placeholder="Interview date, documents received…">${esc(a.notes || '')}</textarea></label>`, {
      save: async (f) => {
        const body = { status: f.status.value, notes: val(f, 'notes') };
        if (f.intakeId.value !== (a.intakeId || '')) body.intakeId = f.intakeId.value;
        await call(`learnerships/applications/${a.id}`, { method: 'PATCH', body });
        toast('Application updated.'); reload();
      },
      remove: isAdmin() ? async () => { await call(`learnerships/applications/${a.id}`, { method: 'DELETE' }); toast('Application deleted.'); reload(); } : null,
    }),
  });
}

function intakeForm(i = {}) {
  return `
    <label class="field">Title<input name="title" required maxlength="120" value="${esc(i.title || '')}" placeholder="e.g. 2027 IT Support Learnership"></label>
    <div class="grid-2">
      <label class="field">Track<select name="track">${options({ end_user_support: L.track.end_user_support, microsoft: L.track.microsoft, aws: L.track.aws, general: L.track.general }, i.track || 'end_user_support')}</select></label>
      <label class="field">Status<select name="status">${options(L.intakeStatus, i.status || 'upcoming')}</select></label>
    </div>
    <div class="grid-2">
      <label class="field">Start date<input name="startDate" type="date" required value="${esc(i.startDate || '')}"></label>
      <label class="field">Applications close<input name="closingDate" type="date" value="${esc(i.closingDate || '')}"></label>
    </div>
    <div class="grid-3">
      <label class="field">Months<input name="durationMonths" type="number" min="1" max="36" value="${i.durationMonths ?? ''}"></label>
      <label class="field">Places<input name="seats" type="number" min="1" max="500" value="${i.seats ?? ''}"></label>
      <label class="field">Stipend<input name="stipend" maxlength="120" value="${esc(i.stipend || '')}" placeholder="e.g. R3,500 a month"></label>
    </div>
    <label class="field">Location<input name="location" maxlength="120" value="${esc(i.location || '')}"></label>
    <label class="field">Description<textarea name="description" rows="3" maxlength="2000">${esc(i.description || '')}</textarea></label>
    <label class="field">Certifications <span class="hint-inline">one per line</span><textarea name="certifications" rows="3">${esc((i.certifications || []).join('\n'))}</textarea></label>
    <label class="field">Requirements <span class="hint-inline">one per line</span><textarea name="requirements" rows="3">${esc((i.requirements || []).join('\n'))}</textarea></label>`;
}
function readIntake(f) {
  const num = (n) => (val(f, n) === '' ? null : Number(val(f, n)));
  return {
    title: val(f, 'title'), track: f.track.value, status: f.status.value, startDate: val(f, 'startDate'), closingDate: val(f, 'closingDate') || null,
    durationMonths: num('durationMonths'), seats: num('seats'), stipend: val(f, 'stipend'), location: val(f, 'location'), description: val(f, 'description'),
    certifications: lines(val(f, 'certifications')), requirements: lines(val(f, 'requirements')),
  };
}

function renderIntakes() {
  const page = listPage({
    key: 'intakes', active: 'learnerships/intakes', title: 'Intakes',
    intro: 'Open and upcoming intakes appear on the Learnerships page. Open intakes accept applications until their closing date.',
    actions: isAdmin() ? '<button class="btn btn--primary" id="add" type="button">Add intake</button>' : '',
    load: intakes,
    empty: 'No intakes yet. Applicants can still join the general pool.',
    columns: [
      ['Intake', (i) => who(i.title, L.track[i.track])],
      ['Starts', (i) => esc(formatDate(i.startDate))],
      ['Closes', (i) => esc(i.closingDate ? formatDate(i.closingDate) : '—')],
      ['Places', (i) => esc(i.seats ?? '—')],
      ['Status', (i) => pill(i.status, L.intakeStatus[i.status])],
    ],
    open: (i, reload) => {
      if (!isAdmin()) return;
      panel(`Edit ${esc(i.title)}`, intakeForm(i), {
        wide: true,
        save: async (f) => {
          const body = readIntake(f);
          for (const k of ['closingDate', 'durationMonths', 'seats']) if (body[k] === null && i[k] == null) delete body[k];
          await call(`learnerships/intakes/${i.id}`, { method: 'PATCH', body });
          toast('Intake updated.'); reload();
        },
        remove: async () => { await call(`learnerships/intakes/${i.id}`, { method: 'DELETE' }); toast('Intake deleted.'); reload(); },
      });
    },
  });
  document.getElementById('add')?.addEventListener('click', () => panel('Add an intake', intakeForm(), {
    wide: true, saveLabel: 'Add intake',
    save: async (f) => {
      const body = readIntake(f);
      for (const k of Object.keys(body)) if (body[k] === null || body[k] === '') delete body[k];
      await call('learnerships/intakes', { method: 'POST', body });
      toast('Intake added.'); page.reload();
    },
  }));
}

// ---------- Messages ----------
function renderMessages() {
  listPage({
    key: 'messages', active: 'messages', title: 'Contact messages', intro: 'Messages from the Contact page.',
    filters: [['open', 'Open'], ...Object.entries(L.msgStatus), ['all', 'All']],
    load: async (f) => (await call('contact/messages', { query: { status: f } })).items,
    empty: 'No messages with this status.',
    columns: [
      ['Received', (m) => esc(formatDateTime(m.createdAt))],
      ['From', (m) => who(m.name, m.phone || m.email)],
      ['Topic', (m) => esc(L.topic[m.topic])],
      ['Assigned to', (m) => esc(staffName(m.assignedTo))],
      ['Status', (m) => pill(m.status, L.msgStatus[m.status])],
    ],
    open: (m, reload) => panel(esc(m.name), `
      ${facts([m.phone && ['Phone', tel(m.phone)], m.email && ['Email', mail(m.email)], ['Topic', esc(L.topic[m.topic])], ['Received', esc(formatDateTime(m.createdAt))]])}
      <p class="message">${esc(m.message)}</p>
      <div class="grid-2">
        <label class="field">Status<select name="status">${options(L.msgStatus, m.status)}</select></label>
        <label class="field">Assigned to<select name="assignedTo">${staffOptions(m.assignedTo)}</select></label>
      </div>
      <label class="field">Internal notes<textarea name="notes" rows="3" maxlength="5000">${esc(m.notes || '')}</textarea></label>`, {
      save: async (f) => { await call(`contact/messages/${m.id}`, { method: 'PATCH', body: { status: f.status.value, assignedTo: f.assignedTo.value, notes: val(f, 'notes') } }); toast('Message updated.'); reload(); },
      remove: isAdmin() ? async () => { await call(`contact/messages/${m.id}`, { method: 'DELETE' }); toast('Message deleted.'); reload(); } : null,
    }),
  });
}

// ---------- Employees (administrators) ----------
function setupLinkBlock(link) {
  if (!link) return '';
  return `<div class="link-box"><p>Send this password setup link to them by WhatsApp or SMS. It works once and expires after a while.</p>
    <div class="link-box__row"><input readonly value="${esc(link)}" aria-label="Password setup link"><button class="btn btn--ghost" type="button" data-copy>Copy</button></div></div>`;
}
function wireCopy(scope) {
  scope.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const input = b.parentElement.querySelector('input');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied.'); } catch { input.select(); }
  }));
}

function renderEmployees() {
  if (!isAdmin()) return go('repairs');
  const page = listPage({
    key: 'employees', active: 'employees', title: 'Employees', intro: 'People who can sign in to this portal.',
    actions: '<button class="btn btn--primary" id="add" type="button">Add employee</button>',
    load: async () => (await call('staff/employees')).items,
    empty: 'No employees yet.',
    columns: [
      ['Name', (p) => `${who(p.name, p.email)}${p.uid === state.user.uid ? ' <span class="you">you</span>' : ''}`],
      ['Role', (p) => esc(L.role[p.role])],
      ['Area', (p) => esc(L.area[p.area])],
      ['Status', (p) => (p.active ? pill('active', 'Active') : pill('inactive', 'Deactivated'))],
    ],
    open: (p, reload) => {
      const self = p.uid === state.user.uid;
      const form = panel(esc(p.name), `
        <p class="muted">${esc(p.email)}</p>
        <label class="field">Full name<input name="name" required maxlength="100" value="${esc(p.name)}"></label>
        <div class="grid-2">
          <label class="field">Role<select name="role"${self ? ' disabled' : ''}>${options(L.role, p.role)}</select></label>
          <label class="field">Area<select name="area">${options(L.area, p.area)}</select></label>
        </div>
        ${self ? '<p class="hint">You can’t change your own role or deactivate yourself. Ask another administrator.</p>' : `
          <label class="check check--field"><input type="checkbox" name="active"${p.active ? ' checked' : ''}> <span>Can sign in to the portal</span></label>
          <p class="hint">Unticking this signs them out everywhere and blocks every service straight away. Role changes take effect the next time they sign in.</p>`}
        ${p.active && !self ? '<button class="btn btn--ghost" type="button" id="new-link">Create a new password setup link</button><div id="link-slot"></div>' : ''}`, {
        save: async (f) => {
          const body = { name: val(f, 'name'), area: f.area.value };
          if (!self) { body.role = f.role.value; body.active = f.active.checked; }
          await call(`staff/employees/${p.uid}`, { method: 'PATCH', body });
          toast('Employee updated.'); reload(); loadDirectory();
        },
      });
      form.querySelector('#new-link')?.addEventListener('click', async (e) => {
        busy(e.target, true, 'Creating…');
        try {
          const { link } = await call(`staff/employees/${p.uid}/setup-link`, { method: 'POST', body: {} });
          form.querySelector('#link-slot').innerHTML = setupLinkBlock(link);
          wireCopy(form);
        } catch (err) { toast(err.message, 'error'); }
        finally { busy(e.target, false); }
      });
    },
  });

  document.getElementById('add').addEventListener('click', () => {
    const form = panel('Add employee', `
      <p class="muted">We create their sign-in and email them a link to choose their own password.</p>
      <label class="field">Full name<input name="name" required maxlength="100" autocomplete="off"></label>
      <label class="field">Work email<input name="email" type="email" required maxlength="200" autocomplete="off"></label>
      <div class="grid-2">
        <label class="field">Role<select name="role">${options(L.role, 'staff')}</select></label>
        <label class="field">Area<select name="area">${options(L.area, 'general')}</select></label>
      </div>
      <p class="hint">Administrators manage employees, prices, hours and intakes, and can delete records. Staff work the queues.</p>`, {
      saveLabel: 'Add employee',
      save: async (f) => {
        const body = { name: val(f, 'name'), email: val(f, 'email'), role: f.role.value, area: f.area.value };
        const res = await call('staff/employees', { method: 'POST', body });
        // Firebase sends its standard password email; the link is also shown as a backup.
        await state.fb.authMod.sendPasswordResetEmail(state.fb.auth, body.email).catch(() => {});
        page.reload(); loadDirectory();
        const dlg = document.getElementById('panel');
        setTimeout(() => {
          dlg.innerHTML = `<div class="panel__body">
            <div class="panel__head"><h2>${esc(res.employee.name)} added</h2><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div>
            <p>We’ve emailed <strong>${esc(res.employee.email)}</strong> a link to set their password.</p>
            ${setupLinkBlock(res.setupLink)}
            <div class="panel__actions"><button class="btn btn--primary" type="button" data-close>Done</button></div></div>`;
          dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
          wireCopy(dlg);
          dlg.showModal();
        });
      },
    });
    form.elements.name.focus();
  });
}

// ---------- Business details (administrators) ----------
async function renderSettings() {
  if (!isAdmin()) return go('repairs');
  shell('settings', `
    <div class="page-head"><h1>Business details</h1><p class="muted">Shown in the footer of every page and on the Contact page.</p></div>
    <section class="card card--wide"><p class="muted">Loading…</p></section>`);
  const d = await api('contact/details');
  const card = document.querySelector('.card');
  card.innerHTML = `
    <form class="stack stack--tight" novalidate>
      <div class="grid-2">
        <label class="field">Phone<input name="phone" type="tel" value="${esc(d.phone)}" placeholder="e.g. 015 555 0100"></label>
        <label class="field">WhatsApp<input name="whatsapp" type="tel" value="${esc(d.whatsapp)}" placeholder="e.g. 072 555 0100"></label>
      </div>
      <label class="field">Public email<input name="email" type="email" value="${esc(d.email)}"></label>
      <label class="field">Hours summary <span class="hint-inline">one line for the footer</span><input name="hoursSummary" maxlength="120" value="${esc(d.hoursSummary)}" placeholder="e.g. Mon to Fri 08:00 to 17:00, Sat 09:00 to 13:00"></label>
      <label class="field">Address <span class="hint-inline">one line each</span><textarea name="address" rows="4">${esc(d.address.join('\n'))}</textarea></label>
      <label class="field">Google Maps link <span class="hint-inline">optional</span><input name="mapUrl" type="url" value="${esc(d.mapUrl)}" placeholder="https://maps.app.goo.gl/…"></label>
      ${facts([['Company', esc(d.companyName)], ['Registration', esc(d.registrationNo)]])}
      <p class="form-error" role="alert"></p>
      <div><button class="btn btn--primary" type="submit">Save details</button></div>
    </form>`;
  const f = card.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    busy(btn, true, 'Saving…');
    try {
      const body = {};
      for (const k of ['phone', 'whatsapp', 'email', 'hoursSummary', 'mapUrl']) if (val(f, k)) body[k] = val(f, k);
      const address = lines(val(f, 'address'));
      if (address.length) body.address = address;
      await call('contact/details', { method: 'PUT', body });
      f.querySelector('.form-error').textContent = '';
      toast('Business details saved. The website updates within a few minutes.');
    } catch (err) { showFormError(f, err); }
    finally { busy(btn, false); }
  });
}

// ---------- Account ----------
function renderAccount() {
  const p = state.me;
  shell('account', `
    <div class="page-head"><h1>My account</h1></div>
    <section class="card">
      ${facts([['Name', esc(p.name)], ['Email', esc(p.email)], ['Role', esc(L.role[p.role])], ['Area', esc(L.area[p.area])]])}
      <div class="panel__actions"><button class="btn btn--ghost" type="button" id="my-reset">Email me a password change link</button></div>
    </section>`);
  document.getElementById('my-reset').addEventListener('click', async () => {
    try { await state.fb.authMod.sendPasswordResetEmail(state.fb.auth, p.email); toast('Check your email for a link to change your password.'); }
    catch (err) { toast(authMessage(err), 'error'); }
  });
}

// ---------- routing ----------
async function loadDirectory() {
  try { state.directory = (await call('staff/directory')).items; } catch { state.directory = []; }
}

async function loadMe() {
  try {
    const res = await call('staff/me');
    state.me = res.staff ? res.profile : null;
    state.meInfo = res;
    if (res.staff) await loadDirectory();
  } catch (err) {
    state.me = null;
    state.meInfo = { error: err.message };
  }
  render();
}

const HOME_FOR_AREA = { repairs: 'repairs', cafe: 'cafe', learnerships: 'learnerships', general: 'repairs' };

function render() {
  if (!state.ready) return;
  const r = route();
  if (!state.user) {
    if (r === 'forgot') return renderForgot();
    if (r === 'setup') return renderSetup();
    return renderLogin();
  }
  if (!state.me) {
    const info = state.meInfo || {};
    if (info.error) return renderBlocked('Can’t reach the staff service', `${esc(info.error)} Try again in a minute.`);
    if (info.canBootstrap) return renderFinishSetup();
    if (info.deactivated) return renderBlocked('Account deactivated', 'Your access to the staff portal has been switched off. Speak to an administrator if this is a mistake.');
    return renderBlocked('No staff access', 'You’re signed in, but this account hasn’t been added as an employee. Ask an administrator to add you.');
  }
  const views = {
    repairs: renderRepairs,
    'repairs/prices': renderRepairPrices,
    cafe: renderCafe,
    'cafe/settings': renderCafeSettings,
    learnerships: renderApplications,
    'learnerships/intakes': renderIntakes,
    messages: renderMessages,
    employees: renderEmployees,
    settings: renderSettings,
    account: renderAccount,
  };
  const view = views[r];
  if (!view) return go(HOME_FOR_AREA[state.me.area] || 'repairs');
  view();
}

async function start() {
  try {
    state.fb = await getFirebase();
  } catch (err) {
    root.className = 'boot';
    root.innerHTML = `${logo()}<p>The portal can’t start: ${esc(err.message)}</p>`;
    return;
  }
  window.addEventListener('hashchange', render);
  state.fb.authMod.onAuthStateChanged(state.fb.auth, async (user) => {
    state.ready = true;
    state.user = user;
    state.me = null;
    state.meInfo = null;
    if (!user) { state.directory = []; render(); return; }
    root.className = 'boot';
    root.innerHTML = `${logo()}<p>Signing you in…</p>`;
    await loadMe();
  });
}

start();
