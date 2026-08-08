import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';

/**
 * Flight provider — AviationStack (https://aviationstack.com).
 *
 * Free tier: real-time flights + airport lookup (100 req/month).
 * The date-based /schedules endpoint requires a paid plan; when it is not
 * available we fall back to real-time flights currently on the route so the
 * app still returns REAL live data instead of fabricating anything.
 *
 * AviationStack does not provide prices — the UI shows "Price on request"
 * with external booking links. Never invent fares or schedules.
 */

const BASE_URL = 'https://api.aviationstack.com/v1';
const IATA_RE = /^[A-Z]{3}$/;

/**
 * AviationStack's FREE plan restricts the /airports `search` function
 * (HTTP 403 function_access_restricted), while iata_code / city_iata_code
 * lookups are allowed. Resolve common city names locally (no API cost) and
 * only fall back to `search` as a last resort.
 */
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

async function apiGet(path, params) {
  const qs = new URLSearchParams({ access_key: env.AVIATIONSTACK_API_KEY, ...params });
  return axiosGet(`${BASE_URL}${path}?${qs}`, {}, {}, 12000);
}

/** Look up a code's display name via the free-plan-safe iata_code endpoint. */
async function lookupByCode(code) {
  try {
    const data = await apiGet('/airports', { iata_code: code, limit: 1 });
    const a = data?.data?.[0];
    if (a?.iata_code) return { iata: a.iata_code, name: a.airport_name || a.city_name || code };
  } catch {
    /* never fail — the code itself is usable */
  }
  return { iata: code, name: code };
}

/** Accept a 3-letter IATA code, or resolve a city/airport name to its code. */
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
    if (res.iata) {
      cache[key] = res;
      return res;
    }
  }

  // Last resort: the name-search function is restricted on the free plan —
  // try it once, and give a clear message if the plan blocks it.
  try {
    const data = await apiGet('/airports', { search: raw, limit: 5 });
    const match = (data?.data || []).find((a) => a.iata_code) || data?.data?.[0];
    if (match?.iata_code) {
      const res = { iata: match.iata_code, name: match.airport_name || match.city_name || raw };
      cache[key] = res;
      return res;
    }
  } catch {
    /* fall through to the friendly error */
  }
  throw new Error(
    `Could not resolve an airport for "${raw}". Try an IATA code (e.g. BOM) or a known city (e.g. ${Object.keys(CITY_IATA)
      .slice(0, 5)
      .join(', ')}, …).`
  );
}

function toFlight(f, index, source) {
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
    // Schedules feed exposes the connection count as flight.connections (a number);
    // real-time feed entries fly this exact leg, so 0 is accurate there too.
    stops: typeof flight.connections === 'number' ? flight.connections : (Array.isArray(f?.connection) ? f.connection.length : 0),
    duration: null,
    price: null, // AviationStack has no fares — never invent them
    status: f.flight_status || (source === 'schedules' ? 'scheduled' : 'active'),
    isLive: true,
    bookingUrl: 'https://www.google.com/travel/flights',
  };
}

/**
 * Search flights between two airports (IATA codes or city names).
 */
export async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, travelClass = 'ECONOMY', nonStop = false, maxPrice } = {}) {
  if (!env.AVIATIONSTACK_API_KEY) {
    return unavailable(
      'aviationstack-flights',
      'AviationStack API key not configured. Set AVIATIONSTACK_API_KEY in backend/.env to enable live flight data.'
    );
  }
  try {
    const cache = {};
    const [o, d] = await Promise.all([resolveAirport(origin, cache), resolveAirport(destination, cache)]);
    if (!o.iata || !d.iata) {
      return unavailable('aviationstack-flights', `Could not resolve airports for "${origin}" → "${destination}".`);
    }

    // 1. Date-based schedules (paid plan — real schedules for the chosen date).
    // On the free plan the /schedules endpoint returns an error body without a
    // `data` array (not an HTTP failure), so the Array.isArray check below is
    // what triggers the real-time fallback.
    let flights = null;
    let mode = '';
    try {
      const sched = await apiGet('/schedules', {
        dep_iata: o.iata,
        arr_iata: d.iata,
        ...(departDate ? { flight_date: departDate } : {}),
        limit: 20,
      });
      if (Array.isArray(sched?.data) && sched.data.length) {
        flights = sched.data.map((f, i) => toFlight(f, i, 'schedules'));
        mode = 'schedules';
      }
    } catch {
      // Network failure — fall through to real-time.
    }

    // 2. Fallback: real-time flights currently flying this route (free tier).
    // Also used when the chosen date has no scheduled flights but the route is live.
    if (!flights) {
      const rt = await apiGet('/flights', { dep_iata: o.iata, arr_iata: d.iata, limit: 20 });
      if (Array.isArray(rt?.data) && rt.data.length) {
        flights = rt.data.map((f, i) => toFlight(f, i, 'live'));
        mode = 'live';
      }
    }

    if (!flights) {
      return unavailable(
        'aviationstack-flights',
        `No flights found on route ${o.name} → ${d.name}${departDate ? ` for ${departDate}` : ''}. On the free plan, date schedules require AviationStack's paid plan.`
      );
    }

    let message = `Live flight data from AviationStack (${mode === 'schedules' ? 'date schedules' : 'real-time route tracking'})`;
    if (returnDate) {
      message += ' · Round-trip not supported on the free plan — outbound shown.';
    }
    return live('aviationstack-flights', flights, message);
  } catch (err) {
    const status = err.response?.status;
    const apiErr = err.response?.data?.error?.message || err.response?.data?.error || '';
    // 429 = free-tier monthly quota (100 req/month) exhausted — the key itself is fine.
    if (status === 429 || /usage limit|quota|upgrade your subscription/i.test(`${apiErr} ${err.message}`)) {
      return unavailable(
        'aviationstack-flights',
        'AviationStack monthly quota reached. The API key is configured correctly, but the free plan allows only 100 requests/month — upgrade the plan at aviationstack.com or wait for the monthly reset.'
      );
    }
    if (status === 401) {
      return unavailable(
        'aviationstack-flights',
        'AviationStack API key is invalid or expired. Check AVIATIONSTACK_API_KEY in backend/.env.'
      );
    }
    return unavailable(
      'aviationstack-flights',
      `Live data unavailable: ${err.message}${apiErr ? ` (${apiErr})` : ''}`
    );
  }
}

export function providerStatus() {
  return {
    configured: Boolean(env.AVIATIONSTACK_API_KEY),
    endpoint: 'api.aviationstack.com',
    message: env.AVIATIONSTACK_API_KEY
      ? 'Configured - live flight data available'
      : 'Not configured - set AVIATIONSTACK_API_KEY in backend/.env',
  };
}

export default { searchFlights, providerStatus };
