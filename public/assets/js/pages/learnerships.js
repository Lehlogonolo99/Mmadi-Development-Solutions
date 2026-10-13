import { api, esc, formatDate } from '../api.js';
import { bindForm } from '../forms.js';

const listEl = document.getElementById('intake-list');
const form = document.getElementById('apply-form');
const intakeSelect = form.intakeId;

function intakeCard(i) {
  const facts = [
    ['Starts', formatDate(i.startDate)],
    i.closingDate && ['Applications close', formatDate(i.closingDate)],
    i.durationMonths && ['Duration', `${i.durationMonths} months`],
    i.seats && ['Places', String(i.seats)],
    i.stipend && ['Stipend', i.stipend],
    i.location && ['Where', i.location],
  ].filter(Boolean);
  const open = i.status === 'open';
  return `
    <article class="intake">
      <div class="intake__head">
        <h3>${esc(i.title)}</h3>
        <span class="open-badge ${open ? 'is-open' : ''}">${open ? 'Open for applications' : 'Opening soon'}</span>
      </div>
      <p class="intake__track">${esc(i.trackLabel)}</p>
      ${i.description ? `<p>${esc(i.description)}</p>` : ''}
      <dl class="intake__facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${i.certifications.length ? `<p class="intake__label">Certifications</p><ul class="chips-list">${i.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${i.requirements.length ? `<p class="intake__label">Requirements</p><ul class="plain-list">${i.requirements.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${open ? `<a class="btn btn--primary" href="#apply" data-apply="${esc(i.id)}">Apply for this intake</a>` : ''}
    </article>`;
}

api('learnerships/intakes').then(({ items }) => {
  if (!items.length) {
    listEl.innerHTML = '<div class="empty-note"><p><strong>No intakes are open right now.</strong> Apply to our general pool below and we’ll contact you when the next one opens.</p></div>';
    return;
  }
  listEl.innerHTML = items.map(intakeCard).join('');
  for (const i of items.filter((x) => x.status === 'open')) {
    intakeSelect.insertAdjacentHTML('beforeend', `<option value="${esc(i.id)}">${esc(i.title)}</option>`);
  }
  listEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-apply]');
    if (a) intakeSelect.value = a.dataset.apply;
  });
}).catch(() => {
  listEl.innerHTML = '<p class="muted">Intakes couldn’t load right now. You can still apply to the general pool below.</p>';
});

bindForm(form, {
  send: (data) => api('learnerships/applications', { method: 'POST', body: data }),
  done: (result, f) => {
    const status = f.querySelector('.form__status');
    status.className = 'form__status is-ok';
    status.innerHTML = `Application received. Your reference is <strong>${esc(result.ref)}</strong>. Use it with your email to check your status.`;
  },
});

bindForm(document.getElementById('status-form'), {
  send: (data) => api('learnerships/applications/status', { query: data }),
  done: (a) => {
    document.getElementById('status-result').innerHTML = `
      <div class="result-card">
        <p class="result-card__ref">${esc(a.ref)}</p>
        <p class="result-card__status">${esc(a.statusLabel)}</p>
        <p class="muted">${esc(a.intakeTitle)}. Submitted ${esc(formatDate(a.submittedAt))}.</p>
      </div>`;
    return false;
  },
});
