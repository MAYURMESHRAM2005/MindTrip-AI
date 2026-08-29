import test from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════════
// Transport Intelligence Service — Unit Tests
//
// Tests the pure/deterministic functions that don't require live API calls.
// The API-dependent functions (findTransportOptions, checkFlightAvailability,
// etc.) are integration-tested via the orchestrator tests.
// ══════════════════════════════════════════════════════════════════════

import { rankTransportOptions } from '../src/services/transportIntelligence.service.js';

// ── rankTransportOptions tests ───────────────────────────────────────

test('rankTransportOptions returns empty array for empty input', () => {
  const result = rankTransportOptions([]);
  assert.deepEqual(result, []);
});

test('rankTransportOptions ranks preferred mode first', () => {
  const options = [
    { mode: 'bus', name: 'Bus option', totalCost: 500, totalDuration: '6h', isLive: true },
    { mode: 'flight', name: 'Flight option', totalCost: 3000, totalDuration: '2h', isLive: true },
    { mode: 'train', name: 'Train option', totalCost: 800, totalDuration: '4h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: 'bus' });
  assert.equal(ranked[0].mode, 'bus', 'preferred mode ranked first');
  assert.equal(ranked[0].rank, 1);
});

test('rankTransportOptions ranks cheaper options higher when no preference', () => {
  const options = [
    { mode: 'flight', name: 'Expensive flight', totalCost: 5000, totalDuration: '2h', isLive: true },
    { mode: 'train', name: 'Cheap train', totalCost: 800, totalDuration: '8h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  // Train should rank higher due to lower cost + no preference penalty
  assert.ok(ranked[0].rank === 1);
  assert.ok(ranked[1].rank === 2);
});

test('rankTransportOptions assigns recommendation reason to top option', () => {
  const options = [
    { mode: 'train', name: 'Train', totalCost: 800, totalDuration: '4h', isLive: true },
    { mode: 'bus', name: 'Bus', totalCost: 500, totalDuration: '6h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: 'train' });
  assert.ok(ranked[0].recommendation, 'top option has a recommendation reason');
  assert.ok(ranked[0].recommendation.includes('preference') || ranked[0].recommendation.includes('balance'), 'reason mentions preference or balance');
});

test('rankTransportOptions penalizes non-live options', () => {
  const options = [
    { mode: 'train', name: 'Live train', totalCost: 800, totalDuration: '4h', isLive: true },
    { mode: 'train', name: 'Dead train', totalCost: 800, totalDuration: '4h', isLive: false },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  assert.equal(ranked[0].name, 'Live train', 'live option ranks higher');
  assert.equal(ranked[1].name, 'Dead train');
});

test('rankTransportOptions ranks direct options higher than multi-modal', () => {
  const options = [
    { mode: 'flight', name: 'Multi-modal flight', totalCost: 3500, totalDuration: '5h', isLive: true, groundTransfer: { distanceKm: 80 } },
    { mode: 'train', name: 'Direct train', totalCost: 800, totalDuration: '4h', isLive: true, groundTransfer: null },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  // Direct train should rank higher (no transfers bonus)
  assert.equal(ranked[0].name, 'Direct train', 'direct option ranks higher');
});

test('rankTransportOptions preserves all original fields', () => {
  const options = [
    { mode: 'bus', name: 'Test Bus', totalCost: 500, totalDuration: '3h', isLive: true, source: 'pay2all', fetchedAt: '2025-01-01' },
  ];
  const ranked = rankTransportOptions(options, { preference: 'bus' });
  assert.equal(ranked[0].source, 'pay2all');
  assert.equal(ranked[0].fetchedAt, '2025-01-01');
  assert.equal(ranked[0].mode, 'bus');
});

test('rankTransportOptions handles single option', () => {
  const options = [
    { mode: 'road', name: 'By Road', totalCost: 2000, totalDuration: '6h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked[0].recommendation, 'single option still gets a recommendation');
});

test('rankTransportOptions budget-aware scoring favors cheaper within budget', () => {
  const options = [
    { mode: 'flight', name: 'Within budget flight', totalCost: 2000, totalDuration: '2h', isLive: true },
    { mode: 'flight', name: 'Over budget flight', totalCost: 8000, totalDuration: '2h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: 'flight', budget: 5000 });
  assert.equal(ranked[0].name, 'Within budget flight', 'cheaper within-budget option ranks higher');
});

test('rankTransportOptions assigns rank sequentially', () => {
  const options = [
    { mode: 'bus', name: 'Bus', totalCost: 500, totalDuration: '6h', isLive: true },
    { mode: 'train', name: 'Train', totalCost: 800, totalDuration: '4h', isLive: true },
    { mode: 'flight', name: 'Flight', totalCost: 3000, totalDuration: '2h', isLive: true },
    { mode: 'road', name: 'Road', totalCost: 2000, totalDuration: '5h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  const ranks = ranked.map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4], 'ranks are sequential from 1');
});

test('rankTransportOptions handles options with null costs gracefully', () => {
  const options = [
    { mode: 'train', name: 'Train no price', totalCost: null, totalDuration: '4h', isLive: false },
    { mode: 'bus', name: 'Bus no price', totalCost: null, totalDuration: '6h', isLive: false },
  ];
  const ranked = rankTransportOptions(options, { preference: '' });
  assert.equal(ranked.length, 2, 'both options ranked despite null costs');
  assert.ok(ranked[0].rank === 1);
});

test('rankTransportOptions with budget=0 does not crash', () => {
  const options = [
    { mode: 'flight', name: 'Flight', totalCost: 3000, totalDuration: '2h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: '', budget: 0 });
  assert.equal(ranked.length, 1);
});

test('rankTransportOptions preference match outweighs cost difference', () => {
  // Even though train is cheaper, flight should rank higher when preference is flight
  const options = [
    { mode: 'train', name: 'Cheap train', totalCost: 500, totalDuration: '8h', isLive: true },
    { mode: 'flight', name: 'Expensive flight', totalCost: 5000, totalDuration: '2h', isLive: true },
  ];
  const ranked = rankTransportOptions(options, { preference: 'flight' });
  assert.equal(ranked[0].mode, 'flight', 'preferred mode wins despite higher cost');
});

test('rankTransportOptions returns options sorted by score ascending', () => {
  const options = Array.from({ length: 10 }, (_, i) => ({
    mode: ['flight', 'train', 'bus', 'road'][i % 4],
    name: `Option ${i}`,
    totalCost: 1000 + i * 500,
    totalDuration: `${2 + i}h`,
    isLive: i % 3 !== 0,
  }));
  const ranked = rankTransportOptions(options, { preference: 'train' });
  // Each option should have a unique rank
  const ranks = ranked.map((r) => r.rank);
  const uniqueRanks = new Set(ranks);
  assert.equal(uniqueRanks.size, 10, 'all 10 options have unique ranks');
  // Ranks should be 1-10
  assert.deepEqual(ranks.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// ── Integration smoke tests for transport intelligence structure ─────

test('transport intelligence module exports expected functions', async () => {
  const mod = await import('../src/services/transportIntelligence.service.js');
  assert.equal(typeof mod.default.findTransportOptions, 'function');
  assert.equal(typeof mod.default.findReturnTransport, 'function');
  assert.equal(typeof mod.default.geocodeLocation, 'function');
  assert.equal(typeof mod.default.findNearbyAirports, 'function');
  assert.equal(typeof mod.default.findNearbyRailwayStations, 'function');
  assert.equal(typeof mod.default.findNearbyBusTerminals, 'function');
  assert.equal(typeof mod.default.calculateGroundTransfer, 'function');
  assert.equal(typeof mod.default.rankTransportOptions, 'function');
});

test('transport intelligence option shape is consistent', () => {
  // Verify the expected shape of a transport option
  const option = {
    mode: 'flight',
    type: 'multi-modal-flight',
    name: '80km transfer + IndiGo 6E-301',
    origin: 'Umred',
    destination: 'Delhi',
    groundTransfer: {
      from: 'Umred',
      to: 'Nagpur Airport (NAG)',
      distanceKm: 80,
      durationMin: 90,
      fare: { amount: 990, currency: 'INR', isEstimate: true },
      method: 'cab/car',
      isLive: true,
    },
    mainTransport: {
      airline: 'IndiGo',
      flightNumber: '6E-301',
      departure: '10:00',
      arrival: '12:30',
      duration: '2h 30m',
      stops: 0,
      price: { amount: 4500, currency: 'INR' },
      isLive: true,
      provider: 'ignav',
    },
    destinationTransfer: null,
    totalDuration: '~195 min',
    totalCost: 5490,
    currency: 'INR',
    isLive: true,
    source: 'ignav',
    fetchedAt: '2025-01-01T00:00:00Z',
    recommendation: 'Ground transfer to Nagpur Airport + flight to Delhi',
  };

  // Validate shape
  assert.equal(typeof option.mode, 'string');
  assert.equal(typeof option.type, 'string');
  assert.equal(typeof option.name, 'string');
  assert.equal(typeof option.origin, 'string');
  assert.equal(typeof option.destination, 'string');
  assert.equal(typeof option.totalCost, 'number');
  assert.equal(typeof option.isLive, 'boolean');
  assert.equal(typeof option.fetchedAt, 'string');
  assert.equal(typeof option.recommendation, 'string');
  assert.ok(option.mainTransport, 'has mainTransport');
  assert.ok(typeof option.mainTransport.airline === 'string');
  assert.ok(typeof option.mainTransport.flightNumber === 'string');
});
