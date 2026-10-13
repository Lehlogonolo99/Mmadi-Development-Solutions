// Firebase Authentication for the staff portal (the public site doesn't need Firebase at all).
//
// The SDK loads as ES modules from Google's CDN, so there is no build step.
// The web app config comes from /__/firebase/init.json, which Firebase Hosting serves automatically.
// In Docker/Kubernetes, the web container serves the same file from a mounted ConfigMap.

export const SDK_VERSION = '12.0.0';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

let loading;

async function loadConfig() {
  const res = await fetch('/__/firebase/init.json', { cache: 'no-store' }).catch(() => null);
  if (res?.ok) return res.json();
  throw new Error('Firebase isn’t configured for this site yet.');
}

/** Loads Firebase once; resolves to { auth, authMod }. */
export function getFirebase() {
  loading ??= (async () => {
    const config = await loadConfig();
    const [appMod, authMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
    ]);
    const app = appMod.initializeApp(config);
    return { auth: authMod.getAuth(app), authMod };
  })();
  return loading;
}
