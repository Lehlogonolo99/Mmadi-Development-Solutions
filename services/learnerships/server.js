// Container entry point for the learnerships service (Docker / Kubernetes).
// Listens on $PORT (default 8080); GET /healthz is the health probe.
import { connect } from './shared/runtime.js';
import { serve } from './shared/server.js';
import { createLearnershipsApp } from './app.js';

serve(createLearnershipsApp(connect()), { name: 'learnerships' });
