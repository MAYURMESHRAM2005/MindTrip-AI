import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, '../../.env');

dotenv.config({ path: ENV_FILE });

/**
 * Central environment configuration.
 * All secrets live in environment variables - never hardcode.
 */
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  MONGODB_URI:
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/travelmind',

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'travelmind-access-dev-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'travelmind-refresh-dev-secret',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',

  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  // Service account JSON string (preferred) or path to a serviceAccountKey.json
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT || '',
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',

  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  GEMINI_TIMEOUT_MS: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 45000,

  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  GROQ_TIMEOUT_MS: parseInt(process.env.GROQ_TIMEOUT_MS, 10) || 60000,

  // Google Maps Platform (server-side key — never expose to the browser).
  // Enables Google Geocoding API, Places API and Routes API.
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',

  AVIATIONSTACK_API_KEY: process.env.AVIATIONSTACK_API_KEY || '',

  IGNAV_API_KEY: process.env.IGNAV_API_KEY || '',

  // Amadeus is used for HOTELS only (flights use AviationStack).
  AMADEUS_CLIENT_ID: process.env.AMADEUS_CLIENT_ID || '',
  AMADEUS_CLIENT_SECRET: process.env.AMADEUS_CLIENT_SECRET || '',
  AMADEUS_ENV: process.env.AMADEUS_ENV || 'test',

  TRAIN_API_URL: process.env.TRAIN_API_URL || '',
  TRAIN_API_KEY: process.env.TRAIN_API_KEY || '',
  // Path of the train search endpoint (RapidAPI: copy from the API docs)
  TRAIN_API_ENDPOINT: process.env.TRAIN_API_ENDPOINT || '/search',
  BUS_API_URL: process.env.BUS_API_URL || '',
  BUS_API_KEY: process.env.BUS_API_KEY || '',
  BUS_API_ENDPOINT: process.env.BUS_API_ENDPOINT || '/search',

  PAY2ALL_API_KEY: process.env.PAY2ALL_API_KEY || '',
  PAY2ALL_BASE_URL: process.env.PAY2ALL_BASE_URL || 'https://pay2all.in/api/v1',

  VIATOR_API_KEY: process.env.VIATOR_API_KEY || '',
  VIATOR_AFFILIATE_ID: process.env.VIATOR_AFFILIATE_ID || '',

  ZOMATO_RAPIDAPI_KEY: process.env.ZOMATO_RAPIDAPI_KEY || '',
  ZOMATO_RAPIDAPI_HOST: process.env.ZOMATO_RAPIDAPI_HOST || 'zomato4.p.rapidapi.com',

  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY || '',

  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'TravelMind AI <no-reply@travelmind.app>',
};

// ── SAFE STARTUP DIAGNOSTIC (fingerprints only — NEVER the full key) ──
// Shows which Google Maps key the server will actually use and flags the
// classic silent failure: a GOOGLE_MAPS_API_KEY exported in the shell / host
// environment shadows backend/.env because dotenv never overrides a variable
// that is already set. If the fingerprints differ, unset the exported
// variable (e.g. `unset GOOGLE_MAPS_API_KEY`) or fix the host env before
// restarting — otherwise edits to backend/.env have no effect.
if (process.env.NODE_ENV !== 'test') {
  const fp = (s) => (s && s.length > 6 ? `${s.slice(0, 6)}...${s.slice(-4)}` : '(empty)');
  const presence = (name) => (process.env[name] !== undefined && process.env[name] !== '' ? 'SET' : 'NOT_SET');
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || '';

  let fileKey = '';
  try {
    const parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
    fileKey = parsed.GOOGLE_MAPS_API_KEY || '';
  } catch {
    /* .env may not exist — nothing to compare */
  }

  console.log('\n[GOOGLE MAPS CONFIG DIAG]');
  // FIREBASE_PROJECT_ID only drives Firebase Auth (Google sign-in). Google
  // Maps Platform calls are keyed by the API key alone, so this value does
  // NOT need to match the Cloud project that issued the Maps key.
  console.log('  firebaseProjectId = ' + (process.env.FIREBASE_PROJECT_ID || '(not set — Google sign-in only)'));
  console.log('  keyVariable       = GOOGLE_MAPS_API_KEY');
  console.log('  keyPrefix         = ' + fp(mapsKey).split('...')[0]);
  console.log('  keySuffix         = ' + fp(mapsKey).split('...')[1]);
  console.log('  GOOGLE_MAPS_API_KEY        = ' + presence('GOOGLE_MAPS_API_KEY'));
  console.log('  VITE_GOOGLE_MAPS_BROWSER_KEY = ' + presence('VITE_GOOGLE_MAPS_BROWSER_KEY'));
  console.log('  GOOGLE_MAPS_BROWSER_KEY    = ' + presence('GOOGLE_MAPS_BROWSER_KEY'));
  console.log('  GOOGLE_MAPS_SERVER_KEY     = ' + presence('GOOGLE_MAPS_SERVER_KEY'));
  if (fileKey && mapsKey && fileKey !== mapsKey) {
    console.log('  ⚠ OVERRIDE DETECTED: the running process uses a key that is NOT the one in ' + ENV_FILE);
    console.log('    file value     = ' + fp(fileKey));
    console.log('    effective value = ' + fp(mapsKey) + ' (exported in shell / set by host)');
    console.log('    Fix: unset GOOGLE_MAPS_API_KEY in the shell (or host env) and restart.');
  }
  console.log('[/GOOGLE MAPS CONFIG DIAG]\n');
}

export const isProduction = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

export default env;
