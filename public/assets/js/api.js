// Calls the Mmadi microservices at /api/<service>/... (same origin on Firebase Hosting and behind the Kubernetes ingress).

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

/**
 * api('repairs/bookings', { method: 'POST', body }) -> parsed JSON.
 * Pass `token` (a Firebase ID token) for staff endpoints.
 */
export async function api(path, { method = 'GET', body, token, query } = {}) {
  const url = new URL(`/api/${path.replace(/^\/+/, '')}`, location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const message = data?.error?.message
      || (res.status >= 500 ? 'Something went wrong on our side. Try again shortly.' : 'That request didn’t work.');
    throw new ApiError(res.status, message, data?.error?.details);
  }
  return data;
}

/** Escapes text for safe use inside HTML template strings. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const rand = (n) => `R${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

export function formatDate(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('en-ZA', opts);
}

export function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
