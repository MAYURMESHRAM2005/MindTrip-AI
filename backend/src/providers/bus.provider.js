import env from '../config/env.js';
import { live, unavailable, axiosPost, axiosGet, providerBaseUrl, providerHeaders } from './base.provider.js';

/**
 * Bus provider - connects to a configured legitimate bus API.
 * When BUS_API_URL is not configured we return "Live data unavailable"
 * and never fabricate schedules or prices.
 *
 * - BUS_API_URL       base URL (https:// is added automatically if missing)
 * - BUS_API_ENDPOINT  path of the search endpoint (default: /search)
 * - BUS_API_KEY       x-rapidapi-key for RapidAPI hosts, otherwise Bearer
 */

function searchEndpoint() {
  let p = String(env.BUS_API_ENDPOINT || '/search').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

const LIST_KEYS = ['buses', 'busList', 'buses_list', 'data', 'results'];

/** Extract a buses array from any common response shape (incl. nested { data: { buses: [...] } }). */
function extractBuses(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of LIST_KEYS) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of LIST_KEYS) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  if (Array.isArray(payload)) return payload;
  return null;
}

/** Coerce a fare that may arrive as number, "500" string, or { amount } object. */
function toPrice(raw, currency) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return { amount: raw, currency: currency || 'INR' };
  if (typeof raw === 'string') {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(n) && n > 0) return { amount: n, currency: currency || 'INR' };
    return null;
  }
  if (typeof raw === 'object' && raw.amount !== undefined && raw.amount !== null) return raw;
  return null;
}

function normalizeBus(b, i) {
  if (!b || typeof b !== 'object') return null;
  const g = (...keys) => {
    for (const k of keys) {
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') return b[k];
    }
    return null;
  };
  return {
    id: `${g('busNumber', 'number', 'id') || 'bus'}-${i}`,
    provider: 'configured-bus',
    name: g('busName', 'name', 'operator', 'bus'),
    busNumber: g('busNumber', 'number', 'bus_no'),
    from: g('fromStation', 'from', 'source', 'origin'),
    to: g('toStation', 'to', 'destination', 'dest'),
    departureTime: g('departureTime', 'departure', 'depart', 'startTime'),
    arrivalTime: g('arrivalTime', 'arrival', 'arrive', 'endTime'),
    duration: g('duration', 'travelTime', 'journeyTime'),
    price: toPrice(g('price', 'fare', 'amount', 'ticketPrice'), g('currency')),
    isLive: true,
  };
}

export async function searchBuses({ from, to, date, passengers = 1 }) {
  const base = providerBaseUrl(env.BUS_API_URL);
  if (!base) {
    return unavailable(
      'bus',
      'Bus API provider is not configured. Set BUS_API_URL and BUS_API_KEY in backend/.env to enable live bus schedules.'
    );
  }
  const url = `${base}${searchEndpoint()}`;
  const body = { from, to, date, passengers };
  const headers = providerHeaders(env.BUS_API_URL, env.BUS_API_KEY);
  try {
    let data;
    try {
      data = await axiosPost(url, body, { headers }, 12000);
    } catch (postErr) {
      if (postErr.response?.status !== 404 && postErr.response?.status !== 405) throw postErr;
      data = await axiosGet(url, body, { headers }, 12000);
    }
    const list = extractBuses(data);
    if (!list) {
      const upstream =
        typeof data?.message === 'string'
          ? data.message
          : JSON.stringify(data?.error || data)?.slice(0, 300) || 'unexpected response shape';
      return unavailable('bus', `Bus provider replied: ${upstream}. Check BUS_API_URL / BUS_API_ENDPOINT in backend/.env.`);
    }
    return live('bus', list.map(normalizeBus).filter(Boolean), 'Live bus schedules from configured provider');
  } catch (err) {
    const upstream = err.response?.data?.message || err.response?.data?.error || '';
    return unavailable('bus', `Live data unavailable: ${err.message}${upstream ? ` (${upstream})` : ''}`);
  }
}

export function providerStatus() {
  const base = providerBaseUrl(env.BUS_API_URL);
  return {
    configured: Boolean(base),
    endpoint: `${base}${searchEndpoint()}`,
    message: base ? 'Configured - live schedules available' : 'Not configured - live bus data unavailable',
  };
}

export default { searchBuses, providerStatus };
