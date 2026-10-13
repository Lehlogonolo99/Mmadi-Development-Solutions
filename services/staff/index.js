// Cloud Functions entry point for the staff service (Firebase deploy).
// The same app runs in a container through server.js.
import { onRequest } from 'firebase-functions/v2/https';
import { connect } from './shared/runtime.js';
import { FUNCTION_OPTIONS } from './shared/config.js';
import { createStaffApp } from './app.js';

const app = createStaffApp({ ...connect(), ownerEmail: process.env.OWNER_EMAIL, portalUrl: process.env.PORTAL_URL });

export const staff = onRequest(FUNCTION_OPTIONS, (req, res) => app.handle(req, res));
