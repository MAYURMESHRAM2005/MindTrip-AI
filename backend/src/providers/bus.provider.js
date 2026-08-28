import env from '../config/env.js';
import { live, unavailable, axiosPost, axiosGet, providerBaseUrl, providerHeaders } from './base.provider.js';
import pay2all from './pay2all.provider.js';
import logger from '../utils/logger.js';

if (pay2all.isConfigured()) {
  console.log('[bus] Pay2all provider loaded — live bus data available');
} else {
  console.warn('[bus] Pay2all NOT configured — set PAY2ALL_API_KEY in backend/.env');
}

// ── Search (facade) ────────────────────────────────────────────────────
export async function searchBuses({ from, to, date, passengers = 1 }) {
  logger.entry('[PROVIDER:bus]', 'searchBuses', { from, to, date, passengers });
  const started = Date.now();
  // Normalize date to YYYY-MM-DD (Pay2all requires ISO format)
  let normalizedDate = date;
  if (date && /\d{2}-\d{2}-\d{4}/.test(date)) {
    const [dd, mm, yyyy] = date.split('-');
    normalizedDate = `${yyyy}-${mm}-${dd}`;
  }

  // 1. Try Pay2all first
  if (pay2all.isConfigured()) {
    try {
      const [srcCities, dstCities] = await Promise.all([
        pay2all.searchCities(from),
        pay2all.searchCities(to),
      ]);

      const src = srcCities.cities?.[0];
      const dst = dstCities.cities?.[0];

      if (src && dst) {
        const result = await pay2all.searchTrips({
          sourceId: src.id,
          destinationId: dst.id,
          date: normalizedDate,
        });
        if (result.trips.length > 0) {
          logger.provider('pay2all', 'searchBuses', { isLive: true, count: result.trips.length, latencyMs: Date.now() - started });
          return live('bus', result.trips, `Live bus schedules from Pay2all (${result.trips.length} trips)`);
        }
        // 0 trips — unusual but possible for some route/date combos
      }
    } catch (err) {
      console.error('[bus] Pay2all error:', err.message);
      // Return the error so the frontend and logs can see it
      return {
        success: false,
        isLive: false,
        data: [],
        message: `Pay2all error: ${err.message}`,
        source: 'pay2all',
        providerConfigured: true,
        _debug: { error: err.message, stack: err.stack?.slice(0, 200) },
      };
    }
  }

  // 2. Generic fallback
  const base = providerBaseUrl(env.BUS_API_URL);
  if (!base) {
    return unavailable(
      'bus',
      'No bus provider available. Set PAY2ALL_API_KEY in backend/.env for live Indian bus data.'
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
    const normalized = list.map(normalizeBus).filter(Boolean);
    logger.provider('generic-bus', 'searchBuses', { isLive: true, count: normalized.length, latencyMs: Date.now() - started });
    return live('bus', normalized, 'Live bus schedules from configured provider');
  } catch (err) {
    const upstream = err.response?.data?.message || err.response?.data?.error || '';
    return unavailable('bus', `Live data unavailable: ${err.message}${upstream ? ` (${upstream})` : ''}`);
  }
}

// ── City autocomplete ───────────────────────────────────────────────────
export async function searchCities(query) {
  return pay2all.searchCities(query);
}

// ── Seat layout ─────────────────────────────────────────────────────────
export async function getSeatLayout(tripId) {
  return pay2all.getSeatLayout(tripId);
}

// ── Book ────────────────────────────────────────────────────────────────
export async function bookSeats(params) {
  return pay2all.bookSeats(params);
}

// ── Status ─────────────────────────────────────────────────────────────
export function providerStatus() {
  const pay2allOk = pay2all.isConfigured();
  const base = providerBaseUrl(env.BUS_API_URL);
  return {
    pay2all: pay2allOk ? 'Configured — live Indian bus schedules' : 'Not configured',
    generic: base ? `Configured — ${base}` : 'Not configured',
    configured: pay2allOk || Boolean(base),
    message: pay2allOk
      ? 'Live bus schedules via Pay2all'
      : base
        ? 'Live schedules from configured provider'
        : 'No bus provider configured',
  };
}

// ── Generic helpers ─────────────────────────────────────────────────────
function searchEndpoint() {
  let p = String(env.BUS_API_ENDPOINT || '/search').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

const LIST_KEYS = ['buses', 'busList', 'buses_list', 'data', 'results'];

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

export default { searchBuses, searchCities, getSeatLayout, bookSeats, providerStatus };
