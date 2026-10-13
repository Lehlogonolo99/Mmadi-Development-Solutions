// Cloud Functions entry point for the repairs service (Firebase deploy).
// The same app runs in a container through server.js.
import { onRequest } from 'firebase-functions/v2/https';
import { connect } from './shared/runtime.js';
import { FUNCTION_OPTIONS } from './shared/config.js';
import { createRepairsApp } from './app.js';

const app = createRepairsApp(connect());

export const repairs = onRequest(FUNCTION_OPTIONS, (req, res) => app.handle(req, res));
