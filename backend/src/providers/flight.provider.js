import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';
import ignavProvider from './ignav.provider.js';
import logger from '../utils/logger.js';

/**
 * Flight provider — Ignav (primary) + AviationStack (fallback).
 *
 * Ignav provides real flight PRICES and BOOKING LINKS (free tier: 1,000 req/month).
 * AviationStack provides real-time tracking without prices (free tier: 100 req/month).
 *
 * Strategy: Try Ignav first for real prices → fall back to AviationStack for live data.
 * Never fabricate prices or schedules.
 */

const AVIATIONSTACK_URL = 'https://api.aviationstack.com/v1';
const IATA_RE = /^[A-Z]{3}$/;

const CITY_IATA = {
  NAGPUR: 'NAG', MUMBAI: 'BOM', DELHI: 'DEL', 'NEW DELHI': 'DEL',
  PUNE: 'PNQ', GOA: 'GOI', BENGALURU: 'BLR', BANGALORE: 'BLR',
  CHENNAI: 'MAA', MADRAS: 'MAA', KOLKATA: 'CCU', CALCUTTA: 'CCU',
  HYDERABAD: 'HYD', JAIPUR: 'JAI', AHMEDABAD: 'AMD', KOCHI: 'COK',
  KOZHIKODE: 'CCJ', CALICUT: 'CCJ', TRIVANDRUM: 'TRV', THIRUVANANTHAPURAM: 'TRV',
  AMRITSAR: 'ATQ', LUCKNOW: 'LKO', VARANASI: 'VNS', PATNA: 'PAT',
  RANCHI: 'IXR', BHUBANESWAR: 'BBI', GUWAHATI: 'GAU', SURAT: 'STV',
  INDORE: 'IDR', BHOPAL: 'BHO', RAIPUR: 'RPR', UDAIPUR: 'UDR',
  DUBAI: 'DXB', LONDON: 'LHR', 'NEW YORK': 'JFK', SINGAPORE: 'SIN',
  BANGKOK: 'BKK', 'HONG KONG': 'HKG', TOKYO: 'NRT', PARIS: 'CDG',
  FRANKFURT: 'FRA', TORONTO: 'YYZ', SYDNEY: 'SYD', MELBOURNE: 'MEL',
  ISTANBUL: 'IST', DOHA: 'DOH', 'ABU DHABI': 'AUH', 'KUALA LUMPUR': 'KUL',
  COLOMBO: 'CMB', KATHMANDU: 'KTM', MALDIVES: 'MLE',
  'SAN FRANCISCO': 'SFO', 'LOS ANGELES': 'LAX', CHICAGO: 'ORD',
};

async function aviationstackGet(path, params) {
  const qs = new URLSearchParams({ access_key: env.AVIATIONSTACK_API_KEY, ...params });
  return axiosGet(`${AVIATIONSTACK_URL}${path}?${qs}`, {}, {}, 12000);
}

async function lookupByCode(code) {
  try {
    const data = await aviationstackGet('/airports', { iata_code: code, limit: 1 });
    const a = data?.data?.[0];
    if (a?.iata_code) return { iata: a.iata_code, name: a.airport_name || a.city_name || code };
  } catch { /* */ }
  return { iata: code, name: code };
}

async function resolveAirport(query, cache) {
  const raw = String(query || '').trim();
  if (!raw) return { iata: '', name: '' };
  const key = raw.toUpperCase();
  if (cache[key]) return cache[key];

  if (IATA_RE.test(key)) {
    const res = await lookupByCode(key);
    cache[key] = res;
    return res;
  }
  const mapped = CITY_IATA[key];
  if (mapped) {
    const res = await lookupByCode(mapped);
    if (res.iata) { cache[key] = res; return res; }
  }
  try {
    const data = await aviationstackGet('/airports', { search: raw, limit: 5 });
    const match = (data?.data || []).find((a) => a.iata_code) || data?.data?.[0];
    if (match?.iata_code) {
      const res = { iata: match.iata_code, name: match.airport_name || match.city_name || raw };
      cache[key] = res;
      return res;
    }
  } catch { /* */ }
  throw new Error(`Could not resolve an airport for "${raw}". Try an IATA code (e.g. BOM) or a known city.`);
}

function aviationstackToFlight(f, index, source) {
  const dep = f?.departure || {};
  const arr = f?.arrival || {};
  const flight = f?.flight || {};
  const airline = f?.airline || {};
  const code = `${flight.iata || ''}${flight.number || ''}`.trim();
  return {
    id: `${code || 'flight'}-${index}`,
    provider: 'AviationStack',
    airline: airline.name || flight.iata || '',
    flightNumber: flight.number || code,
    origin: dep.iata || '',
    destination: arr.iata || '',
    departAt: dep.scheduled || dep.estimated || '',
    arriveAt: arr.scheduled || arr.estimated || '',
    stops: typeof flight.connections === 'number' ? flight.connections : (Array.isArray(f?.connection) ? f.connection.length : 0),
    duration: null,
    price: null,
    status: f.flight_status || (source === 'schedules' ? 'scheduled' : 'active'),
    isLive: true,
    bookingUrl: 'https://www.google.com/travel/flights',
  };
}

/**
 * Search flights — Ignav first (real prices), AviationStack fallback (live tracking).
 */
export async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, travelClass = 'ECONOMY', nonStop = false, maxPrice } = {}) {
  logger.entry('[PROVIDER:flight]', 'searchFlights', { origin, destination, departDate, returnDate, adults, travelClass });
  const started = Date.now();
  // 1. Try Ignav first (real prices + booking links)
  if (env.IGNAV_API_KEY) {
    logger.info('[PROVIDER:flight] Trying Ignav provider first...');
    const ignavResult = await ignavProvider.searchFlights({ origin, destination, departDate, returnDate, adults, travelClass, nonStop, maxPrice });
    if (ignavResult.isLive) {
      logger.provider('ignav', 'searchFlights', { isLive: true, count: ignavResult.data?.length || 0, latencyMs: Date.now() - started, message: ignavResult.message });
      return ignavResult;
    }
    logger.warn(`[PROVIDER:flight] Ignav failed: ${ignavResult.message}, falling through to AviationStack`);
  }

  // 2. Fallback: AviationStack (no prices, but real-time tracking)
  if (!env.AVIATIONSTACK_API_KEY) {
    return unavailable(
      'flight-providers',
      'No flight API configured. Set IGNAV_API_KEY (real prices) or AVIATIONSTACK_API_KEY (live tracking) in backend/.env.'
    );
  }

  try {
    const cache = {};
    const [o, d] = await Promise.all([resolveAirport(origin, cache), resolveAirport(destination, cache)]);
    if (!o.iata || !d.iata) {
      return unavailable('aviationstack-flights', `Could not resolve airports for "${origin}" → "${destination}".`);
    }

    let flights = null;
    let mode = '';
    try {
      const sched = await aviationstackGet('/schedules', {
        dep_iata: o.iata, arr_iata: d.iata,
        ...(departDate ? { flight_date: departDate } : {}),
        limit: 20,
      });
      if (Array.isArray(sched?.data) && sched.data.length) {
        flights = sched.data.map((f, i) => aviationstackToFlight(f, i, 'schedules'));
        mode = 'schedules';
      }
    } catch { /* fall through */ }

    if (!flights) {
      const rt = await aviationstackGet('/flights', { dep_iata: o.iata, arr_iata: d.iata, limit: 20 });
      if (Array.isArray(rt?.data) && rt.data.length) {
        flights = rt.data.map((f, i) => aviationstackToFlight(f, i, 'live'));
        mode = 'live';
      }
    }

    if (!flights) {
      logger.warn(`[PROVIDER:flight] No flights found on route ${o.name} → ${d.name}`);
      return unavailable(
        'aviationstack-flights',
        `No flights found on route ${o.name} → ${d.name}${departDate ? ` for ${departDate}` : ''}.`
      );
    }

    let message = `Live flight data from AviationStack (${mode === 'schedules' ? 'date schedules' : 'real-time route tracking'})`;
    if (returnDate) message += ' · Round-trip not supported on AviationStack free plan — outbound shown.';
    message += ' · Prices not available — use Ignav for real fares.';
    logger.provider('aviationstack', 'searchFlights', { isLive: true, count: flights.length, latencyMs: Date.now() - started, message });
    return live('aviationstack-flights', flights, message);
  } catch (err) {
    const status = err.response?.status;
    const apiErr = err.response?.data?.error?.message || err.response?.data?.error || '';
    if (status === 429 || /usage limit|quota|upgrade/i.test(`${apiErr} ${err.message}`)) {
      return unavailable('aviationstack-flights', 'AviationStack monthly quota reached. Wait for reset or upgrade at aviationstack.com.');
    }
    if (status === 401) {
      return unavailable('aviationstack-flights', 'AviationStack API key is invalid. Check AVIATIONSTACK_API_KEY in backend/.env.');
    }
    return unavailable('aviationstack-flights', `Live data unavailable: ${err.message}${apiErr ? ` (${apiErr})` : ''}`);
  }
}

export function providerStatus() {
  const ignavOk = Boolean(env.IGNAV_API_KEY);
  const aviationOk = Boolean(env.AVIATIONSTACK_API_KEY);
  return {
    configured: ignavOk || aviationOk,
    providers: {
      ignav: { configured: ignavOk, endpoint: 'ignav.com', message: ignavOk ? 'Real prices + booking links' : 'Not configured' },
      aviationstack: { configured: aviationOk, endpoint: 'api.aviationstack.com', message: aviationOk ? 'Live tracking (no prices)' : 'Not configured' },
    },
    message: ignavOk
      ? 'Ignav configured — real flight prices available'
      : aviationOk
        ? 'AviationStack configured — live tracking only (no prices). Set IGNAV_API_KEY for real fares.'
        : 'No flight API configured. Set IGNAV_API_KEY or AVIATIONSTACK_API_KEY in backend/.env.',
  };
}

/**
 * Search airports by name/city using AviationStack.
 * Used by the Transport Intelligence service to find nearby airports.
 */
export async function searchAirports(query, { limit = 10 } = {}) {
  if (!env.AVIATIONSTACK_API_KEY || !query) return [];
  try {
    const data = await aviationstackGet('/airports', { search: query, limit });
    return (data?.data || []).filter((a) => a.iata_code).map((a) => ({
      iata_code: a.iata_code,
      airport_name: a.airport_name || '',
      city_name: a.city_name || '',
      country_name: a.country_name || '',
      latitude: a.latitude != null ? Number(a.latitude) : null,
      longitude: a.longitude != null ? Number(a.longitude) : null,
    }));
  } catch {
    return [];
  }
}

export default { searchFlights, searchAirports, providerStatus };
