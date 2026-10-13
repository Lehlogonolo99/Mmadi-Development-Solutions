// Container entry point for the contact service (Docker / Kubernetes).
// Listens on $PORT (default 8080); GET /healthz is the health probe.
import { connect } from './shared/runtime.js';
import { serve } from './shared/server.js';
import { createContactApp } from './app.js';

serve(createContactApp(connect()), { name: 'contact' });
