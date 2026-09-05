import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDestinationName,
  validateCandidate,
  filterCandidates,
  filterPlaces,
  METRO_AREAS,
  DEFAULT_RADIUS_KM,
} from '../src/services/destinationLock.service.js';

// ══════════════════════════════════════════════════════════════════════
//  TEST FIXTURES — Mumbai destination (resolved coordinates)
// ══════════════════════════════════════════════════════════════════════

const MUMBAI_DESTINATION = {
  name: 'Mumbai',
  normalizedName: 'mumbai',
  city: 'Mumbai',
  cityNormalized: 'mumbai',
  state: 'Maharashtra',
  country: 'India',
  latitude: 19.076,
  longitude: 72.8777,
  radiusKm: 55, // Mumbai metro radius
  metro: METRO_AREAS.mumbai,
  formattedAddress: 'Mumbai, Maharashtra, India',
  isMetro: true,
};

// ══════════════════════════════════════════════════════════════════════
//  1. normalizeDestinationName
// ══════════════════════════════════════════════════════════════════════

test('normalizeDestinationName strips country suffixes', () => {
  assert.equal(normalizeDestinationName('Mumbai, India'), 'mumbai');
  assert.equal(normalizeDestinationName('Goa, India'), 'goa');
  assert.equal(normalizeDestinationName('New Delhi, India'), 'new delhi');
  assert.equal(normalizeDestinationName('Paris, France'), 'paris, france');
});

test('normalizeDestinationName handles whitespace', () => {
  assert.equal(normalizeDestinationName('  Mumbai  '), 'mumbai');
  assert.equal(normalizeDestinationName('New   Delhi'), 'new delhi');
});

test('normalizeDestinationName handles null/undefined', () => {
  assert.equal(normalizeDestinationName(null), '');
  assert.equal(normalizeDestinationName(undefined), '');
  assert.equal(normalizeDestinationName(''), '');
});

// ══════════════════════════════════════════════════════════════════════
//  2. Mumbai valid locations → ACCEPTED
// ══════════════════════════════════════════════════════════════════════

test('Gateway of India (Mumbai) → accepted', () => {
  const candidate = {
    name: 'Gateway of India',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Gateway of India should be accepted for Mumbai');
});

test('Marine Drive (Mumbai) → accepted', () => {
  const candidate = {
    name: 'Marine Drive',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.9432,
    longitude: 72.8234,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Marine Drive should be accepted for Mumbai');
});

test('Elephanta Caves (Mumbai) → accepted', () => {
  const candidate = {
    name: 'Elephanta Caves',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.9634,
    longitude: 72.9315,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Elephanta Caves should be accepted for Mumbai');
});

// ══════════════════════════════════════════════════════════════════════
//  3. Mumbai metropolitan area → ACCEPTED
// ══════════════════════════════════════════════════════════════════════

test('Navi Mumbai → accepted (metropolitan area)', () => {
  const candidate = {
    name: 'Navi Mumbai',
    city: 'Navi Mumbai',
    country: 'India',
    latitude: 19.033,
    longitude: 73.0297,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Navi Mumbai should be accepted as Mumbai metro');
});

test('Thane → accepted (metropolitan area)', () => {
  const candidate = {
    name: 'Thane Creek Flamingo Sanctuary',
    city: 'Thane',
    country: 'India',
    latitude: 19.1967,
    longitude: 72.9636,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Thane should be accepted as Mumbai metro');
});

test('Kalyan → accepted (metropolitan area)', () => {
  const candidate = {
    name: 'Kalyan',
    city: 'Kalyan',
    country: 'India',
    latitude: 19.2437,
    longitude: 73.1355,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Kalyan should be accepted as Mumbai metro');
});

test('Vasai → accepted (metropolitan area)', () => {
  const candidate = {
    name: 'Vasai Fort',
    city: 'Vasai',
    country: 'India',
    latitude: 19.3614,
    longitude: 72.8311,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Vasai should be accepted as Mumbai metro');
});

// ══════════════════════════════════════════════════════════════════════
//  4. Hyderabad → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Charminar (Hyderabad) → rejected from Mumbai itinerary', () => {
  const candidate = {
    name: 'Charminar',
    city: 'Hyderabad',
    country: 'India',
    latitude: 17.3616,
    longitude: 78.4747,
  };
  const { valid, rejection } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Charminar (Hyderabad) should be rejected from Mumbai');
  assert.ok(rejection, 'Should have rejection metadata');
  assert.ok(rejection.reason.includes('km') || rejection.reason.includes('mismatch'), `Reason: ${rejection.reason}`);
});

test('Golconda Fort (Hyderabad) → rejected from Mumbai itinerary', () => {
  const candidate = {
    name: 'Golconda Fort',
    city: 'Hyderabad',
    state: 'Telangana',
    country: 'India',
    latitude: 17.3833,
    longitude: 78.4011,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Golconda Fort should be rejected from Mumbai');
});

// ══════════════════════════════════════════════════════════════════════
//  5. Macapá, Brazil → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Macapá Brazil → rejected from Mumbai itinerary', () => {
  const candidate = {
    name: 'Forte de São José de Macapá',
    city: 'Macapá',
    state: 'Amapá',
    country: 'Brazil',
    latitude: 0.0349,
    longitude: -51.0694,
  };
  const { valid, rejection } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Macapá should be rejected from Mumbai');
  assert.ok(rejection, 'Should have rejection metadata');
  assert.ok(
    rejection.reason.includes('Country') || rejection.reason.includes('km'),
    `Reason should mention country or distance: ${rejection.reason}`
  );
});

// ══════════════════════════════════════════════════════════════════════
//  6. Unrelated country → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Eiffel Tower (Paris, France) → rejected from Mumbai', () => {
  const candidate = {
    name: 'Eiffel Tower',
    city: 'Paris',
    country: 'France',
    latitude: 48.8584,
    longitude: 2.2945,
  };
  const { valid, rejection } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Eiffel Tower should be rejected from Mumbai');
  assert.ok(rejection.reason.includes('Country') || rejection.reason.includes('km'));
});

test('Statue of Liberty (New York, USA) → rejected from Mumbai', () => {
  const candidate = {
    name: 'Statue of Liberty',
    city: 'New York',
    country: 'United States',
    latitude: 40.6892,
    longitude: -74.0445,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Statue of Liberty should be rejected from Mumbai');
});

// ══════════════════════════════════════════════════════════════════════
//  7. Missing coordinates but matching address → handled safely
// ══════════════════════════════════════════════════════════════════════

test('No coordinates but city matches Mumbai → accepted', () => {
  const candidate = {
    name: 'Mumbai Street Food Tour',
    city: 'Mumbai',
    country: 'India',
    latitude: null,
    longitude: null,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'No coordinates but city matches → accepted');
});

test('No coordinates and city does not match → rejected', () => {
  const candidate = {
    name: 'Mystery Restaurant',
    city: 'Hyderabad',
    country: 'India',
    latitude: null,
    longitude: null,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'No coordinates and wrong city → rejected');
});

test('No coordinates and no city data → rejected (cannot confirm)', () => {
  const candidate = {
    name: 'Unknown Place',
    city: '',
    country: '',
    latitude: null,
    longitude: null,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'No coordinates and no city → rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  8. Missing city/country → not automatically trusted
// ══════════════════════════════════════════════════════════════════════

test('Wrong city but correct country → rejected by city mismatch', () => {
  const candidate = {
    name: 'Some Place',
    city: 'Pune',
    country: 'India',
    latitude: 18.5204,
    longitude: 73.8567,
  };
  // Pune is ~150km from Mumbai center — outside 55km radius
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Pune should be rejected from Mumbai (too far)');
});

test('Correct city but null country → accepted if coordinates match', () => {
  const candidate = {
    name: 'Juhu Beach',
    city: 'Mumbai',
    country: null,
    latitude: 19.0948,
    longitude: 72.8267,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Coordinates match Mumbai → accepted even with null country');
});

// ══════════════════════════════════════════════════════════════════════
//  9. Name contains obviously wrong location → REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Restaurant named "Hyderabad Biryani House" in Mumbai → rejected', () => {
  const candidate = {
    name: 'Hyderabad Biryani House',
    city: 'Mumbai',
    country: 'India',
    latitude: 19.07,
    longitude: 72.88,
  };
  const { valid, rejection } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Name containing "Hyderabad" should be flagged');
  assert.ok(rejection.reason.includes('Hyderabad') || rejection.reason.includes('distant'));
});

test('Attraction "Macapá Beach" → rejected by name check', () => {
  const candidate = {
    name: 'Macapá Beach Resort',
    city: 'Mumbai',
    country: 'India',
    latitude: 19.05,
    longitude: 72.85,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Name containing "Macapá" should be rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  10. filterCandidates — batch filtering
// ══════════════════════════════════════════════════════════════════════

test('filterCandidates splits valid and invalid candidates', () => {
  const candidates = [
    { name: 'Gateway of India', city: 'Mumbai', country: 'India', latitude: 18.922, longitude: 72.8347 },
    { name: 'Charminar', city: 'Hyderabad', country: 'India', latitude: 17.3616, longitude: 78.4747 },
    { name: 'Eiffel Tower', city: 'Paris', country: 'France', latitude: 48.8584, longitude: 2.2945 },
    { name: 'Marine Drive', city: 'Mumbai', country: 'India', latitude: 18.9432, longitude: 72.8234 },
    { name: 'Forte de São José', city: 'Macapá', country: 'Brazil', latitude: 0.0349, longitude: -51.0694 },
  ];

  const { accepted, rejected, rejectionLog } = filterCandidates(candidates, MUMBAI_DESTINATION, 'google');

  assert.equal(accepted.length, 2, 'Should accept 2 Mumbai locations');
  assert.equal(accepted[0].name, 'Gateway of India');
  assert.equal(accepted[1].name, 'Marine Drive');

  assert.equal(rejected.length, 3, 'Should reject 3 non-Mumbai locations');
  assert.equal(rejected[0].name, 'Charminar');
  assert.equal(rejected[1].name, 'Eiffel Tower');
  assert.equal(rejected[2].name, 'Forte de São José');

  assert.equal(rejectionLog.length, 3, 'Should have 3 rejection log entries');
  assert.ok(rejectionLog[0].reason.includes('km') || rejectionLog[0].reason.includes('mismatch'));
  assert.ok(rejectionLog[1].reason.includes('Country') || rejectionLog[1].reason.includes('km'));
  assert.ok(rejectionLog[2].reason.includes('Country') || rejectionLog[2].reason.includes('km'));
});

test('filterCandidates with empty array returns empty results', () => {
  const { accepted, rejected } = filterCandidates([], MUMBAI_DESTINATION, 'google');
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

test('filterCandidates with null array returns empty results', () => {
  const { accepted, rejected } = filterCandidates(null, MUMBAI_DESTINATION, 'google');
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  11. filterPlaces — Google shape handling
// ══════════════════════════════════════════════════════════════════════

test('filterPlaces handles Google place shape', () => {
  const places = [
    {
      name: 'Gateway of India',
      address: 'Apollo Bunder, Mumbai, Maharashtra, India',
      city: 'Mumbai',
      state: 'Maharashtra',
      coordinates: { lat: 18.922, lng: 72.8347 },
      placeId: 'abc123',
    },
    {
      name: 'Charminar',
      address: 'Charminar, Hyderabad, Telangana, India',
      city: 'Hyderabad',
      state: 'Telangana',
      coordinates: { lat: 17.3616, lng: 78.4747 },
      placeId: 'def456',
    },
  ];

  const { accepted, rejected } = filterPlaces(places, MUMBAI_DESTINATION, 'google');

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, 'Gateway of India');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].name, 'Charminar');
});

// ══════════════════════════════════════════════════════════════════════
//  12. Edge cases
// ══════════════════════════════════════════════════════════════════════

test('Missing destination → always rejected', () => {
  const candidate = { name: 'Test', city: 'Mumbai', country: 'India', latitude: 19, longitude: 72 };
  const { valid } = validateCandidate(candidate, null, 'google');
  assert.equal(valid, false);
});

test('Missing candidate → always rejected', () => {
  const { valid } = validateCandidate(null, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false);
});

test('Candidate at exact boundary distance → accepted', () => {
  // 55km from Mumbai center — should be within 55km radius
  // At lat 19°, 1° latitude ≈ 110.6km, so 0.45° ≈ 49.8km
  const candidate = {
    name: 'Border Place',
    city: 'Unknown',
    country: 'India',
    latitude: 19.076 + 0.45, // ~49.8km north
    longitude: 72.8777,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, true, 'Within 55km radius should be accepted');
});

test('Candidate just outside boundary → rejected', () => {
  // ~60km from Mumbai center
  const candidate = {
    name: 'Far Away Place',
    city: 'Unknown',
    country: 'India',
    latitude: 19.076 + 0.6, // ~66.6km north
    longitude: 72.8777,
  };
  const { valid } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');
  assert.equal(valid, false, 'Outside 55km radius should be rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  13. Default radius constant
// ══════════════════════════════════════════════════════════════════════

test('DEFAULT_RADIUS_KM is 40', () => {
  assert.equal(DEFAULT_RADIUS_KM, 40);
});

test('METRO_AREAS has Mumbai entry', () => {
  assert.ok(METRO_AREAS.mumbai, 'Mumbai should be in METRO_AREAS');
  assert.equal(METRO_AREAS.mumbai.radiusKm, 55);
  assert.ok(METRO_AREAS.mumbai.allowedSuburbs.includes('thane'));
  assert.ok(METRO_AREAS.mumbai.allowedSuburbs.includes('navi mumbai'));
});

// ══════════════════════════════════════════════════════════════════════
//  14. Rejection log structure validation
// ══════════════════════════════════════════════════════════════════════

test('Rejection log has correct structure', () => {
  const candidate = {
    name: 'Charminar',
    city: 'Hyderabad',
    country: 'India',
    latitude: 17.3616,
    longitude: 78.4747,
    provider: 'google',
    providerId: 'charminar-123',
  };
  const { rejection } = validateCandidate(candidate, MUMBAI_DESTINATION, 'google');

  assert.ok(rejection, 'Should have rejection');
  assert.ok(typeof rejection.reason === 'string' && rejection.reason.length > 0);
  assert.ok(rejection.candidate, 'Should have candidate info');
  assert.ok(rejection.expectedDestination, 'Should have expected destination info');
  assert.ok(rejection.provider === 'google');
  assert.ok(rejection.timestamp, 'Should have timestamp');
  assert.equal(rejection.candidate.name, 'Charminar');
  assert.equal(rejection.expectedDestination.name, 'Mumbai');
  assert.equal(rejection.expectedDestination.radiusKm, 55);
});
