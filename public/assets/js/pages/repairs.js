import { api, esc, rand, formatDateTime } from '../api.js';
import { bindForm } from '../forms.js';

const CATEGORY_LABELS = {
  phone: 'Phones',
  computer: 'Laptops and PCs',
  software: 'Software',
  unlock: 'Unlocking',
  other: 'Other',
};

function priceText(i) {
  if (i.priceFrom != null && i.priceTo != null && i.priceTo !== i.priceFrom) return `${rand(i.priceFrom)} to ${rand(i.priceTo)}`;
  if (i.priceFrom != null) return `From ${rand(i.priceFrom)}`;
  return 'Quoted after diagnosis';
}

// ---- Price list ----
const catalogueEl = document.getElementById('catalogue');
api('repairs/catalogue').then(({ items }) => {
  if (!items.length) {
    catalogueEl.innerHTML = '<p class="muted">Every repair is quoted after a free look at the device. <a href="#book">Book a repair</a> to get yours.</p>';
    return;
  }
  const groups = Object.keys(CATEGORY_LABELS).map((cat) => [cat, items.filter((i) => i.category === cat)]).filter(([, list]) => list.length);
  catalogueEl.innerHTML = groups.map(([cat, list]) => `
    <div class="price-group">
      <h3>${CATEGORY_LABELS[cat]}</h3>
      <table class="prices">
        <tbody>${list.map((i) => `
          <tr>
            <th scope="row">${esc(i.name)}${i.description ? `<span class="sub">${esc(i.description)}</span>` : ''}</th>
            <td>${esc(priceText(i))}${i.turnaround ? `<span class="sub">${esc(i.turnaround)}</span>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');
}).catch(() => {
  catalogueEl.innerHTML = '<p class="muted">Prices couldn’t load right now. Every repair is quoted before any work starts.</p>';
});

// ---- Booking ----
const bookingForm = document.getElementById('booking-form');
const proofRow = document.getElementById('proof-row');
const proofBox = proofRow.querySelector('input');
const syncProof = () => {
  const unlock = bookingForm.category.value === 'unlock';
  proofRow.hidden = !unlock;
  proofBox.required = unlock;
};
bookingForm.category.addEventListener('change', syncProof);
bookingForm.addEventListener('reset', () => setTimeout(syncProof));

bindForm(bookingForm, {
  send: (data) => api('repairs/bookings', { method: 'POST', body: data }),
  done: (result, form) => {
    const status = form.querySelector('.form__status');
    status.className = 'form__status is-ok';
    status.innerHTML = `Booked. Your job number is <strong>${esc(result.jobNo)}</strong>. Keep it to track your repair. We’ll contact you about bringing the device in.`;
    const trackForm = document.getElementById('track-form');
    trackForm.job.value = result.jobNo;
    trackForm.phone.value = form.phone.value;
  },
});

// ---- Tracking ----
const resultEl = document.getElementById('track-result');
const ORDER = ['booked', 'received', 'diagnosing', 'awaiting_approval', 'in_repair', 'ready', 'collected'];

function renderJob(job) {
  const reached = new Map(job.history.map((h) => [h.status, h.at]));
  const current = job.status;
  let steps;
  if (current === 'cancelled') {
    steps = job.history.map((h) => `<li class="is-done"><span>${esc(h.label)}</span><time>${esc(formatDateTime(h.at))}</time></li>`).join('');
  } else {
    const idx = ORDER.indexOf(current);
    steps = ORDER.filter((s) => s !== 'awaiting_approval' || reached.has(s) || current === s).map((s) => {
      const i = ORDER.indexOf(s);
      const cls = s === current ? 'is-now' : i < idx ? 'is-done' : '';
      const label = { booked: 'Booked', received: 'Device received', diagnosing: 'Diagnosing', awaiting_approval: 'Quote sent', in_repair: 'Repairing', ready: 'Ready for collection', collected: 'Collected' }[s];
      const at = reached.get(s);
      return `<li class="${cls}"><span>${label}</span>${at ? `<time>${esc(formatDateTime(at))}</time>` : ''}</li>`;
    }).join('');
  }
  resultEl.innerHTML = `
    <div class="ticket ticket--result">
      <div class="ticket__head"><span class="ticket__title">Job card</span><span class="ticket__no">${esc(job.jobNo)}</span></div>
      <dl class="ticket__meta">
        <div><dt>Device</dt><dd>${esc(job.device)}</dd></div>
        <div><dt>Status</dt><dd>${esc(job.statusLabel)}</dd></div>
        ${job.quote != null ? `<div><dt>Quote</dt><dd>${rand(job.quote)}</dd></div>` : ''}
      </dl>
      <ol class="ticket__steps">${steps}</ol>
      ${job.customerNote ? `<p class="ticket__note">${esc(job.customerNote)}</p>` : ''}
    </div>`;
}

bindForm(document.getElementById('track-form'), {
  send: (data) => api('repairs/track', { query: data }),
  done: (job) => { renderJob(job); return false; },
});

// Allow links like /repairs/?job=J-0012#track
const params = new URLSearchParams(location.search);
if (params.get('job')) document.getElementById('track-form').job.value = params.get('job');
