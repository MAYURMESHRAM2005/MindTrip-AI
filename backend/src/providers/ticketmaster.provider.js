import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Ticketmaster Discovery API provider.
 * Finds real cultural events, concerts, festivals, and local happenings
 * happening during a trip's dates.
 *
 * The Discovery API is FREE with generous rate limits (5 calls/sec, 1000/day).
 * No affiliate/partner approval needed — just an API key.
 *
 * Env vars:
 *   TICKETMASTER_API_KEY — Ticketmaster API key (get at developer.ticketmaster.com)
 *
 * Key endpoints:
 *   GET /discovery/v2/events.json — search events by keyword, location, date
 *   GET /discovery/v2/venues.json — search venues by keyword
 */

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

function apiKey() {
  return env.TICKETMASTER_API_KEY;
}

/**
 * Search for events in a destination during specific dates.
 *
 * @param {object} opts
 * @param {string} opts.destination — City or area name (e.g., "Paris", "Goa")
 * @param {string} opts.keyword — Optional keyword filter (e.g., "music", "festival")
 * @param {string} opts.startDate — ISO date string (e.g., "2026-09-01")
 * @param {string} opts.endDate — ISO date string (e.g., "2026-09-05")
 * @param {number} opts.lat — Optional latitude for location bias
 * @param {number} opts.lng — Optional longitude for location bias
 * @param {number} opts.radius — Search radius in km (default 50)
 * @param {number} opts.limit — Max results (default 20, max 200)
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchEvents({
  destination,
  keyword,
  startDate,
  endDate,
  lat,
  lng,
  radius = 50,
  limit = 20,
}) {
  logger.entry('[PROVIDER:ticketmaster]', 'searchEvents', { destination, keyword, startDate, endDate, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('ticketmaster', 'Ticketmaster API key not configured');
  }

  try {
    const params = {
      apikey: apiKey(),
      size: Math.min(Number(limit) || 20, 200).toString(),
      sort: 'date,asc',
      classificationName: 'music,arts,theatre,festival,conference', // broad categories
    };

    // Location: prefer lat/lng, fallback to city keyword
    if (lat != null && lng != null) {
      params.latlong = `${lat},${lng}`;
      params.radius = String(radius);
      params.unit = 'km';
    } else if (destination) {
      params.city = destination;
    }

    // Date range filter
    if (startDate) {
      params.startDateTime = `${startDate}T00:00:00Z`;
    }
    if (endDate) {
      // Add 1 day to endDate to include events on the last day
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      params.endDateTime = end.toISOString().slice(0, 10) + 'T00:00:00Z';
    }

    // Keyword filter
    if (keyword) {
      params.keyword = keyword;
    }

    const data = await axiosGet(
      `${BASE_URL}/events.json`,
      params,
      12000
    );

    const events = (data._embedded?.events || []).map(mapEvent).filter(Boolean);

    logger.provider('ticketmaster', 'searchEvents', {
      isLive: true,
      count: events.length,
      totalElements: data.page?.totalElements || 0,
      latencyMs: Date.now() - started,
    });

    return live('ticketmaster', events, `Live events from Ticketmaster (${events.length} events)`);
  } catch (err) {
    logger.error(`[PROVIDER:ticketmaster] searchEvents error: ${err.message}`);
    return unavailable('ticketmaster', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Search for events near specific coordinates.
 *
 * @param {object} opts
 * @param {number} opts.lat — Latitude
 * @param {number} opts.lng — Longitude
 * @param {string} opts.startDate — ISO date string
 * @param {string} opts.endDate — ISO date string
 * @param {number} opts.radius — Search radius in km (default 25)
 * @param {number} opts.limit — Max results (default 15)
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchNearby({ lat, lng, startDate, endDate, radius = 25, limit = 15 }) {
  logger.entry('[PROVIDER:ticketmaster]', 'searchNearby', { lat, lng, startDate, endDate, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('ticketmaster', 'Ticketmaster API key not configured');
  }

  try {
    const params = {
      apikey: apiKey(),
      latlong: `${lat},${lng}`,
      radius: String(radius),
      unit: 'km',
      size: Math.min(Number(limit) || 15, 200).toString(),
      sort: 'date,asc',
      classificationName: 'music,arts,theatre,festival',
    };

    if (startDate) params.startDateTime = `${startDate}T00:00:00Z`;
    if (endDate) {
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      params.endDateTime = end.toISOString().slice(0, 10) + 'T00:00:00Z';
    }

    const data = await axiosGet(
      `${BASE_URL}/events.json`,
      params,
      12000
    );

    const events = (data._embedded?.events || []).map(mapEvent).filter(Boolean);

    logger.provider('ticketmaster', 'searchNearby', {
      isLive: true,
      count: events.length,
      latencyMs: Date.now() - started,
    });

    return live('ticketmaster', events, `Live nearby events from Ticketmaster (${events.length})`);
  } catch (err) {
    logger.error(`[PROVIDER:ticketmaster] searchNearby error: ${err.message}`);
    return unavailable('ticketmaster', `Live data unavailable: ${err.message}`);
  }
}

// ── Mapping helpers ─────────────────────────────────────────────────

/** Map a Ticketmaster event response to a normalized shape. */
function mapEvent(e) {
  if (!e || typeof e !== 'object') return null;

  const dates = e.dates || {};
  const start = dates.start || {};
  const venue = e._embedded?.venues?.[0] || {};
  const priceRange = e.priceRanges?.[0] || {};
  const classifications = e.classifications?.[0] || {};
  const segment = classifications.segment || {};
  const genre = classifications.genre || {};
  const images = e.images || [];

  // Pick the best image (640px or fallback to first)
  const bestImage = images.find((img) => img.width >= 640) || images[0] || null;

  const location = venue.location || {};

  return {
    eventId: e.id || '',
    name: e.name || '',
    type: e.type || 'event',
    url: e.url || '',
    info: e.info || e.description || '',
    // Dates
    date: start.localDate || start.date || '',
    time: start.localTime || '',
    dateTime: start.dateTime || '',
    dateTBD: Boolean(start.dateTBD),
    dateStatus: dates.status?.code || '',
    // Venue
    venueName: venue.name || '',
    venueAddress: venue.address?.line1 || '',
    venueCity: venue.city?.name || '',
    venueState: venue.state?.name || venue.state?.stateCode || '',
    venueCountry: venue.country?.name || venue.country?.countryCode || '',
    venuePostalCode: venue.postalCode || '',
    coordinates: location.latitude && location.longitude
      ? { lat: Number(location.latitude), lng: Number(location.longitude) }
      : null,
    venueUrl: venue.url || '',
    // Pricing
    priceRange: priceRange.min != null ? {
      min: Number(priceRange.min),
      max: Number(priceRange.max || priceRange.min),
      currency: priceRange.currency || 'USD',
    } : null,
    // Classification
    category: segment.name || '',
    genre: genre.name || '',
    subGenre: classifications.subGenre?.name || '',
    // Images
    imageUrl: bestImage?.url || '',
    thumbnailUrl: images.find((img) => img.width >= 200)?.url || images[0]?.url || '',
    // Metadata
    isFree: priceRange.min === 0 || Boolean(e._embedded?.events?.[0]?.priceRanges?.[0]?.min === 0),
    source: 'ticketmaster',
    fetchedAt: new Date().toISOString(),
  };
}

export default {
  searchEvents,
  searchNearby,
};
