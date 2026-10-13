// GENERATED from services/shared by scripts/sync-shared.mjs. Do not edit here.
// Settings shared by every service. Change REGION in one place (also update firebase.json rewrites).
export const REGION = 'africa-south1';

export const FUNCTION_OPTIONS = {
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 5,
  concurrency: 40,
};

// Default form rate limit per IP address (per function instance).
export const FORM_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };
export const LOOKUP_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
