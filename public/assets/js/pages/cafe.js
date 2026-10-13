import { api, esc, rand, formatDate } from '../api.js';
import { bindForm } from '../forms.js';

const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const JS_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SERVICE_LABELS = {
  computer: 'Computers and internet',
  printing: 'Printing, scanning and copying',
  cv: 'CV typing',
  online_application: 'Online applications',
};

// South African time, whatever the visitor's device is set to.
function nowInSA() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return { day: parts.weekday.slice(0, 3).toLowerCase(), time: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

const form = document.getElementById('cafe-form');
const sa = nowInSA();
form.date.min = sa.date;
const max = new Date(`${sa.date}T12:00:00`); max.setDate(max.getDate() + 30);
form.date.max = max.toISOString().slice(0, 10);

const durationField = form.duration.closest('.field');
const syncDuration = () => { durationField.hidden = form.service.value !== 'computer'; };
form.service.addEventListener('change', syncDuration);
form.addEventListener('reset', () => setTimeout(syncDuration));

api('cafe/info').then((info) => {
  const hoursEl = document.getElementById('hours');
  if (!info.hours.length) {
    hoursEl.innerHTML = `<h2>Opening hours</h2><p class="muted">Hours will be posted here soon. <a href="/contact/">Contact us</a> to check before you visit.</p>`;
  } else {
    const today = info.hours.find((h) => h.day === sa.day);
    const open = today && !today.closed && sa.time >= today.open && sa.time < today.close;
    hoursEl.innerHTML = `
      <div class="hours-card__head">
        <h2>Opening hours</h2>
        <span class="open-badge ${open ? 'is-open' : ''}">${open ? `Open now, until ${esc(today.close)}` : 'Closed now'}</span>
      </div>
      <table class="hours">
        <tbody>${Object.keys(DAYS).map((d) => {
          const h = info.hours.find((x) => x.day === d);
          const text = !h || h.closed ? 'Closed' : `${esc(h.open)} to ${esc(h.close)}`;
          return `<tr${d === sa.day ? ' class="is-today"' : ''}><th scope="row">${DAYS[d]}</th><td>${text}</td></tr>`;
        }).join('')}</tbody>
      </table>
      ${info.notice ? `<p class="notice-line">${esc(info.notice)}</p>` : ''}`;
  }

  const pricesEl = document.getElementById('prices');
  if (!info.prices.length) {
    pricesEl.innerHTML = '<p class="muted">Ask at the counter for current prices.</p>';
  } else {
    const groups = Object.keys(SERVICE_LABELS).map((s) => [s, info.prices.filter((p) => p.service === s)]).filter(([, l]) => l.length);
    pricesEl.innerHTML = groups.map(([s, list]) => `
      <div class="price-group">
        <h3>${SERVICE_LABELS[s]}</h3>
        <table class="prices"><tbody>${list.map((p) => `
          <tr><th scope="row">${esc(p.item)}<span class="sub">${esc(p.unit)}</span></th><td>${rand(p.price)}</td></tr>`).join('')}
        </tbody></table>
      </div>`).join('');
  }
}).catch(() => {
  document.getElementById('hours').innerHTML = '<h2>Opening hours</h2><p class="muted">Hours couldn’t load right now.</p>';
  document.getElementById('prices').innerHTML = '<p class="muted">Prices couldn’t load right now. Ask at the counter.</p>';
});

bindForm(form, {
  send: (data) => {
    if (data.service !== 'computer') delete data.duration;
    return api('cafe/bookings', { method: 'POST', body: data });
  },
  done: (result, f) => {
    const status = f.querySelector('.form__status');
    status.className = 'form__status is-ok';
    status.innerHTML = `Booking requested. Your reference is <strong>${esc(result.ref)}</strong>. We’ll confirm it with you.`;
  },
});

bindForm(document.getElementById('cafe-check-form'), {
  send: (data) => api('cafe/bookings/status', { query: data }),
  done: (b) => {
    document.getElementById('cafe-check-result').innerHTML = `
      <div class="result-card">
        <p class="result-card__ref">${esc(b.ref)}</p>
        <p class="result-card__status">${esc(b.statusLabel)}</p>
        <p class="muted">${esc(SERVICE_LABELS[b.service] || b.service)}, ${esc(formatDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }))} at ${esc(b.time)}</p>
      </div>`;
    return false;
  },
});
