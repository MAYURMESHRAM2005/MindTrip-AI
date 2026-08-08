import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

  GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY || '',
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',

  AVIATIONSTACK_API_KEY: process.env.AVIATIONSTACK_API_KEY || '',

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

  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'TravelMind AI <no-reply@travelmind.app>',
};

export const isProduction = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

export default env;
