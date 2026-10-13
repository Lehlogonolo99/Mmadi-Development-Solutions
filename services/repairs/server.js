// Container entry point for the repairs service (Docker / Kubernetes).
// Listens on $PORT (default 8080); GET /healthz is the health probe.
import { connect } from './shared/runtime.js';
import { serve } from './shared/server.js';
import { createRepairsApp } from './app.js';

serve(createRepairsApp(connect()), { name: 'repairs' });
