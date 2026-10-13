// Cloud Functions entry point for the contact service (Firebase deploy).
// The same app runs in a container through server.js.
import { onRequest } from 'firebase-functions/v2/https';
import { connect } from './shared/runtime.js';
import { FUNCTION_OPTIONS } from './shared/config.js';
import { createContactApp } from './app.js';

const app = createContactApp(connect());

export const contact = onRequest(FUNCTION_OPTIONS, (req, res) => app.handle(req, res));
