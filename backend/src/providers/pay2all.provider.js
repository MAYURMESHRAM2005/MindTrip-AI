import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Pay2all Bus API provider.
 * Docs: https://pay2all.in/developers
 *
 * Endpoints used:
 *   GET  /buses/cities?q=...        City autocomplete
 *   POST /buses/search              Search available trips
 *   POST /buses/seat-layout         Seat map & boarding points
 *   POST /buses/book                Book seats
 */

const BASE_URL = env.PAY2ALL_BASE_URL || 'https://pay2all.in/api/v1';
const API_KEY = env.PAY2ALL_API_KEY || '';

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function isConfigured() {
  return Boolean(API_KEY);
}

async function request(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const json = await res.json();
  if (json.status_id === 2) {
    throw new Error(json.message || 'Pay2all API error');
  }
  return json;
}

// ── City autocomplete ──────────────────────────────────────────────────
export async function searchCities(query) {
  logger.entry('[PROVIDER:pay2all]', 'searchCities', { query });
  const started = Date.now();
  if (!isConfigured()) {
    return { cities: [], message: 'Pay2all API key not configured' };
  }
  try {
    const res = await request('GET', `/buses/cities?q=${encodeURIComponent(query)}`);
    const cities = res.data?.cities || [];
    logger.provider('pay2all', 'searchCities', { isLive: true, count: cities.length, latencyMs: Date.now() - started });
    return { cities, message: res.message };
  } catch (err) {
    logger.error(`[PROVIDER:pay2all] searchCities error: ${err.message}`);
    return { cities: [], message: err.message };
  }
}

// ── Search trips ───────────────────────────────────────────────────────
export async function searchTrips({ sourceId, destinationId, date }) {
  logger.entry('[PROVIDER:pay2all]', 'searchTrips', { sourceId, destinationId, date });
  const started = Date.now();
  if (!isConfigured()) {
    return { trips: [], traceId: null, message: 'Pay2all API key not configured' };
  }
  try {
    const res = await request('POST', '/buses/search', {
      source_id: sourceId,
      destination_id: destinationId,
      date,
    });
    // Pay2all returns { count, results: [...] } — not "trips"
    const rawTrips = res.data?.results || res.data?.trips || [];
    const count = res.data?.count || rawTrips.length;
    const trips = rawTrips.map(normalizeTrip);
    logger.provider('pay2all', 'searchTrips', { isLive: true, count: trips.length, latencyMs: Date.now() - started });
    return { trips, count, message: res.message };
  } catch (err) {
    logger.error(`[PROVIDER:pay2all] searchTrips error: ${err.message}`);
    return { trips: [], traceId: null, message: err.message };
  }
}

// ── Seat layout ────────────────────────────────────────────────────────
export async function getSeatLayout(tripId) {
  logger.entry('[PROVIDER:pay2all]', 'getSeatLayout', { tripId });
  const started = Date.now();
  if (!isConfigured()) {
    return { seats: [], boarding: [], dropping: [], message: 'Pay2all API key not configured' };
  }
  try {
    const res = await request('POST', '/buses/seat-layout', { trip_id: tripId });
    const result = {
      seats: res.data?.seats || [],
      boarding: res.data?.boarding || [],
      dropping: res.data?.dropping || [],
      message: res.message,
    };
    logger.provider('pay2all', 'getSeatLayout', { isLive: true, seatCount: result.seats.length, latencyMs: Date.now() - started });
    return result;
  } catch (err) {
    logger.error(`[PROVIDER:pay2all] getSeatLayout error: ${err.message}`);
    return { seats: [], boarding: [], dropping: [], message: err.message };
  }
}

// ── Book seats ─────────────────────────────────────────────────────────
export async function bookSeats({ tripId, boardingId, droppingId, email, mobile, passengers, reference }) {
  logger.entry('[PROVIDER:pay2all]', 'bookSeats', { tripId, boardingId, droppingId, passengerCount: passengers?.length });
  const started = Date.now();
  if (!isConfigured()) {
    return { success: false, message: 'Pay2all API key not configured' };
  }
  try {
    const res = await request('POST', '/buses/book', {
      trip_id: tripId,
      boarding_id: boardingId,
      dropping_id: droppingId,
      email,
      mobile,
      reference,
      passengers,
    });
    const result = {
      success: res.status_id === 1,
      pnr: res.data?.pnr || null,
      amount: res.data?.amount || 0,
      currency: res.data?.currency || 'INR',
      seats: res.data?.seats || [],
      message: res.message,
    };
    logger.provider('pay2all', 'bookSeats', { isLive: true, success: result.success, pnr: result.pnr, latencyMs: Date.now() - started });
    return result;
  } catch (err) {
    logger.error(`[PROVIDER:pay2all] bookSeats error: ${err.message}`);
    return { success: false, message: err.message };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function normalizeTrip(t, i) {
  if (!t || typeof t !== 'object') return null;
  // Pay2all response fields: id, operator, busType, departure, arrival,
  // durationMin, fareMin, fareMax, currency, seatsAvailable, ac, sleeper,
  // boardingPoints, droppingPoints, amenities
  const durationMin = t.durationMin || 0;
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const durationStr = durationMin > 0
    ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`)
    : t.duration || '';
  return {
    id: t.id || `pay2all-${i}`,
    tripId: t.id || `pay2all-${i}`,
    operator: t.operator || 'Bus',
    busType: t.busType || t.bus_type || 'Standard',
    departure: t.departure || '',
    arrival: t.arrival || '',
    duration: durationStr,
    durationMin,
    fareMin: t.fareMin || t.fare_min || 0,
    fareMax: t.fareMax || t.fare_max || 0,
    currency: t.currency || 'INR',
    seatsAvailable: t.seatsAvailable ?? t.seats_available ?? 0,
    ac: t.ac ?? false,
    sleeper: t.sleeper ?? false,
    rating: t.rating ?? null,
    boardingPoints: t.boardingPoints || [],
    droppingPoints: t.droppingPoints || [],
    amenities: t.amenities || [],
    singleSeats: t.singleSeats || 0,
    source: 'pay2all',
  };
}

export default {
  isConfigured,
  searchCities,
  searchTrips,
  getSeatLayout,
  bookSeats,
};
