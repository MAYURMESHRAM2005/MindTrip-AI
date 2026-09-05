/**
 * provenanceValidator.js — Data Provenance Validation
 *
 * Enforces strict data provenance for every factual itinerary entity.
 * Every item must contain a valid provenance block with:
 *   - sourceType: "provider" | "estimated" | "unavailable"
 *   - provider: string (provider name)
 *   - providerId: string (provider's unique ID)
 *   - fetchedAt: ISO timestamp
 *   - dataStatus: "live" | "estimated" | "unavailable"
 *   - isEstimate: boolean
 *
 * Rules:
 *   LIVE: Actual provider response contains the data
 *   ESTIMATED: System calculated an estimate using a documented deterministic rule
 *   UNAVAILABLE: No reliable provider data exists
 *
 * Never allow:
 *   - provider unavailable → Gemini generates value → mark live
 *   - provider unavailable → arbitrary default → mark live
 *   - provider unavailable → Gemini invents place → mark live
 */

// Allowed values for dataStatus
const ALLOWED_DATA_STATUS = ['live', 'estimated', 'unavailable'];

// Allowed values for sourceType
const ALLOWED_SOURCE_TYPE = ['provider', 'estimated', 'unavailable'];

/**
 * Validate a provenance block for an itinerary entity.
 * Returns { valid, errors } where errors is an array of validation error messages.
 */
export function validateProvenance(provenance, entityName = 'entity') {
  const errors = [];

  if (!provenance || typeof provenance !== 'object') {
    return { valid: false, errors: [`[${entityName}] Missing provenance block`] };
  }

  // Validate sourceType
  if (!provenance.sourceType) {
    errors.push(`[${entityName}] Missing sourceType`);
  } else if (!ALLOWED_SOURCE_TYPE.includes(provenance.sourceType)) {
    errors.push(`[${entityName}] Invalid sourceType: "${provenance.sourceType}". Must be one of: ${ALLOWED_SOURCE_TYPE.join(', ')}`);
  }

  // Validate provider
  if (!provenance.provider) {
    errors.push(`[${entityName}] Missing provider`);
  } else if (typeof provenance.provider !== 'string') {
    errors.push(`[${entityName}] Provider must be a string`);
  }

  // Validate providerId
  if (!provenance.providerId) {
    errors.push(`[${entityName}] Missing providerId`);
  } else if (typeof provenance.providerId !== 'string') {
    errors.push(`[${entityName}] ProviderId must be a string`);
  }

  // Validate fetchedAt
  if (!provenance.fetchedAt) {
    errors.push(`[${entityName}] Missing fetchedAt`);
  } else if (typeof provenance.fetchedAt !== 'string') {
    errors.push(`[${entityName}] fetchedAt must be a string`);
  } else if (isNaN(new Date(provenance.fetchedAt).getTime())) {
    errors.push(`[${entityName}] fetchedAt must be a valid ISO timestamp`);
  }

  // Validate dataStatus
  if (!provenance.dataStatus) {
    errors.push(`[${entityName}] Missing dataStatus`);
  } else if (!ALLOWED_DATA_STATUS.includes(provenance.dataStatus)) {
    errors.push(`[${entityName}] Invalid dataStatus: "${provenance.dataStatus}". Must be one of: ${ALLOWED_DATA_STATUS.join(', ')}`);
  }

  // Validate isEstimate
  if (typeof provenance.isEstimate !== 'boolean') {
    errors.push(`[${entityName}] isEstimate must be a boolean`);
  }

  // Cross-field validation: dataStatus consistency
  if (provenance.dataStatus === 'live' && provenance.isEstimate) {
    errors.push(`[${entityName}] dataStatus "live" cannot coexist with isEstimate: true`);
  }

  if (provenance.dataStatus === 'estimated' && !provenance.isEstimate) {
    errors.push(`[${entityName}] dataStatus "estimated" must have isEstimate: true`);
  }

  if (provenance.dataStatus === 'unavailable' && provenance.isEstimate) {
    errors.push(`[${entityName}] dataStatus "unavailable" cannot coexist with isEstimate: true`);
  }

  // Validate sourceType consistency with dataStatus
  if (provenance.sourceType === 'provider' && provenance.dataStatus === 'unavailable') {
    errors.push(`[${entityName}] sourceType "provider" cannot coexist with dataStatus "unavailable"`);
  }

  if (provenance.sourceType === 'estimated' && provenance.dataStatus === 'live') {
    errors.push(`[${entityName}] sourceType "estimated" cannot coexist with dataStatus "live"`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a provenance block for a provider-sourced entity.
 * @param {string} provider - Provider name (e.g., "google", "zomato")
 * @param {string} providerId - Provider's unique ID for this entity
 * @param {string} dataStatus - "live" or "estimated" (default: "live")
 * @param {object} options - Optional overrides
 * @returns {object} Provenance block
 */
export function createProviderProvenance(provider, providerId, dataStatus = 'live', options = {}) {
  if (!ALLOWED_DATA_STATUS.includes(dataStatus)) {
    throw new Error(`Invalid dataStatus: "${dataStatus}". Must be one of: ${ALLOWED_DATA_STATUS.join(', ')}`);
  }

  return {
    sourceType: 'provider',
    provider,
    providerId: String(providerId),
    fetchedAt: new Date().toISOString(),
    dataStatus,
    isEstimate: dataStatus === 'estimated',
    ...options,
  };
}

/**
 * Create a provenance block for an estimated entity.
 * @param {string} provider - Provider name that provided base data (or "system")
 * @param {string} providerId - Provider's unique ID or "estimated-{hash}"
 * @param {object} options - Optional overrides
 * @returns {object} Provenance block
 */
export function createEstimatedProvenance(provider, providerId, options = {}) {
  return {
    sourceType: 'estimated',
    provider: provider || 'system',
    providerId: String(providerId || 'estimated'),
    fetchedAt: new Date().toISOString(),
    dataStatus: 'estimated',
    isEstimate: true,
    ...options,
  };
}

/**
 * Create a provenance block for an unavailable entity.
 * @param {string} provider - Provider name that was attempted (or "none")
 * @param {string} reason - Reason for unavailability
 * @param {object} options - Optional overrides
 * @returns {object} Provenance block
 */
export function createUnavailableProvenance(provider, reason, options = {}) {
  return {
    sourceType: 'unavailable',
    provider: provider || 'none',
    providerId: `unavailable-${Date.now()}`,
    fetchedAt: new Date().toISOString(),
    dataStatus: 'unavailable',
    isEstimate: false,
    unavailableReason: reason || 'No reliable data available',
    ...options,
  };
}

/**
 * Validate a complete itinerary entity (activity) for provenance compliance.
 * @param {object} activity - The activity object to validate
 * @returns {object} { valid, errors, warnings }
 */
export function validateActivityProvenance(activity) {
  const entityName = activity?.title || activity?.place || 'unknown-activity';
  const errors = [];
  const warnings = [];

  // Check if provenance block exists
  if (!activity.provenance) {
    errors.push(`[${entityName}] Missing provenance block`);
    return { valid: false, errors, warnings };
  }

  // Validate the provenance block
  const provenanceResult = validateProvenance(activity.provenance, entityName);
  errors.push(...provenanceResult.errors);

  // Additional business logic validations
  if (activity.provenance.dataStatus === 'live') {
    // Ensure we have a real provider
    if (!activity.provenance.provider || activity.provenance.provider === 'none') {
      errors.push(`[${entityName}] dataStatus "live" requires a real provider name`);
    }

    // Ensure we have a real provider ID
    if (!activity.provenance.providerId || activity.provenance.providerId.startsWith('unavailable-')) {
      errors.push(`[${entityName}] dataStatus "live" requires a real providerId`);
    }
  }

  if (activity.provenance.dataStatus === 'estimated') {
    warnings.push(`[${entityName}] This is an estimated value - verify estimation methodology is documented`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate all activities in an itinerary day for provenance compliance.
 * @param {object} day - The day object containing activities
 * @returns {object} { valid, errors, warnings, summary }
 */
export function validateDayProvenance(day) {
  const dayNumber = day?.dayNumber || 0;
  const errors = [];
  const warnings = [];
  let totalActivities = 0;
  let liveCount = 0;
  let estimatedCount = 0;
  let unavailableCount = 0;

  for (const activity of (day?.activities || [])) {
    totalActivities++;
    const result = validateActivityProvenance(activity);
    errors.push(...result.errors);
    warnings.push(...result.warnings);

    if (activity.provenance?.dataStatus === 'live') liveCount++;
    else if (activity.provenance?.dataStatus === 'estimated') estimatedCount++;
    else if (activity.provenance?.dataStatus === 'unavailable') unavailableCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      dayNumber,
      totalActivities,
      liveCount,
      estimatedCount,
      unavailableCount,
    },
  };
}

/**
 * Validate an entire itinerary for provenance compliance.
 * @param {Array} days - Array of day objects
 * @returns {object} { valid, errors, warnings, summary }
 */
export function validateItineraryProvenance(days) {
  const errors = [];
  const warnings = [];
  let totalDays = 0;
  let totalActivities = 0;
  let totalLive = 0;
  let totalEstimated = 0;
  let totalUnavailable = 0;

  for (const day of (days || [])) {
    totalDays++;
    const result = validateDayProvenance(day);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    totalActivities += result.summary.totalActivities;
    totalLive += result.summary.liveCount;
    totalEstimated += result.summary.estimatedCount;
    totalUnavailable += result.summary.unavailableCount;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      totalDays,
      totalActivities,
      totalLive,
      totalEstimated,
      totalUnavailable,
      livePercentage: totalActivities > 0 ? Math.round((totalLive / totalActivities) * 100) : 0,
    },
  };
}

/**
 * Ensure an activity has a valid provenance block, creating one if missing.
 * This is a safety function to guarantee all activities have provenance.
 * @param {object} activity - The activity object
 * @param {string} fallbackProvider - Fallback provider name
 * @param {string} fallbackDataStatus - Fallback data status
 * @returns {object} Activity with guaranteed provenance block
 */
export function ensureProvenance(activity, fallbackProvider = 'none', fallbackDataStatus = 'unavailable') {
  if (!activity.provenance) {
    activity.provenance = {
      sourceType: fallbackDataStatus === 'live' ? 'provider' : fallbackDataStatus === 'estimated' ? 'estimated' : 'unavailable',
      provider: fallbackProvider,
      providerId: activity.providerId || activity.placeId || `fallback-${Date.now()}`,
      fetchedAt: new Date().toISOString(),
      dataStatus: fallbackDataStatus,
      isEstimate: fallbackDataStatus === 'estimated',
    };
  }
  return activity;
}

export default {
  validateProvenance,
  createProviderProvenance,
  createEstimatedProvenance,
  createUnavailableProvenance,
  validateActivityProvenance,
  validateDayProvenance,
  validateItineraryProvenance,
  ensureProvenance,
};
