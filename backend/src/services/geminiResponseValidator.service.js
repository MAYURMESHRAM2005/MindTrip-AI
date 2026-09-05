/**
 * geminiResponseValidator.service.js — Anti-Hallucination Response Validator
 *
 * Validates Gemini's response against the trusted candidate dataset.
 * Gemini MUST return candidateIds only. Backend hydrates the full data.
 *
 * Architecture:
 *   Gemini response (candidateIds only) → schema validation →
 *   trusted dataset validation → hydration → final itinerary
 *
 * This is the critical anti-hallucination checkpoint.
 */

import { buildTrustedLookup, validateItemAgainstTrustedDataset, hydrateResponse } from './trustedDatasetBuilder.service.js';
import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  VALID TYPES
// ══════════════════════════════════════════════════════════════════════

const VALID_TYPES = new Set([
  'attraction', 'restaurant', 'hotel', 'event',
  'transport', 'nightlife', 'activity', 'flight', 'train', 'bus',
]);

/**
 * Fields that Gemini MUST include in each item.
 */
const REQUIRED_ITEM_FIELDS = ['candidateId', 'type', 'time', 'reason'];

/**
 * Fields that Gemini must NOT include (factual data resolved by backend).
 * These are FORBIDDEN — if present, they are stripped and warned.
 */
const FORBIDDEN_FACTUAL_FIELDS = [
  'name', 'provider', 'providerId', 'price', 'cost', 'coordinates',
  'rating', 'openingHours', 'availability', 'bookingUrl', 'imageUrl',
  'duration', 'address', 'latitude', 'longitude', 'pricePerNight',
  'averageCostPerPerson', 'dataStatus', 'isEstimate', 'source',
  'suburb', 'city', 'country', 'tags', 'priceLevel', 'venue',
  'eventDate', 'eventTime', 'isFree', 'departure', 'arrival',
  'estimatedVisitHours', 'roomType',
];

// ══════════════════════════════════════════════════════════════════════
//  SCHEMA VALIDATION — Strict ID-Only Format
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate the basic schema of Gemini's response.
 * Enforces strict ID-only format: candidateId + type + time + reason.
 *
 * Expected format:
 * {
 *   "days": [
 *     {
 *       "dayNumber": 1,
 *       "date": "2026-09-01",
 *       "areaId": "area-1",
 *       "theme": "South Mumbai Heritage",
 *       "items": [
 *         {
 *           "candidateId": "google-123",
 *           "type": "attraction",
 *           "time": "09:30",
 *           "reason": "Matches heritage interest"
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * Returns { valid, errors, warnings, data }.
 */
export function validateSchema(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Response is not an object'], warnings: [], data: null };
  }

  const root = raw;

  if (!Array.isArray(root.days)) {
    return { valid: false, errors: ['days is not an array'], warnings: [], data: null };
  }
  if (root.days.length === 0) {
    return { valid: false, errors: ['days is empty'], warnings: [], data: null };
  }

  for (let di = 0; di < root.days.length; di++) {
    const day = root.days[di];
    const dayLabel = `days[${di}]`;

    // Day-level validation
    if (day.dayNumber != null && (typeof day.dayNumber !== 'number' || day.dayNumber < 1)) {
      warnings.push(`${dayLabel}.dayNumber should be a positive number`);
    }
    if (typeof day.date !== 'string' || !day.date.trim()) {
      errors.push(`${dayLabel}.date is missing or empty`);
    }
    if (typeof day.theme !== 'string' || !day.theme.trim()) {
      warnings.push(`${dayLabel}.theme is missing or empty`);
    }
    if (day.areaId != null && typeof day.areaId !== 'string') {
      warnings.push(`${dayLabel}.areaId should be a string`);
    }
    if (!Array.isArray(day.items)) {
      errors.push(`${dayLabel}.items is not an array`);
      continue;
    }
    if (day.items.length === 0) {
      warnings.push(`${dayLabel}.items is empty`);
    }

    // Item-level validation
    for (let ii = 0; ii < day.items.length; ii++) {
      const item = day.items[ii];
      const itemLabel = `${dayLabel}.items[${ii}]`;

      // candidateId is REQUIRED (strict schema)
      if (typeof item.candidateId !== 'string' || !item.candidateId.trim()) {
        errors.push(`${itemLabel}.candidateId is missing or empty — Gemini must return candidateIds only`);
      }

      // type is REQUIRED
      if (!item.type || !VALID_TYPES.has(item.type)) {
        errors.push(`${itemLabel}.type "${item.type}" is not valid`);
      }

      // time is REQUIRED
      if (typeof item.time !== 'string' || !item.time.trim()) {
        errors.push(`${itemLabel}.time is missing or empty`);
      }

      // reason is REQUIRED
      if (typeof item.reason !== 'string' || !item.reason.trim()) {
        errors.push(`${itemLabel}.reason is missing or empty`);
      }

      // Check for forbidden factual fields
      for (const field of FORBIDDEN_FACTUAL_FIELDS) {
        if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
          warnings.push(`${itemLabel}.${field} should not be present — backend hydrates from trusted dataset`);
        }
      }

      // Legacy format: provider/providerId still accepted but warned
      if (!item.candidateId && item.provider && item.providerId) {
        warnings.push(`${itemLabel}: using legacy provider/providerId format — migrate to candidateId`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, data: null };
  }

  return { valid: true, errors: [], warnings, data: root };
}

// ══════════════════════════════════════════════════════════════════════
//  TRUSTED DATASET VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate that every item in Gemini's response exists in the trusted dataset.
 * This is the critical anti-hallucination check.
 *
 * @param {object} response - Gemini's parsed response
 * @param {Map} trustedLookup - lookup map from buildTrustedLookup()
 * @returns {{ valid, errors, warnings, validatedDays }}
 */
export function validateAgainstTrustedDataset(response, trustedLookup) {
  const errors = [];
  const warnings = [];
  const validatedDays = [];

  if (!response?.days || !trustedLookup) {
    return { valid: false, errors: ['Missing response or trusted lookup'], warnings: [], validatedDays: [] };
  }

  for (let di = 0; di < response.days.length; di++) {
    const day = response.days[di];
    const validatedItems = [];

    for (let ii = 0; ii < (day.items || []).length; ii++) {
      const item = day.items[ii];
      const itemLabel = `Day ${di + 1} item ${ii}`;

      // Validate against trusted dataset
      const { valid, trustedCandidate, reason } = validateItemAgainstTrustedDataset(item, trustedLookup);

      if (!valid) {
        errors.push(`${itemLabel}: ${reason}`);
        logger.warn(`[ANTI-HALLUCINATION] REJECTED: ${itemLabel} — ${reason}`);
        continue;
      }

      // Additional checks
      if (trustedCandidate) {
        // Warn if forbidden fields are present
        for (const field of FORBIDDEN_FACTUAL_FIELDS) {
          if (item[field] !== undefined && item[field] !== null && item[field] !== '') {
            warnings.push(`${itemLabel}: contains forbidden field "${field}" — will be overwritten by trusted data`);
          }
        }
      }

      validatedItems.push({
        ...item,
        _validated: true,
        _trustedCandidateId: trustedCandidate?.candidateId || '',
      });
    }

    validatedDays.push({
      ...day,
      items: validatedItems,
    });
  }

  if (errors.length > 0) {
    logger.warn(`[ANTI-HALLUCINATION] ${errors.length} items rejected from ${response.days.length} days`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    validatedDays,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  FULL VALIDATION + HYDRATION PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full anti-hallucination validation and hydration pipeline.
 *
 * Steps:
 *   1. Schema validation (strict ID-only format)
 *   2. Trusted dataset validation (every candidateId must exist)
 *   3. Hydration (resolve candidateIds to full trusted data)
 *
 * @param {object} rawResponse - raw Gemini response
 * @param {Map} trustedLookup - trusted dataset lookup
 * @returns {{ valid, errors, warnings, data, summary }}
 */
export function validateGeminiResponse(rawResponse, trustedLookup) {
  const started = Date.now();

  // Step 1: Schema validation
  const schemaResult = validateSchema(rawResponse);
  if (!schemaResult.valid) {
    return {
      valid: false,
      errors: schemaResult.errors,
      warnings: schemaResult.warnings,
      data: null,
      summary: {
        schemaFailed: true,
        trustedFailed: false,
        hydrationFailed: false,
        totalItems: 0,
        validated: 0,
        hydrated: 0,
        rejected: 0,
        latencyMs: Date.now() - started,
      },
    };
  }

  // Step 2: Trusted dataset validation
  const trustedResult = validateAgainstTrustedDataset(schemaResult.data, trustedLookup);

  if (!trustedResult.valid) {
    return {
      valid: false,
      errors: trustedResult.errors,
      warnings: [...(schemaResult.warnings || []), ...(trustedResult.warnings || [])],
      data: null,
      summary: {
        schemaFailed: false,
        trustedFailed: true,
        hydrationFailed: false,
        totalItems: schemaResult.data.days.reduce((s, d) => s + (d.items?.length || 0), 0),
        validated: 0,
        hydrated: 0,
        rejected: trustedResult.errors.length,
        latencyMs: Date.now() - started,
      },
    };
  }

  // Step 3: Hydration — resolve candidateIds to full trusted data
  const hydrationResult = hydrateResponse(
    { days: trustedResult.validatedDays },
    trustedLookup
  );

  const totalItems = schemaResult.data.days.reduce((s, d) => s + (d.items?.length || 0), 0);

  const summary = {
    schemaFailed: false,
    trustedFailed: false,
    hydrationFailed: hydrationResult.rejectedCount > 0,
    totalItems,
    validated: trustedResult.validatedDays.reduce((s, d) => s + (d.items?.length || 0), 0),
    hydrated: hydrationResult.hydratedCount,
    rejected: hydrationResult.rejectedCount,
    warnings: [...(schemaResult.warnings || []), ...(trustedResult.warnings || [])].length,
    latencyMs: Date.now() - started,
  };

  if (hydrationResult.rejectedCount > 0) {
    logger.warn(`[ANTI-HALLUCINATION] ${hydrationResult.rejectedCount} items failed hydration`);
    return {
      valid: false,
      errors: hydrationResult.errors,
      warnings: [...(schemaResult.warnings || []), ...(trustedResult.warnings || [])],
      data: null,
      summary,
    };
  }

  logger.info(`[ANTI-HALLUCINATION] PASSED: ${summary.hydrated}/${summary.totalItems} items hydrated (${summary.rejected} rejected)`);

  return {
    valid: true,
    errors: [],
    warnings: [...(schemaResult.warnings || []), ...(trustedResult.warnings || [])],
    data: { days: hydrationResult.hydratedDays },
    summary,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  validateSchema,
  validateAgainstTrustedDataset,
  validateGeminiResponse,
  FORBIDDEN_FACTUAL_FIELDS,
  REQUIRED_ITEM_FIELDS,
  VALID_TYPES,
};
