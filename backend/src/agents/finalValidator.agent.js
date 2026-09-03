/**
 * Final Validator Agent: runs the mandatory 20-rule checklist.
 * 
 * Architecture (post-refactor):
 *  - Validates AI-generated itineraries against the real candidate dataset
 *  - Returns STRUCTURED validation errors with type, day, providerId, message
 *  - Candidate dataset is passed in for cross-referencing (provider ID existence,
 *    price source verification, coordinates verification, etc.)
 *  - Supports automatic replanning by returning actionable error objects
 *  - Falls back to deterministic validation when no candidates are provided
 */
import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  VALIDATION ERROR TYPES
// ══════════════════════════════════════════════════════════════════════

export const ERROR_TYPES = Object.freeze({
  PROVIDER_ID_MISSING: 'PROVIDER_ID_MISSING',
  PROVIDER_ID_NOT_FOUND: 'PROVIDER_ID_NOT_FOUND',
  PROVIDER_ID_WRONG_PROVIDER: 'PROVIDER_ID_WRONG_PROVIDER',
  DUPLICATE: 'DUPLICATE',
  OPENING_HOURS: 'OPENING_HOURS',
  TRAVEL_TIME: 'TRAVEL_TIME',
  BUDGET: 'BUDGET',
  DATE_INVALID: 'DATE_INVALID',
  TIME_INVALID: 'TIME_INVALID',
  OVERLAP: 'OVERLAP',
  HOTEL_DATES: 'HOTEL_DATES',
  MEAL_TIMING: 'MEAL_TIMING',
  WEATHER_RELATED: 'WEATHER_RELATED',
  DURATION_VIOLATION: 'DURATION_VIOLATION',
  PRICE_FABRICATED: 'PRICE_FABRICATED',
  RATING_FABRICATED: 'RATING_FABRICATED',
  COORDINATES_FABRICATED: 'COORDINATES_FABRICATED',
  BOOKING_URL_INVALID: 'BOOKING_URL_INVALID',
  DATA_INTEGRITY: 'DATA_INTEGRITY',
  GEOGRAPHIC_REVIEW: 'GEOGRAPHIC_REVIEW',
  EVENT_DATE: 'EVENT_DATE',
  MISSING_PROVIDER_DATA: 'MISSING_PROVIDER_DATA',
});

function createValidationError(type, day, providerId, message) {
  return { type, day: day || null, providerId: providerId || null, message };
}

class FinalValidatorAgent {
  constructor() {
    this.name = 'finalValidator';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  _timeToMinutes(t) {
    if (!t || !t.includes(':')) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  _minutesToTime(m) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  // ════════════════════════════════════════════════════════════════════
  //  ENHANCED VALIDATION WITH CANDIDATE DATASET
  // ════════════════════════════════════════════════════════════════════

  /**
   * Validate an AI-generated itinerary against the candidate dataset.
   * Returns structured validation errors that can drive automatic replanning.
   *
   * @param {object} opts
   * @param {Array} opts.days - The AI-generated itinerary days
   * @param {number} opts.budget - User's total budget
   * @param {number} opts.totalEstimatedCost - Current estimated total
   * @param {string} opts.destination - Destination name
   * @param {string} opts.origin - Origin name
   * @param {object} opts.prefs - User preferences
   * @param {Array} opts.candidates - Normalized candidate dataset (optional, for enhanced validation)
   * @param {object} opts.weather - Weather data (optional)
   * @param {object} opts.transportResult - Transport data (optional)
   * @param {object} opts.hotelResult - Hotel data (optional)
   * @param {object} opts.routeCache - Route cache map (optional)
   */
  runEnhanced({ days, budget, totalEstimatedCost, destination, origin, prefs, candidates, weather, transportResult, hotelResult, routeCache }) {
    const issues = [];
    const warnings = [];
    const candidateMap = this._buildCandidateMap(candidates || []);

    // ═══ RULE 1: Every providerId exists in the candidate dataset ═══
    this._validateProviderIdsExist(days, candidateMap, issues);

    // ═══ RULE 2: Every itinerary item exists in the source dataset ═══
    this._validateItemsInDataset(days, candidateMap, issues);

    // ═══ RULE 3: No duplicate provider IDs ═══
    this._validateNoDuplicateProviderIds(days, candidateMap, issues);

    // ═══ RULE 3b: Provider ID belongs to correct provider ═══
    this._validateProviderOwnership(days, candidateMap, issues);

    // ═══ RULE 3c: Missing provider data ═══
    this._validateMissingProviderData(days, candidateMap, issues);

    // ═══ RULE 3d: Restaurant duplication-aware (only error when alternatives exist) ═══
    this._validateRestaurantDuplicationAware(days, candidateMap, issues);

    // ═══ RULE 4: Dates are valid ═══
    this._validateDates(days, issues);

    // ═══ RULE 5: Start/end times are valid ═══
    this._validateTimes(days, issues);

    // ═══ RULE 5b: Start/end time consistency ═══
    this._validateStartEndTimeConsistency(days, issues);

    // ═══ RULE 6: Activities fit opening hours ═══
    this._validateOpeningHours(days, candidateMap, issues, warnings);

    // ═══ RULE 7: Events occur on the correct dates ═══
    this._validateEventDates(days, issues);

    // ═══ RULE 8: Activity durations are respected ═══
    this._validateDurations(days, warnings);

    // ═══ RULE 9: Travel time is realistic ═══
    this._validateTravelTime(days, routeCache, warnings);

    // ═══ RULE 10: Consecutive locations are geographically reasonable ═══
    this._validateGeographicReasonableness(days, issues, warnings);

    // ═══ RULE 11: Budget is within the user's budget ═══
    this._validateBudget(totalEstimatedCost, budget, issues);

    // ═══ RULE 12: Meal timing is reasonable ═══
    this._validateMealTiming(days, warnings);

    // ═══ RULE 13: Hotel dates are correct ═══
    this._validateHotelDates(days, issues);

    // ═══ RULE 14: Weather-dependent activities are reasonable ═══
    this._validateWeatherActivities(days, weather, warnings);

    // ═══ RULE 15: No impossible overlapping activities ═══
    this._validateNoOverlaps(days, issues);

    // ═══ RULE 16: No fabricated factual data exists ═══
    this._validateNoFabricatedData(days, issues);

    // ═══ RULE 17: Booking URLs come only from provider data ═══
    this._validateBookingUrls(days, candidateMap, warnings);

    // ═══ RULE 18: Prices come only from provider data ═══
    this._validatePriceSources(days, candidateMap, warnings);

    // ═══ RULE 19: Ratings come only from provider data ═══
    this._validateRatingSources(days, candidateMap, warnings);

    // ═══ RULE 20: Coordinates come only from provider data ═══
    this._validateCoordinateSources(days, candidateMap, warnings);

    // ═══ Existing checks: duplicates, transport, labelling ═══
    this._validateDuplicates(days, warnings);
    this._validateTransportRoute(days, origin, warnings);
    this._validateFoodPreferences(days, prefs, warnings);
    this._validateLabelling(days, warnings);
    this._validateLateNightAttractions(days, warnings);
    this._validateTransportBuffer(days, warnings);
    this._validateDataIntegrity(days, issues);

    const passed = issues.length === 0;

    // Build structured errors with available alternatives for each replannable error
    const usedIds = this._collectUsedProviderIds(days);
    const structuredErrors = issues.map(e => {
      const structured = typeof e === 'object' ? e : { type: 'UNKNOWN', message: e };

      // If error already has alternatives (from duplicate checks), keep them
      if (structured.availableAlternatives) return structured;

      // For provider-not-found or provider-missing errors, find alternatives
      if (
        (structured.type === ERROR_TYPES.PROVIDER_ID_NOT_FOUND ||
         structured.type === ERROR_TYPES.PROVIDER_ID_MISSING ||
         structured.type === ERROR_TYPES.PROVIDER_ID_WRONG_PROVIDER) &&
        structured.day
      ) {
        // Find the activity to determine its category
        const dayObj = days.find(d => d.dayNumber === structured.day);
        const act = dayObj?.activities?.find(a => {
          const pid = a.providerId || a._candidateProviderId;
          return structured.providerId?.includes(pid);
        });
        if (act) {
          structured.availableAlternatives = this._findAvailableAlternatives(
            candidateMap, act.category, Array.from(usedIds)
          );
          structured.replaceableCategory = act.category;
        }
      }

      return structured;
    });

    return {
      passed,
      issues,
      warnings,
      structuredErrors,
      summary: issues.length
        ? `Validation failed with ${issues.length} issue(s) and ${warnings.length} warning(s)`
        : `Validation passed with ${warnings.length} warning(s)`,
      fixesApplied: [],
    };
  }

  // ════════════════════════════════════════════════════════════════════
  //  CANDIDATE MAP BUILDER
  // ════════════════════════════════════════════════════════════════════

  _buildCandidateMap(candidates) {
    const map = new Map();
    for (const c of candidates) {
      const key = `${c.provider || ''}|${c.providerId || ''}`;
      if (key !== '|') map.set(key, c);
      // Also index by name for fallback
      if (c.name) map.set(`name:${c.name.toLowerCase()}`, c);
    }
    return map;
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 1 & 2: Provider ID existence
  // ════════════════════════════════════════════════════════════════════

  /**
   * Find available alternative candidates of the same type, excluding items already used.
   * Used to provide the AI with real replacement options when validation fails.
   */
  _findAvailableAlternatives(candidateMap, category, excludeProviderIds = [], maxAlternatives = 5) {
    const alternatives = [];
    const typeCategoryMap = {
      'attraction': ['attraction'],
      'restaurant': ['restaurant'],
      'hotel': ['hotel'],
      'nightlife': ['nightlife'],
      'activity': ['activity', 'event'],
      'event': ['event', 'activity'],
      'transport': ['transport', 'flight', 'train', 'bus'],
      'flight': ['flight', 'transport'],
      'train': ['train', 'transport'],
      'bus': ['bus', 'transport'],
    };
    const matchingTypes = typeCategoryMap[category] || [category];
    const excludeSet = new Set(excludeProviderIds);

    for (const [key, candidate] of candidateMap) {
      if (key.startsWith('name:')) continue; // Skip name index entries
      if (!matchingTypes.includes(candidate.type)) continue;
      if (excludeSet.has(`${candidate.provider}|${candidate.providerId}`)) continue;
      if (alternatives.length >= maxAlternatives) break;
      alternatives.push({
        provider: candidate.provider,
        providerId: candidate.providerId,
        type: candidate.type,
        name: candidate.name,
        rating: candidate.rating ?? null,
        price: candidate.price ?? null,
        address: candidate.address || '',
        suburb: candidate.suburb || '',
      });
    }
    return alternatives;
  }

  /**
   * Collect all providerIds already used across all days.
   */
  _collectUsedProviderIds(days) {
    const used = new Set();
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        if (provider && providerId) {
          used.add(`${provider}|${providerId}`);
        }
      }
    }
    return used;
  }

  _validateProviderIdsExist(days, candidateMap, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        // Transport and hotel activities don't always have provider IDs
        if (['transport', 'flight', 'train', 'bus', 'hotel'].includes(act.category)) continue;
        
        if (provider && providerId) {
          const key = `${provider}|${providerId}`;
          if (!candidateMap.has(key)) {
            issues.push(createValidationError(
              ERROR_TYPES.PROVIDER_ID_NOT_FOUND,
              day.dayNumber,
              `${provider}:${providerId}`,
              `Provider ID "${provider}:${providerId}" for "${act.title}" does not exist in the candidate dataset.`
            ));
          }
        } else if (!provider && !providerId && act.category !== 'free' && act.dataStatus !== 'unavailable') {
          // Activities that aren't free or unavailable should have provider references
          const name = (act.place || act.title || '').toLowerCase();
          if (name && !candidateMap.has(`name:${name}`)) {
            issues.push(createValidationError(
              ERROR_TYPES.PROVIDER_ID_MISSING,
              day.dayNumber,
              null,
              `Activity "${act.title}" has no provider reference and is not found in the candidate dataset.`
            ));
          }
        }
      }
    }
  }

  _validateItemsInDataset(days, candidateMap, issues) {
    // This is covered by _validateProviderIdsExist above
    // Additional check: ensure the item exists by name lookup
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 3: No duplicate provider IDs
  // ════════════════════════════════════════════════════════════════════

  _validateNoDuplicateProviderIds(days, candidateMap, issues) {
    const seen = new Map(); // key → dayNumber
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        if (!provider || !providerId) continue;
        
        // Hotels legitimately repeat across nights (multi-night stay)
        if (act.category === 'hotel') continue;
        
        const key = `${provider}|${providerId}`;
        if (seen.has(key)) {
          const alternatives = this._findAvailableAlternatives(
            candidateMap, act.category, [key]
          );
          issues.push(createValidationError(
            ERROR_TYPES.DUPLICATE,
            day.dayNumber,
            `${provider}:${providerId}`,
            `Provider ID "${provider}:${providerId}" ("${act.title}") was already used on Day ${seen.get(key)}. No duplication allowed.`
          ));
          // Attach alternatives to the last issue
          if (alternatives.length > 0) {
            issues[issues.length - 1].availableAlternatives = alternatives;
            issues[issues.length - 1].replaceableCategory = act.category;
          }
        } else {
          seen.set(key, day.dayNumber);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE: Provider ID belongs to correct provider
  // ════════════════════════════════════════════════════════════════════

  _validateProviderOwnership(days, candidateMap, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        if (!provider || !providerId) continue;

        const key = `${provider}|${providerId}`;
        const candidate = candidateMap.get(key);
        
        if (candidate) {
          // Found by exact provider|providerId match — verify the provider matches
          if (candidate.provider !== provider) {
            issues.push(createValidationError(
              ERROR_TYPES.PROVIDER_ID_WRONG_PROVIDER,
              day.dayNumber,
              `${provider}:${providerId}`,
              `Provider ID "${providerId}" belongs to provider "${candidate.provider}" but was claimed under "${provider}".`
            ));
          }
        } else {
          // Not found by exact key — search by providerId across all providers
          // This catches cases where the providerId is valid but attributed to wrong provider
          let foundUnderDifferentProvider = false;
          for (const [mapKey, mapCandidate] of candidateMap) {
            if (mapKey.startsWith('name:')) continue;
            if (mapCandidate.providerId === providerId && mapCandidate.provider !== provider) {
              foundUnderDifferentProvider = true;
              issues.push(createValidationError(
                ERROR_TYPES.PROVIDER_ID_WRONG_PROVIDER,
                day.dayNumber,
                `${provider}:${providerId}`,
                `Provider ID "${providerId}" belongs to provider "${mapCandidate.provider}" but was claimed under "${provider}". Use provider="${mapCandidate.provider}" instead.`
              ));
              break;
            }
          }
          // If not found under any provider, it's caught by PROVIDER_ID_NOT_FOUND
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE: Missing provider data (candidate exists but key fields missing)
  // ════════════════════════════════════════════════════════════════════

  _validateMissingProviderData(days, candidateMap, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        if (!provider || !providerId) continue;
        if (['transport', 'flight', 'train', 'bus', 'hotel'].includes(act.category)) continue;

        const key = `${provider}|${providerId}`;
        const candidate = candidateMap.get(key);
        if (!candidate) continue;

        const missingFields = [];
        if (!candidate.name && !candidate.name?.trim()) missingFields.push('name');
        if (candidate.latitude == null || candidate.longitude == null) missingFields.push('coordinates');
        if (!candidate.address && !candidate.address?.trim()) missingFields.push('address');

        if (missingFields.length > 0) {
          issues.push(createValidationError(
            ERROR_TYPES.MISSING_PROVIDER_DATA,
            day.dayNumber,
            `${provider}:${providerId}`,
            `Candidate "${candidate.name || providerId}" is missing required fields: ${missingFields.join(', ')}. The AI should not select candidates with incomplete data.`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE: Restaurant duplication — only error when alternatives exist
  // ════════════════════════════════════════════════════════════════════

  _validateRestaurantDuplicationAware(days, candidateMap, issues) {
    const restaurantCandidates = [];
    for (const [key, candidate] of candidateMap) {
      if (key.startsWith('name:')) continue;
      if (candidate.type === 'restaurant') restaurantCandidates.push(candidate);
    }
    const hasRestaurantAlternatives = restaurantCandidates.length > 1;

    const seenRestaurants = new Map(); // providerId → dayNumber
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.category !== 'restaurant') continue;
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        if (!provider || !providerId) continue;

        const key = `${provider}|${providerId}`;
        if (seenRestaurants.has(key)) {
          if (hasRestaurantAlternatives) {
            // Only flag as error when alternatives exist
            const usedIds = Array.from(seenRestaurants.entries()).map(([k]) => k);
            const alternatives = this._findAvailableAlternatives(
              candidateMap, 'restaurant', usedIds
            );
            issues.push(createValidationError(
              ERROR_TYPES.DUPLICATE,
              day.dayNumber,
              `${provider}:${providerId}`,
              `Restaurant "${act.title}" already used on Day ${seenRestaurants.get(key)}. ${restaurantCandidates.length} restaurant candidates available — use a different one.`
            ));
            if (alternatives.length > 0) {
              issues[issues.length - 1].availableAlternatives = alternatives;
              issues[issues.length - 1].replaceableCategory = 'restaurant';
            }
          }
          // If no alternatives, it's a warning, not an error (already handled by _validateDuplicates)
        } else {
          seenRestaurants.set(key, day.dayNumber);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE: Start/end time consistency (AI-provided times)
  // ════════════════════════════════════════════════════════════════════

  _validateStartEndTimeConsistency(days, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        // Check the AI-provided _plannerEndTime against the resolved time
        const startTime = act.time;
        const endTime = act._plannerEndTime;

        if (startTime && endTime) {
          const startMin = this._timeToMinutes(startTime);
          const endMin = this._timeToMinutes(endTime);

          if (startMin !== null && endMin !== null) {
            if (endMin <= startMin) {
              issues.push(createValidationError(
                ERROR_TYPES.TIME_INVALID,
                day.dayNumber,
                act.providerId || null,
                `"${act.title}" has end time (${endTime}) at or before start time (${startTime}).`
              ));
            }

            // Check duration is reasonable (not more than 12 hours)
            const durationMin = endMin - startMin;
            if (durationMin > 720) {
              issues.push(createValidationError(
                ERROR_TYPES.DURATION_VIOLATION,
                day.dayNumber,
                act.providerId || null,
                `"${act.title}" has unreasonable duration of ${Math.round(durationMin / 60)}h (${startTime} → ${endTime}).`
              ));
            }
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 4: Dates are valid
  // ════════════════════════════════════════════════════════════════════

  _validateDates(days, issues) {
    for (const day of days || []) {
      const d = new Date(day.date);
      if (isNaN(d.getTime())) {
        issues.push(createValidationError(
          ERROR_TYPES.DATE_INVALID,
          day.dayNumber,
          null,
          `Day ${day.dayNumber} has an invalid date: "${day.date}".`
        ));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 5: Start/end times are valid
  // ════════════════════════════════════════════════════════════════════

  _validateTimes(days, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.time && !/^\d{2}:\d{2}$/.test(act.time)) {
          issues.push(createValidationError(
            ERROR_TYPES.TIME_INVALID,
            day.dayNumber,
            act.providerId || null,
            `Activity "${act.title}" has invalid time format: "${act.time}". Expected HH:MM.`
          ));
        }
        const minutes = this._timeToMinutes(act.time);
        if (minutes !== null && (minutes < 0 || minutes > 1439)) {
          issues.push(createValidationError(
            ERROR_TYPES.TIME_INVALID,
            day.dayNumber,
            act.providerId || null,
            `Activity "${act.title}" has out-of-range time: "${act.time}".`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 6: Activities fit opening hours
  // ════════════════════════════════════════════════════════════════════

  _validateOpeningHours(days, candidateMap, issues, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.category !== 'attraction' && act.category !== 'activity') continue;
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        let candidate = null;
        if (provider && providerId) {
          candidate = candidateMap.get(`${provider}|${providerId}`);
        }
        if (!candidate) {
          const name = (act.place || '').toLowerCase();
          candidate = candidateMap.get(`name:${name}`);
        }
        
        if (candidate?.openingHours?.periods?.length && act.time) {
          const actMinutes = this._timeToMinutes(act.time);
          if (actMinutes === null) continue;
          
          const actHour = Math.floor(actMinutes / 60);
          let isOpen = false;
          for (const period of candidate.openingHours.periods) {
            // Handle both string format ('09:00') and object format ({ day: 0, time: '09:00' })
            const openStr = typeof period.open === 'string' ? period.open : (period.open?.time || '00:00');
            const closeStr = typeof period.close === 'string' ? period.close : (period.close?.time || '23:59');
            const [openH] = openStr.split(':').map(Number);
            const [closeH] = closeStr.split(':').map(Number);
            if (closeH < openH) {
              // Overnight hours
              if (actHour >= openH || actHour < closeH) { isOpen = true; break; }
            } else {
              if (actHour >= openH && actHour < closeH) { isOpen = true; break; }
            }
          }
          
          if (!isOpen) {
            const hoursStr = candidate.openingHours.periods.map(p => {
              const o = typeof p.open === 'string' ? p.open : p.open?.time || '?';
              const c = typeof p.close === 'string' ? p.close : p.close?.time || '?';
              return `${o}-${c}`;
            }).join(', ');
            // When we have definitive opening hours from the provider and the
            // activity is scheduled outside them, this is a hard error — the
            // venue is closed and replanning is required.
            issues.push(createValidationError(
              ERROR_TYPES.OPENING_HOURS,
              day.dayNumber,
              `${provider}:${providerId}`,
              `"${act.title}" is scheduled at ${act.time} but is CLOSED (opening hours: ${hoursStr}). Replanning required.`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 7: Events occur on the correct dates
  // ════════════════════════════════════════════════════════════════════

  _validateEventDates(days, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.category !== 'activity' || !act._isEvent) continue;
        
        const eventDate = act._eventDate;
        if (eventDate && day.date) {
          const dayDate = new Date(day.date).toISOString().slice(0, 10);
          const eventDateStr = new Date(eventDate).toISOString().slice(0, 10);
          if (dayDate !== eventDateStr) {
            issues.push(createValidationError(
              ERROR_TYPES.EVENT_DATE,
              day.dayNumber,
              act.providerId || null,
              `Event "${act.title}" is scheduled on Day ${day.dayNumber} (${dayDate}) but the event date is ${eventDateStr}.`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 8: Activity durations are respected
  // ════════════════════════════════════════════════════════════════════

  _validateDurations(days, warnings) {
    const DURATION_MIN = {
      transport: 30, flight: 30, train: 30, bus: 30,
      restaurant: 60, attraction: 120, activity: 90,
      free: 60, other: 45, hotel: 0,
    };
    
    for (const day of days || []) {
      const activities = (day.activities || []).filter(a => a.time).sort((a, b) => a.time.localeCompare(b.time));
      
      for (let i = 0; i < activities.length - 1; i++) {
        const curr = activities[i];
        const next = activities[i + 1];
        const currStart = this._timeToMinutes(curr.time);
        const nextStart = this._timeToMinutes(next.time);
        if (currStart === null || nextStart === null) continue;
        
        const duration = DURATION_MIN[curr.category] || 45;
        const currEnd = currStart + duration;
        
        if (currEnd > nextStart + 5) {
          warnings.push(createValidationError(
            ERROR_TYPES.DURATION_VIOLATION,
            day.dayNumber,
            curr.providerId || null,
            `"${curr.title}" (${this._minutesToTime(currStart)}-${this._minutesToTime(currEnd)}) may overlap with "${next.title}" at ${next.time}.`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 9: Travel time is realistic
  // ════════════════════════════════════════════════════════════════════

  _validateTravelTime(days, routeCache, warnings) {
    for (const day of days || []) {
      const activities = (day.activities || []).filter(a => a.time && a.coordinates?.lat != null);
      
      for (let i = 0; i < activities.length - 1; i++) {
        const curr = activities[i];
        const next = activities[i + 1];
        const currStart = this._timeToMinutes(curr.time);
        const nextStart = this._timeToMinutes(next.time);
        if (currStart === null || nextStart === null) continue;
        
        const gapMin = nextStart - currStart;
        
        // Check if we have real route data
        let travelTimeMin = null;
        if (routeCache) {
          const key = `${curr.coordinates.lat},${curr.coordinates.lng}|${next.coordinates.lat},${next.coordinates.lng}`;
          const reverseKey = `${next.coordinates.lat},${next.coordinates.lng}|${curr.coordinates.lat},${curr.coordinates.lng}`;
          const route = routeCache.get(key) || routeCache.get(reverseKey);
          if (route) travelTimeMin = route.durationMin;
        }
        
        // If gap is less than 5 minutes and locations are different, flag it
        if (gapMin < 5 && curr.coordinates && next.coordinates) {
          const dist = this._haversineKm(curr.coordinates, next.coordinates);
          if (dist > 0.5) { // More than 500m apart
            warnings.push(createValidationError(
              ERROR_TYPES.TRAVEL_TIME,
              day.dayNumber,
              null,
              `"${curr.title}" to "${next.title}" has only ${gapMin}min gap but locations are ${dist.toFixed(1)}km apart.`
            ));
          }
        }
        
        // If route data says travel takes longer than available gap
        if (travelTimeMin && travelTimeMin > gapMin && gapMin > 0) {
          warnings.push(createValidationError(
            ERROR_TYPES.TRAVEL_TIME,
            day.dayNumber,
            null,
            `Travel from "${curr.title}" to "${next.title}" takes ~${travelTimeMin}min but only ${gapMin}min is available.`
          ));
        }
      }
    }
  }

  _haversineKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 10: Consecutive locations are geographically reasonable
  // ════════════════════════════════════════════════════════════════════

  _validateGeographicReasonableness(days, issues, warnings) {
    for (const day of days || []) {
      const activities = (day.activities || []).filter(a => a.coordinates?.lat != null);
      
      for (let i = 0; i < activities.length - 1; i++) {
        const curr = activities[i];
        const next = activities[i + 1];
        const dist = this._haversineKm(curr.coordinates, next.coordinates);
        
        // Distances > 50km between consecutive same-day activities are
        // infeasible — treat as a hard validation error that triggers replanning.
        if (dist > 50) {
          issues.push(createValidationError(
            ERROR_TYPES.GEOGRAPHIC_REVIEW,
            day.dayNumber,
            null,
            `"${curr.title}" to "${next.title}" is ${dist.toFixed(0)}km apart — infeasible for a single day without intercity transport. Replanning required.`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 11: Budget is within the user's budget
  // ════════════════════════════════════════════════════════════════════

  _validateBudget(totalEstimatedCost, budget, issues) {
    if (budget && totalEstimatedCost > budget) {
      const overBy = Math.round((totalEstimatedCost - budget) * 100) / 100;
      issues.push(createValidationError(
        ERROR_TYPES.BUDGET,
        null,
        null,
        `Current estimated total (${totalEstimatedCost}) exceeds budget (${budget}) by ${overBy}.`
      ));
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 12: Meal timing is reasonable
  // ════════════════════════════════════════════════════════════════════

  _validateMealTiming(days, warnings) {
    const MEAL_WINDOWS = {
      breakfast: { earliest: 6 * 60, latest: 11 * 60 },
      lunch: { earliest: 11 * 60, latest: 15 * 60 },
      dinner: { earliest: 18 * 60, latest: 23 * 60 },
    };
    
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.category !== 'restaurant' || !act.slot || !MEAL_WINDOWS[act.slot]) continue;
        const minutes = this._timeToMinutes(act.time);
        if (minutes === null) continue;
        
        const window = MEAL_WINDOWS[act.slot];
        if (minutes < window.earliest || minutes > window.latest) {
          warnings.push(createValidationError(
            ERROR_TYPES.MEAL_TIMING,
            day.dayNumber,
            act.providerId || null,
            `"${act.title}" (${act.slot}) is scheduled at ${act.time} — outside typical ${act.slot} window (${this._minutesToTime(window.earliest)}-${this._minutesToTime(window.latest)}).`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 13: Hotel dates are correct
  // ════════════════════════════════════════════════════════════════════

  _validateHotelDates(days, issues) {
    if (!days || days.length === 0) return;
    
    // Day 1 should have a hotel check-in
    const day1Hotels = (days[0]?.activities || []).filter(a => a.category === 'hotel');
    if (day1Hotels.length === 0) {
      issues.push(createValidationError(
        ERROR_TYPES.HOTEL_DATES,
        1,
        null,
        'No accommodation entry found on Day 1.'
      ));
    }
    
    // Departure day should NOT have overnight charges (only checkout)
    const lastDay = days[days.length - 1];
    if (lastDay && days.length > 1) {
      const overnightCharges = (lastDay.activities || []).filter(
        a => a.category === 'hotel' && a.cost?.amount > 0 && a.slot !== 'hotel'
      );
      if (overnightCharges.length > 0) {
        issues.push(createValidationError(
          ERROR_TYPES.HOTEL_DATES,
          lastDay.dayNumber,
          null,
          `Day ${lastDay.dayNumber} (departure) has overnight hotel charges — should only have checkout.`
        ));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 14: Weather-dependent activities are reasonable
  // ════════════════════════════════════════════════════════════════════

  _validateWeatherActivities(days, weather, warnings) {
    if (!weather?.data?.forecast?.length) return;
    
    for (const day of days || []) {
      const dayIdx = (day.dayNumber || 1) - 1;
      const forecast = weather.data.forecast[dayIdx];
      if (!forecast) continue;
      
      const isBadWeather = (forecast.rainProbability || 0) >= 70 ||
        /rain|storm|thunderstorm/i.test(`${forecast.condition || ''} ${forecast.description || ''}`);
      
      if (!isBadWeather) continue;
      
      const outdoorActivities = (day.activities || []).filter(a => {
        if (a.category !== 'attraction' && a.category !== 'activity') return false;
        const name = `${a.title || ''} ${a.place || ''}`.toLowerCase();
        return /beach|park|garden|viewpoint|outdoor|sunset|waterfront/i.test(name);
      });
      
      if (outdoorActivities.length > 0) {
        warnings.push(createValidationError(
          ERROR_TYPES.WEATHER_RELATED,
          day.dayNumber,
          null,
          `Day ${day.dayNumber} has rain probability ${forecast.rainProbability || 'high'}% but includes ${outdoorActivities.length} outdoor activity(ies): ${outdoorActivities.map(a => a.title).join(', ')}.`
        ));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 15: No impossible overlapping activities
  // ════════════════════════════════════════════════════════════════════

  _validateNoOverlaps(days, issues) {
    const DURATION_MIN = {
      transport: 30, flight: 30, train: 30, bus: 30,
      restaurant: 60, attraction: 120, activity: 90,
      free: 60, other: 45, hotel: 0,
    };
    const BUFFER = 5;
    
    for (const day of days || []) {
      const blocks = [];
      for (const act of day.activities || []) {
        const start = this._timeToMinutes(act.time);
        if (start === null) continue;
        const duration = DURATION_MIN[act.category] ?? 45;
        if (duration <= 0) continue;
        const end = start + duration;
        
        for (const b of blocks) {
          if (start < b.end - BUFFER && b.start < end - BUFFER) {
            issues.push(createValidationError(
              ERROR_TYPES.OVERLAP,
              day.dayNumber,
              act.providerId || null,
              `"${act.title}" at ${act.time} overlaps with "${b.title}" (${this._minutesToTime(b.start)}-${this._minutesToTime(b.end)}).`
            ));
          }
        }
        blocks.push({ start, end, title: act.title });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 16: No fabricated factual data exists
  // ════════════════════════════════════════════════════════════════════

  _validateNoFabricatedData(days, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        // Check for isLive/dataStatus contradiction
        if (act.isLive === true && act.dataStatus === 'unavailable') {
          issues.push(createValidationError(
            ERROR_TYPES.DATA_INTEGRITY,
            day.dayNumber,
            act.providerId || null,
            `"${act.title}" claims isLive=true but dataStatus=unavailable — contradiction.`
          ));
        }
        
        // Check for non-estimate cost without provider source
        if (act.cost?.isEstimate === false && act.source) {
          const validSources = ['provider', 'geoapify', 'amadeus-hotels', 'viator', 'zomato', 'ticketmaster', 'aviationstack'];
          if (!validSources.includes(act.source)) {
            issues.push(createValidationError(
              ERROR_TYPES.PRICE_FABRICATED,
              day.dayNumber,
              act.providerId || null,
              `"${act.title}" claims non-estimate cost but source is "${act.source}" — prices should come only from provider data.`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 17: Booking URLs come only from provider data
  // ════════════════════════════════════════════════════════════════════

  _validateBookingUrls(days, candidateMap, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (!act.bookingUrl) continue;
        
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        if (provider && providerId) {
          const candidate = candidateMap.get(`${provider}|${providerId}`);
          if (candidate && candidate.bookingUrl && candidate.bookingUrl !== act.bookingUrl) {
            warnings.push(createValidationError(
              ERROR_TYPES.BOOKING_URL_INVALID,
              day.dayNumber,
              `${provider}:${providerId}`,
              `"${act.title}" booking URL differs from provider data URL.`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 18: Prices come only from provider data
  // ════════════════════════════════════════════════════════════════════

  _validatePriceSources(days, candidateMap, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (!act.cost || act.cost.isEstimate) continue;
        
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        if (provider && providerId) {
          const candidate = candidateMap.get(`${provider}|${providerId}`);
          if (candidate?.price != null && candidate.price !== act.cost.amount) {
            warnings.push(createValidationError(
              ERROR_TYPES.PRICE_FABRICATED,
              day.dayNumber,
              `${provider}:${providerId}`,
              `"${act.title}" price (${act.cost.amount}) differs from provider price (${candidate.price}).`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 19: Ratings come only from provider data
  // ════════════════════════════════════════════════════════════════════

  _validateRatingSources(days, candidateMap, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.rating == null) continue;
        
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        if (provider && providerId) {
          const candidate = candidateMap.get(`${provider}|${providerId}`);
          if (candidate?.rating != null && candidate.rating !== act.rating) {
            warnings.push(createValidationError(
              ERROR_TYPES.RATING_FABRICATED,
              day.dayNumber,
              `${provider}:${providerId}`,
              `"${act.title}" rating (${act.rating}) differs from provider rating (${candidate.rating}).`
            ));
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RULE 20: Coordinates come only from provider data
  // ════════════════════════════════════════════════════════════════════

  _validateCoordinateSources(days, candidateMap, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (!act.coordinates?.lat || !act.coordinates?.lng) continue;
        
        const provider = act.provider || act._candidateProvider;
        const providerId = act.providerId || act._candidateProviderId;
        
        if (provider && providerId) {
          const candidate = candidateMap.get(`${provider}|${providerId}`);
          if (candidate?.coordinates) {
            const distKm = this._haversineKm(act.coordinates, candidate.coordinates);
            if (distKm > 1) { // More than 1km off
              warnings.push(createValidationError(
                ERROR_TYPES.COORDINATES_FABRICATED,
                day.dayNumber,
                `${provider}:${providerId}`,
                `"${act.title}" coordinates are ${distKm.toFixed(1)}km from provider coordinates.`
              ));
            }
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  EXISTING CHECKS (preserved from original)
  // ════════════════════════════════════════════════════════════════════

  _validateDuplicates(days, warnings) {
    const seenAttractions = new Map();
    const seenRestaurants = new Map();
    
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const name = String(act.place || act.title || '').trim();
        if (!name) continue;
        
        if (act.category === 'attraction' || act.category === 'activity') {
          if (seenAttractions.has(name)) {
            warnings.push(createValidationError(
              ERROR_TYPES.DUPLICATE,
              day.dayNumber,
              act.providerId || null,
              `Attraction "${name}" appears on both Day ${seenAttractions.get(name)} and Day ${day.dayNumber}.`
            ));
          } else {
            seenAttractions.set(name, day.dayNumber);
          }
        }
        
        if (act.category === 'restaurant') {
          if (seenRestaurants.has(name)) {
            warnings.push(createValidationError(
              ERROR_TYPES.DUPLICATE,
              day.dayNumber,
              act.providerId || null,
              `Restaurant "${name}" appears on both Day ${seenRestaurants.get(name)} and Day ${day.dayNumber}.`
            ));
          } else {
            seenRestaurants.set(name, day.dayNumber);
          }
        }
      }
    }
  }

  _validateTransportRoute(days, origin, warnings) {
    if (!origin) return;
    const day1 = days?.[0];
    if (!day1) return;
    const transportActs = (day1.activities || []).filter(a =>
      ['flight', 'train', 'bus', 'transport'].includes(a.category)
    );
    if (transportActs.length === 0) {
      warnings.push(createValidationError(
        ERROR_TYPES.DATA_INTEGRITY,
        1,
        null,
        'No outbound transport entry found — verify your route.'
      ));
    }
  }

  _validateFoodPreferences(days, prefs, warnings) {
    if (!prefs?.foodPreference) return;
    const restaurantActs = (days || []).flatMap(d => d.activities || []).filter(a => a.category === 'restaurant');
    const unavailable = restaurantActs.filter(a => a.dataStatus === 'unavailable');
    if (unavailable.length > 0) {
      warnings.push(createValidationError(
        ERROR_TYPES.DATA_INTEGRITY,
        null,
        null,
        `${unavailable.length} restaurant(s) could not be verified against live data.`
      ));
    }
  }

  _validateLabelling(days, warnings) {
    const estimates = (days || []).flatMap(d => d.activities || []).filter(a => a.cost?.isEstimate === true);
    if (estimates.length > 0) {
      warnings.push(createValidationError(
        ERROR_TYPES.DATA_INTEGRITY,
        null,
        null,
        `${estimates.length} costs are estimates (flagged).`
      ));
    }
  }

  _validateLateNightAttractions(days, warnings) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if ((act.category === 'attraction' || act.category === 'activity') && act.time) {
          const minutes = this._timeToMinutes(act.time);
          if (minutes !== null && minutes >= 21 * 60) {
            warnings.push(createValidationError(
              ERROR_TYPES.OPENING_HOURS,
              day.dayNumber,
              act.providerId || null,
              `"${act.title}" at ${act.time} — most attractions close by 20:00.`
            ));
          }
        }
      }
    }
  }

  _validateTransportBuffer(days, warnings) {
    for (const day of days || []) {
      const activities = day.activities || [];
      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        if (['flight', 'train', 'bus', 'transport'].includes(act.category)) {
          const transportEnd = this._timeToMinutes(act.time);
          if (transportEnd !== null && i + 1 < activities.length) {
            const nextAct = activities[i + 1];
            const nextStart = this._timeToMinutes(nextAct.time);
            if (nextStart !== null && nextStart - transportEnd < 30) {
              warnings.push(createValidationError(
                ERROR_TYPES.TRAVEL_TIME,
                day.dayNumber,
                null,
                `Transport at ${act.time} may not allow enough buffer before "${nextAct.title}" at ${nextAct.time}.`
              ));
            }
          }
        }
      }
    }
  }

  _validateDataIntegrity(days, issues) {
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.isLive === true && act.dataStatus === 'unavailable') {
          issues.push(createValidationError(
            ERROR_TYPES.DATA_INTEGRITY,
            day.dayNumber,
            act.providerId || null,
            `"${act.title}" is marked isLive=true but dataStatus=unavailable — contradiction.`
          ));
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  RUN (backward-compatible)
  // ════════════════════════════════════════════════════════════════════

  /**
   * Run validation — supports both legacy and enhanced modes.
   * When candidates are provided, runs enhanced validation with structured errors.
   * Otherwise, runs the original deterministic checks.
   */
  async run({ days, budget, totalEstimatedCost, destination, origin, prefs, userId, candidates, weather, transportResult, hotelResult, routeCache }) {
    logger.entry('[AGENT:finalValidator]', 'run', { dayCount: days?.length || 0, budget, totalEstimatedCost, destination, hasCandidates: Boolean(candidates?.length) });

    let result;
    if (candidates && candidates.length > 0) {
      // Enhanced validation with candidate dataset
      result = this.runEnhanced({ days, budget, totalEstimatedCost, destination, origin, prefs, candidates, weather, transportResult, hotelResult, routeCache });
    } else {
      // Legacy deterministic validation
      result = this.runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs });
    }

    logger.exit('[AGENT:finalValidator]', 'run', {
      status: result.passed ? 'success' : 'degraded',
      issues: result.issues.length,
      warnings: result.warnings.length,
      passed: result.passed,
    });

    return {
      agent: this.name,
      status: result.passed ? 'success' : 'degraded',
      data: { ...result, aiReview: candidates?.length ? 'Enhanced validation with candidate dataset' : 'Deterministic validation only' },
      message: `Validated (${result.issues.length} issues, ${result.warnings.length} warnings)`,
      latencyMs: 0,
      usedAI: false,
      source: candidates?.length ? 'enhanced-deterministic' : 'deterministic',
    };
  }

  /**
   * Legacy deterministic validation (backward-compatible).
   */
  runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs }) {
    const issues = [];
    const warnings = [];

    // Budget check
    if (totalEstimatedCost > budget) {
      issues.push(createValidationError(ERROR_TYPES.BUDGET, null, null, `Estimated cost (${totalEstimatedCost}) exceeds budget (${budget})`));
    }

    // Duplicate checks
    const seenAttractions = new Map();
    const seenRestaurants = new Map();
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const title = String(act.title || '').trim();
        const name = String(act.place || '').trim();
        if (!name) continue;
        if (act.category === 'attraction' || act.category === 'activity') {
          if (seenAttractions.has(name)) {
            warnings.push(createValidationError(ERROR_TYPES.DUPLICATE, day.dayNumber, null, `Duplicate attraction: ${name} (Day ${seenAttractions.get(name)} & Day ${day.dayNumber})`));
          } else {
            seenAttractions.set(name, day.dayNumber);
          }
        }
        if (act.category === 'restaurant') {
          if (seenRestaurants.has(name)) {
            warnings.push(createValidationError(ERROR_TYPES.DUPLICATE, day.dayNumber, null, `Duplicate restaurant: ${name} (Day ${seenRestaurants.get(name)} & Day ${day.dayNumber})`));
          } else {
            seenRestaurants.set(name, day.dayNumber);
          }
        }
      }
    }

    // Date checks
    for (const day of days || []) {
      const d = new Date(day.date);
      if (isNaN(d)) issues.push(createValidationError(ERROR_TYPES.DATE_INVALID, day.dayNumber, null, `Day ${day.dayNumber} has an invalid date`));
    }

    // Overlap checks
    const DURATION_MIN = {
      transport: 30, flight: 30, train: 30, bus: 30,
      restaurant: 60, attraction: 120, activity: 90,
      free: 60, other: 45, hotel: 0, weather: 0, safety: 0,
    };
    for (const day of days || []) {
      const blocks = [];
      for (const act of day.activities || []) {
        const start = this._timeToMinutes(act.time);
        if (start === null) continue;
        const duration = DURATION_MIN[act.category] ?? 45;
        if (duration <= 0) continue;
        const end = start + duration;
        for (const b of blocks) {
          if (start < b.end - 10 && b.start < end - 10) {
            issues.push(createValidationError(ERROR_TYPES.OVERLAP, day.dayNumber, null, `Day ${day.dayNumber}: "${act.title}" at ${act.time} overlaps "${b.title}"`));
          }
        }
        blocks.push({ start, end, title: act.title });
      }
    }

    // Late-night attractions
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if ((act.category === 'attraction' || act.category === 'activity') && act.time) {
          const actMinutes = this._timeToMinutes(act.time);
          if (actMinutes !== null && actMinutes >= 21 * 60) {
            warnings.push(createValidationError(ERROR_TYPES.OPENING_HOURS, day.dayNumber, null, `Day ${day.dayNumber}: "${act.title}" at ${act.time} — most attractions close by 20:00.`));
          }
        }
      }
    }

    // Transport buffer
    for (const day of days || []) {
      const activities = day.activities || [];
      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        if (['flight', 'train', 'bus', 'transport'].includes(act.category)) {
          const transportEnd = this._timeToMinutes(act.time);
          if (transportEnd !== null && i + 1 < activities.length) {
            const nextAct = activities[i + 1];
            const nextStart = this._timeToMinutes(nextAct.time);
            if (nextStart !== null && nextStart - transportEnd < 30) {
              warnings.push(createValidationError(ERROR_TYPES.TRAVEL_TIME, day.dayNumber, null, `Transport at ${act.time} may not allow enough buffer before "${nextAct.title}" at ${nextAct.time}`));
            }
          }
        }
      }
    }

    // Data integrity
    for (const day of days || []) {
      for (const act of day.activities || []) {
        if (act.isLive === true && act.dataStatus === 'unavailable') {
          issues.push(createValidationError(ERROR_TYPES.DATA_INTEGRITY, day.dayNumber, null, `"${act.title}" isLive=true but dataStatus=unavailable`));
        }
        // Fabrication check: non-estimate cost without valid provider source
        if (act.cost?.isEstimate === false && act.source) {
          const validSources = ['provider', 'geoapify', 'amadeus-hotels', 'viator', 'zomato', 'ticketmaster', 'aviationstack'];
          if (!validSources.includes(act.source)) {
            issues.push(createValidationError(ERROR_TYPES.PRICE_FABRICATED, day.dayNumber, act.providerId || null, `"${act.title}" claims non-estimate cost but source is "${act.source}"`));
          }
        }
      }
    }

    // Meal timing
    this._validateMealTiming(days, warnings);

    // Hotel dates
    this._validateHotelDates(days, issues);

    // Geographic reasonableness
    this._validateGeographicReasonableness(days, issues, warnings);

    const passed = issues.length === 0;
    // Collect duplicate details for backward compatibility
    const duplicatePlaces = [];
    const duplicateRestaurants = [];
    for (const w of warnings) {
      if (w.type === ERROR_TYPES.DUPLICATE) {
        const msg = w.message || '';
        if (msg.includes('restaurant')) duplicateRestaurants.push(msg);
        else duplicatePlaces.push(msg);
      }
    }
    return {
      passed,
      issues,
      warnings,
      summary: issues.length ? `Validation failed with ${issues.length} issue(s)` : `Validation passed with ${warnings.length} warning(s)`,
      fixesApplied: [],
      duplicatesFound: warnings.some(w => (typeof w === 'object' ? w.type : '') === ERROR_TYPES.DUPLICATE),
      duplicatePlaces,
      duplicateRestaurants,
    };
  }

  report(result) {
    return {
      agent: this.name,
      status: result.status,
      message: result.message,
      latencyMs: result.latencyMs,
      usedAI: result.usedAI,
    };
  }
}

export default new FinalValidatorAgent();
