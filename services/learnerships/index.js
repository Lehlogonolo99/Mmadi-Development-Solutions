// Cloud Functions entry point for the learnerships service (Firebase deploy).
// The same app runs in a container through server.js.
import { onRequest } from 'firebase-functions/v2/https';
import { connect } from './shared/runtime.js';
import { FUNCTION_OPTIONS } from './shared/config.js';
import { createLearnershipsApp } from './app.js';

const app = createLearnershipsApp(connect());

export const learnerships = onRequest(FUNCTION_OPTIONS, (req, res) => app.handle(req, res));
