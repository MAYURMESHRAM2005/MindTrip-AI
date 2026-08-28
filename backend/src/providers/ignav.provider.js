import env from '../config/env.js';
import { live, unavailable } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Ignav flight provider — https://ignav.com
 *
 * Provides real flight PRICES and BOOKING LINKS (which AviationStack lacks).
 * Free tier: 1,000 requests/month. Auth via X-Api-Key header.
 *
 * Endpoints:
 *   POST /api/fares/one-way     — one-way itineraries with prices
 *   POST /api/fares/round-trip  — round-trip itineraries with prices
 *   POST /api/fares/booking-links — booking URLs for a selected itinerary
 *   GET  /api/airports?q=...    — airport search
 */

const BASE_URL = 'https://ignav.com/api';
const IATA_RE = /^[A-Z]{3}$/;

/** Common city → IATA mapping (supplements Ignav's airport search) */
const CITY_IATA = {
  MUMBAI: 'BOM', DELHI: 'DEL', 'NEW DELHI': 'DEL', PUNE: 'PNQ', GOA: 'GOI',
  BENGALURU: 'BLR', BANGALORE: 'BLR', CHENNAI: 'MAA', MADRAS: 'MAA',
  KOLKATA: 'CCU', CALCUTTA: 'CCU', HYDERABAD: 'HYD', JAIPUR: 'JAI',
  AHMEDABAD: 'AMD', KOCHI: 'COK', TRIVANDRUM: 'TRV', AMRITSAR: 'ATQ',
  LUCKNOW: 'LKO', NAGPUR: 'NAG', DUBAI: 'DXB', LONDON: 'LHR',
  'NEW YORK': 'JFK', SINGAPORE: 'SIN', BANGKOK: 'BKK', 'HONG KONG': 'HKG',
  TOKYO: 'NRT', PARIS: 'CDG', FRANKFURT: 'FRA', TORONTO: 'YYZ',
  SYDNEY: 'SYD', ISTANBUL: 'IST', DOHA: 'DOH', 'ABU DHABI': 'AUH',
  'KUALA LUMPUR': 'KUL', COLOMBO: 'CMB', KATHMANDU: 'KTM', MALDIVES: 'MLE',
  'SAN FRANCISCO': 'SFO', 'LOS ANGELES': 'LAX', CHICAGO: 'ORD',
};

/** Map cabin class from our internal format to Ignav's format */
const CABIN_MAP = {
  ECONOMY: 'economy',
  PREMIUM_ECONOMY: 'premium_economy',
  BUSINESS: 'business',
  FIRST: 'first',
};

async function ignavPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'X-Api-Key': env.IGNAV_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.detail || err?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json();
}

async function ignavGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': env.IGNAV_API_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.detail || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

/** Resolve a city name or IATA code to an IATA code. */
async function resolveAirport(query) {
  const raw = String(query || '').trim().toUpperCase();
  if (!raw) return '';
  if (IATA_RE.test(raw)) return raw;

  // Check local map first
  const mapped = CITY_IATA[raw];
  if (mapped) return mapped;

  // Search Ignav's airport endpoint
  try {
    const airports = await ignavGet('/airports', { q: query, limit: 5 });
    const match = airports?.find((a) => a.code);
    if (match?.code) return match.code;
  } catch {
    // Fall through
  }

  // If the user typed something that looks like an IATA code, use it as-is
  if (/^[A-Z]{3}$/i.test(raw)) return raw;
  return '';
}

/** Convert an Ignav itinerary to our normalized flight shape. */
function toFlight(itin, index) {
  const out = itin.outbound || {};
  const segs = out.segments || [];
  const first = segs[0] || {};
  const last = segs[segs.length - 1] || first;

  return {
    id: `ignav-${index}`,
    provider: 'Ignav',
    airline: out.carrier || first.operating_carrier_name || first.marketing_carrier_code || '',
    flightNumber: first.flight_number ? `${first.marketing_carrier_code || ''}${first.flight_number}` : '',
    origin: first.departure_airport || '',
    destination: last.arrival_airport || '',
    departAt: first.departure_time_local || first.departure_time_utc || '',
    arriveAt: last.arrival_time_local || last.arrival_time_utc || '',
    duration: out.duration_minutes ? `${Math.floor(out.duration_minutes / 60)}h ${out.duration_minutes % 60}m` : null,
    stops: segs.length > 1 ? segs.length - 1 : 0,
    price: itin.price ? {
      amount: itin.price.amount,
      currency: itin.price.currency || 'INR',
      status: itin.price.status || 'verified',
      // always per-person since we request with adults=1
      perPerson: true,
    } : null,
    status: 'scheduled',
    isLive: true,
    cabinClass: itin.cabin_class || 'economy',
    bookingUrl: null, // Will be populated via booking-links endpoint
    ignavId: itin.ignav_id || null,
    segments: segs.map((s) => ({
      carrier: s.marketing_carrier_code || '',
      flightNumber: s.flight_number || '',
      airline: s.operating_carrier_name || '',
      from: s.departure_airport || '',
      to: s.arrival_airport || '',
      depart: s.departure_time_local || '',
      arrive: s.arrival_time_local || '',
      duration: s.duration_minutes || null,
      aircraft: s.aircraft || null,
    })),
  };
}

/**
 * Search flights via Ignav (one-way or round-trip).
 * Returns real prices and booking-link IDs.
 */
export async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, travelClass = 'ECONOMY', nonStop = false, maxPrice } = {}) {
  logger.entry('[PROVIDER:ignav]', 'searchFlights', { origin, destination, departDate, returnDate, adults, travelClass });
  const started = Date.now();
  if (!env.IGNAV_API_KEY) {
    return unavailable('ignav-flights', 'Ignav API key not configured. Set IGNAV_API_KEY in backend/.env to enable real flight prices.');
  }

  try {
    const o = await resolveAirport(origin);
    const d = await resolveAirport(destination);
    if (!o || !d) {
      return unavailable('ignav-flights', `Could not resolve airports for "${origin}" → "${destination}". Try IATA codes (e.g. BOM, GOI).`);
    }

    const cabinClass = CABIN_MAP[travelClass] || 'economy';
    const body = { origin: o, destination: d, departure_date: departDate, cabin_class: cabinClass, market: 'IN' };
    if (nonStop) body.max_stops = 0;
    // Always request per-person pricing (adults=1) so the returned price
    // represents a single seat, not the total for the whole party.
    // The frontend/orchestrator multiplies by traveler count when needed.

    let result;
    if (returnDate) {
      result = await ignavPost('/fares/round-trip', { ...body, return_date: returnDate });
    } else {
      result = await ignavPost('/fares/one-way', body);
    }

    const itineraries = result?.itineraries || [];
    if (!itineraries.length) {
      return unavailable('ignav-flights', `No flights found on route ${o} → ${d}${departDate ? ` for ${departDate}` : ''}.`);
    }

    const flights = itineraries.map((itin, i) => toFlight(itin, i));
    // Log price details for debugging
    const priceRange = flights.filter((f) => f.price?.amount).map((f) => f.price.amount);
    logger.info(`[PROVIDER:ignav] Price details: min=${Math.min(...priceRange)} max=${Math.max(...priceRange)} currency=${flights[0]?.price?.currency || 'N/A'} perPerson=${flights[0]?.price?.perPerson} sample=${JSON.stringify(flights[0]?.price)}`);
    const msg = `Real prices from Ignav · ${flights.length} itineraries`;
    logger.provider('ignav', 'searchFlights', { isLive: true, count: flights.length, latencyMs: Date.now() - started, message: msg });
    return live('ignav-flights', flights, msg);
  } catch (err) {
    logger.error(`[PROVIDER:ignav] searchFlights error: ${err.message}`);
    const status = err.status || err.response?.status;
    if (status === 401) {
      return unavailable('ignav-flights', 'Ignav API key is invalid. Check IGNAV_API_KEY in backend/.env.');
    }
    if (status === 429) {
      return unavailable('ignav-flights', 'Ignav monthly quota reached. The free plan allows 1,000 requests/month — wait for reset or upgrade at ignav.com.');
    }
    if (status === 402) {
      return unavailable('ignav-flights', 'Ignav subscription required for this route. Upgrade at ignav.com.');
    }
    return unavailable('ignav-flights', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Get booking links for a specific itinerary by its ignav_id.
 */
export async function getBookingLinks(ignavId) {
  logger.entry('[PROVIDER:ignav]', 'getBookingLinks', { ignavId });
  const started = Date.now();
  if (!env.IGNAV_API_KEY) {
    return unavailable('ignav-flights', 'Ignav API key not configured.');
  }
  if (!ignavId) {
    return unavailable('ignav-flights', 'No itinerary ID provided.');
  }

  try {
    const result = await ignavPost('/fares/booking-links', { ignav_id: ignavId });
    const options = result?.booking_options || [];
    const links = [];
    for (const opt of options) {
      for (const link of opt.links || []) {
        links.push({
          provider: link.provider_name || '',
          type: link.provider_type || 'third_party',
          url: link.url || '',
          fareName: link.fare_name || null,
          price: link.price ? { amount: link.price.amount, currency: link.price.currency } : null,
        });
      }
    }
    logger.provider('ignav', 'getBookingLinks', { isLive: true, linkCount: links.length, latencyMs: Date.now() - started });
    return live('ignav-flights', links, `Booking links for itinerary ${ignavId}`);
  } catch (err) {
    logger.error(`[PROVIDER:ignav] getBookingLinks error: ${err.message}`);
    return unavailable('ignav-flights', `Booking links unavailable: ${err.message}`);
  }
}

export function providerStatus() {
  return {
    configured: Boolean(env.IGNAV_API_KEY),
    endpoint: 'ignav.com',
    message: env.IGNAV_API_KEY
      ? 'Configured — real flight prices and booking links via Ignav'
      : 'Not configured — set IGNAV_API_KEY in backend/.env',
  };
}

export default { searchFlights, getBookingLinks, providerStatus };
