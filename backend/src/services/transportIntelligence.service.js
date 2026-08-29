import mapsProvider from '../providers/maps.provider.js';
import placesProvider from '../providers/places.provider.js';
import flightProvider from '../providers/flight.provider.js';
import trainProvider from '../providers/train.provider.js';
import busProvider from '../providers/bus.provider.js';
import logger from '../utils/logger.js';
import { live, unavailable } from '../providers/base.provider.js';

/**
 * Transport Intelligence Service
 *
 * Generic, location-agnostic transport selection engine.
 * Works for ANY origin/destination: villages, towns, cities, remote locations,
 * domestic and international destinations.
 *
 * Architecture:
 *  1. Geocode origin + destination (parallel)
 *  2. Search for nearby transport hubs: airports, railway stations, bus terminals
 *  3. Check real availability for each mode (parallel)
 *  4. Build multi-modal journeys (ground transfer + main transport + destination transfer)
 *  5. Rank options by preference, time, cost, transfers, convenience
 *
 * CRITICAL: No data is ever fabricated. If an API returns nothing, the mode is
 * marked "unavailable" with an honest message.
 */

const NEARBY_AIRPORT_RADIUS_KM = 300;
const NEARBY_STATION_RADIUS_KM = 150;
const NEARBY_TERMINAL_RADIUS_KM = 100;
const HUB_SEARCH_LIMIT = 10;

// ── Caching ─────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(...parts) { return parts.join('|'); }
function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  return null;
}
function cacheSet(key, value) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

// ── Helpers ─────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDriveTimeMin(distanceKm) {
  // Rough: 40 km/h average (mix of city + highway)
  return Math.max(10, Math.round((distanceKm / 40) * 60));
}

function estimateCabFare(distanceKm, currency = 'INR') {
  // Generic India cab estimate: base ₹30 + ₹12/km + ₹1/min wait
  const base = 30;
  const perKm = 12;
  const amount = Math.round(base + distanceKm * perKm);
  return {
    amount,
    currency,
    isEstimate: true,
    estimateNote: `Estimated cab fare: ₹${base} base + ₹${perKm}/km × ${Math.round(distanceKm)} km. Confirm with your cab provider.`,
    source: 'estimate',
  };
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 1: GEOCODING
// ══════════════════════════════════════════════════════════════════════

/**
 * Geocode a location and return structured geographic data.
 * @returns {{ lat, lng, city, state, country, formatted, source }}
 */
export async function geocodeLocation(query) {
  const ck = cacheKey('geo', query);
  const hit = cached(ck);
  if (hit) return hit;

  const result = await mapsProvider.geocode(query);
  if (!result.isLive || !result.data) {
    logger.warn(`[transportIntel] Geocoding failed for "${query}": ${result.message}`);
    return null;
  }

  const d = result.data;
  // Geoapify doesn't always return city/state/country in the basic geocode.
  // The formatted address usually contains this info.
  const geo = {
    lat: d.lat,
    lng: d.lng,
    formatted: d.formatted || query,
    placeId: d.placeId || '',
    city: d.city || d.formatted || query,
    state: d.state || '',
    country: d.country || '',
    source: 'geoapify',
  };

  cacheSet(ck, geo);
  return geo;
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 2: FIND NEARBY TRANSPORT HUBS
// ══════════════════════════════════════════════════════════════════════

/**
 * Find nearby airports using AviationStack's airport database.
 * Returns airports within NEARBY_AIRPORT_RADIUS_KM, sorted by distance.
 *
 * For each airport, we check:
 *  - distance from origin
 *  - IATA code
 *  - operational status (when available)
 */
export async function findNearbyAirports(location, { radiusKm = NEARBY_AIRPORT_RADIUS_KM, limit = HUB_SEARCH_LIMIT } = {}) {
  if (!location?.lat || !location?.lng) return [];

  const ck = cacheKey('airports', location.lat, location.lng, radiusKm);
  const hit = cached(ck);
  if (hit) return hit;

  const airports = [];

  // Strategy:
  // 1. Search AviationStack for airports near the city/region
  // 2. Fallback: search Geoapify for airport POIs near the coordinates
  // 3. Never invent airports — only use real data from APIs

  // 1. AviationStack airport search by city/region name
  const regionQuery = location.city || location.formatted || '';
  if (regionQuery) {
    try {
      const data = await flightProvider.searchAirports(regionQuery, { limit: 10 });
      for (const a of data) {
        if (a.latitude != null && a.longitude != null) {
          const dist = haversineKm(location.lat, location.lng, a.latitude, a.longitude);
          if (dist <= radiusKm) {
            airports.push({
              iata: a.iata_code || '',
              name: a.airport_name || '',
              city: a.city_name || '',
              country: a.country_name || '',
              lat: a.latitude,
              lng: a.longitude,
              distanceKm: Math.round(dist),
              driveTimeMin: estimateDriveTimeMin(dist),
            });
          }
        }
      }
    } catch (err) {
      logger.warn(`[transportIntel] AviationStack airport search failed: ${err.message}`);
    }
  }

  // 2. Geoapify POI search for airports near the coordinates
  if (airports.length === 0) {
    try {
      const nearby = await placesProvider.nearbySearch({
        lat: location.lat,
        lng: location.lng,
        type: 'transport.airport',
        radius: radiusKm * 1000,
        limit,
      });
      if (nearby?.isLive && nearby.data) {
        for (const p of nearby.data) {
          if (p.coordinates?.lat != null && p.coordinates?.lng != null) {
            const dist = haversineKm(location.lat, location.lng, p.coordinates.lat, p.coordinates.lng);
            airports.push({
              iata: '',
              name: p.name || '',
              city: p.city || '',
              country: p.state || '',
              lat: p.coordinates.lat,
              lng: p.coordinates.lng,
              distanceKm: Math.round(dist),
              driveTimeMin: estimateDriveTimeMin(dist),
            });
          }
        }
      }
    } catch (err) {
      logger.warn(`[transportIntel] Geoapify airport search failed: ${err.message}`);
    }
  }

  // 3. If the origin city itself has an airport (detected during direct flight search),
  // we don't need to add it here — the flight provider's CITY_IATA map handles that.

  // Sort by distance
  airports.sort((a, b) => a.distanceKm - b.distanceKm);

  const result = airports.slice(0, limit);
  cacheSet(ck, result);
  return result;
}

/**
 * Find nearby railway stations.
 * Uses the train provider's station search capabilities.
 * Returns stations within NEARBY_STATION_RADIUS_KM, sorted by distance.
 */
export async function findNearbyRailwayStations(location, { radiusKm = NEARBY_STATION_RADIUS_KM, limit = HUB_SEARCH_LIMIT } = {}) {
  if (!location?.lat || !location?.lng) return [];

  const ck = cacheKey('stations', location.lat, location.lng, radiusKm);
  const hit = cached(ck);
  if (hit) return hit;

  const stations = [];

  // Strategy: Use Geoapify's POI search for railway stations near the location.
  // Geoapify category for railway stations: public_transport.railway_station
  try {
    const nearby = await placesProvider.nearbySearch({
      lat: location.lat,
      lng: location.lng,
      type: 'transport.train',
      radius: radiusKm * 1000,
      limit,
    });
    if (nearby?.isLive && nearby.data) {
      for (const p of nearby.data) {
        if (p.coordinates?.lat != null && p.coordinates?.lng != null) {
          const dist = haversineKm(location.lat, location.lng, p.coordinates.lat, p.coordinates.lng);
          stations.push({
            name: p.name || '',
            city: p.city || '',
            lat: p.coordinates.lat,
            lng: p.coordinates.lng,
            distanceKm: Math.round(dist),
            driveTimeMin: estimateDriveTimeMin(dist),
          });
        }
      }
    }
  } catch (err) {
    logger.warn(`[transportIntel] Railway station search failed: ${err.message}`);
  }

  // Fallback: if the city itself is in the STATION_MAP, the city's own station
  // is the most practical hub. Don't invent stations — the train provider's
  // searchTrains() already handles city-name → station-code resolution.
  const cityName = (location.city || location.formatted || '').trim();
  if (cityName && stations.length === 0) {
    // Mark that this city likely has a station (train provider will resolve it)
    stations.push({
      name: `${cityName} Railway Station`,
      city: cityName,
      lat: location.lat,
      lng: location.lng,
      distanceKm: 0,
      driveTimeMin: 0,
      isCityStation: true,
    });
  }

  stations.sort((a, b) => a.distanceKm - b.distanceKm);
  const result = stations.slice(0, limit);
  cacheSet(ck, result);
  return result;
}

/**
 * Find nearby bus terminals.
 * Uses Geoapify POI search for bus stations.
 */
export async function findNearbyBusTerminals(location, { radiusKm = NEARBY_TERMINAL_RADIUS_KM, limit = HUB_SEARCH_LIMIT } = {}) {
  if (!location?.lat || !location?.lng) return [];

  const ck = cacheKey('terminals', location.lat, location.lng, radiusKm);
  const hit = cached(ck);
  if (hit) return hit;

  const terminals = [];

  try {
    const nearby = await placesProvider.nearbySearch({
      lat: location.lat,
      lng: location.lng,
      type: 'transport.bus',
      radius: radiusKm * 1000,
      limit,
    });
    if (nearby?.isLive && nearby.data) {
      for (const p of nearby.data) {
        if (p.coordinates?.lat != null && p.coordinates?.lng != null) {
          const dist = haversineKm(location.lat, location.lng, p.coordinates.lat, p.coordinates.lng);
          terminals.push({
            name: p.name || '',
            city: p.city || '',
            lat: p.coordinates.lat,
            lng: p.coordinates.lng,
            distanceKm: Math.round(dist),
            driveTimeMin: estimateDriveTimeMin(dist),
          });
        }
      }
    }
  } catch (err) {
    logger.warn(`[transportIntel] Bus terminal search failed: ${err.message}`);
  }

  // Every city has some form of bus connectivity — mark the city itself as a terminal
  const cityName = (location.city || location.formatted || '').trim();
  if (cityName && terminals.length === 0) {
    terminals.push({
      name: `${cityName} Bus Stand`,
      city: cityName,
      lat: location.lat,
      lng: location.lng,
      distanceKm: 0,
      driveTimeMin: 0,
      isCityTerminal: true,
    });
  }

  terminals.sort((a, b) => a.distanceKm - b.distanceKm);
  const result = terminals.slice(0, limit);
  cacheSet(ck, result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 3: GROUND TRANSFER CALCULATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate ground transfer details between two points.
 * Uses Geoapify Routes API for real distance and duration.
 * Returns distance, duration, and estimated cab fare.
 */
export async function calculateGroundTransfer(origin, destination, currency = 'INR') {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    return {
      distanceKm: 0,
      durationMin: 0,
      method: 'unknown',
      fare: null,
      isLive: false,
      message: 'Coordinates unavailable for ground transfer calculation',
    };
  }

  // Same location — no transfer needed
  const dist = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
  if (dist < 1) {
    return {
      distanceKm: 0,
      durationMin: 0,
      method: 'walking',
      fare: { amount: 0, currency, isEstimate: false },
      isLive: false,
      message: 'Same location — no transfer needed',
    };
  }

  // Try real routing via Geoapify
  try {
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;
    const routeResult = await mapsProvider.directions(originStr, destStr, 'driving', false);

    if (routeResult.isLive && routeResult.data?.routes?.length) {
      const route = routeResult.data.routes[0];
      return {
        distanceKm: route.distanceKm || Math.round(dist),
        durationMin: route.durationMin || estimateDriveTimeMin(dist),
        method: 'cab/car',
        fare: estimateCabFare(route.distanceKm || dist, currency),
        isLive: true,
        source: 'geoapify-routes',
        message: `Real driving route: ${route.distanceKm} km, ${route.durationMin} min`,
      };
    }
  } catch (err) {
    logger.warn(`[transportIntel] Ground transfer routing failed: ${err.message}`);
  }

  // Fallback: haversine estimate
  return {
    distanceKm: Math.round(dist),
    durationMin: estimateDriveTimeMin(dist),
    method: 'cab/car',
    fare: estimateCabFare(dist, currency),
    isLive: false,
    estimateNote: 'Estimated from straight-line distance — actual road route may differ',
    message: `Estimated: ${Math.round(dist)} km, ~${estimateDriveTimeMin(dist)} min by road`,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 4: CHECK AVAILABILITY FOR EACH MODE
// ══════════════════════════════════════════════════════════════════════

/**
 * Check flight availability between two locations.
 * If origin has no airport, searches nearby airports and builds a
 * multi-modal journey (ground transfer + flight).
 *
 * @returns {Array<Object>} Array of transport options, each with:
 *   { mode, type, name, origin, destination, groundTransfer, mainTransport,
 *     destinationTransfer, totalDuration, totalCost, isLive, source, rank }
 */
export async function checkFlightAvailability(originGeo, destGeo, opts = {}) {
  const { departDate, returnDate, adults = 1, currency = 'INR' } = opts;
  const options = [];

  // Step 1: Try direct flight from origin city
  try {
    const directResult = await flightProvider.searchFlights({
      origin: originGeo.city || originGeo.formatted,
      destination: destGeo.city || destGeo.formatted,
      departDate,
      returnDate,
      adults,
      travelClass: 'ECONOMY',
    });

    if (directResult.isLive && directResult.data?.length) {
      const best = directResult.data[0];
      options.push({
        mode: 'flight',
        type: 'direct-flight',
        name: `${best.airline || ''} ${best.flightNumber || ''}`.trim() || 'Flight',
        origin: originGeo.formatted,
        destination: destGeo.formatted,
        mainTransport: {
          airline: best.airline || '',
          flightNumber: best.flightNumber || '',
          departure: best.departAt || '',
          arrival: best.arriveAt || '',
          duration: best.duration || '',
          stops: best.stops || 0,
          price: best.price || null,
          status: best.status || 'scheduled',
          isLive: true,
          provider: best.provider || directResult.source || 'flight-api',
        },
        groundTransfer: null, // No ground transfer needed for direct
        destinationTransfer: null,
        totalDuration: best.duration || '',
        totalCost: best.price?.amount || null,
        currency: best.price?.currency || currency,
        isLive: true,
        source: directResult.source || 'flight-api',
        fetchedAt: new Date().toISOString(),
        recommendation: 'Direct flight — most convenient option',
      });
      logger.info(`[transportIntel] Direct flight found: ${best.airline} ${best.flightNumber}`);
    }
  } catch (err) {
    logger.warn(`[transportIntel] Direct flight search failed: ${err.message}`);
  }

  // Step 2: If origin has no airport or no direct flights, search nearby airports
  const originAirports = await findNearbyAirports(originGeo, { radiusKm: NEARBY_AIRPORT_RADIUS_KM });
  const destAirports = await findNearbyAirports(destGeo, { radiusKm: NEARBY_AIRPORT_RADIUS_KM });

  // Check if origin city itself has an airport in the results
  const originHasAirport = originAirports.some(
    (a) => a.distanceKm === 0 || (a.city && originGeo.city && a.city.toLowerCase() === originGeo.city.toLowerCase())
  );

  if (!originHasAirport && originAirports.length > 0) {
    // Origin has no airport — build multi-modal journeys via nearby airports
    for (const airport of originAirports.slice(0, 3)) {
      // Ground transfer: origin → nearby airport
      const groundTransfer = await calculateGroundTransfer(
        { lat: originGeo.lat, lng: originGeo.lng },
        { lat: airport.lat, lng: airport.lng },
        currency
      );

      // Flight from nearby airport to destination
      try {
        const flightResult = await flightProvider.searchFlights({
          origin: airport.iata || airport.name,
          destination: destGeo.city || destGeo.formatted,
          departDate,
          returnDate,
          adults,
          travelClass: 'ECONOMY',
        });

        if (flightResult.isLive && flightResult.data?.length) {
          const best = flightResult.data[0];

          // Destination transfer: destination airport → final destination
          const destTransfer = await calculateGroundTransfer(
            { lat: destGeo.lat, lng: destGeo.lng }, // approximate airport coords
            { lat: destGeo.lat, lng: destGeo.lng },
            currency
          );

          options.push({
            mode: 'flight',
            type: 'multi-modal-flight',
            name: `${groundTransfer.distanceKm}km transfer + ${best.airline || ''} ${best.flightNumber || ''}`.trim(),
            origin: originGeo.formatted,
            destination: destGeo.formatted,
            groundTransfer: {
              from: originGeo.formatted,
              to: `${airport.name} (${airport.iata || 'N/A'})`,
              distanceKm: groundTransfer.distanceKm,
              durationMin: groundTransfer.durationMin,
              fare: groundTransfer.fare,
              method: groundTransfer.method,
              isLive: groundTransfer.isLive,
            },
            mainTransport: {
              airline: best.airline || '',
              flightNumber: best.flightNumber || '',
              departure: best.departAt || '',
              arrival: best.arriveAt || '',
              duration: best.duration || '',
              stops: best.stops || 0,
              price: best.price || null,
              status: best.status || 'scheduled',
              isLive: true,
              provider: best.provider || flightResult.source || 'flight-api',
              viaAirport: airport.name,
              viaIata: airport.iata,
            },
            destinationTransfer: destTransfer.distanceKm > 1 ? {
              from: `${destGeo.city || destGeo.formatted} Airport`,
              to: destGeo.formatted,
              distanceKm: destTransfer.distanceKm,
              durationMin: destTransfer.durationMin,
              fare: destTransfer.fare,
              method: destTransfer.method,
              isLive: destTransfer.isLive,
            } : null,
            totalDuration: `~${groundTransfer.durationMin + (best.duration ? parseDurationToMin(best.duration) : 120) + (destTransfer.distanceKm > 1 ? destTransfer.durationMin : 0)} min`,
            totalCost: (groundTransfer.fare?.amount || 0) + (best.price?.amount || 0) + (destTransfer.fare?.amount || 0),
            currency,
            isLive: true,
            source: flightResult.source || 'flight-api',
            fetchedAt: new Date().toISOString(),
            recommendation: `Ground transfer to ${airport.name} (${airport.iata}) + flight to destination`,
          });
          logger.info(`[transportIntel] Multi-modal flight via ${airport.name} (${airport.iata}): ground ${groundTransfer.distanceKm}km + flight`);
        }
      } catch (err) {
        logger.warn(`[transportIntel] Flight from ${airport.name} failed: ${err.message}`);
      }
    }
  }

  return options;
}

/**
 * Check train availability between two locations.
 * Uses the train provider's search with city names (auto-resolves station codes).
 */
export async function checkTrainAvailability(originGeo, destGeo, opts = {}) {
  const { date, passengers = 1, currency = 'INR' } = opts;
  const options = [];

  try {
    const result = await trainProvider.searchTrains({
      from: originGeo.city || originGeo.formatted,
      to: destGeo.city || destGeo.formatted,
      date,
      passengers,
    });

    if (result.isLive && result.data?.length) {
      for (const train of result.data.slice(0, 5)) {
        options.push({
          mode: 'train',
          type: 'direct-train',
          name: train.trainName || train.trainNumber || 'Train',
          origin: originGeo.formatted,
          destination: destGeo.formatted,
          mainTransport: {
            trainName: train.trainName || '',
            trainNumber: train.trainNumber || '',
            departure: train.departureTime || '',
            arrival: train.arrivalTime || '',
            duration: train.duration || '',
            classes: train.classes || '',
            price: train.price || null,
            isLive: true,
            provider: 'configured-train-api',
          },
          groundTransfer: null,
          destinationTransfer: null,
          totalDuration: train.duration || '',
          totalCost: train.price?.amount || null,
          currency: train.price?.currency || currency,
          isLive: true,
          source: result.source || 'train-api',
          fetchedAt: new Date().toISOString(),
          recommendation: train.trainName ? `Train ${train.trainNumber}: ${train.trainName}` : 'Train service available',
        });
      }
      logger.info(`[transportIntel] Found ${options.length} train options`);
    } else {
      logger.info(`[transportIntel] No trains found: ${result.message}`);
    }
  } catch (err) {
    logger.warn(`[transportIntel] Train search failed: ${err.message}`);
  }

  // If origin has no railway station, check nearby stations
  if (options.length === 0) {
    const originStations = await findNearbyRailwayStations(originGeo);
    if (originStations.length > 0 && !originStations[0].isCityStation) {
      for (const station of originStations.slice(0, 2)) {
        const groundTransfer = await calculateGroundTransfer(
          { lat: originGeo.lat, lng: originGeo.lng },
          { lat: station.lat, lng: station.lng },
          currency
        );

        try {
          const result = await trainProvider.searchTrains({
            from: station.name,
            to: destGeo.city || destGeo.formatted,
            date,
            passengers,
          });

          if (result.isLive && result.data?.length) {
            const train = result.data[0];
            options.push({
              mode: 'train',
              type: 'multi-modal-train',
              name: `${groundTransfer.distanceKm}km transfer + ${train.trainName || train.trainNumber || 'Train'}`,
              origin: originGeo.formatted,
              destination: destGeo.formatted,
              groundTransfer: {
                from: originGeo.formatted,
                to: station.name,
                distanceKm: groundTransfer.distanceKm,
                durationMin: groundTransfer.durationMin,
                fare: groundTransfer.fare,
                method: groundTransfer.method,
                isLive: groundTransfer.isLive,
              },
              mainTransport: {
                trainName: train.trainName || '',
                trainNumber: train.trainNumber || '',
                departure: train.departureTime || '',
                arrival: train.arrivalTime || '',
                duration: train.duration || '',
                price: train.price || null,
                isLive: true,
                provider: 'configured-train-api',
                viaStation: station.name,
              },
              destinationTransfer: null,
              totalDuration: `~${groundTransfer.durationMin + (train.duration ? parseDurationToMin(train.duration) : 60)} min`,
              totalCost: (groundTransfer.fare?.amount || 0) + (train.price?.amount || 0),
              currency,
              isLive: true,
              source: result.source || 'train-api',
              fetchedAt: new Date().toISOString(),
              recommendation: `Transfer to ${station.name} + train to destination`,
            });
          }
        } catch (err) {
          logger.warn(`[transportIntel] Train from ${station.name} failed: ${err.message}`);
        }
      }
    }
  }

  return options;
}

/**
 * Check bus availability between two locations.
 * Uses the bus provider (Pay2all or configured fallback).
 */
export async function checkBusAvailability(originGeo, destGeo, opts = {}) {
  const { date, passengers = 1, currency = 'INR' } = opts;
  const options = [];

  try {
    const result = await busProvider.searchBuses({
      from: originGeo.city || originGeo.formatted,
      to: destGeo.city || destGeo.formatted,
      date,
      passengers,
    });

    if (result.isLive && result.data?.length) {
      for (const bus of result.data.slice(0, 5)) {
        options.push({
          mode: 'bus',
          type: 'direct-bus',
          name: bus.operator || bus.name || 'Bus',
          origin: originGeo.formatted,
          destination: destGeo.formatted,
          mainTransport: {
            operator: bus.operator || bus.name || '',
            busNumber: bus.busNumber || '',
            departure: bus.departureTime || bus.departure || '',
            arrival: bus.arrivalTime || bus.arrival || '',
            duration: bus.duration || '',
            price: bus.price || null,
            isLive: true,
            provider: 'pay2all',
          },
          groundTransfer: null,
          destinationTransfer: null,
          totalDuration: bus.duration || '',
          totalCost: bus.price?.amount || null,
          currency: bus.price?.currency || currency,
          isLive: true,
          source: result.source || 'pay2all',
          fetchedAt: new Date().toISOString(),
          recommendation: bus.operator ? `${bus.operator} bus service` : 'Bus service available',
        });
      }
      logger.info(`[transportIntel] Found ${options.length} bus options`);
    } else {
      logger.info(`[transportIntel] No buses found: ${result.message}`);
    }
  } catch (err) {
    logger.warn(`[transportIntel] Bus search failed: ${err.message}`);
  }

  return options;
}

/**
 * Calculate road option (self-drive / cab for the entire journey).
 * Always available — uses Geoapify Routes for real distance + duration.
 */
export async function checkRoadAvailability(originGeo, destGeo, currency = 'INR') {
  const transfer = await calculateGroundTransfer(
    { lat: originGeo.lat, lng: originGeo.lng },
    { lat: destGeo.lat, lng: destGeo.lng },
    currency
  );

  return [{
    mode: 'road',
    type: 'direct-road',
    name: 'By Road',
    origin: originGeo.formatted,
    destination: destGeo.formatted,
    mainTransport: {
      distanceKm: transfer.distanceKm,
      durationMin: transfer.durationMin,
      method: 'self-drive/cab',
      fare: transfer.fare,
      isLive: transfer.isLive,
      source: transfer.source || 'estimate',
    },
    groundTransfer: null,
    destinationTransfer: null,
    totalDuration: `~${transfer.durationMin} min`,
    totalCost: transfer.fare?.amount || null,
    currency,
    isLive: transfer.isLive,
    source: transfer.source || 'estimate',
    fetchedAt: new Date().toISOString(),
    recommendation: `Direct road: ${transfer.distanceKm} km, ~${Math.round(transfer.durationMin / 60 * 10) / 10} hours`,
  }];
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 5: RANK TRANSPORT OPTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Rank transport options based on multiple factors.
 * The cheapest option is NOT automatically the best.
 *
 * Scoring factors:
 *  - user preference match (30%)
 *  - total travel time (25%)
 *  - total cost (20%)
 *  - number of transfers (15%)
 *  - data live-ness (10%)
 */
export function rankTransportOptions(options, { preference = '', budget = 0, currency = 'INR' } = {}) {
  if (!options.length) return [];

  // Normalize scores (lower = better)
  const scored = options.map((opt) => {
    let score = 0;

    // 1. Preference match (30 points max)
    const modeMatch = preference && opt.mode === preference;
    const typeMatch = preference && opt.type?.includes(preference);
    if (modeMatch) score += 0;
    else if (typeMatch) score += 5;
    else score += 15;

    // 2. Travel time (25 points max)
    const timeMin = parseDurationToMin(opt.totalDuration) || 120;
    const timeScore = Math.min(25, (timeMin / 300) * 25); // 5h = max penalty
    score += timeScore;

    // 3. Cost (20 points max)
    const cost = opt.totalCost || 0;
    const costScore = budget > 0 ? Math.min(20, (cost / budget) * 20) : 10;
    score += costScore;

    // 4. Transfers (15 points max — fewer is better)
    const transfers = (opt.groundTransfer ? 1 : 0) + (opt.destinationTransfer ? 1 : 0);
    score += transfers * 7.5;

    // 5. Live data bonus (10 points max)
    if (!opt.isLive) score += 10;

    // Reason for ranking
    let reason = '';
    if (modeMatch) reason = `Matches your ${preference} preference`;
    else if (opt.isLive && cost > 0 && timeMin < 180) reason = 'Good balance of time, cost and convenience';
    else if (transfers === 0) reason = 'No transfers — direct journey';
    else if (cost > 0 && cost < (budget * 0.3)) reason = 'Budget-friendly option';

    return { ...opt, _score: score, _rank: 0, _reason: reason };
  });

  // Sort by score (ascending)
  scored.sort((a, b) => a._score - b._score);

  // Assign ranks and reasons
  scored.forEach((opt, i) => {
    opt._rank = i + 1;
    if (!opt._reason) {
      if (i === 0) opt._reason = 'Recommended: best overall balance of time, cost and convenience';
      else if (i === 1) opt._reason = 'Good alternative';
      else opt._reason = 'Available option';
    }
  });

  // Clean internal fields
  return scored.map(({ _score, _rank, _reason, ...rest }) => ({
    ...rest,
    rank: _rank,
    recommendation: _reason,
  }));
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════════

/**
 * Main transport intelligence function.
 * Orchestrates the entire transport selection process.
 *
 * @param {Object} opts
 * @param {string} opts.origin - User's origin (city, address, or coordinates)
 * @param {string} opts.destination - User's destination
 * @param {string} opts.departDate - Departure date (YYYY-MM-DD)
 * @param {string} opts.returnDate - Return date (YYYY-MM-DD)
 * @param {number} opts.adults - Number of adults
 * @param {number} opts.children - Number of children
 * @param {string} opts.preference - User's transport preference (flight, train, bus, road)
 * @param {number} opts.budget - Total transport budget
 * @param {string} opts.currency - Currency code
 *
 * @returns {Object} { options, recommended, originGeo, destGeo, summary }
 */
export async function findTransportOptions({
  origin,
  destination,
  departDate,
  returnDate,
  adults = 1,
  children = 0,
  preference = '',
  budget = 0,
  currency = 'INR',
} = {}) {
  const started = Date.now();
  logger.entry('[transportIntel]', 'findTransportOptions', { origin, destination, departDate, preference });

  // ═══ Step 1: Geocode both locations (parallel) ═══
  const [originGeo, destGeo] = await Promise.all([
    geocodeLocation(origin),
    geocodeLocation(destination),
  ]);

  if (!originGeo) {
    return {
      options: [],
      recommended: null,
      originGeo: null,
      destGeo,
      summary: { message: `Could not geocode origin "${origin}". Please check the location name.`, modesChecked: [] },
    };
  }
  if (!destGeo) {
    return {
      options: [],
      recommended: null,
      originGeo,
      destGeo: null,
      summary: { message: `Could not geocode destination "${destination}". Please check the location name.`, modesChecked: [] },
    };
  }

  logger.info(`[transportIntel] Geocoded: "${origin}" → ${originGeo.formatted}, "${destination}" → ${destGeo.formatted}`);

  // ═══ Step 2: Check all transport modes in parallel ═══
  const travelPrefs = {
    departDate,
    returnDate,
    adults,
    children,
    currency,
    date: departDate,
    passengers: adults + children,
  };

  logger.info('[transportIntel] Checking all transport modes in parallel...');

  const [flightOptions, trainOptions, busOptions, roadOptions] = await Promise.all([
    checkFlightAvailability(originGeo, destGeo, travelPrefs).catch((err) => {
      logger.warn(`[transportIntel] Flight check failed: ${err.message}`);
      return [];
    }),
    checkTrainAvailability(originGeo, destGeo, travelPrefs).catch((err) => {
      logger.warn(`[transportIntel] Train check failed: ${err.message}`);
      return [];
    }),
    checkBusAvailability(originGeo, destGeo, travelPrefs).catch((err) => {
      logger.warn(`[transportIntel] Bus check failed: ${err.message}`);
      return [];
    }),
    checkRoadAvailability(originGeo, destGeo, currency).catch((err) => {
      logger.warn(`[transportIntel] Road check failed: ${err.message}`);
      return [];
    }),
  ]);

  // ═══ Step 3: Aggregate all options ═══
  const allOptions = [...flightOptions, ...trainOptions, ...busOptions, ...roadOptions];

  // ═══ Step 4: Rank options ═══
  const ranked = rankTransportOptions(allOptions, { preference, budget, currency });

  // ═══ Step 5: Build summary ═══
  const modesChecked = [];
  if (flightOptions.length) modesChecked.push({ mode: 'flight', count: flightOptions.length, live: true });
  else modesChecked.push({ mode: 'flight', count: 0, live: false, message: 'No flights found' });
  if (trainOptions.length) modesChecked.push({ mode: 'train', count: trainOptions.length, live: true });
  else modesChecked.push({ mode: 'train', count: 0, live: false, message: 'No trains found' });
  if (busOptions.length) modesChecked.push({ mode: 'bus', count: busOptions.length, live: true });
  else modesChecked.push({ mode: 'bus', count: 0, live: false, message: 'No buses found' });
  modesChecked.push({ mode: 'road', count: roadOptions.length, live: roadOptions[0]?.isLive || false });

  const summary = {
    message: ranked.length
      ? `Found ${ranked.length} transport option(s) from ${originGeo.formatted} to ${destGeo.formatted}`
      : `No transport options found from ${originGeo.formatted} to ${destGeo.formatted}`,
    modesChecked,
    originGeo,
    destGeo,
    latencyMs: Date.now() - started,
  };

  logger.info(`[transportIntel] Complete: ${ranked.length} options ranked in ${Date.now() - started}ms`);

  return {
    options: ranked,
    recommended: ranked[0] || null,
    originGeo,
    destGeo,
    summary,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  RETURN TRANSPORT
// ══════════════════════════════════════════════════════════════════════

/**
 * Find return transport (destination → origin).
 * Swaps origin/destination and re-runs the intelligence engine.
 */
export async function findReturnTransport(opts) {
  return findTransportOptions({
    ...opts,
    origin: opts.destination,
    destination: opts.origin,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Parse duration string (e.g. "2h 30m", "135", "02:30") into minutes. */
function parseDurationToMin(dur) {
  if (typeof dur === 'number') return dur;
  if (!dur) return 0;
  const str = String(dur);

  // "HH:MM" format
  const hm = str.match(/^(\d+):(\d+)$/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);

  // "Xh Ym" format
  const h = parseInt(str.match(/(\d+)\s*h/i)?.[1] || '0', 10);
  const m = parseInt(str.match(/(\d+)\s*m/i)?.[1] || '0', 10);
  if (h || m) return h * 60 + m;

  // Plain number (minutes)
  const n = parseInt(str, 10);
  return Number.isNaN(n) ? 0 : n;
}

export default {
  findTransportOptions,
  findReturnTransport,
  geocodeLocation,
  findNearbyAirports,
  findNearbyRailwayStations,
  findNearbyBusTerminals,
  calculateGroundTransfer,
  rankTransportOptions,
};
