// Connects a service to Firebase (Firestore + Auth) using the Admin SDK.
// Used by both entry points: index.js (Cloud Functions) and server.js (Docker / Kubernetes).
//
// Credentials: on Firebase they are automatic. In a container, set GOOGLE_APPLICATION_CREDENTIALS
// to a mounted service-account key, or use Workload Identity on GKE.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { firestoreStore, firebaseAuthAdapter } from './store.js';

export function connect() {
  if (!getApps().length) initializeApp();
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  return { store: firestoreStore(db), auth: firebaseAuthAdapter(getAuth()) };
}
