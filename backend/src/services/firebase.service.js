import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Backend root = backend/ (two levels up from src/services/)
const BACKEND_ROOT = path.resolve(__dirname, '../..');

let app = null;

/**
 * Resolve a service-account path reliably regardless of the process CWD.
 * Relative paths are resolved against the backend root (backend/), so
 * "src/config/firebase-admin.json" works whether the server is started
 * from backend/ or from the repo root.
 */
function resolveServiceAccountPath(p) {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  // Try backend-root-relative first, then CWD-relative (backwards compatible)
  const fromRoot = path.resolve(BACKEND_ROOT, p);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return path.resolve(process.cwd(), p);
}

function init() {
  if (app) return app;

  try {
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const resolved = resolveServiceAccountPath(env.FIREBASE_SERVICE_ACCOUNT_PATH);
      app = admin.initializeApp({ credential: admin.credential.cert(resolved) });
    } else if (env.FIREBASE_PROJECT_ID) {
      // Project ID alone is enough to verify ID tokens: the Admin SDK fetches
      // Google's public certs and validates aud/iss against the project.
      app = admin.initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
    } else {
      throw new Error('FIREBASE_PROJECT_ID missing');
    }
  } catch (e) {
    throw ApiError.internal(`Firebase initialization failed: ${e.message}`);
  }
  return app;
}

export function isFirebaseConfigured() {
  return Boolean(env.FIREBASE_PROJECT_ID || env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

/**
 * Verify a Firebase ID token minted by the Firebase client SDK after Google
 * sign-in. Returns the decoded claims: { uid, email, name, picture, ... }.
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!isFirebaseConfigured()) {
    throw ApiError.badRequest('Firebase is not configured on the server');
  }
  init();
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    // Distinguish config/SDK failures from genuinely invalid tokens.
    logger.warn('[firebase-verify]', e?.message);
    throw ApiError.unauthorized('Invalid Firebase token');
  }
}

export default { init, isFirebaseConfigured, verifyFirebaseIdToken };
