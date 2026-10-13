// Container entry point for the cafe service (Docker / Kubernetes).
// Listens on $PORT (default 8080); GET /healthz is the health probe.
import { connect } from './shared/runtime.js';
import { serve } from './shared/server.js';
import { createCafeApp } from './app.js';

serve(createCafeApp(connect()), { name: 'cafe' });
