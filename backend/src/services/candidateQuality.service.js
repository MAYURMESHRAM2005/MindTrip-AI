/**
 * Candidate Quality Service
 *
 * Deterministic quality scoring and rejection for travel candidates.
 * Every candidate (attraction, restaurant, hotel, event, nightlife) is
 * scored on a 0–100 scale across five dimensions:
 *
 *   providerIdentityScore  (0–30)  — real provider ID, name, source
 *   geographicScore        (0–25)  — valid coordinates and address
 *   categoryScore          (0–15)  — valid categories/types
 *   metadataScore          (0–15)  — rating, review count, opening hours
 *   nameQualityScore       (0–15)  — name is meaningful, not a raw address
 *
 * Candidates below the acceptance threshold are rejected with structured
 * rejection metadata. No LLM involvement — all logic is pure code.
 *
 * Design rules:
 *  - Do not fabricate missing fields. Reject rather than invent.
 *  - Raw addresses, street addresses, generic buildings, test records,
 *    unnamed locations, and administrative POIs are rejected.
 *  - Hospitals/police/pharmacies are rejected unless explicitly requested.
 *  - Reusable across all candidate types (attraction, restaurant, hotel,
 *    event, nightlife, transport).
 */

import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

/** Minimum quality score for a candidate to be accepted. */
export const MIN_QUALITY_SCORE = 40;

/** Weight configuration for each scoring dimension. */
export const SCORE_WEIGHTS = {
  providerIdentity: 30,
  geographic: 25,
  category: 15,
  metadata: 15,
  nameQuality: 15,
};

// ══════════════════════════════════════════════════════════════════════
//  REJECTION PATTERNS
// ══════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate a raw address rather than a place name.
 * Matches: "123 Main St", "MG Road, Mumbai", "Unnamed Road", etc.
 */
const ADDRESS_PATTERNS = [
  /^\d+\s+\w+\s+(st|street|road|rd|ave|avenue|blvd|boulevard|lane|ln|dr|drive|way|ct|court|pl|place)\b/i,
  /\b\d{1,5}\s+\w+(\s+\w+)?\s+(st|street|road|rd|ave|avenue|blvd|boulevard|lane|ln|dr|drive|way|ct|court|pl|place)\b/i,
  /\b(street|road|avenue|boulevard|lane|drive|highway|motorway|expressway)\b/i,
  /\b( unnamed | unnamed road | unnamed street)\b/i,
  /^\d+[A-Z]?\s/, // starts with a house number
  /\b,\s*\d{6}\b/, // contains a postal/PIN code
  /\b(district|taluka|tehsil|sub-district)\b/i,
];

/**
 * Patterns that indicate a generic, non-POI record.
 */
const GENERIC_PATTERNS = [
  /\b(building|building no|plot no|floor|wing|tower|complex)\b/i,
  /\b(demo|test|sample|placeholder|dummy|fake|mock)\b/i,
  /\b(unnamed|untitled|unknown)\b/i,
  /\b(railway station|bus stop|bus stand|bus depot)\b/i, // transit hubs, not attractions
  /\b(post office|post office)\b/i,
  /\b(govt|government|govt\.|municipal|panchayat|ward)\b/i,
];

/**
 * Patterns that indicate utility/infrastructure POIs (not tourist-relevant).
 */
const UTILITY_PATTERNS = [
  /\b(hospital|medical|clinic|nursing home|health center|dispensary|diagnostic center|pathology)\b/i,
  /\b(police station|police post|thana|outpost)\b/i,
  /\b(pharmacy|chemist|medical store|drug store)\b/i,
  /\b(fire station|fire brigade)\b/i,
  /\b(cemetery|graveyard|crematorium|shmashana)\b/i,
  /\b(atm|atms|automated teller)\b/i,
  /\b(toll booth|toll naka|petrol pump|gas station|fuel station)\b/i,
  /\b(water tank|water tower|sewage|drainage)\b/i,
  /\b(electricity|power station|substation|transformer)\b/i,
  /\b(telecom tower|cell tower|mobile tower)\b/i,
  /\b(spa|wellness center|massage|sauna|hammam|day spa|beauty parlor?|salon|physiotherapy|physio)\b/i,
];

/**
 * Valid Google category prefixes that indicate a real POI.
 */
const VALID_ATTRACTION_CATEGORIES = [
  'tourism', 'entertainment', 'natural', 'leisure', 'commercial',
  'catering', 'accommodation', 'heritage',
];

const VALID_RESTAURANT_CATEGORIES = [
  'catering',
];

/**
 * Patterns that indicate a non-restaurant business (for restaurant candidate type only).
 */
const RESTAURANT_REJECTION_PATTERNS = [
  /\b(hotel|motel|hostel|guest house|guesthouse|lodge|resort|serviced apartment|paying guest|p\.g\.)\b/i,
  /\b(apartment|flat|villa|bungalow|colony|nagar|housing society|residential|plot no|house no)\b/i,
  /\b(building|office|workspace|coworking|parking|warehouse|factory|showroom|outlet|branch|head office|complex|tower)\b/i,
];

const VALID_HOTEL_CATEGORIES = [
  'accommodation',
];

const VALID_EVENT_CATEGORIES = [
  'entertainment', 'tourism', 'commercial',
];

const VALID_NIGHTLIFE_CATEGORIES = [
  'entertainment', 'catering',
];

// ══════════════════════════════════════════════════════════════════════
//  SCORING FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Score provider identity (0–30).
 * Does the candidate have a real provider ID, provider name, and source?
 */
function providerIdentityScore(c) {
  let score = 0;

  // Has a provider ID (placeId, hotelId, etc.)
  const providerId = c.providerId || c.placeId || c.id || '';
  if (providerId && providerId.length > 0) {
    score += 10;
    // Provider ID is numeric or alphanumeric (not just a name)
    if (/^\d+$/.test(providerId) || /^[A-Z0-9_-]+$/i.test(providerId)) {
      score += 5;
    }
  }

  // Has a provider name
  if (c.provider && c.provider.length > 0) {
    score += 5;
  }

  // Has a source
  if (c.source && c.source.length > 0) {
    score += 5;
  }

  // Has a meaningful name (not just the providerId repeated)
  const name = c.name || '';
  if (name && name.length > 0 && name !== providerId) {
    score += 5;
  }

  return Math.min(score, SCORE_WEIGHTS.providerIdentity);
}

/**
 * Score geographic data (0–25).
 * Does the candidate have valid coordinates and an address?
 */
function geographicScore(c) {
  let score = 0;

  const lat = c.latitude ?? c.coordinates?.lat ?? null;
  const lng = c.longitude ?? c.coordinates?.lng ?? null;

  // Has valid coordinates
  if (lat != null && lng != null && typeof lat === 'number' && typeof lng === 'number') {
    // Coordinates are within reasonable bounds
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      score += 15;
      // Not exactly 0,0 (which often means "no data" or null island)
      if (!(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)) {
        score += 3;
      }
    }
  }

  // Has an address
  const address = c.address || '';
  if (address && address.length > 5) {
    score += 5;
    // Address is not just a raw coordinate string
    if (!/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(address)) {
      score += 2;
    }
  }

  return Math.min(score, SCORE_WEIGHTS.geographic);
}

/**
 * Score category/type validity (0–15).
 * Does the candidate have meaningful categories?
 */
function categoryScore(c, candidateType) {
  let score = 0;

  const types = c.types || c.categories || [];
  const typeStr = types.join(' ').toLowerCase();

  // Has at least one type/category
  if (types.length > 0) {
    score += 5;
  }

  // Has multiple types (more specific classification)
  if (types.length >= 2) {
    score += 3;
  }

  // Type matches expected candidate type
  const validCategories = {
    attraction: VALID_ATTRACTION_CATEGORIES,
    restaurant: VALID_RESTAURANT_CATEGORIES,
    hotel: VALID_HOTEL_CATEGORIES,
    event: VALID_EVENT_CATEGORIES,
    nightlife: VALID_NIGHTLIFE_CATEGORIES,
  };

  const expected = validCategories[candidateType] || VALID_ATTRACTION_CATEGORIES;
  const hasValidCategory = expected.some((cat) => typeStr.includes(cat));
  if (hasValidCategory) {
    score += 5;
  }

  // Bonus for specific attraction types
  if (candidateType === 'attraction') {
    if (/museum|monument|fort|palace|temple|church|mosque|garden|park|zoo|beach|viewpoint|waterfall|heritage/i.test(typeStr)) {
      score += 2;
    }
  }

  return Math.min(score, SCORE_WEIGHTS.category);
}

/**
 * Score metadata richness (0–15).
 * Does the candidate have rating, review count, opening hours?
 */
function metadataScore(c) {
  let score = 0;

  // Has a rating
  if (c.rating != null && typeof c.rating === 'number' && c.rating > 0) {
    score += 5;
    // Rating is in a reasonable range (1-5 or 1-10)
    if (c.rating >= 1 && c.rating <= 5) {
      score += 2;
    }
  }

  // Has review count
  const reviewCount = c.reviewCount || c.userRatingsTotal || c.votes || 0;
  if (reviewCount > 0) {
    score += 3;
  }

  // Has opening hours
  if (c.openingHours && (c.openingHours.periods?.length > 0 || c.openingHours.raw)) {
    score += 3;
  }

  // Has phone or website
  if (c.phone || c.website || c.url) {
    score += 2;
  }

  return Math.min(score, SCORE_WEIGHTS.metadata);
}

/**
 * Score name quality (0–15).
 * Is the name meaningful, not a raw address, not generic, not test data?
 */
function nameQualityScore(c) {
  const name = (c.name || '').trim();
  let score = 0;

  // Has a name at all
  if (!name) return 0;

  // Name is long enough to be meaningful
  if (name.length >= 3) {
    score += 3;
  }

  // Name is not a raw address
  const isAddress = ADDRESS_PATTERNS.some((p) => p.test(name));
  if (isAddress) {
    return 0; // Hard zero — addresses are never valid place names
  }

  // Name is not generic
  const isGeneric = GENERIC_PATTERNS.some((p) => p.test(name));
  if (isGeneric) {
    return 0;
  }

  // Name is not a utility/infrastructure POI
  const isUtility = UTILITY_PATTERNS.some((p) => p.test(name));
  if (isUtility) {
    return 0;
  }

  // Name has capitalization (proper noun)
  if (/^[A-Z]/.test(name)) {
    score += 3;
  }

  // Name contains multiple words (not just a single generic word)
  const words = name.split(/\s+/);
  if (words.length >= 2) {
    score += 3;
  }

  // Name is not too short (1-2 chars)
  if (name.length >= 5) {
    score += 2;
  }

  // Name doesn't look like a phone number or numeric ID
  if (!/^[\d\s+()-]+$/.test(name)) {
    score += 2;
  }

  // Name contains location-specific words (temple, fort, palace, etc.)
  if (/\b(fort|palace|temple|church|mosque|museum|garden|park|beach|market|tower|monument|cave|caves|falls|waterfall|lake|hill|point|view|sanctuary|shrine|gate|dargah|masjid|vihara|stupa)\b/i.test(name)) {
    score += 2;
  }

  return Math.min(score, SCORE_WEIGHTS.nameQuality);
}

// ══════════════════════════════════════════════════════════════════════
//  QUALITY ASSESSMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Assess the quality of a single candidate.
 *
 * @param {object} candidate - Raw candidate from a provider
 * @param {string} candidateType - Expected type: 'attraction', 'restaurant', 'hotel', 'event', 'nightlife'
 * @returns {{ eligible: boolean, qualityScore: number, breakdown: object, rejectionReason: string|null }}
 */
export function assessCandidateQuality(candidate, candidateType = 'attraction') {
  if (!candidate || typeof candidate !== 'object') {
    return {
      eligible: false,
      qualityScore: 0,
      breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
      rejectionReason: 'Candidate is null or not an object',
    };
  }

  // ── Hard rejection rules (bypass scoring) ──

  // Must have a name
  const name = (candidate.name || '').trim();
  if (!name) {
    return {
      eligible: false,
      qualityScore: 0,
      breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
      rejectionReason: 'Candidate has no name',
    };
  }

  // Reject raw addresses as names
  const isAddress = ADDRESS_PATTERNS.some((p) => p.test(name));
  if (isAddress) {
    return {
      eligible: false,
      qualityScore: 0,
      breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
      rejectionReason: `Name "${name}" is a raw address, not a place name`,
    };
  }

  // Reject generic/test records
  const isGeneric = GENERIC_PATTERNS.some((p) => p.test(name));
  if (isGeneric) {
    return {
      eligible: false,
      qualityScore: 0,
      breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
      rejectionReason: `Name "${name}" matches a generic/test pattern`,
    };
  }

  // Reject utility POIs (hospitals, police, spas, etc.)
  const isUtility = UTILITY_PATTERNS.some((p) => p.test(name));
  if (isUtility) {
    return {
      eligible: false,
      qualityScore: 0,
      breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
      rejectionReason: `Name "${name}" is a utility/infrastructure POI, not tourist-relevant`,
    };
  }

  // Reject non-restaurant businesses when candidateType is 'restaurant'
  if (candidateType === 'restaurant') {
    const isNonRestaurant = RESTAURANT_REJECTION_PATTERNS.some((p) => p.test(name));
    if (isNonRestaurant) {
      return {
        eligible: false,
        qualityScore: 0,
        breakdown: { providerIdentity: 0, geographic: 0, category: 0, metadata: 0, nameQuality: 0 },
        rejectionReason: `Name "${name}" is not a restaurant/food establishment (hotel, residential, or generic building)`,
      };
    }
  }

  // ── Compute scores ──
  const pScore = providerIdentityScore(candidate);
  const gScore = geographicScore(candidate);
  const cScore = categoryScore(candidate, candidateType);
  const mScore = metadataScore(candidate);
  const nScore = nameQualityScore(candidate);

  const totalScore = pScore + gScore + cScore + mScore + nScore;

  const breakdown = {
    providerIdentity: pScore,
    geographic: gScore,
    category: cScore,
    metadata: mScore,
    nameQuality: nScore,
  };

  const eligible = totalScore >= MIN_QUALITY_SCORE;
  let rejectionReason = null;

  if (!eligible) {
    // Determine the primary reason for rejection
    const reasons = [];
    if (pScore < 10) reasons.push('insufficient provider identity');
    if (gScore < 8) reasons.push('missing or invalid geographic data');
    if (cScore < 5) reasons.push('no valid category/type');
    if (nScore < 5) reasons.push('low name quality');
    rejectionReason = `Quality score ${totalScore}/${SCORE_WEIGHTS.providerIdentity + SCORE_WEIGHTS.geographic + SCORE_WEIGHTS.category + SCORE_WEIGHTS.metadata + SCORE_WEIGHTS.nameQuality} below threshold ${MIN_QUALITY_SCORE} — ${reasons.join('; ') || 'insufficient evidence'}`;
  }

  return {
    eligible,
    qualityScore: totalScore,
    breakdown,
    rejectionReason,
  };
}

/**
 * Filter an array of candidates by quality.
 *
 * @param {Array} candidates - Raw candidates from providers
 * @param {string} candidateType - Expected type
 * @param {string} [provider] - Provider name for logging
 * @returns {{ accepted: Array, rejected: Array, rejectionLog: Array }}
 */
export function filterByQuality(candidates, candidateType = 'attraction', provider = '') {
  const accepted = [];
  const rejected = [];
  const rejectionLog = [];

  for (const candidate of (candidates || [])) {
    const assessment = assessCandidateQuality(candidate, candidateType);

    if (assessment.eligible) {
      // Attach quality metadata to accepted candidates
      candidate._qualityScore = assessment.qualityScore;
      candidate._qualityBreakdown = assessment.breakdown;
      accepted.push(candidate);
    } else {
      rejected.push(candidate);
      rejectionLog.push({
        reason: assessment.rejectionReason,
        candidate: {
          name: candidate.name || '',
          providerId: candidate.providerId || candidate.placeId || candidate.id || '',
          address: candidate.address || '',
          types: (candidate.types || candidate.categories || []).join(', '),
        },
        candidateType,
        provider: provider || candidate.provider || 'unknown',
        qualityScore: assessment.qualityScore,
        breakdown: assessment.breakdown,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (rejected.length > 0) {
    logger.info(
      `[candidateQuality] ${provider || candidateType}: ${accepted.length} accepted, ${rejected.length} rejected out of ${(candidates || []).length}`
    );
    for (const r of rejectionLog) {
      logger.warn(
        `[candidateQuality] REJECTED: "${r.candidate.name}" — ${r.reason}`
      );
    }
  }

  return { accepted, rejected, rejectionLog };
}

/**
 * Get a quality summary for logging/debugging.
 */
export function getQualitySummary(candidates, candidateType) {
  const scores = (candidates || []).map((c) => {
    const assessment = assessCandidateQuality(c, candidateType);
    return { name: c.name, score: assessment.qualityScore, eligible: assessment.eligible };
  });
  return {
    total: scores.length,
    eligible: scores.filter((s) => s.eligible).length,
    ineligible: scores.filter((s) => !s.eligible).length,
    avgScore: scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length) : 0,
    minScore: scores.length > 0 ? Math.min(...scores.map((s) => s.score)) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores.map((s) => s.score)) : 0,
    lowest: scores.filter((s) => !s.eligible).sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

export default {
  assessCandidateQuality,
  filterByQuality,
  getQualitySummary,
  MIN_QUALITY_SCORE,
  SCORE_WEIGHTS,
  ADDRESS_PATTERNS,
  GENERIC_PATTERNS,
  UTILITY_PATTERNS,
  RESTAURANT_REJECTION_PATTERNS,
};
