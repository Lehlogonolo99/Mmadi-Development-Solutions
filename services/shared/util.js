// Helpers shared by the services.

/** Formats a sequence number as a short reference, e.g. ref('J', 7) -> 'J-0007'. */
export function ref(prefix, n) {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** Today's date in South Africa (UTC+2, no daylight saving) as YYYY-MM-DD. */
export function todaySA(now = new Date()) {
  return new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Keeps only the listed keys of an object. */
export function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

export const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

/** Filters a list by an optional ?status= query value. */
export function filterStatus(items, status, allowed) {
  if (!status || status === 'all') return items;
  if (status === 'open') return items.filter((i) => !allowed.closed.includes(i.status));
  return items.filter((i) => i.status === status);
}
