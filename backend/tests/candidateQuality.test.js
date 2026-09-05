import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCandidateQuality,
  filterByQuality,
  getQualitySummary,
  MIN_QUALITY_SCORE,
  SCORE_WEIGHTS,
} from '../src/services/candidateQuality.service.js';

// ══════════════════════════════════════════════════════════════════════
//  HELPER: Build a high-quality candidate fixture
// ══════════════════════════════════════════════════════════════════════

function makeGoodAttraction(overrides = {}) {
  return {
    name: 'Gateway of India',
    providerId: '12345678',
    provider: 'google',
    source: 'google',
    types: ['tourism.sights', 'tourism.monument'],
    categories: ['tourism.sights', 'tourism.monument'],
    address: 'Apollo Bunder, Mumbai, Maharashtra 400005, India',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
    rating: 4.5,
    reviewCount: 12500,
    openingHours: { periods: [{ days: ['all'], open: '09:00', close: '18:00' }] },
    phone: '+91 22 2202 1234',
    website: 'https://example.com',
    ...overrides,
  };
}

function makeGoodRestaurant(overrides = {}) {
  return {
    name: 'Leopold Cafe',
    providerId: '87654321',
    provider: 'google',
    source: 'zomato',
    types: ['catering.restaurant', 'catering.cafe'],
    categories: ['catering.restaurant'],
    address: 'Colaba Causeway, Mumbai, Maharashtra, India',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.9154,
    longitude: 72.8264,
    rating: 4.2,
    reviewCount: 3200,
    openingHours: { periods: [{ days: ['all'], open: '07:30', close: '23:30' }] },
    ...overrides,
  };
}

function makeGoodHotel(overrides = {}) {
  return {
    name: 'Taj Mahal Palace',
    providerId: 'TajMahalPalace',
    provider: 'amadeus',
    source: 'amadeus-hotels',
    types: ['accommodation.hotel'],
    categories: ['accommodation.hotel'],
    address: 'Apollo Bunder, Mumbai, Maharashtra, India',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.9236,
    longitude: 72.8341,
    rating: 4.7,
    reviewCount: 8500,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  1. HIGH-QUALITY CANDIDATES → ELIGIBLE
// ══════════════════════════════════════════════════════════════════════

test('Well-known attraction (Gateway of India) → eligible', () => {
  const c = makeGoodAttraction();
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, true, `Should be eligible (score: ${result.qualityScore})`);
  assert.ok(result.qualityScore >= 60, `Score should be >= 60, got ${result.qualityScore}`);
});

test('Well-known restaurant (Leopold Cafe) → eligible', () => {
  const c = makeGoodRestaurant();
  const result = assessCandidateQuality(c, 'restaurant');
  assert.equal(result.eligible, true, `Should be eligible (score: ${result.qualityScore})`);
  assert.ok(result.qualityScore >= 50, `Score should be >= 50, got ${result.qualityScore}`);
});

test('Well-known hotel (Taj Mahal Palace) → eligible', () => {
  const c = makeGoodHotel();
  const result = assessCandidateQuality(c, 'hotel');
  assert.equal(result.eligible, true, `Should be eligible (score: ${result.qualityScore})`);
  assert.ok(result.qualityScore >= 50, `Score should be >= 50, got ${result.qualityScore}`);
});

// ══════════════════════════════════════════════════════════════════════
//  2. RAW ADDRESSES AS NAMES → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Street address as name → rejected', () => {
  const c = makeGoodAttraction({ name: '123 MG Road, Mumbai' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('address'));
});

test('House number + street → rejected', () => {
  const c = makeGoodAttraction({ name: '45B Colaba Causeway' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('address'));
});

test('Unnamed Road → rejected', () => {
  const c = makeGoodAttraction({ name: 'Unnamed Road, Andheri' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('address'));
});

// ══════════════════════════════════════════════════════════════════════
//  3. GENERIC BUILDINGS / TEST DATA → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Building record → rejected', () => {
  const c = makeGoodAttraction({ name: 'Building No 5, Bandra' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('generic'));
});

test('Demo/test record → rejected', () => {
  const c = makeGoodAttraction({ name: 'Demo Railway Station' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('generic'));
});

test('Test record → rejected', () => {
  const c = makeGoodAttraction({ name: 'Test Place' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('generic'));
});

test('Placeholder record → rejected', () => {
  const c = makeGoodAttraction({ name: 'Placeholder Location' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('generic'));
});

// ══════════════════════════════════════════════════════════════════════
//  4. UNNAMED LOCATIONS → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Unnamed location → rejected', () => {
  const c = makeGoodAttraction({ name: 'Unnamed' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
});

test('Empty name → rejected', () => {
  const c = makeGoodAttraction({ name: '' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('no name'));
});

test('Null candidate → rejected', () => {
  const result = assessCandidateQuality(null, 'attraction');
  assert.equal(result.eligible, false);
});

// ══════════════════════════════════════════════════════════════════════
//  5. UTILITY / INFRASTRUCTURE POIs → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Hospital → rejected', () => {
  const c = makeGoodAttraction({ name: 'Breach Candy Hospital' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('utility') || result.rejectionReason.includes('quality')),
    `Expected utility or quality rejection, got: ${result.rejectionReason}`;
});

test('Police station → rejected', () => {
  const c = makeGoodAttraction({ name: 'Colaba Police Station' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('utility') || result.rejectionReason.includes('quality')),
    `Expected utility or quality rejection, got: ${result.rejectionReason}`;
});

test('Pharmacy → rejected', () => {
  const c = makeGoodAttraction({ name: 'Apollo Pharmacy' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('utility') || result.rejectionReason.includes('quality')),
    `Expected utility or quality rejection, got: ${result.rejectionReason}`;
});

test('ATM → rejected', () => {
  const c = makeGoodAttraction({ name: 'HDFC ATM' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('utility') || result.rejectionReason.includes('quality')),
    `Expected utility or quality rejection, got: ${result.rejectionReason}`;
});

test('Petrol pump → rejected', () => {
  const c = makeGoodAttraction({ name: 'HP Petrol Pump' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReason.includes('utility') || result.rejectionReason.includes('quality')),
    `Expected utility or quality rejection, got: ${result.rejectionReason}`;
});

// ══════════════════════════════════════════════════════════════════════
//  6. QUALITY SCORE COMPONENTS
// ══════════════════════════════════════════════════════════════════════

test('Score breakdown sums to total', () => {
  const c = makeGoodAttraction();
  const result = assessCandidateQuality(c, 'attraction');
  const sum = result.breakdown.providerIdentity + result.breakdown.geographic + result.breakdown.category + result.breakdown.metadata + result.breakdown.nameQuality;
  assert.equal(result.qualityScore, sum, 'Score should equal sum of breakdown');
});

test('Candidate with no provider ID scores low on providerIdentity', () => {
  const c = makeGoodAttraction({ providerId: '', provider: '', source: '' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.providerIdentity <= 5, `Provider identity score should be low: ${result.breakdown.providerIdentity}`);
});

test('Candidate with no coordinates scores low on geographic', () => {
  const c = makeGoodAttraction({ latitude: null, longitude: null, address: '' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.geographic <= 5, `Geographic score should be low: ${result.breakdown.geographic}`);
});

test('Candidate with no rating/reviews scores low on metadata', () => {
  const c = makeGoodAttraction({ rating: null, reviewCount: 0, openingHours: null });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.metadata <= 5, `Metadata score should be low: ${result.breakdown.metadata}`);
});

// ══════════════════════════════════════════════════════════════════════
//  7. MINIMAL CANDIDATE → BELOW THRESHOLD
// ══════════════════════════════════════════════════════════════════════

test('Minimal candidate (name only) → below threshold', () => {
  const c = { name: 'Random Place' };
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, false);
  assert.ok(result.qualityScore < MIN_QUALITY_SCORE, `Score ${result.qualityScore} should be below ${MIN_QUALITY_SCORE}`);
});

// ══════════════════════════════════════════════════════════════════════
//  8. filterByQuality — batch filtering
// ══════════════════════════════════════════════════════════════════════

test('filterByQuality splits good and bad candidates', () => {
  const candidates = [
    makeGoodAttraction(),                                      // good
    { name: '123 Main Street', types: ['tourism'], provider: 'google', providerId: '1', source: 'google' }, // address
    { name: 'Hospital Road', types: ['healthcare'], provider: 'google', providerId: '2', source: 'google' }, // utility
    makeGoodRestaurant(),                                      // good
    { name: 'Test Location', types: ['test'], provider: 'google', providerId: '3', source: 'google' },       // test
  ];

  const { accepted, rejected, rejectionLog } = filterByQuality(candidates, 'attraction', 'google');

  assert.ok(accepted.length >= 2, `Should accept at least 2, got ${accepted.length}`);
  assert.ok(rejected.length >= 2, `Should reject at least 2, got ${rejected.length}`);
  assert.equal(rejectionLog.length, rejected.length);
  assert.ok(rejectionLog.every((r) => r.reason && r.candidate && r.candidateType));
});

test('filterByQuality with empty array', () => {
  const { accepted, rejected } = filterByQuality([], 'attraction', 'google');
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

test('filterByQuality with null array', () => {
  const { accepted, rejected } = filterByQuality(null, 'attraction', 'google');
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  9. getQualitySummary
// ══════════════════════════════════════════════════════════════════════

test('getQualitySummary returns correct stats', () => {
  const candidates = [
    makeGoodAttraction(),
    makeGoodRestaurant(),
    { name: 'Test', provider: 'google', providerId: '1', source: 'google', types: ['test'] },
  ];
  const summary = getQualitySummary(candidates, 'attraction');
  assert.equal(summary.total, 3);
  assert.ok(summary.eligible >= 2);
  assert.ok(summary.ineligible >= 1);
  assert.ok(summary.avgScore > 0);
});

// ══════════════════════════════════════════════════════════════════════
//  10. CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

test('MIN_QUALITY_SCORE is 40', () => {
  assert.equal(MIN_QUALITY_SCORE, 40);
});

test('SCORE_WEIGHTS sum to 100', () => {
  const sum = SCORE_WEIGHTS.providerIdentity + SCORE_WEIGHTS.geographic + SCORE_WEIGHTS.category + SCORE_WEIGHTS.metadata + SCORE_WEIGHTS.nameQuality;
  assert.equal(sum, 100, 'Weights should sum to 100');
});

// ══════════════════════════════════════════════════════════════════════
//  11. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Candidate with coordinates at 0,0 → geographic penalty (null island)', () => {
  const c = makeGoodAttraction({ latitude: 0, longitude: 0 });
  const result = assessCandidateQuality(c, 'attraction');
  // 0,0 is "null island" — gets base coords (15) + address (7) = 22, but no null-island bonus
  // Compared to real coords which would get 15 + 3 + 7 = 25
  assert.ok(result.breakdown.geographic < 25, `0,0 coords should not get max geographic score: ${result.breakdown.geographic}`);
});

test('Candidate with invalid coordinates → geographic penalty', () => {
  const c = makeGoodAttraction({ latitude: 999, longitude: -999 });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.geographic < 15, `Invalid coords should reduce geographic score: ${result.breakdown.geographic}`);
});

test('Candidate with string coordinates → geographic penalty', () => {
  const c = makeGoodAttraction({ latitude: '18.922', longitude: '72.8347' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.geographic < 15, `String coords should reduce geographic score: ${result.breakdown.geographic}`);
});

test('Candidate with rating 0 → metadata penalty', () => {
  const c = makeGoodAttraction({ rating: 0, reviewCount: 0, openingHours: null, phone: '', website: '' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.ok(result.breakdown.metadata < 5, `Rating 0 with no other metadata should reduce score: ${result.breakdown.metadata}`);
});

test('Valid temple name → accepted', () => {
  const c = makeGoodAttraction({ name: 'Siddhivinayak Temple' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, true, 'Temple should be eligible');
});

test('Valid fort name → accepted', () => {
  const c = makeGoodAttraction({ name: 'Raigad Fort' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, true, 'Fort should be eligible');
});

test('Valid beach name → accepted', () => {
  const c = makeGoodAttraction({ name: 'Juhu Beach' });
  const result = assessCandidateQuality(c, 'attraction');
  assert.equal(result.eligible, true, 'Beach should be eligible');
});

// ══════════════════════════════════════════════════════════════════════
//  12. REJECTION LOG STRUCTURE
// ══════════════════════════════════════════════════════════════════════

test('Rejection log has correct structure', () => {
  const candidates = [
    { name: '123 Test Road', types: ['test'], provider: 'google', providerId: '1', source: 'google' },
  ];
  const { rejectionLog } = filterByQuality(candidates, 'attraction', 'google');

  assert.equal(rejectionLog.length, 1);
  const r = rejectionLog[0];
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  assert.ok(r.candidate);
  assert.equal(r.candidate.name, '123 Test Road');
  assert.equal(r.candidateType, 'attraction');
  assert.equal(r.provider, 'google');
  assert.ok(typeof r.qualityScore === 'number');
  assert.ok(r.breakdown);
  assert.ok(r.timestamp);
});

// ══════════════════════════════════════════════════════════════════════
//  13. ACCEPTED CANDIDATES GET QUALITY METADATA
// ══════════════════════════════════════════════════════════════════════

test('Accepted candidates get _qualityScore and _qualityBreakdown', () => {
  const candidates = [makeGoodAttraction()];
  const { accepted } = filterByQuality(candidates, 'attraction', 'google');

  assert.equal(accepted.length, 1);
  assert.equal(typeof accepted[0]._qualityScore, 'number');
  assert.ok(accepted[0]._qualityBreakdown);
  assert.equal(typeof accepted[0]._qualityBreakdown.providerIdentity, 'number');
});
