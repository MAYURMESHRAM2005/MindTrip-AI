import env from '../config/env.js';
import { live, unavailable, axiosPost, axiosGet, providerBaseUrl, providerHeaders } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Train provider - connects to a configured legitimate train API
 * (e.g. an IRCTC RapidAPI subscription, RailYatri B2B, or any compliant
 * provider). When TRAIN_API_URL is not configured we return
 * "Live data unavailable" and never fabricate schedules or prices.
 *
 * - TRAIN_API_URL       base URL (https:// is added automatically if missing)
 * - TRAIN_API_ENDPOINT  path of the search endpoint (default: /search)
 * - TRAIN_API_KEY       used as x-rapidapi-key for RapidAPI hosts,
 *                       otherwise sent as a Bearer token
 *
 * The IRCTC RapidAPI family (irctc1.p.rapidapi.com etc.) is auto-detected:
 * it uses GET with fromStationCode/toStationCode/dateOfJourney params and
 * exposes /api/v1/searchStation to resolve city names -> station codes.
 */

function searchEndpoint() {
  let p = String(env.TRAIN_API_ENDPOINT || '/search').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function isIrctcApi() {
  const host = providerBaseUrl(env.TRAIN_API_URL).replace(/^https?:\/\//i, '');
  const ep = searchEndpoint();
  return /irctc/i.test(host) || /trainBetweenStations|train_between|trainsbetween/i.test(ep);
}

/** Common Indian city -> station code map (fast path, zero API calls). */
const STATION_MAP = {
  nagpur: 'NGP', mumbai: 'CSTM', bombay: 'CSTM', delhi: 'NDLS', newdelhi: 'NDLS',
  bengaluru: 'SBC', bangalore: 'SBC', chennai: 'MAS', madras: 'MAS', kolkata: 'HWH',
  calcutta: 'HWH', hyderabad: 'HYB', pune: 'PUNE', ahmedabad: 'ADI', jaipur: 'JP',
  lucknow: 'LKO', goa: 'MAO', indore: 'INDB', bhopal: 'BPL', surat: 'ST',
  varanasi: 'BSB', patna: 'PNBE', agra: 'AGC', kanpur: 'CNB', coimbatore: 'CBE',
  kochi: 'ERS', kerala: 'ERS', thiruvananthapuram: 'TVC', trivandrum: 'TVC',
  guwahati: 'GHY', amritsar: 'ASR', chandigarh: 'CDG', jammu: 'JAT',
  srinagar: 'SINA', mysuru: 'MYS', mysore: 'MYS', mangaluru: 'MAQ', udupi: 'UD',
  vijayawada: 'BZA', visakhapatnam: 'VSKP', raipur: 'R', jabalpur: 'JBP',
  allahabad: 'PRYJ', prayagraj: 'PRYJ', nashik: 'NK', aurangabad: 'AWB',
  solapur: 'SUR', kolhapur: 'KOP', amravati: 'AMI', wardha: 'WR', gwalior: 'GWL',
  kochin: 'ERS', madurai: 'MDU', tiruchirappalli: 'TPJ', trichy: 'TPJ',
  ranchi: 'RNC', jamshedpur: 'TATA', bhuvaneshwar: 'BBS', bhubaneswar: 'BBS',
  cuttack: 'CTC', siliguri: 'SGUJ', dehradun: 'DDN', haridwar: 'HW',  rishikesh: 'RKSH',
  jodhpur: 'JU', udaipur: 'UDZ', bikaner: 'BKN', ajmer: 'AII', kota: 'KOTA',
  gandhinagar: 'GNC', vadodara: 'BRC', baroda: 'BRC', rajkot: 'RJT', jamnagar: 'JAM',
  bhavnagar: 'BVC', ujjain: 'UJN', dhule: 'DHL',
  sangli: 'SLI', miraj: 'MRJ', belgaum: 'BGM', hubli: 'UBL', davangere: 'DVG',
  shimoga: 'SMET', hospet: 'HPT', bellary: 'BAY', guntur: 'GNT', nellore: 'NLR',
  tirupati: 'TPTY', rajmundry: 'RJY', eluru: 'EE', ongole: 'OGL',
  kadapa: 'HX', anantapur: 'ATP', kurnool: 'KRNT', warangal: 'WL', nizamabad: 'NZB',
  karimnagar: 'KRMR', bidar: 'BIDR', gulbarga: 'GR', kalaburagi: 'KLBG',
  akola: 'AK', buldhana: 'BDL', yeotmal: 'YTL', parbhani: 'PBN', nanded: 'NED',
  latur: 'LUR', osmanabad: 'OMB', beed: 'BID', jalna: 'J', jalgaon: 'JL',
  bhusawal: 'BSL', malegaon: 'MGN', ahmednagar: 'ANG', shirdi: 'SNSI', srirampur: 'SRP',
  kopargaon: 'KPG', manmad: 'MMR', igatpuri: 'IGP', kalyan: 'KYN', thane: 'TNA',
  dombivli: 'DI', panvel: 'PNVL', roha: 'ROHA', ratnagiri: 'RN', sindhudurg: 'SWV',
  kudal: 'KUDL', sawantwadi: 'SWV', chinchwad: 'CCH', lonavala: 'LNL',
  karjat: 'KJT', khandala: 'KAD', panipat: 'PNP', karnal: 'KUN', ambala: 'UMB',
  ludhiana: 'LDH', jalandhar: 'JUC', pathankot: 'PTK', firozpur: 'FZR', bhatinda: 'BTI',
  hisar: 'HSR', rohtak: 'ROK', gurugram: 'GGN', gurgaon: 'GGN', faridabad: 'FDB',
  noida: 'NDLS', ghaziabad: 'GZB', meerut: 'MTC', moradabad: 'MB', bareilly: 'BE',
  shahjahanpur: 'SPN', sitapur: 'STP', gorakhpur: 'GKP', darbhanga: 'DBG', muzaffarpur: 'MFP',
  bhagalpur: 'BGP', gaya: 'GAYA', dhanbad: 'DHN', bokaro: 'BKSC', asansol: 'ASN',
  durgapur: 'DGR', barddhaman: 'BWN', howrah: 'HWH', sealdah: 'SDAH', shalimar: 'SHM',
  kharagpur: 'KGP', balasore: 'BLS', sambalpur: 'SBP', rourkela: 'ROU', bilaspur: 'BSP',
  korba: 'KRBA', durg: 'DURG', bhilai: 'BIA', gondia: 'G',
  chhindwara: 'CWA', seoni: 'SEI', betul: 'BZU', itarsi: 'ET',
  hosangabad: 'HBD', khargone: 'KGN', dhar: 'DHR', ratlam: 'RTM',
  neemuch: 'NMH', mandsaur: 'MDS', shajapur: 'SFY', sagar: 'SGO',
  damoh: 'DMO', katni: 'KTE', rewa: 'REWA', sidhi: 'SID',
  shahdol: 'SDL', umaria: 'UDR', dindori: 'DIN', mandla: 'MNL', narsinghpur: 'NU',
  sehore: 'SEH', raisen: 'RIS', chhatarpur: 'CJ', tikamgarh: 'TKMG',
  datia: 'DAA', morena: 'MRA', bhind: 'BIX', shivpuri: 'SVPI',
  ashoknagar: 'ASKN', barwani: 'BWN', burhanpur: 'BAU',
};

/** Normalize a city/station name for map lookups. */
function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '').trim();
}

/**
 * Resolve a city name (e.g. "Nagpur", "Mumbai CST") to an IRCTC station code.
 * Fast path: local map. Slow path: live /api/v1/searchStation on the provider
 * (result cached so it only costs one API call per station).
 */
async function resolveStationCode(name) {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  if (STATION_MAP[n]) return STATION_MAP[n];
  const cachedCode = cached(`station:${n}`);
  if (cachedCode) return cachedCode;
  // Live lookup via the provider's own station search endpoint (free on RapidAPI)
  try {
    const base = providerBaseUrl(env.TRAIN_API_URL);
    const headers = providerHeaders(env.TRAIN_API_URL, env.TRAIN_API_KEY);
    const data = await axiosGet(`${base}/api/v1/searchStation`, { query: name.trim() }, { headers }, 8000);
    const list = data?.data || data?.stations || data?.results;
    if (Array.isArray(list) && list.length) {
      const exact = list.find((s) => norm(s.name) === n || norm(s.code) === n);
      const pick = exact || list[0];
      const code = pick?.code || pick?.station_code || null;
      if (code) cacheSet(`station:${n}`, code);
      return code;
    }
  } catch {
    /* fall through - caller reports the friendly message */
  }
  return null;
}

/**
 * Format a date for the IRCTC dateOfJourney param.
 * The API accepts YYYYMMDD or YYYY-MM-DD (NOT DD-MM-YYYY).
 */
function irctcDate(date) {
  if (!date) return '';
  const s = String(date).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO -> keep as-is
  if (m) return s;
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/); // YYYYMMDD -> keep as-is
  if (m2) return s;
  const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})/); // DD-MM-YYYY -> ISO
  if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
  const m4 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // DD/MM/YYYY -> ISO
  if (m4) return `${m4[3]}-${m4[2]}-${m4[1]}`;
  return '';
}

/**
 * Tiny in-memory cache so repeated identical searches cost 1 API call
 * instead of burning the (often tiny) RapidAPI free quota on every request.
 */
const cache = new Map();
// Train schedules for a fixed date don't change - cache a full day so each
// unique search costs exactly ONE API call (free RapidAPI tiers are tiny).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function cached(key, ttlMs = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return null;
}
function cacheSet(key, value) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

const LIST_KEYS = ['trains', 'trainBetweenStations', 'trainsBetweenStations', 'trains_list', 'trainList', 'data', 'results'];

/** Extract a trains array from any of the common response shapes (incl. nested { data: { trains: [...] } }). */
function extractTrains(payload) {
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

/** Map a provider train row to the fields the app's train card expects. */
function normalizeTrain(t, i) {
  if (!t || typeof t !== 'object') return null;
  const g = (...keys) => {
    for (const k of keys) {
      if (t[k] !== undefined && t[k] !== null && t[k] !== '') return t[k];
    }
    return null;
  };
  const number = g('trainNumber', 'train_number', 'number', 'train_num', 'trainNo');
  const name = g('trainName', 'train_name', 'name', 'train');
  let arrival = g('arrivalTime', 'arrival', 'arrive', 'endTime', 'toTime', 'to_std', 'to_sta');
  // Mark next-day arrivals (IRCTC to_day) so users aren't surprised
  if (Number(g('to_day', 'arrivalDay')) > 0 && arrival && !String(arrival).includes('+')) {
    arrival = `${arrival} (+1)`;
  }
  return {
    id: `${number || 'train'}-${i}`,
    provider: 'configured-train',
    name,
    trainName: name,
    number,
    trainNumber: number,
    from: g('fromStation', 'from', 'source', 'originStation', 'train_src', 'fromStationCode'),
    to: g('toStation', 'to', 'destination', 'destStation', 'train_dstn', 'toStationCode'),
    fromName: g('fromStationName', 'from_station_name'),
    toName: g('toStationName', 'to_station_name'),
    departureTime: g('departureTime', 'departure', 'depart', 'startTime', 'fromTime', 'from_std', 'from_sta'),
    arrivalTime: arrival,
    duration: g('duration', 'travelTime', 'journeyTime'),
    classes: g('class_type', 'classes'),
    price: toPrice(g('price', 'fare', 'amount', 'ticketPrice'), g('currency')),
    isLive: true,
  };
}

/**
 * Search trains between two places.
 * Accepts city names OR station codes (NGP, CSTM) - IRCTC codes resolve live.
 */
export async function searchTrains({ from, to, date, passengers = 1, trainClass }) {
  logger.entry('[PROVIDER:train]', 'searchTrains', { from, to, date, passengers, trainClass });
  const started = Date.now();
  const base = providerBaseUrl(env.TRAIN_API_URL);
  if (!base) {
    return unavailable(
      'train',
      'Train API provider is not configured. Set TRAIN_API_URL and TRAIN_API_KEY in backend/.env to enable live train schedules.'
    );
  }
  const headers = providerHeaders(env.TRAIN_API_URL, env.TRAIN_API_KEY);
  const url = `${base}${searchEndpoint()}`;

  try {
    // --- IRCTC RapidAPI family: GET with station codes + dateOfJourney ---
    if (isIrctcApi()) {
      const [fromCode, toCode] = await Promise.all([resolveStationCode(from), resolveStationCode(to)]);
      if (!fromCode || !toCode) {
        return unavailable(
          'train',
          `Could not resolve station code for "${fromCode ? to : from}". The IRCTC API needs station codes (e.g. NGP, CSTM) - try typing the station code directly.`
        );
      }
      const params = { fromStationCode: fromCode, toStationCode: toCode, dateOfJourney: irctcDate(date) };
      const cacheKey = `irctc:${fromCode}:${toCode}:${params.dateOfJourney}`;
      const hit = cached(cacheKey);
      if (hit) return hit;
      const data = await axiosGet(url, params, { headers }, 12000);
      const list = extractTrains(data);
      if (!list) {
        const upstream = typeof data?.message === 'string' ? data.message : JSON.stringify(data?.error || data)?.slice(0, 300);
        return unavailable('train', `Train provider replied: ${upstream || 'no train data returned'}.`);
      }
      const normalized = list.map(normalizeTrain).filter(Boolean);
      logger.provider('irctc-train', 'searchTrains', { isLive: true, count: normalized.length, latencyMs: Date.now() - started });
      const result = live('train', normalized, 'Live train schedules from configured provider');
      cacheSet(cacheKey, result);
      return result;
    }

    // --- Generic provider contract: POST {from,to,date,passengers}, GET fallback ---
    const body = { from, to, date, passengers, trainClass: trainClass || '' };
    let data;
    try {
      data = await axiosPost(url, body, { headers }, 12000);
    } catch (postErr) {
      if (postErr.response?.status !== 404 && postErr.response?.status !== 405) throw postErr;
      data = await axiosGet(url, body, { headers }, 12000);
    }
    const list = extractTrains(data);
    if (!list) {
      const upstream =
        typeof data?.message === 'string'
          ? data.message
          : JSON.stringify(data?.error || data)?.slice(0, 300) || 'unexpected response shape';
      return unavailable(
        'train',
        `Train provider replied: ${upstream}. If this is a RapidAPI host, open the API on rapidapi.com → Endpoints and set TRAIN_API_ENDPOINT to the exact search path (e.g. /api/v2/getTrainBetweenStations).`
      );
    }
    const normalized = list.map(normalizeTrain).filter(Boolean);
    logger.provider('generic-train', 'searchTrains', { isLive: true, count: normalized.length, latencyMs: Date.now() - started });
    return live('train', normalized, 'Live train schedules from configured provider');
  } catch (err) {
    if (err.response?.status === 429) {
      return unavailable(
        'train',
        'Train API free-tier quota exhausted (this RapidAPI plan allows ~10 requests/month). Search results are cached for 24h - retry after the monthly reset or upgrade the RapidAPI plan for a larger quota.'
      );
    }
    const upstream = err.response?.data?.message || err.response?.data?.error || '';
    return unavailable('train', `Live data unavailable: ${err.message}${upstream ? ` (${upstream})` : ''}`);
  }
}

export function providerStatus() {
  const base = providerBaseUrl(env.TRAIN_API_URL);
  return {
    configured: Boolean(base),
    endpoint: `${base}${searchEndpoint()}`,
    message: base ? 'Configured - live schedules available' : 'Not configured - live train data unavailable',
  };
}

export default { searchTrains, providerStatus };
