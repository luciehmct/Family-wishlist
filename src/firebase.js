import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Values come from .env.local locally, and from GitHub Actions secrets in CI, so no
// project identifiers are stored in this repo.
//
// Be clear about what that buys: Vite inlines these at build time, so they still ship
// inside dist/assets/index-*.js and every visitor's browser downloads them. This keeps
// them out of the repo — not out of the site. The thing that actually protects the data
// is firestore.rules plus an HTTP-referrer restriction on the API key.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FB_API_KEY,
  authDomain: env.VITE_FB_AUTH_DOMAIN,
  projectId: env.VITE_FB_PROJECT_ID,
  storageBucket: env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FB_MSG_SENDER_ID,
  appId: env.VITE_FB_APP_ID,
};

// Fail loudly at startup: without this you get an opaque Firebase error deep in a
// listener instead of "you forgot .env.local".
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error('Firebase config manquante — copie .env.example en .env.local et remplis-le.');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
