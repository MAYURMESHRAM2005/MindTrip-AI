/**
 * itineraryValidator.js — Frontend safety check for duplicate itinerary entities.
 *
 * The backend remains the authoritative validator. This is a defensive
 * client-side layer that catches issues before rendering and logs
 * developer-visible warnings in development mode.
 */

/**
 * Normalize a name for comparison: lowercase, trim, collapse whitespace.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Build a provider key for an activity.
 * Returns "provider|providerId" or null if neither field is present.
 * @param {object} activity
 * @returns {string|null}
 */
function providerKey(activity) {
  const p = activity.provider;
  const id = activity.providerId;
  if (!p && !id) return null;
  return `${p || ''}|${id || ''}`;
}

/**
 * Validate an itinerary for duplicate entities across days.
 *
 * Checks performed:
 *  1. Duplicate provider IDs — same provider+providerId on multiple days
 *  2. Duplicate attractions — same place name appearing as an attraction/activity on multiple days
 *  3. Duplicate restaurants — same restaurant appearing on multiple days
 *  4. Suspicious identical names — any activity with the same name on different days
 *
 * @param {Array} days - array of day objects from the itinerary
 * @returns {{ warnings: string[], counts: { providerDuplicates: number, attractionDuplicates: number, restaurantDuplicates: number, nameDuplicates: number } }}
 */
export function validateItinerary(days) {
  const warnings = [];
  const counts = {
    providerDuplicates: 0,
    attractionDuplicates: 0,
    restaurantDuplicates: 0,
    nameDuplicates: 0,
  };

  if (!Array.isArray(days) || days.length === 0) {
    return { warnings, counts };
  }

  // ── 1. Detect duplicate provider IDs across days ──
  const seenProviders = new Map(); // key → { dayNumber, title, category }

  for (const day of days) {
    const dayNum = day.dayNumber ?? '?';
    for (const act of day.activities || []) {
      const key = providerKey(act);
      if (!key || key === '|') continue;

      // Skip hotels — same hotel across nights is expected
      if (act.category === 'hotel') continue;
      // Skip transport — flights/trains can legitimately repeat
      if (['transport', 'flight', 'train', 'bus'].includes(act.category)) continue;

      if (seenProviders.has(key)) {
        const prev = seenProviders.get(key);
        counts.providerDuplicates++;
        warnings.push(
          `Itinerary validation warning:\n` +
          `"${act.title || act.place || key}" (provider: ${act.provider || 'unknown'}, id: ${act.providerId || 'unknown'}) ` +
          `appears on Day ${prev.dayNumber} and Day ${dayNum}.`
        );
      } else {
        seenProviders.set(key, { dayNumber: dayNum, title: act.title, category: act.category });
      }
    }
  }

  // ── 2. Detect duplicate attractions across days ──
  const seenAttractions = new Map(); // normalizedName → { dayNumber, title }

  for (const day of days) {
    const dayNum = day.dayNumber ?? '?';
    for (const act of day.activities || []) {
      if (act.category !== 'attraction' && act.category !== 'activity') continue;

      const name = normalizeName(act.place || act.title);
      if (!name) continue;

      // Skip generic/unavailable entries
      if (act.dataStatus === 'unavailable' || act.source === 'none') continue;

      if (seenAttractions.has(name)) {
        const prev = seenAttractions.get(name);
        counts.attractionDuplicates++;
        warnings.push(
          `Itinerary validation warning:\n` +
          `"${act.place || act.title}" appears on Day ${prev.dayNumber} and Day ${dayNum} as an attraction.`
        );
      } else {
        seenAttractions.set(name, { dayNumber: dayNum, title: act.place || act.title });
      }
    }
  }

  // ── 3. Detect duplicate restaurants across days ──
  const seenRestaurants = new Map(); // normalizedName → { dayNumber, title }

  for (const day of days) {
    const dayNum = day.dayNumber ?? '?';
    for (const act of day.activities || []) {
      if (act.category !== 'restaurant') continue;

      const name = normalizeName(act.place || act.title);
      if (!name) continue;

      // Skip generic/unavailable entries
      if (act.dataStatus === 'unavailable' || act.source === 'none') continue;

      if (seenRestaurants.has(name)) {
        const prev = seenRestaurants.get(name);
        counts.restaurantDuplicates++;
        warnings.push(
          `Itinerary validation warning:\n` +
          `"${act.place || act.title}" appears on Day ${prev.dayNumber} and Day ${dayNum} as a restaurant.`
        );
      } else {
        seenRestaurants.set(name, { dayNumber: dayNum, title: act.place || act.title });
      }
    }
  }

  // ── 4. Detect suspicious identical names across any category ──
  const seenNames = new Map(); // normalizedName → [{ dayNumber, category, title }]

  for (const day of days) {
    const dayNum = day.dayNumber ?? '?';
    for (const act of day.activities || []) {
      const name = normalizeName(act.place || act.title);
      if (!name || name.length < 3) continue;

      // Skip generic/unavailable entries
      if (act.dataStatus === 'unavailable' || act.source === 'none') continue;
      // Skip transport — legitimately repeated
      if (['transport', 'flight', 'train', 'bus'].includes(act.category)) continue;
      // Skip hotels — same hotel across nights is expected
      if (act.category === 'hotel') continue;

      if (seenNames.has(name)) {
        const prev = seenNames.get(name);
        // Only warn if it's on a DIFFERENT day (same day duplicates are different slots)
        const onDifferentDay = prev.some((p) => p.dayNumber !== dayNum);
        if (onDifferentDay) {
          counts.nameDuplicates++;
          warnings.push(
            `Itinerary validation warning:\n` +
            `"${act.place || act.title}" appears on Day ${prev[0].dayNumber} and Day ${dayNum}.`
          );
        }
        prev.push({ dayNumber: dayNum, category: act.category, title: act.place || act.title });
      } else {
        seenNames.set(name, [{ dayNumber: dayNum, category: act.category, title: act.place || act.title }]);
      }
    }
  }

  return { warnings, counts };
}

/**
 * Log itinerary validation warnings in development mode.
 * Uses console.warn for visibility in dev tools.
 *
 * @param {Array} days - array of day objects from the itinerary
 */
export function logItineraryWarnings(days) {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return;
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'production') return;

  const { warnings, counts } = validateItinerary(days);

  if (warnings.length === 0) return;

  console.group(
    `%c⚠️ Itinerary Validation: ${warnings.length} issue(s) found`,
    'color: #f59e0b; font-weight: bold; font-size: 12px'
  );
  console.warn(
    `Provider duplicates: ${counts.providerDuplicates} | ` +
    `Attraction duplicates: ${counts.attractionDuplicates} | ` +
    `Restaurant duplicates: ${counts.restaurantDuplicates} | ` +
    `Name duplicates: ${counts.nameDuplicates}`
  );
  for (const w of warnings) {
    console.warn(w);
  }
  console.groupEnd();
}
