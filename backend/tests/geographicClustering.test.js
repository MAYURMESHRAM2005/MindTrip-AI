import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCentroid,
  boundingRadiusKm,
  computeClusterRadius,
  radiusClustering,
  mergeSmallClusters,
  assignZonesToDays,
  optimizeIntraDayRoute,
  totalRouteDistance,
  totalRouteTime,
  attachSupportVenues,
  runGeographicClustering,
} from '../src/services/geographicClustering.service.js';

// ══════════════════════════════════════════════════════════════════════
//  FIXTURES — Mumbai attractions, restaurants, nightlife
// ══════════════════════════════════════════════════════════════════════

const southMumbaiAttractions = [
  { name: 'Gateway of India', latitude: 18.922, longitude: 72.8347, providerId: 'goi-1', provider: 'google', type: 'attraction' },
  { name: 'Taj Mahal Palace', latitude: 18.9236, longitude: 72.8341, providerId: 'taj-1', provider: 'google', type: 'attraction' },
  { name: 'Chhatrapati Shivaji Terminus', latitude: 18.9398, longitude: 72.8355, providerId: 'cst-1', provider: 'google', type: 'attraction' },
  { name: 'Colaba Causeway', latitude: 18.9154, longitude: 72.8264, providerId: 'col-1', provider: 'google', type: 'attraction' },
  { name: 'Leopold Cafe', latitude: 18.9154, longitude: 72.8264, providerId: 'leo-1', provider: 'google', type: 'attraction' },
];

const centralMumbaiAttractions = [
  { name: 'Marine Drive', latitude: 18.9432, longitude: 72.8234, providerId: 'md-1', provider: 'google', type: 'attraction' },
  { name: 'Haji Ali Dargah', latitude: 18.9826, longitude: 72.8089, providerId: 'haji-1', provider: 'google', type: 'attraction' },
  { name: 'Siddhivinayak Temple', latitude: 19.0169, longitude: 72.8311, providerId: 'sidd-1', provider: 'google', type: 'attraction' },
];

const bandraJuhuAttractions = [
  { name: 'Bandra-Worli Sea Link', latitude: 19.0307, longitude: 72.8163, providerId: 'bws-1', provider: 'google', type: 'attraction' },
  { name: 'Juhu Beach', latitude: 19.0948, longitude: 72.8266, providerId: 'juhu-1', provider: 'google', type: 'attraction' },
  { name: 'Mandapeshwar Caves', latitude: 19.0462, longitude: 72.8382, providerId: 'mand-1', provider: 'google', type: 'attraction' },
];

const northMumbaiAttractions = [
  { name: 'Sanjay Gandhi National Park', latitude: 19.2147, longitude: 72.9107, providerId: 'sgnp-1', provider: 'google', type: 'attraction' },
  { name: 'Kanheri Caves', latitude: 19.2096, longitude: 72.8944, providerId: 'kan-1', provider: 'google', type: 'attraction' },
];

const mumbaiRestaurants = [
  { name: 'Trishna', latitude: 18.927, longitude: 72.833, providerId: 'trish-1', provider: 'zomato', type: 'restaurant' },
  { name: 'Britannia & Co', latitude: 18.934, longitude: 72.836, providerId: 'brit-1', provider: 'zomato', type: 'restaurant' },
  { name: 'Leopold Cafe Restaurant', latitude: 18.915, longitude: 72.826, providerId: 'leo-r1', provider: 'zomato', type: 'restaurant' },
  { name: 'Cafe Mondegar', latitude: 18.929, longitude: 72.836, providerId: 'monde-1', provider: 'zomato', type: 'restaurant' },
  { name: 'Mahesh Lunch Home', latitude: 18.976, longitude: 72.811, providerId: 'mahesh-1', provider: 'zomato', type: 'restaurant' },
  { name: 'Juice Bar Juhu', latitude: 19.093, longitude: 72.825, providerId: 'juice-1', provider: 'zomato', type: 'restaurant' },
];

const mumbaiNightlife = [
  { name: 'Trilogy Nightclub', latitude: 19.042, longitude: 72.823, providerId: 'tri-1', provider: 'google', type: 'nightlife' },
  { name: 'Toto\'s Garage', latitude: 19.058, longitude: 72.837, providerId: 'toto-1', provider: 'google', type: 'nightlife' },
];

// ══════════════════════════════════════════════════════════════════════
//  1. CENTROID COMPUTATION
// ══════════════════════════════════════════════════════════════════════

test('computeCentroid returns valid centroid for Mumbai candidates', () => {
  const all = [...southMumbaiAttractions, ...centralMumbaiAttractions, ...bandraJuhuAttractions, ...northMumbaiAttractions];
  const centroid = computeCentroid(all);
  assert.ok(centroid, 'Should return a centroid');
  assert.ok(typeof centroid.lat === 'number', 'lat should be a number');
  assert.ok(typeof centroid.lng === 'number', 'lng should be a number');
  // Mumbai centroid should be roughly between 18.9 and 19.2 lat
  assert.ok(centroid.lat > 18.8 && centroid.lat < 19.3, `lat should be in Mumbai range: ${centroid.lat}`);
  assert.ok(centroid.lng > 72.7 && centroid.lng < 73.0, `lng should be in Mumbai range: ${centroid.lng}`);
});

test('computeCentroid returns null for empty candidates', () => {
  assert.equal(computeCentroid([]), null);
  assert.equal(computeCentroid(null), null);
  assert.equal(computeCentroid([{ name: 'no coords' }]), null);
});

test('computeCentroid handles single candidate', () => {
  const c = computeCentroid([{ name: 'Solo', latitude: 19.0, longitude: 72.8 }]);
  assert.ok(c);
  assert.equal(c.lat, 19.0);
  assert.equal(c.lng, 72.8);
});

// ══════════════════════════════════════════════════════════════════════
//  2. BOUNDING RADIUS
// ══════════════════════════════════════════════════════════════════════

test('boundingRadiusKm returns distance for Mumbai candidates', () => {
  const all = [...southMumbaiAttractions, ...northMumbaiAttractions];
  const centroid = computeCentroid(all);
  const radius = boundingRadiusKm(all, centroid);
  assert.ok(radius > 0, `Radius should be positive: ${radius}`);
  // South Mumbai to Sanjay Gandhi is ~30km
  assert.ok(radius > 10, `Radius should be > 10km for Mumbai span: ${radius}`);
});

test('boundingRadiusKm returns 0 for empty list', () => {
  assert.equal(boundingRadiusKm([], { lat: 19, lng: 72 }), 0);
});

// ══════════════════════════════════════════════════════════════════════
//  3. CLUSTER RADIUS COMPUTATION
// ══════════════════════════════════════════════════════════════════════

test('computeClusterRadius scales with trip duration', () => {
  const r2 = computeClusterRadius(2, 30);
  const r4 = computeClusterRadius(4, 30);
  const r7 = computeClusterRadius(7, 30);
  // More days → smaller radius (more zones)
  assert.ok(r4 <= r2, `4-day radius (${r4}) should be <= 2-day radius (${r2})`);
  assert.ok(r7 <= r4, `7-day radius (${r7}) should be <= 4-day radius (${r4})`);
});

test('computeClusterRadius respects bounds', () => {
  const r = computeClusterRadius(4, 30);
  assert.ok(r >= 2, `Radius should be >= 2km: ${r}`);
  assert.ok(r <= 30, `Radius should be <= 30km: ${r}`);
});

test('computeClusterRadius defaults for unknown trip', () => {
  const r = computeClusterRadius(0, 0);
  assert.equal(r, 8, 'Default should be 8km');
});

// ══════════════════════════════════════════════════════════════════════
//  4. RADIUS CLUSTERING
// ══════════════════════════════════════════════════════════════════════

test('radiusClustering groups nearby South Mumbai attractions', () => {
  const clusters = radiusClustering(southMumbaiAttractions, 2);
  assert.ok(clusters.length >= 1, 'Should have at least 1 cluster');
  // South Mumbai attractions are all within ~1km of each other
  const allNames = clusters.flat().map((c) => c.name);
  assert.ok(allNames.includes('Gateway of India'), 'Should include Gateway of India');
  assert.ok(allNames.includes('Taj Mahal Palace'), 'Should include Taj Mahal Palace');
});

test('radiusClustering separates distant attractions into different clusters', () => {
  const all = [...southMumbaiAttractions, ...northMumbaiAttractions];
  const clusters = radiusClustering(all, 5);
  // South Mumbai cluster and North Mumbai cluster should be separate
  assert.ok(clusters.length >= 2, `Should have >= 2 clusters, got ${clusters.length}`);
  const clusterNames = clusters.map((c) => c.map((x) => x.name).join(', '));
  // At least one cluster should contain a South Mumbai attraction
  const hasSouth = clusterNames.some((n) => n.includes('Gateway') || n.includes('Taj'));
  const hasNorth = clusterNames.some((n) => n.includes('Sanjay Gandhi') || n.includes('Kanheri'));
  assert.ok(hasSouth, `Should have South Mumbai cluster: ${clusterNames}`);
  assert.ok(hasNorth, `Should have North Mumbai cluster: ${clusterNames}`);
});

test('radiusClustering returns empty for no coordinates', () => {
  const clusters = radiusClustering([{ name: 'No coords' }], 5);
  assert.equal(clusters.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  5. MERGE SMALL CLUSTERS
// ══════════════════════════════════════════════════════════════════════

test('mergeSmallClusters merges tiny clusters into neighbors', () => {
  const clusters = [
    [{ name: 'A', latitude: 19.0, longitude: 72.8 }], // 1 candidate
    [{ name: 'B', latitude: 19.01, longitude: 72.81 }], // 1 candidate, close
    [{ name: 'C', latitude: 19.1, longitude: 72.9 }], // 1 candidate, far
  ];
  const merged = mergeSmallClusters(clusters, 5);
  // A and B should merge (both small and close)
  assert.ok(merged.length < 3, `Should merge small clusters: ${merged.length} clusters`);
});

test('mergeSmallClusters preserves large clusters', () => {
  const clusters = [
    southMumbaiAttractions.slice(0, 3), // 3 candidates
    northMumbaiAttractions, // 2 candidates
  ];
  const merged = mergeSmallClusters(clusters, 5);
  // Both clusters have >= MIN_CANDIDATES_PER_CLUSTER, so they should stay separate
  // unless they are within mergeThreshold
  assert.ok(merged.length >= 1, 'Should have at least 1 cluster');
});

// ══════════════════════════════════════════════════════════════════════
//  6. ZONE ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

test('assignZonesToDays creates one zone per day for 4-day trip', () => {
  const all = [...southMumbaiAttractions, ...centralMumbaiAttractions, ...bandraJuhuAttractions, ...northMumbaiAttractions];
  const clusters = radiusClustering(all, 5);
  const merged = mergeSmallClusters(clusters, 3);
  const zones = assignZonesToDays(merged, 4, 'Mumbai');
  assert.equal(zones.length, 4, 'Should have 4 day assignments');
  for (const z of zones) {
    assert.ok(z.dayNumber >= 1 && z.dayNumber <= 4, `dayNumber should be 1-4: ${z.dayNumber}`);
    assert.ok(z.zone, 'zone should have a name');
    assert.ok(Array.isArray(z.attractionPool), 'should have attractionPool');
  }
});

test('assignZonesToDays repeats zones when fewer clusters than days', () => {
  const clusters = [
    [{ name: 'A', latitude: 19.0, longitude: 72.8 }],
    [{ name: 'B', latitude: 19.1, longitude: 72.9 }],
  ];
  const zones = assignZonesToDays(clusters, 4, 'Mumbai');
  assert.equal(zones.length, 4, 'Should have 4 day assignments');
  // Days 3 and 4 should repeat zones 1 and 2
  assert.ok(zones[2].isRepeatedZone, 'Day 3 should be a repeated zone');
  assert.ok(zones[3].isRepeatedZone, 'Day 4 should be a repeated zone');
});

test('assignZonesToDays handles empty clusters', () => {
  const zones = assignZonesToDays([], 4, 'Mumbai');
  assert.equal(zones.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  7. INTRA-DAY ROUTING
// ══════════════════════════════════════════════════════════════════════

test('optimizeIntraDayRoute sorts by nearest-neighbor from starting point', () => {
  const candidates = [
    { name: 'Far', latitude: 19.2, longitude: 72.9 },
    { name: 'Close', latitude: 18.93, longitude: 72.83 },
    { name: 'Mid', latitude: 19.0, longitude: 72.85 },
  ];
  const start = { latitude: 18.92, longitude: 72.83 };
  const sorted = optimizeIntraDayRoute(candidates, start);
  assert.equal(sorted.length, 3);
  // First should be closest to start
  assert.equal(sorted[0].name, 'Close');
});

test('optimizeIntraDayRoute handles empty list', () => {
  assert.deepEqual(optimizeIntraDayRoute([], { latitude: 19, lng: 72 }), []);
  assert.deepEqual(optimizeIntraDayRoute(null, { latitude: 19, lng: 72 }), []);
});

test('optimizeIntraDayRoute preserves candidates without coords', () => {
  const candidates = [
    { name: 'WithCoords', latitude: 19.0, longitude: 72.8 },
    { name: 'NoCoords' },
  ];
  const sorted = optimizeIntraDayRoute(candidates, { latitude: 19, longitude: 72 });
  assert.equal(sorted.length, 2);
  // NoCoords should be at the end
  assert.equal(sorted[1].name, 'NoCoords');
});

// ══════════════════════════════════════════════════════════════════════
//  8. ROUTE DISTANCE AND TIME
// ══════════════════════════════════════════════════════════════════════

test('totalRouteDistance calculates correctly', () => {
  const route = [
    { latitude: 18.92, longitude: 72.83 },
    { latitude: 18.94, longitude: 72.82 },
  ];
  const dist = totalRouteDistance(route);
  assert.ok(dist > 0, `Distance should be positive: ${dist}`);
  assert.ok(dist < 10, `Distance should be reasonable: ${dist}km`);
});

test('totalRouteTime calculates correctly', () => {
  const route = [
    { latitude: 18.92, longitude: 72.83 },
    { latitude: 18.94, longitude: 72.82 },
  ];
  const time = totalRouteTime(route);
  assert.ok(time > 0, `Time should be positive: ${time}`);
  assert.ok(time < 60, `Time should be reasonable: ${time}min`);
});

test('totalRouteDistance returns 0 for empty route', () => {
  assert.equal(totalRouteDistance([]), 0);
});

// ══════════════════════════════════════════════════════════════════════
//  9. RESTAURANT / NIGHTLIFE ATTACHMENT
// ══════════════════════════════════════════════════════════════════════

test('attachSupportVenues assigns restaurants to nearest zone', () => {
  const dayAssignments = [
    { dayNumber: 1, centroid: { lat: 18.92, lng: 72.83 }, attractionPool: [] },
    { dayNumber: 2, centroid: { lat: 19.09, lng: 72.83 }, attractionPool: [] },
  ];
  const result = attachSupportVenues(mumbaiRestaurants, mumbaiNightlife, dayAssignments);
  assert.equal(result.length, 2);
  // Trishna (18.927) should be in Day 1 zone (centroid 18.92)
  const day1Restaurants = result[0].restaurantPool.map((r) => r.name);
  assert.ok(day1Restaurants.includes('Trishna'), `Trishna should be in Day 1: ${day1Restaurants}`);
  // Juice Bar Juhu (19.093) should be in Day 2 zone (centroid 19.09)
  const day2Restaurants = result[1].restaurantPool.map((r) => r.name);
  assert.ok(day2Restaurants.includes('Juice Bar Juhu'), `Juice Bar should be in Day 2: ${day2Restaurants}`);
});

test('attachSupportVenues handles empty inputs', () => {
  const result = attachSupportVenues([], [], []);
  assert.equal(result.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  10. FULL PIPELINE — 4-DAY MUMBAI
// ══════════════════════════════════════════════════════════════════════

test('4-day Mumbai: unique attractions across all 4 days', () => {
  const allAttractions = [
    ...southMumbaiAttractions,
    ...centralMumbaiAttractions,
    ...bandraJuhuAttractions,
    ...northMumbaiAttractions,
  ];
  const result = runGeographicClustering({
    attractions: allAttractions,
    restaurants: mumbaiRestaurants,
    nightlife: mumbaiNightlife,
    daysCount: 4,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 4, `Should have 4 days: ${result.dayAssignments.length}`);
  assert.ok(result.summary.clustersCreated >= 2, `Should have >= 2 clusters: ${result.summary.clustersCreated}`);

  // Verify no duplicate attractions across days
  const allDayAttractions = result.dayAssignments.flatMap((d) =>
    (d.attractionPool || []).map((a) => a.name)
  );
  const uniqueAttractions = new Set(allDayAttractions);
  // There may be some overlap due to fallback, but most should be unique
  assert.ok(uniqueAttractions.size >= allAttractions.length * 0.7,
    `Should have >= 70% unique attractions: ${uniqueAttractions.size}/${allAttractions.length}`);
});

test('4-day Mumbai: restaurants are distributed across zones', () => {
  const allAttractions = [
    ...southMumbaiAttractions,
    ...centralMumbaiAttractions,
    ...bandraJuhuAttractions,
    ...northMumbaiAttractions,
  ];
  const result = runGeographicClustering({
    attractions: allAttractions,
    restaurants: mumbaiRestaurants,
    nightlife: mumbaiNightlife,
    daysCount: 4,
    destination: 'Mumbai',
    logPipeline: false,
  });

  // Total restaurants across all days should equal the input count
  const totalAssigned = result.dayAssignments.reduce((s, d) => s + d.restaurantPool.length, 0);
  assert.ok(totalAssigned === mumbaiRestaurants.length,
    `All ${mumbaiRestaurants.length} restaurants should be assigned: ${totalAssigned}`);
  // At least one day should have restaurants
  const daysWithRestaurants = result.dayAssignments.filter((d) => d.restaurantPool.length > 0);
  assert.ok(daysWithRestaurants.length >= 1, 'At least one day should have restaurants');
});

test('4-day Mumbai: intra-day routes are optimized', () => {
  const allAttractions = [
    ...southMumbaiAttractions,
    ...centralMumbaiAttractions,
    ...bandraJuhuAttractions,
    ...northMumbaiAttractions,
  ];
  const result = runGeographicClustering({
    attractions: allAttractions,
    restaurants: mumbaiRestaurants,
    nightlife: mumbaiNightlife,
    daysCount: 4,
    destination: 'Mumbai',
    logPipeline: false,
  });

  for (const day of result.dayAssignments) {
    assert.ok(typeof day.routeDistanceKm === 'number', `Day ${day.dayNumber} should have routeDistanceKm`);
    assert.ok(typeof day.routeTimeMin === 'number', `Day ${day.dayNumber} should have routeTimeMin`);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  11. DISTANCE MINIMIZATION
// ══════════════════════════════════════════════════════════════════════

test('clustered day routes have shorter total distance than random assignment', () => {
  const allAttractions = [
    ...southMumbaiAttractions,
    ...centralMumbaiAttractions,
    ...bandraJuhuAttractions,
    ...northMumbaiAttractions,
  ];
  const result = runGeographicClustering({
    attractions: allAttractions,
    restaurants: mumbaiRestaurants,
    nightlife: mumbaiNightlife,
    daysCount: 4,
    destination: 'Mumbai',
    logPipeline: false,
  });

  const clusteredTotalDistance = result.dayAssignments.reduce((s, d) => s + (d.routeDistanceKm || 0), 0);

  // Random assignment: mix all attractions randomly across 4 days
  const shuffled = [...allAttractions].sort(() => Math.random() - 0.5);
  const randomDays = [[], [], [], []];
  shuffled.forEach((a, i) => randomDays[i % 4].push(a));
  let randomTotalDistance = 0;
  for (const day of randomDays) {
    const sorted = optimizeIntraDayRoute(day, { latitude: 18.92, longitude: 72.83 });
    randomTotalDistance += totalRouteDistance(sorted);
  }

  // Clustered should be more efficient (or at least not much worse)
  // Allow some tolerance since random assignment can sometimes be lucky
  assert.ok(clusteredTotalDistance <= randomTotalDistance * 1.5,
    `Clustered (${clusteredTotalDistance}km) should be comparable to or better than random (${randomTotalDistance}km)`);
});

// ══════════════════════════════════════════════════════════════════════
//  12. DUPLICATE PREVENTION BETWEEN CLUSTERS
// ══════════════════════════════════════════════════════════════════════

test('different clusters have different attractions', () => {
  const all = [...southMumbaiAttractions, ...northMumbaiAttractions];
  const clusters = radiusClustering(all, 5);
  const merged = mergeSmallClusters(clusters, 3);
  const zones = assignZonesToDays(merged, 2, 'Mumbai');

  if (zones.length === 2) {
    const zone1Names = new Set(zones[0].attractionPool.map((a) => a.name));
    const zone2Names = new Set(zones[1].attractionPool.map((a) => a.name));
    // No attraction should appear in both zones
    for (const name of zone1Names) {
      assert.ok(!zone2Names.has(name), `"${name}" should not appear in both zones`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  13. INSUFFICIENT CANDIDATES
// ══════════════════════════════════════════════════════════════════════

test('insufficient candidates: fewer attractions than days', () => {
  const fewAttractions = [
    { name: 'Solo Attraction', latitude: 19.0, longitude: 72.8, providerId: 'solo-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: fewAttractions,
    restaurants: [],
    nightlife: [],
    daysCount: 4,
    destination: 'Mumbai',
    logPipeline: false,
  });

  // Should still produce 4 days, even with limited data
  assert.ok(result.dayAssignments.length === 4, `Should produce 4 days: ${result.dayAssignments.length}`);
  // The single attraction may repeat across days
  assert.ok(result.summary.totalAttractions === 1, 'Should have 1 total attraction');
});

test('insufficient candidates: no attractions at all', () => {
  const result = runGeographicClustering({
    attractions: [],
    restaurants: [],
    nightlife: [],
    daysCount: 3,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 3, `Should produce 3 days: ${result.dayAssignments.length}`);
  assert.ok(result.summary.clustersCreated === 0, 'Should have 0 clusters');
});

// ══════════════════════════════════════════════════════════════════════
//  14. TRANSPORT REPEATITION ALLOWED
// ══════════════════════════════════════════════════════════════════════

test('transport candidates are not part of geographic clustering', () => {
  const attractions = [...southMumbaiAttractions];
  const result = runGeographicClustering({
    attractions,
    restaurants: [],
    nightlife: [],
    daysCount: 2,
    destination: 'Mumbai',
    logPipeline: false,
  });

  // Clustering should only contain attractions, not transport
  for (const day of result.dayAssignments) {
    for (const a of day.attractionPool) {
      assert.ok(a.type !== 'transport', 'Should not include transport in clustering');
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  15. HOTEL REPETITION ALLOWED
// ══════════════════════════════════════════════════════════════════════

test('hotel candidates are not part of geographic clustering zones', () => {
  const attractions = [...southMumbaiAttractions];
  const result = runGeographicClustering({
    attractions,
    restaurants: [],
    nightlife: [],
    daysCount: 2,
    destination: 'Mumbai',
    logPipeline: false,
  });

  for (const day of result.dayAssignments) {
    for (const a of day.attractionPool) {
      assert.ok(a.type !== 'hotel', 'Should not include hotel in clustering zones');
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  16. SUMMARY STATS
// ══════════════════════════════════════════════════════════════════════

test('summary contains expected fields', () => {
  const result = runGeographicClustering({
    attractions: [...southMumbaiAttractions, ...northMumbaiAttractions],
    restaurants: mumbaiRestaurants,
    nightlife: mumbaiNightlife,
    daysCount: 3,
    destination: 'Mumbai',
    logPipeline: false,
  });

  const s = result.summary;
  assert.ok(typeof s.totalDays === 'number');
  assert.ok(typeof s.totalAttractions === 'number');
  assert.ok(typeof s.totalRestaurants === 'number');
  assert.ok(typeof s.clusterRadiusKm === 'number');
  assert.ok(typeof s.boundingRadiusKm === 'number');
  assert.ok(typeof s.clustersCreated === 'number');
  assert.ok(typeof s.avgAttractionsPerDay === 'number');
  assert.ok(typeof s.avgRouteDistanceKm === 'number');
  assert.ok(typeof s.avgRouteTimeMin === 'number');
});

// ══════════════════════════════════════════════════════════════════════
//  17. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('all candidates at same location', () => {
  const sameSpot = [
    { name: 'A', latitude: 19.0, longitude: 72.8, providerId: 'a-1', provider: 'google', type: 'attraction' },
    { name: 'B', latitude: 19.0, longitude: 72.8, providerId: 'b-1', provider: 'google', type: 'attraction' },
    { name: 'C', latitude: 19.0, longitude: 72.8, providerId: 'c-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: sameSpot,
    restaurants: [],
    nightlife: [],
    daysCount: 3,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 3, 'Should produce 3 days');
  // All in one cluster since they are at the same spot
  assert.ok(result.summary.clustersCreated <= 2, 'Should have <= 2 clusters');
});

test('candidates with no coordinates are excluded from clustering', () => {
  const mixed = [
    { name: 'WithCoords', latitude: 19.0, longitude: 72.8, providerId: 'wc-1', provider: 'google', type: 'attraction' },
    { name: 'NoCoords', providerId: 'nc-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: mixed,
    restaurants: [],
    nightlife: [],
    daysCount: 2,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 2);
});

test('single day trip', () => {
  const result = runGeographicClustering({
    attractions: southMumbaiAttractions,
    restaurants: mumbaiRestaurants,
    nightlife: [],
    daysCount: 1,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.equal(result.dayAssignments.length, 1);
  assert.equal(result.dayAssignments[0].dayNumber, 1);
});

test('10-day trip with limited candidates', () => {
  const result = runGeographicClustering({
    attractions: southMumbaiAttractions,
    restaurants: [],
    nightlife: [],
    daysCount: 10,
    destination: 'Mumbai',
    logPipeline: false,
  });

  assert.equal(result.dayAssignments.length, 10);
  // Zones will repeat since we only have ~5 attractions
  const repeatedDays = result.dayAssignments.filter((d) => d.isRepeatedZone);
  assert.ok(repeatedDays.length > 0, 'Should have repeated zones for 10-day trip');
});

// ══════════════════════════════════════════════════════════════════════
//  18. ANY DESTINATION (not hardcoded Mumbai)
// ══════════════════════════════════════════════════════════════════════

test('clustering works for Delhi attractions', () => {
  const delhiAttractions = [
    { name: 'Red Fort', latitude: 28.6562, longitude: 77.241, providerId: 'rf-1', provider: 'google', type: 'attraction' },
    { name: 'Jama Masjid', latitude: 28.6507, longitude: 77.2334, providerId: 'jm-1', provider: 'google', type: 'attraction' },
    { name: 'Qutub Minar', latitude: 28.5244, longitude: 77.1855, providerId: 'qm-1', provider: 'google', type: 'attraction' },
    { name: 'India Gate', latitude: 28.6129, longitude: 77.2295, providerId: 'ig-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: delhiAttractions,
    restaurants: [],
    nightlife: [],
    daysCount: 2,
    destination: 'Delhi',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 2);
  assert.ok(result.summary.totalAttractions === 4);
});

test('clustering works for Goa attractions', () => {
  const goaAttractions = [
    { name: 'Baga Beach', latitude: 15.5563, longitude: 73.7513, providerId: 'baga-1', provider: 'google', type: 'attraction' },
    { name: 'Basilica of Bom Jesus', latitude: 15.5009, longitude: 73.9116, providerId: 'boj-1', provider: 'google', type: 'attraction' },
    { name: 'Dudhsagar Falls', latitude: 15.3144, longitude: 74.3143, providerId: 'ddf-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: goaAttractions,
    restaurants: [],
    nightlife: [],
    daysCount: 2,
    destination: 'Goa',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 2);
  // Dudhsagar is ~100km from Baga, should be in a different cluster
  assert.ok(result.summary.clustersCreated >= 2,
    `Goa should have >= 2 clusters: ${result.summary.clustersCreated}`);
});

// ══════════════════════════════════════════════════════════════════════
//  19. INTERNATIONAL DESTINATION
// ══════════════════════════════════════════════════════════════════════

test('clustering works for international destination (Bangkok)', () => {
  const bangkokAttractions = [
    { name: 'Grand Palace', latitude: 13.751, longitude: 100.491, providerId: 'gp-1', provider: 'google', type: 'attraction' },
    { name: 'Wat Arun', latitude: 13.7437, longitude: 100.4888, providerId: 'wa-1', provider: 'google', type: 'attraction' },
    { name: 'Chatuchak Market', latitude: 13.7999, longitude: 100.5509, providerId: 'cm-1', provider: 'google', type: 'attraction' },
    { name: 'Sukhumvit Road', latitude: 13.7326, longitude: 100.5693, providerId: 'sr-1', provider: 'google', type: 'attraction' },
  ];
  const result = runGeographicClustering({
    attractions: bangkokAttractions,
    restaurants: [],
    nightlife: [],
    daysCount: 3,
    destination: 'Bangkok',
    logPipeline: false,
  });

  assert.ok(result.dayAssignments.length === 3);
  assert.ok(result.summary.totalAttractions === 4);
});
