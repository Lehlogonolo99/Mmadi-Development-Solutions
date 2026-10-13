// Shared behaviour for public forms: browser validation first, then the service's own validation,
// with every error shown next to its field.
import { ApiError } from './api.js';

function fieldError(form, name) {
  const input = form.elements[name];
  const el = input?.length && !input.tagName ? input[0] : input;
  const wrap = el?.closest('.field, .check');
  return { el, msg: wrap?.querySelector('.field__error') };
}

export function clearErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field__error').forEach((el) => { el.textContent = ''; });
}

export function showErrors(form, details) {
  let first = null;
  for (const [name, message] of Object.entries(details || {})) {
    const { el, msg } = fieldError(form, name.split(/[.[]/)[0]);
    if (!el) continue;
    el.setAttribute('aria-invalid', 'true');
    if (msg) msg.textContent = message;
    first ??= el;
  }
  first?.focus();
  return Boolean(first);
}

/** Reads a form into an object. data-type="bool" | "number" on a control converts its value; blanks are dropped. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.name === 'website' || el.type === 'submit') continue;
    if (el.type === 'checkbox') { out[el.name] = el.checked; continue; }
    if (el.type === 'radio' && !el.checked) continue;
    const raw = el.value.trim();
    if (raw === '') continue;
    if (el.dataset.type === 'bool') out[el.name] = raw === 'true';
    else if (el.dataset.type === 'number') out[el.name] = Number(raw);
    else out[el.name] = raw;
  }
  return out;
}

/**
 * bindForm(form, { send, done }):
 *   send(data) calls the API and returns its result
 *   done(result, form) shows the outcome (the form resets itself unless done returns false)
 */
export function bindForm(form, { send, done }) {
  const status = form.querySelector('.form__status');
  const button = form.querySelector('button[type=submit]');
  const label = button.textContent;

  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid')) {
      e.target.removeAttribute('aria-invalid');
      const msg = e.target.closest('.field, .check')?.querySelector('.field__error');
      if (msg) msg.textContent = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    status.className = 'form__status';
    status.textContent = '';

    if (!form.checkValidity()) {
      const details = {};
      for (const el of form.elements) if (el.name && !el.validity.valid) details[el.name] = el.validationMessage;
      showErrors(form, details);
      status.classList.add('is-error');
      status.textContent = 'Check the highlighted fields.';
      return;
    }
    if (form.elements.website?.value) { form.reset(); return; } // bots fill the hidden field

    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const result = await send(readForm(form));
      if (done(result, form) !== false) form.reset();
    } catch (err) {
      status.classList.add('is-error');
      if (err instanceof ApiError && showErrors(form, err.details)) status.textContent = 'Check the highlighted fields.';
      else status.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}
