// Small schema validator: rejects unknown fields, trims strings, reports every bad field at once.
import { badRequest } from './errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const v = {
  string: (o = {}) => ({ type: 'string', min: 0, max: 500, ...o }),
  text: (o = {}) => ({ type: 'string', min: 0, max: 5000, multiline: true, ...o }),
  email: (o = {}) => ({ type: 'email', ...o }),
  phone: (o = {}) => ({ type: 'phone', ...o }),
  oneOf: (values, o = {}) => ({ type: 'enum', values, ...o }),
  bool: (o = {}) => ({ type: 'bool', ...o }),
  number: (o = {}) => ({ type: 'number', ...o }),
  date: (o = {}) => ({ type: 'date', ...o }),
  time: (o = {}) => ({ type: 'time', ...o }),
  list: (item, o = {}) => ({ type: 'list', item, max: 50, ...o }),
  object: (shape, o = {}) => ({ type: 'object', shape, ...o }),
};

/** Returns digits only, so "072 555 0101" and "+27725550101" compare equal by their last 9 digits. */
export function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9);
}

function check(rule, value, path, errors) {
  const fail = (msg) => { errors[path] = msg; return undefined; };
  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') return fail('Must be text.');
      let s = rule.multiline ? value.replace(/\r\n/g, '\n').trim() : value.replace(/\s+/g, ' ').trim();
      if (rule.lower) s = s.toLowerCase();
      if (s.length < rule.min) return fail(rule.min <= 1 ? 'Required.' : `Must be at least ${rule.min} characters.`);
      if (s.length > rule.max) return fail(`Must be ${rule.max} characters or fewer.`);
      if (rule.pattern && !rule.pattern.test(s)) return fail(rule.patternMessage || 'Invalid format.');
      return s;
    }
    case 'email': {
      if (typeof value !== 'string') return fail('Must be an email address.');
      const s = value.trim().toLowerCase();
      if (s.length > 200 || !EMAIL.test(s)) return fail('Enter a valid email address.');
      return s;
    }
    case 'phone': {
      if (typeof value !== 'string') return fail('Must be a phone number.');
      const s = value.trim();
      const digits = s.replace(/\D/g, '');
      if (!/^[+\d][\d\s()-]*$/.test(s) || digits.length < 9 || digits.length > 15) return fail('Enter a valid phone number, e.g. 072 555 0101.');
      return s;
    }
    case 'enum':
      if (!rule.values.includes(value)) return fail(`Must be one of: ${rule.values.join(', ')}.`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') return fail('Must be true or false.');
      return value;
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail('Must be a number.');
      if (rule.integer && !Number.isInteger(n)) return fail('Must be a whole number.');
      if (rule.min != null && n < rule.min) return fail(`Must be at least ${rule.min}.`);
      if (rule.max != null && n > rule.max) return fail(`Must be ${rule.max} or less.`);
      return n;
    }
    case 'date': {
      if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return fail('Use the format YYYY-MM-DD.');
      return value;
    }
    case 'time':
      if (typeof value !== 'string' || !TIME.test(value)) return fail('Use the format HH:MM.');
      return value;
    case 'list': {
      if (!Array.isArray(value)) return fail('Must be a list.');
      if (value.length > rule.max) return fail(`At most ${rule.max} items.`);
      return value.map((item, i) => check(rule.item, item, `${path}[${i}]`, errors));
    }
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Must be an object.');
      return walk(rule.shape, value, errors, path, false);
    default:
      throw new Error(`Unknown rule type ${rule.type}`);
  }
}

function walk(shape, input, errors, prefix, partial) {
  const out = {};
  for (const key of Object.keys(input)) {
    if (!(key in shape)) errors[prefix ? `${prefix}.${key}` : key] = 'Unknown field.';
  }
  for (const [key, rule] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = input[key];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      if (partial) {
        if (key in input && rule.optional) out[key] = rule.type === 'string' || rule.type === 'email' || rule.type === 'phone' ? '' : null;
        else if (key in input) errors[path] = 'Required.';
        continue;
      }
      if (!rule.optional) errors[path] = 'Required.';
      else if (rule.default !== undefined) out[key] = rule.default;
      continue;
    }
    const cleaned = check(rule, value, path, errors);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

/**
 * parse(shape, input) validates a request body against a shape.
 * With { partial: true } (for PATCH) only the fields present are checked, and at least one is required.
 */
export function parse(shape, input, { partial = false } = {}) {
  const errors = {};
  const out = walk(shape, input || {}, errors, '', partial);
  if (partial && Object.keys(input || {}).length === 0) throw badRequest('Nothing to update.');
  if (Object.keys(errors).length) throw badRequest('Some fields need attention.', errors);
  return out;
}
