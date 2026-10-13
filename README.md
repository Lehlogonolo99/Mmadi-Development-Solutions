# Mmadi Development Solutions

Website, staff portal and microservices for **Mmadi Development Solutions (Pty) Ltd** (reg. 2026/580350/07), Ga-Moretsele, Jane Furse.

| Page | What it does | Backed by |
|---|---|---|
| `/` | Home | |
| `/repairs/` | What we fix, repair prices, booking, **job tracking** | `repairs` service |
| `/cafe/` | Opening hours (with “open now”), prices, computer/service bookings, booking lookup | `cafe` service |
| `/learnerships/` | MICT SETA learnership programme, open intakes, applications, **status check** | `learnerships` service |
| `/contact/` | Address, contact details, message form | `contact` service |
| `/portal/` | Staff portal: work queues, prices, hours, intakes, employees, business details | all services + `staff` |
| `/privacy/` | POPIA privacy notice | |

## Architecture

```
                 Browser
                    │
      Firebase Hosting  (or Kubernetes Ingress / docker-compose gateway)
     ┌──────────────┼─────────────────────────────────────────────┐
     │ /            │ /api/repairs  /api/cafe  /api/learnerships  │ /api/contact  /api/staff
     ▼              ▼                                             ▼
  public/        repairs        cafe        learnerships       contact        staff
  (static)       service       service       service           service        service
                    │             │              │                 │              │
                    └─────────────┴──────── Cloud Firestore ───────┴──────────────┘
                                         + Firebase Authentication (staff sign-in, roles)
```

- **Frontend** (`public/`): plain HTML, CSS and JavaScript. No framework and no build step, so pages load fast, are easy for Google to index, and serve from any static host or an nginx container.
- **Microservices** (`services/<name>/`): one Node.js 22 service per area. Each owns its own Firestore collections and exposes a JSON API under `/api/<name>`. The browser never touches the database directly; `firestore.rules` denies all client access.
- **Two ways to run each service, same code**:
  - `index.js` exports it as a Cloud Function (2nd gen) for Firebase.
  - `server.js` runs it as a plain HTTP server on port 8080 for Docker and Kubernetes, with `GET /healthz` for probes.
- **Shared code** lives in `services/shared/` and is copied into each service by `node scripts/sync-shared.mjs` (each service must deploy and containerise on its own). Edit only `services/shared/`; CI fails if the copies drift.
- **Data layer**: services talk to a small store interface (`services/shared/store.js`), not to Firestore directly. Swapping to Postgres later means writing one new adapter.
- **Staff access**: employees sign in with Firebase Authentication. Their role (`admin` or `staff`) is a custom claim set by the staff service, and every service checks it on every request. Deactivating someone disables their account and revokes their sessions, which locks them out of every service immediately.

### Services and endpoints

Public endpoints are rate-limited per IP address. Lookups (tracking, status) need two matching pieces of information, such as the job number *and* the phone number used to book, so reference numbers alone reveal nothing.

**repairs**: `GET /catalogue`, `POST /bookings`, `GET /track?job=&phone=` · staff: `GET /jobs`, `GET|PATCH /jobs/:id` · admin: `DELETE /jobs/:id`, `GET /catalogue/all`, `POST /catalogue`, `PATCH|DELETE /catalogue/:id`.
Unlock bookings are refused unless the customer confirms they'll bring ID and proof of ownership.

**cafe**: `GET /info`, `POST /bookings`, `GET /bookings/status?ref=&phone=` · staff: `GET /bookings`, `PATCH /bookings/:id`, `GET /prices` · admin: `PUT /settings`, `POST /prices`, `PATCH|DELETE /prices/:id`, `DELETE /bookings/:id`.
Bookings must fall inside opening hours, within the next 30 days.

**learnerships**: `GET /intakes`, `POST /applications`, `GET /applications/status?ref=&email=` · staff: `GET /applications`, `PATCH /applications/:id`, `GET /intakes/all` · admin: `POST /intakes`, `PATCH|DELETE /intakes/:id`, `DELETE /applications/:id`.

**contact**: `GET /details`, `POST /messages` · staff: `GET /messages`, `PATCH /messages/:id` · admin: `PUT /details`, `DELETE /messages/:id`.

**staff**: `GET /me`, `POST /bootstrap` (owner only, once) · staff: `GET /directory` · admin: `GET|POST /employees`, `PATCH /employees/:uid`, `POST /employees/:uid/setup-link`.

## Tests

```bash
npm test
```

Runs every service against in-memory fakes of Firestore and Firebase Auth (`tests/fakes.mjs`), plus a real HTTP test of the container server. No dependencies to install.

## Going live on Firebase

Cloud Functions need the **Blaze (pay-as-you-go)** plan. The monthly free allowance is large, so a site this size normally costs little or nothing, but a billing account must be attached. Set a budget alert in Google Cloud Billing.

1. **Upgrade** the project to Blaze: Firebase console > ⚙ > Usage and billing.
2. **Register a web app**: Project settings > General > Your apps > Add app > Web. Firebase Hosting then serves its config to the portal automatically.
3. **Turn on email sign-in**: Authentication > Sign-in method > Email/Password.
4. **Create Firestore**: Firestore Database > Create database > production mode > location **africa-south1 (Johannesburg)**. The location can't be changed later.
5. **Deploy** from a computer with Node.js 22:
   ```bash
   npm install -g firebase-tools
   firebase login
   npm run deploy
   ```
6. **Create the first administrator**: open `/portal/#/setup`, sign up with the owner email (`OWNER_EMAIL` in `services/staff/.env`), click the verification link in your email, then return and press continue. This works once.
7. **Fill in the business**: in the portal, add employees, then set Business details, repair prices, café hours and prices, and learnership intakes. The public pages update from these.

Optional: in Authentication > Templates, set the sender name to “Mmadi Development Solutions”, and under Hosting add your own domain.

### Automatic deploys from GitHub

`.github/workflows/deploy.yml` runs the tests on every push and pull request. On `main` it then deploys to Firebase and builds the six container images to GitHub Container Registry.

For the Firebase deploy, add a repository secret named `FIREBASE_SERVICE_ACCOUNT` holding a service-account JSON key with these roles: Firebase Admin, Cloud Functions Admin, Service Account User, Cloud Run Admin, Artifact Registry Administrator, Cloud Build Editor. (Google Cloud console > IAM & Admin > Service accounts.) Delete the downloaded key file after adding it.

## Running in containers

```bash
node scripts/sync-shared.mjs
cp deploy/firebase-web-config.example.json deploy/firebase-web-config.json   # then fill it in
mkdir -p deploy/secrets && cp ~/Downloads/<key>.json deploy/secrets/service-account.json
docker compose up --build
```

Open http://localhost:8080. A gateway container routes `/api/<service>` to each service, as Firebase Hosting does.

### Kubernetes

Manifests are in `deploy/k8s/` (Deployments and Services for each microservice and the website, an Ingress with the same routing, ConfigMaps, and a namespace):

```bash
kubectl create namespace mmadi
kubectl -n mmadi create secret generic firebase-service-account --from-file=service-account.json=./service-account.json
# edit deploy/k8s/config.yaml (web app config) and deploy/k8s/kustomization.yaml (image registry and tags)
kubectl apply -k deploy/k8s
```

Containers run as non-root with read-only root filesystems, liveness and readiness probes on `/healthz`, and resource limits. On GKE, Workload Identity can replace the mounted key.

Note: the per-IP rate limit lives in each instance's memory. With several replicas, add a shared limit at the ingress (for example ingress-nginx `limit-rps`) if spam becomes a problem.

## Project layout

```
public/                      website and staff portal (static)
  assets/js/api.js           calls /api/<service>
  assets/js/forms.js         shared form validation and error display
  assets/js/pages/*.js       one script per public page
  assets/js/portal.js        staff portal
services/
  shared/                    router, validation, auth, store adapter, container server (source of truth)
  <name>/app.js              the service's routes and rules
  <name>/index.js            Cloud Functions entry
  <name>/server.js           container entry
  <name>/Dockerfile
tests/                       node:test suites with in-memory fakes
deploy/                      web image, gateway, Kubernetes manifests
scripts/sync-shared.mjs      copies services/shared into each service
firebase.json                hosting, rewrites to services, functions codebases
firestore.rules              denies all direct client access
```
