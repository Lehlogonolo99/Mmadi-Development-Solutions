// Runs on every public page: mobile menu, footer year, and contact details from the contact service.
import { api, esc } from './api.js';

const menuBtn = document.querySelector('.menu-btn');
const nav = document.getElementById('site-nav');
menuBtn?.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') === 'true';
  menuBtn.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('is-open', !open);
});

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

const telHref = (n) => `tel:${n.replace(/[^\d+]/g, '')}`;
const waHref = (n) => {
  let d = n.replace(/\D/g, '');
  if (d.startsWith('0')) d = `27${d.slice(1)}`;
  return `https://wa.me/${d}`;
};

/** Contact details are edited by administrators in the portal; pages show whatever is set. */
export const contactDetails = api('contact/details').catch(() => null);

contactDetails.then((d) => {
  if (!d) return;
  const lines = [];
  if (d.phone) lines.push(`<a href="${telHref(d.phone)}">${esc(d.phone)}</a>`);
  if (d.whatsapp) lines.push(`<a href="${waHref(d.whatsapp)}" rel="noopener">WhatsApp ${esc(d.whatsapp)}</a>`);
  if (d.email) lines.push(`<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`);
  if (d.hoursSummary) lines.push(esc(d.hoursSummary));
  document.querySelectorAll('[data-contact-lines]').forEach((el) => {
    el.innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
    el.hidden = !lines.length;
  });
});

export { telHref, waHref };
