import { api, esc } from '../api.js';
import { bindForm } from '../forms.js';
import { contactDetails, telHref, waHref } from '../site.js';

contactDetails.then((d) => {
  if (!d) return;
  const lines = [];
  if (d.phone) lines.push(['Phone', `<a href="${telHref(d.phone)}">${esc(d.phone)}</a>`]);
  if (d.whatsapp) lines.push(['WhatsApp', `<a href="${waHref(d.whatsapp)}" rel="noopener">${esc(d.whatsapp)}</a>`]);
  if (d.email) lines.push(['Email', `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`]);
  if (d.hoursSummary) lines.push(['Hours', esc(d.hoursSummary)]);
  document.getElementById('contact-lines').innerHTML = lines.length
    ? `<dl class="visit__facts">${lines.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
    : '';
  if (d.mapUrl) document.getElementById('map-link').href = d.mapUrl;
});

bindForm(document.getElementById('contact-form'), {
  send: (data) => api('contact/messages', { method: 'POST', body: data }),
  done: (_, f) => {
    const status = f.querySelector('.form__status');
    status.className = 'form__status is-ok';
    status.textContent = 'Message sent. We’ll get back to you soon.';
  },
});
