import env from './env.js';
import { axiosGet, axiosPost } from '../providers/base.provider.js';
import logger from '../utils/logger.js';

/**
 * Central Google Maps Platform configuration.
 *
 * All Google Maps Platform API calls (Geocoding, Places API, Routes API)
 * run server-side with a single restricted backend key (GOOGLE_MAPS_API_KEY).
 * The key is never sent to the frontend, to logs, or to Gemini.
 *
 * Errors are normalized to structured { code, message } values so callers
 * can degrade gracefully instead of crashing the pipeline.
 */

export const GOOGLE_URLS = {
  geocode: 'https://maps.googleapis.com/maps/api/geocode/json',
  reverseGeocode: 'https://maps.googleapis.com/maps/api/geocode/json',
  // Places API (New)
  placesTextSearch: 'https://places.googleapis.com/v1/places:searchText',
  placesNearbySearch: 'https://places.googleapis.com/v1/places:searchNearby',
  placesAutocomplete: 'https://places.googleapis.com/v1/places:autocomplete',
  placesDetails: (placeId) => `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
  placesPhoto: (photoName) => `https://places.googleapis.com/v1/${photoName}/media`,
  // Routes API
  computeRoutes: 'https://routes.googleapis.com/directions/v2:computeRoutes',
  computeRouteMatrix: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
};

/** Server-side Google Maps Platform API key. Never exposed to the browser. */
export function googleMapsKey() {
  return env.GOOGLE_MAPS_API_KEY || '';
}

export function isGoogleMapsConfigured() {
  return Boolean(env.GOOGLE_MAPS_API_KEY);
}

/** Default request timeout for Google Maps Platform calls. */
export const GOOGLE_TIMEOUT_MS = 8000;

/**
 * Structured Google Maps Platform error.
 * @typedef {Object} GoogleMapsError
 */
export class GoogleMapsError extends Error {
  constructor(message, { code = 'GOOGLE_MAPS_ERROR', status = '', httpStatus = null } = {}) {
    super(message);
    this.name = 'GoogleMapsError';
    this.code = code;
    this.status = status;
    this.httpStatus = httpStatus;
  }
}

/** Map Google API status codes to stable, caller-friendly error codes. */
const STATUS_CODE_MAP = {
  API_KEY_INVALID: 'INVALID_API_KEY',
  API_KEY_NOT_FOUND: 'INVALID_API_KEY',
  REQUEST_DENIED: 'PERMISSION_DENIED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RESOURCE_EXHAUSTED: 'QUOTA_EXCEEDED',
  BILLING_NOT_ENABLED: 'BILLING_DISABLED',
  BILLING_DISABLED: 'BILLING_DISABLED',
  OVER_QUERY_LIMIT: 'RATE_LIMITED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMITED',
  ZERO_RESULTS: 'NO_RESULTS',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  FAILED_PRECONDITION: 'API_NOT_ENABLED',
  UNAUTHENTICATED: 'PERMISSION_DENIED',
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: 'PERMISSION_DENIED',
  MAX_ROUTE_LENGTH_EXCEEDED: 'ROUTE_NOT_FOUND',
  NO_ROUTE_FOUND: 'ROUTE_NOT_FOUND',
};

/**
 * Normalize any thrown error from a Google Maps Platform call into a
 * GoogleMapsError with a stable code. Never logs the API key.
 *
 * @param {Error} err
 * @param {string} context - operation name for messages
 * @returns {GoogleMapsError}
 */
export function normalizeGoogleError(err, context = 'Google Maps Platform') {
  const data = err?.response?.data || {};
  const apiError = data.error || {};
  const status = apiError.status || data.status || '';
  const legacyMessage = data.error_message || '';
  const rawMessage = apiError.message || legacyMessage || err.message || '';

  const statusCode = status || (err?.response?.status >= 500 ? 'SERVER_ERROR' : '');
  const code = STATUS_CODE_MAP[statusCode] || (statusCode ? 'GOOGLE_MAPS_ERROR' : 'NETWORK_ERROR');

  let message;
  switch (code) {
    case 'INVALID_API_KEY':
      message = `${context} rejected the API key. Check GOOGLE_MAPS_API_KEY.`;
      break;
    case 'PERMISSION_DENIED':
      message = `${context} permission denied. Enable the required API and restrict the key to it.`;
      break;
    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMITED':
      message = `${context} quota/rate limit exceeded. Retry later.`;
      break;
    case 'BILLING_DISABLED':
      message = `${context} billing is not enabled for this project.`;
      break;
    case 'API_NOT_ENABLED':
      message = `${context} reports this API is not enabled for the project/key.`;
      break;
    case 'NO_RESULTS':
      message = rawMessage || `${context} returned no results.`;
      break;
    default:
      message = rawMessage || `${context} request failed.`;
      // Default branch already carries the raw Google text — nothing to append.
  }

  // Append Google's verbatim reason when we have one (never the API key) so
  // callers and logs can distinguish restriction, billing and auth failures.
  if (code !== 'NO_RESULTS' && rawMessage && rawMessage !== message && !message.endsWith(rawMessage)) {
    message = `${message} (Google: "${rawMessage}")`;
  }

  return new GoogleMapsError(message, { code, status: statusCode, httpStatus: err?.response?.status ?? null });
}

/**
 * Diagnostic log for a failed Google Maps Platform call: endpoint + HTTP
 * status + Google status code + sanitized message. The API key is never part
 * of the URL or logged. Then rethrows the normalized GoogleMapsError.
 */
function throwGoogleError(url, err, context = 'Google Maps Platform') {
  const mapsErr = err instanceof GoogleMapsError ? err : normalizeGoogleError(err, context);
  logger.error(
    `[GOOGLE_MAPS] ${url} failed — http=${mapsErr.httpStatus} googleStatus=${mapsErr.status || 'N/A'} code=${mapsErr.code} message="${mapsErr.message}"`
  );
  throw mapsErr;
}

/**
 * GET against a Google Maps Platform endpoint that authenticates with a key
 * query parameter (legacy Geocoding API). Throws GoogleMapsError on failure.
 */
export async function googleQueryGet(url, params = {}, { timeoutMs = GOOGLE_TIMEOUT_MS } = {}) {
  try {
    return await axiosGet(url, { key: googleMapsKey(), ...params }, {}, timeoutMs);
  } catch (err) {
    throwGoogleError(url, err, 'Google Maps Platform');
  }
}

/**
 * GET against a Places API (New) / Routes API style endpoint that
 * authenticates with the X-Goog-Api-Key header. Throws GoogleMapsError.
 */
export async function googleHeaderGet(url, { fieldMask = '', timeoutMs = GOOGLE_TIMEOUT_MS } = {}) {
  const headers = { 'X-Goog-Api-Key': googleMapsKey() };
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  try {
    return await axiosGet(url, {}, { headers }, timeoutMs);
  } catch (err) {
    throwGoogleError(url, err, 'Google Maps Platform');
  }
}

/**
 * POST to a Places API (New) / Routes API endpoint. Throws GoogleMapsError.
 */
export async function googlePost(url, body = {}, { fieldMask = '', timeoutMs = GOOGLE_TIMEOUT_MS } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleMapsKey() };
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  try {
    return await axiosPost(url, body, { headers }, timeoutMs);
  } catch (err) {
    throwGoogleError(url, err, 'Google Maps Platform');
  }
}

export default {
  GOOGLE_URLS,
  googleMapsKey,
  isGoogleMapsConfigured,
  GOOGLE_TIMEOUT_MS,
  GoogleMapsError,
  normalizeGoogleError,
  googleQueryGet,
  googleHeaderGet,
  googlePost,
};
