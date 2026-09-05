/**
 * geographicClustering.service.js — Geographic Area Clustering for Day-Wise Itinerary
 *
 * Clusters validated candidates into geographic zones and assigns each
 * day to a zone, minimizing total travel time.
 *
 * Architecture:
 *   candidates → radius clustering → day-zone assignment → intra-day routing
 *
 * Does NOT use Gemini for clustering — purely deterministic geographic math.
 */

import { haversineKm, estimateDriveMinutes } from '../utils/geo.js';
import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Minimum radius (km) used for clustering — prevents tiny clusters in dense cities. */
const MIN_CLUSTER_RADIUS_KM = 2;

/** Maximum radius (km) for a single cluster zone. */
const MAX_CLUSTER_RADIUS_KM = 30;

/** Default radius when trip duration is unknown. */
const DEFAULT_CLUSTER_RADIUS_KM = 8;

/** Radius to attach restaurants/nightlife to a day's zone. */
const LOCAL_ATTACHMENT_RADIUS_KM = 14;

/** Minimum candidates per cluster to avoid creating empty zones. */
const MIN_CANDIDATES_PER_CLUSTER = 2;

// ══════════════════════════════════════════════════════════════════════
//  GEOGRAPHIC MATH
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize candidate coordinates from either flat (latitude/longitude)
 * or nested ({ coordinates: { lat, lng } }) format.
 */
function normalizeCoords(c) {
  return {
    ...c,
    latitude: c.latitude ?? c.coordinates?.lat ?? null,
    longitude: c.longitude ?? c.coordinates?.lng ?? null,
  };
}

/**
 * Compute the geographic centroid of a set of candidates with coordinates.
 * Returns { lat, lng } or null if no valid coordinates exist.
 */
export function computeCentroid(candidates) {
  const valid = (candidates || []).map(normalizeCoords).filter(
    (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number'
      && !Number.isNaN(c.latitude) && !Number.isNaN(c.longitude)
  );
  if (!valid.length) return null;

  // Use Cartesian average to avoid pole/meridian issues
  let x = 0, y = 0, z = 0;
  for (const c of valid) {
    const latRad = (c.latitude * Math.PI) / 180;
    const lngRad = (c.longitude * Math.PI) / 180;
    x += Math.cos(latRad) * Math.cos(lngRad);
    y += Math.cos(latRad) * Math.sin(lngRad);
    z += Math.sin(latRad);
  }
  const n = valid.length;
  const avgX = x / n, avgY = y / n, avgZ = z / n;
  const lng = Math.atan2(avgY, avgX) * 180 / Math.PI;
  const hyp = Math.sqrt(avgX * avgX + avgY * avgY);
  const lat = Math.atan2(avgZ, hyp) * 180 / Math.PI;

  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/**
 * Compute the bounding radius (km) of a candidate set from its centroid.
 * Returns the maximum haversine distance from centroid to any candidate.
 */
export function boundingRadiusKm(candidates, centroid) {
  if (!centroid) return 0;
  let maxKm = 0;
  for (const c of (candidates || []).map(normalizeCoords)) {
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue;
    const km = haversineKm(centroid.lat, centroid.lng, c.latitude, c.longitude);
    if (km > maxKm) maxKm = km;
  }
  return Math.round(maxKm * 10) / 10;
}

/**
 * Derive a locality name for a cluster from candidate data.
 * Uses the most common suburb/district/county from the cluster's candidates.
 * Falls back to a generic name if no locality data exists.
 */
function deriveLocalityName(cluster, destination) {
  if (!cluster?.length) return '';

  // Count locality names from candidates
  const localityCounts = new Map();
  for (const c of cluster) {
    const locality = c.suburb || c.district || c.county || c.city || '';
    if (locality && locality !== destination) {
      localityCounts.set(locality, (localityCounts.get(locality) || 0) + 1);
    }
  }

  // Return the most common locality name
  if (localityCounts.size > 0) {
    let best = '';
    let bestCount = 0;
    for (const [name, count] of localityCounts) {
      if (count > bestCount) {
        bestCount = count;
        best = name;
      }
    }
    return best || '';
  }

  return '';
}

/**
 * Compute the pairwise distance matrix for a set of candidates.
 * Returns a 2D array distances[i][j] in km.
 */
export function pairwiseDistanceMatrix(candidates) {
  const n = candidates.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.latitude == null || b.latitude == null) {
        matrix[i][j] = matrix[j][i] = Infinity;
      } else {
        const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
        matrix[i][j] = matrix[j][i] = Math.round(km * 100) / 100;
      }
    }
  }
  return matrix;
}

// ══════════════════════════════════════════════════════════════════════
//  CLUSTERING ALGORITHM
// ══════════════════════════════════════════════════════════════════════

/**
 * Compute adaptive clustering radius based on trip parameters.
 * Short trips in compact cities get smaller radii; long trips in large
 * destinations get larger radii.
 *
 * @param {number} daysCount - Number of trip days
 * @param {number} boundingRadius - Bounding radius of all candidates from centroid (km)
 * @returns {number} clustering radius in km
 */
export function computeClusterRadius(daysCount, boundingRadius) {
  if (!daysCount || daysCount < 1) return DEFAULT_CLUSTER_RADIUS_KM;

  // Target: ~3-5 candidates per cluster for a good day plan
  // More days → smaller radius (more zones); fewer days → larger radius (fewer zones)
  const base = boundingRadius / Math.max(1, Math.sqrt(daysCount));

  // Clamp to reasonable bounds
  return Math.max(MIN_CLUSTER_RADIUS_KM, Math.min(MAX_CLUSTER_RADIUS_KM, Math.round(base * 10) / 10));
}

/**
 * Single-linkage hierarchical radius clustering.
 *
 * Groups candidates into clusters where every candidate is within
 * `radiusKm` of at least one other candidate in the same cluster.
 *
 * @param {Array} candidates - candidates with latitude/longitude
 * @param {number} radiusKm - maximum intra-cluster distance
 * @returns {Array<Array>} array of clusters (each cluster is an array of candidates)
 */
export function radiusClustering(candidates, radiusKm) {
  // Normalize candidates to have flat latitude/longitude fields
  const normalized = (candidates || []).map((c) => ({
    ...c,
    latitude: c.latitude ?? c.coordinates?.lat ?? null,
    longitude: c.longitude ?? c.coordinates?.lng ?? null,
  }));
  const withCoords = normalized.filter(
    (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number'
  );
  if (!withCoords.length) return [];

  // Build adjacency: two candidates are neighbors if within radiusKm
  const n = withCoords.length;
  const neighbors = Array.from({ length: n }, () => new Set());

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const km = haversineKm(
        withCoords[i].latitude, withCoords[i].longitude,
        withCoords[j].latitude, withCoords[j].longitude
      );
      if (km <= radiusKm) {
        neighbors[i].add(j);
        neighbors[j].add(i);
      }
    }
  }

  // BFS to find connected components
  const visited = new Set();
  const clusters = [];
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const cluster = [];
    const queue = [i];
    visited.add(i);
    while (queue.length) {
      const node = queue.shift();
      cluster.push(withCoords[node]);
      for (const neighbor of neighbors[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Merge small clusters that are close together.
 * Prevents creating trivial 1-candidate clusters when the clustering
 * radius is too aggressive.
 *
 * @param {Array<Array>} clusters - output of radiusClustering
 * @param {number} mergeThresholdKm - merge clusters whose centroids are within this distance
 * @returns {Array<Array>} merged clusters
 */
export function mergeSmallClusters(clusters, mergeThresholdKm = 5) {
  if (clusters.length <= 1) return clusters;

  // Compute centroids for each cluster
  const centroids = clusters.map((cl) => {
    const normalized = cl.map(normalizeCoords);
    const lat = normalized.reduce((s, c) => s + c.latitude, 0) / normalized.length;
    const lng = normalized.reduce((s, c) => s + c.longitude, 0) / normalized.length;
    return { lat, lng };
  });

  // Merge clusters that are too close or too small
  let merged = clusters.map((c, i) => ({ items: c, centroid: centroids[i] }));

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const km = haversineKm(
          merged[i].centroid.lat, merged[i].centroid.lng,
          merged[j].centroid.lat, merged[j].centroid.lng
        );
        // Merge if close enough AND at least one cluster is small
        // Don't merge clusters that are far apart, even if small
        const isSmall = merged[i].items.length < MIN_CANDIDATES_PER_CLUSTER
          || merged[j].items.length < MIN_CANDIDATES_PER_CLUSTER;
        const shouldMerge = km <= mergeThresholdKm && isSmall;
        if (shouldMerge) {
          merged[i].items.push(...merged[j].items);
          // Recompute centroid
          merged[i].centroid = computeCentroid(merged[i].items);
          merged.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return merged.map((m) => m.items);
}

// ══════════════════════════════════════════════════════════════════════
//  DAY-ZONE ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Assign geographic zones to trip days.
 *
 * Strategy:
 *   1. Sort clusters by geographic position (north-to-south or west-to-east
 *      based on the dominant axis of spread).
 *   2. Assign one cluster per day in order.
 *   3. If more days than clusters, duplicate clusters for remaining days.
 *   4. If more clusters than days, merge the smallest/closest clusters.
 *
 * @param {Array<Array>} clusters - radius-clustering output
 * @param {number} daysCount - number of trip days
 * @param {string} destination - for labeling
 * @returns {Array<{dayNumber, zone, attractions, centroid}>}
 */
export function assignZonesToDays(clusters, daysCount, destination = '') {
  if (!clusters.length || !daysCount) return [];

  // Sort clusters geographically using principal axis
  const sorted = sortClustersGeographically(clusters);

  const zones = sorted.map((cluster, i) => {
    const centroid = computeCentroid(cluster);
    const localityName = deriveLocalityName(cluster, destination);
    return {
      dayNumber: i + 1,
      zone: localityName || (centroid
        ? `Area ${i + 1} · ${destination || 'destination'}`
        : `Area ${i + 1}`),
      attractions: cluster,
      centroid,
      candidateCount: cluster.length,
    };
  });

  // Assign to days: if more days than zones, repeat zones
  const dayAssignments = [];
  for (let d = 0; d < daysCount; d++) {
    const zone = zones[d % zones.length];
    dayAssignments.push({
      dayNumber: d + 1,
      zone: zone.zone,
      centroid: zone.centroid,
      attractionPool: zone.attractions,
      isRepeatedZone: d >= zones.length,
    });
  }

  return dayAssignments;
}

/**
 * Sort clusters along the principal geographic axis (dominant spread direction).
 * This creates a natural geographic progression for the itinerary.
 */
function sortClustersGeographics(clusters) {
  if (clusters.length <= 1) return clusters;

  const centroids = clusters.map((c) => computeCentroid(c));
  const validCentroids = centroids.filter(Boolean);
  if (validCentroids.length <= 1) return clusters;

  // Determine dominant axis
  const latSpread = Math.max(...validCentroids.map((c) => c.lat)) - Math.min(...validCentroids.map((c) => c.lat));
  const lngSpread = Math.max(...validCentroids.map((c) => c.lng)) - Math.min(...validCentroids.map((c) => c.lng));

  // Sort along the dominant axis
  return [...clusters].sort((a, b) => {
    const ca = computeCentroid(a);
    const cb = computeCentroid(b);
    if (!ca || !cb) return 0;
    if (lngSpread > latSpread) {
      // East-to-west or west-to-east
      return ca.lng - cb.lng;
    }
    // North-to-south or south-to-north
    return ca.lat - cb.lat;
  });
}

// Alias — the exported name uses the correct spelling
function sortClustersGeographically(clusters) {
  return sortClustersGeographics(clusters);
}

// ══════════════════════════════════════════════════════════════════════
//  INTRA-DAY ROUTING
// ══════════════════════════════════════════════════════════════════════

/**
 * Sort candidates within a day by geographic proximity (nearest-neighbor
 * greedy tour) to minimize intra-day travel.
 *
 * @param {Array} candidates - candidates for a single day
 * @param {object} startFrom - { latitude, longitude } starting point (hotel/arrival area)
 * @returns {Array} sorted candidates
 */
export function optimizeIntraDayRoute(candidates, startFrom) {
  if (!candidates || candidates.length <= 1) return candidates || [];

  const normalized = candidates.map(normalizeCoords);
  const withCoords = normalized.filter(
    (c) => typeof c.latitude === 'number' && typeof c.longitude === 'number'
  );
  const withoutCoords = normalized.filter(
    (c) => typeof c.latitude !== 'number' || typeof c.longitude !== 'number'
  );

  if (withCoords.length <= 1) return [...withCoords, ...withoutCoords];

  // Nearest-neighbor greedy tour from starting point
  const sorted = [];
  const remaining = [...withCoords];
  let current = startFrom || remaining[0];

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const km = haversineKm(
        current.latitude, current.longitude,
        remaining[i].latitude, remaining[i].longitude
      );
      if (km < bestDist) {
        bestDist = km;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    current = next;
  }

  return [...sorted, ...withoutCoords];
}

/**
 * Calculate total travel distance for a route.
 * @param {Array} route - ordered list of candidates
 * @returns {number} total distance in km
 */
export function totalRouteDistance(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    if (route[i].latitude == null || route[i - 1].latitude == null) continue;
    total += haversineKm(
      route[i - 1].latitude, route[i - 1].longitude,
      route[i].latitude, route[i].longitude
    );
  }
  return Math.round(total * 10) / 10;
}

/**
 * Calculate total estimated travel time for a route.
 * @param {Array} route - ordered list of candidates
 * @returns {number} total time in minutes
 */
export function totalRouteTime(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    if (route[i].latitude == null || route[i - 1].latitude == null) {
      total += 15; // default gap for unknown distance
      continue;
    }
    const km = haversineKm(
      route[i - 1].latitude, route[i - 1].longitude,
      route[i].latitude, route[i].longitude
    );
    const method = km < 1.5 ? 4.5 : km < 12 ? 30 : 25;
    total += estimateDriveMinutes(km, method);
  }
  return Math.round(total);
}

// ══════════════════════════════════════════════════════════════════════
//  RESTAURANT / NIGHTLIFE ATTACHMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Attach restaurants and nightlife to day zones by proximity.
 * Each restaurant/nightlife venue is assigned to the nearest day zone.
 *
 * @param {Array} restaurants - all restaurant candidates
 * @param {Array} nightlife - all nightlife candidates
 * @param {Array} dayAssignments - output of assignZonesToDays
 * @returns {Array} dayAssignments with restaurantPool and nightlifePool added
 */
export function attachSupportVenues(restaurants, nightlife, dayAssignments) {
  if (!dayAssignments?.length) return dayAssignments || [];

  for (const day of dayAssignments) {
    day.restaurantPool = [];
    day.nightlifePool = [];
  }

  // Group day assignments by their zone centroid to handle repeated zones.
  // When zones repeat (e.g., 2 clusters for 4 days), distribute venues
  // across all instances of the same zone.
  const uniqueCentroids = [];
  const centroidToDays = new Map();
  for (const day of dayAssignments) {
    const key = day.centroid ? `${day.centroid.lat},${day.centroid.lng}` : `no-centroid-${day.dayNumber}`;
    if (!centroidToDays.has(key)) {
      centroidToDays.set(key, []);
      uniqueCentroids.push({ key, centroid: day.centroid });
    }
    centroidToDays.get(key).push(day);
  }

  // Assign each restaurant to the nearest unique zone, then distribute
  // across repeated zone instances in round-robin.
  const zoneCounters = new Map();
  for (const r of restaurants || []) {
    if (r.latitude == null || r.longitude == null) continue;
    let bestKey = null;
    let bestDist = Infinity;
    for (const { key, centroid } of uniqueCentroids) {
      if (!centroid) {
        bestKey = key;
        break;
      }
      const km = haversineKm(centroid.lat, centroid.lng, r.latitude, r.longitude);
      if (km < bestDist) {
        bestDist = km;
        bestKey = key;
      }
    }
    if (bestKey) {
      const days = centroidToDays.get(bestKey);
      const idx = (zoneCounters.get(bestKey) || 0) % days.length;
      zoneCounters.set(bestKey, idx + 1);
      days[idx].restaurantPool.push(r);
    }
  }

  // Same for nightlife
  const nightCounters = new Map();
  for (const n of nightlife || []) {
    if (n.latitude == null || n.longitude == null) continue;
    let bestKey = null;
    let bestDist = Infinity;
    for (const { key, centroid } of uniqueCentroids) {
      if (!centroid) {
        bestKey = key;
        break;
      }
      const km = haversineKm(centroid.lat, centroid.lng, n.latitude, n.longitude);
      if (km < bestDist) {
        bestDist = km;
        bestKey = key;
      }
    }
    if (bestKey) {
      const days = centroidToDays.get(bestKey);
      const idx = (nightCounters.get(bestKey) || 0) % days.length;
      nightCounters.set(bestKey, idx + 1);
      days[idx].nightlifePool.push(n);
    }
  }

  return dayAssignments;
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full geographic clustering pipeline.
 *
 * @param {object} opts
 * @param {Array}  opts.attractions - validated attraction candidates
 * @param {Array}  opts.restaurants - validated restaurant candidates
 * @param {Array}  opts.nightlife - validated nightlife candidates
 * @param {Array}  opts.events - validated event candidates
 * @param {number} opts.daysCount - number of trip days
 * @param {string} opts.destination - destination name
 * @param {object} opts.hotelCentroid - { lat, lng } of the hotel location (if known)
 * @param {boolean} opts.logPipeline - whether to log pipeline steps
 * @returns {object} { dayAssignments, summary, clusterInfo }
 */
export function runGeographicClustering({
  attractions = [],
  restaurants = [],
  nightlife = [],
  events = [],
  daysCount = 3,
  destination = '',
  hotelCentroid = null,
  logPipeline = true,
} = {}) {
  const started = Date.now();

  // 1. Compute overall centroid and bounding radius
  const allCandidates = [...attractions, ...restaurants, ...nightlife];
  const centroid = hotelCentroid || computeCentroid(allCandidates);
  const boundingRadius = boundingRadiusKm(allCandidates, centroid);

  // 2. Compute adaptive clustering radius
  const clusterRadius = computeClusterRadius(daysCount, boundingRadius);

  // 3. Cluster attractions into geographic zones
  let attractionClusters = radiusClustering(attractions, clusterRadius);

  // 4. Merge small clusters
  const mergeThreshold = Math.max(MIN_CLUSTER_RADIUS_KM, clusterRadius * 0.6);
  attractionClusters = mergeSmallClusters(attractionClusters, mergeThreshold);

  // 5. If fewer clusters than days, reduce radius and re-cluster
  if (attractionClusters.length < daysCount && attractions.length >= daysCount * 2) {
    const tighterRadius = Math.max(MIN_CLUSTER_RADIUS_KM, clusterRadius * 0.5);
    let tighterClusters = radiusClustering(attractions, tighterRadius);
    tighterClusters = mergeSmallClusters(tighterClusters, mergeThreshold * 0.5);
    if (tighterClusters.length > attractionClusters.length) {
      attractionClusters = tighterClusters;
    }
  }

  // 6. If more clusters than days, merge closest pairs until we have enough
  while (attractionClusters.length > daysCount && attractionClusters.length > 1) {
    // Find the two closest clusters
    let bestI = 0, bestJ = 1, bestDist = Infinity;
    const centroids = attractionClusters.map((c) => computeCentroid(c));
    for (let i = 0; i < attractionClusters.length; i++) {
      for (let j = i + 1; j < attractionClusters.length; j++) {
        if (!centroids[i] || !centroids[j]) continue;
        const km = haversineKm(centroids[i].lat, centroids[i].lng, centroids[j].lat, centroids[j].lng);
        if (km < bestDist) {
          bestDist = km;
          bestI = i;
          bestJ = j;
        }
      }
    }
    // Merge j into i
    attractionClusters[bestI] = [...attractionClusters[bestI], ...attractionClusters[bestJ]];
    attractionClusters.splice(bestJ, 1);
  }

  // 7. Assign zones to days
  let dayAssignments = assignZonesToDays(attractionClusters, daysCount, destination);

  // Fallback: if no clusters (no attractions), create empty day assignments
  if (!dayAssignments.length && daysCount > 0) {
    dayAssignments = Array.from({ length: daysCount }, (_, i) => ({
      dayNumber: i + 1,
      zone: `Day ${i + 1} · ${destination || 'destination'}`,
      centroid: null,
      attractionPool: [],
      isRepeatedZone: true,
    }));
  }

  // 8. Attach restaurants and nightlife to zones
  dayAssignments = attachSupportVenues(restaurants, nightlife, dayAssignments);

  // 9. Optimize intra-day routes
  for (const day of dayAssignments) {
    const startFrom = hotelCentroid || day.centroid || { latitude: 0, longitude: 0 };
    day.attractionPool = optimizeIntraDayRoute(day.attractionPool, startFrom);
    day.restaurantPool = optimizeIntraDayRoute(day.restaurantPool, startFrom);
    day.routeDistanceKm = totalRouteDistance(day.attractionPool);
    day.routeTimeMin = totalRouteTime(day.attractionPool);
  }

  // 10. Build summary
  const summary = {
    totalDays: dayAssignments.length,
    totalAttractions: attractions.length,
    totalRestaurants: restaurants.length,
    totalNightlife: nightlife.length,
    clusterRadiusKm: clusterRadius,
    boundingRadiusKm: boundingRadius,
    clustersCreated: attractionClusters.length,
    avgAttractionsPerDay: dayAssignments.length
      ? Math.round((attractions.length / dayAssignments.length) * 10) / 10
      : 0,
    avgRouteDistanceKm: dayAssignments.length
      ? Math.round((dayAssignments.reduce((s, d) => s + (d.routeDistanceKm || 0), 0) / dayAssignments.length) * 10) / 10
      : 0,
    avgRouteTimeMin: dayAssignments.length
      ? Math.round(dayAssignments.reduce((s, d) => s + (d.routeTimeMin || 0), 0) / dayAssignments.length)
      : 0,
  };

  // 11. Log pipeline
  if (logPipeline) {
    logClusteringPipeline(dayAssignments, summary, destination);
  }

  const latencyMs = Date.now() - started;
  logger.info(`[GEO-CLUSTER] Pipeline complete in ${latencyMs}ms: ${summary.clustersCreated} clusters, ${summary.totalDays} days`);

  return { dayAssignments, summary, clusterInfo: { centroid, boundingRadius, clusterRadius } };
}

// ══════════════════════════════════════════════════════════════════════
//  LOGGING
// ══════════════════════════════════════════════════════════════════════

function logClusteringPipeline(dayAssignments, summary, destination) {
  logger.info(`[GEO-CLUSTER] ═══ Geographic Clustering: ${destination || 'destination'} ═══`);
  logger.info(`[GEO-CLUSTER] Bounding radius: ${summary.boundingRadiusKm}km, cluster radius: ${summary.clusterRadiusKm}km`);

  for (const day of dayAssignments) {
    const attractionNames = (day.attractionPool || []).slice(0, 5).map((a) => a.name || 'unnamed');
    const restaurantNames = (day.restaurantPool || []).slice(0, 3).map((r) => r.name || 'unnamed');
    logger.info(`[GEO-CLUSTER] Day ${day.dayNumber}: ${day.zone} | ` +
      `${day.attractionPool.length} attractions, ${day.restaurantPool.length} restaurants | ` +
      `route: ${day.routeDistanceKm || 0}km, ${day.routeTimeMin || 0}min` +
      (day.isRepeatedZone ? ' (repeated zone)' : ''));
    if (attractionNames.length) {
      logger.info(`[GEO-CLUSTER]   Attractions: ${attractionNames.join(', ')}`);
    }
    if (restaurantNames.length) {
      logger.info(`[GEO-CLUSTER]   Restaurants: ${restaurantNames.join(', ')}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  computeCentroid,
  boundingRadiusKm,
  pairwiseDistanceMatrix,
  computeClusterRadius,
  radiusClustering,
  mergeSmallClusters,
  assignZonesToDays,
  optimizeIntraDayRoute,
  totalRouteDistance,
  totalRouteTime,
  attachSupportVenues,
  runGeographicClustering,
};
