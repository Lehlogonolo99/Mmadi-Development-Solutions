// Container entry point for the staff service (Docker / Kubernetes).
// Listens on $PORT (default 8080); GET /healthz is the health probe.
import { connect } from './shared/runtime.js';
import { serve } from './shared/server.js';
import { createStaffApp } from './app.js';

serve(createStaffApp({ ...connect(), ownerEmail: process.env.OWNER_EMAIL, portalUrl: process.env.PORTAL_URL }), { name: 'staff' });
