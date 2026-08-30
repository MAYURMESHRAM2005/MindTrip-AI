import ticketmasterProvider from '../providers/ticketmaster.provider.js';
import mapsProvider from '../providers/maps.provider.js';
import logger from '../utils/logger.js';

/**
 * Cultural Events Agent: finds real events, concerts, festivals, and
 * local happenings during the trip dates using Ticketmaster Discovery API.
 *
 * This agent adds date-specific, real-world cultural experiences that
 * static attraction data cannot provide. Events are mapped to specific
 * trip days so the itinerary builder can schedule them.
 *
 * No Gemini calls — purely provider-based.
 */
class CulturalEventsAgent {
  constructor() {
    this.name = 'culturalEvents';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  /**
   * Search for cultural events happening during the trip.
   *
   * @param {object} opts
   * @param {string} opts.destination — City/destination name
   * @param {string} opts.startDate — Trip start date (YYYY-MM-DD)
   * @param {string} opts.endDate — Trip end date (YYYY-MM-DD)
   * @param {string[]} opts.interests — User interests (e.g., ['music', 'food', 'arts'])
   * @param {number} opts.lat — Optional destination latitude
   * @param {number} opts.lng — Optional destination longitude
   * @returns {object} — Agent result with events mapped to days
   */
  async run({ destination, startDate, endDate, interests = [], lat, lng }) {
    logger.entry('[AGENT:culturalEvents]', 'run', { destination, startDate, endDate, interests });
    const started = Date.now();

    // Geocode destination if no coordinates provided
    let destLat = lat;
    let destLng = lng;
    if (destLat == null || destLng == null) {
      try {
        const geo = await mapsProvider.geocode(destination);
        if (geo.isLive && geo.data?.lat != null) {
          destLat = geo.data.lat;
          destLng = geo.data.lng;
        }
      } catch {
        // Geocoding failed — proceed with keyword-only search
      }
    }

    // Build keyword queries from interests
    const keywords = this._buildKeywords(interests);

    // Search events — broad search first, then interest-specific
    let allEvents = [];
    const seenEventIds = new Set();

    // 1. Broad search (all events in the area during trip dates)
    try {
      const broadResult = await ticketmasterProvider.searchEvents({
        destination: destLat == null ? destination : undefined,
        lat: destLat,
        lng: destLng,
        startDate,
        endDate,
        radius: 30,
        limit: 25,
      });
      if (broadResult.isLive) {
        for (const event of broadResult.data || []) {
          if (!seenEventIds.has(event.eventId)) {
            seenEventIds.add(event.eventId);
            allEvents.push(event);
          }
        }
      }
    } catch (err) {
      logger.warn(`[AGENT:culturalEvents] Broad search failed: ${err.message}`);
    }

    // 2. Interest-specific searches (up to 3 keywords, 10 events each)
    for (const kw of keywords.slice(0, 3)) {
      try {
        const kwResult = await ticketmasterProvider.searchEvents({
          destination: destLat == null ? destination : undefined,
          lat: destLat,
          lng: destLng,
          keyword: kw,
          startDate,
          endDate,
          radius: 30,
          limit: 10,
        });
        if (kwResult.isLive) {
          for (const event of kwResult.data || []) {
            if (!seenEventIds.has(event.eventId)) {
              seenEventIds.add(event.eventId);
              allEvents.push(event);
            }
          }
        }
      } catch (err) {
        logger.warn(`[AGENT:culturalEvents] Keyword search "${kw}" failed: ${err.message}`);
      }
    }

    // Map events to specific trip days
    const daysMap = this._mapEventsToDays(allEvents, startDate, endDate);

    // Classify events by category for the itinerary builder
    const categorized = {
      concerts: allEvents.filter((e) => /music|concert|dj|band/i.test(e.category + ' ' + e.genre)),
      festivals: allEvents.filter((e) => /festival|fair|carnival/i.test(e.name + ' ' + e.category)),
      theatre: allEvents.filter((e) => /theatre|theater|opera|ballet|comedy/i.test(e.category + ' ' + e.name)),
      arts: allEvents.filter((e) => /art|exhibition|museum|gallery|craft/i.test(e.category + ' ' + e.name)),
      food: allEvents.filter((e) => /food|culinary|wine|beer|dining/i.test(e.name + ' ' + e.category)),
      other: allEvents.filter((e) => !categorized?.concerts?.includes(e) && !categorized?.festivals?.includes(e) && !categorized?.theatre?.includes(e) && !categorized?.arts?.includes(e) && !categorized?.food?.includes(e)),
    };

    // Collect unique categories for recommendations
    const categories = [...new Set(allEvents.map((e) => e.category).filter(Boolean))];

    logger.exit('[AGENT:culturalEvents]', 'run', {
      status: allEvents.length > 0 ? 'success' : 'degraded',
      eventCount: allEvents.length,
      daysWithEvents: Object.keys(daysMap).length,
      latencyMs: Date.now() - started,
    });

    return {
      agent: this.name,
      status: allEvents.length > 0 ? 'success' : 'degraded',
      data: {
        events: allEvents,
        daysMap,
        categorized,
        categories,
        totalEvents: allEvents.length,
        daysWithEvents: Object.keys(daysMap).length,
        dateRange: { startDate, endDate },
        note: allEvents.length > 0
          ? `Found ${allEvents.length} real events from Ticketmaster during your trip dates`
          : 'No events found for your dates — Ticketmaster coverage may be limited for this destination',
      },
      message: allEvents.length > 0
        ? `Found ${allEvents.length} cultural events during ${startDate} → ${endDate}`
        : `No events found for ${destination} during ${startDate} → ${endDate} — Ticketmaster may not cover this area`,
      latencyMs: Date.now() - started,
      usedAI: false,
      source: 'provider',
    };
  }

  /**
   * Build search keywords from user interests.
   * Maps travel interests to Ticketmaster-friendly keywords.
   */
  _buildKeywords(interests) {
    const keywordMap = {
      music: 'music',
      concerts: 'concert',
      nightlife: 'nightlife',
      food: 'food',
      culinary: 'food festival',
      wine: 'wine',
      beer: 'beer festival',
      arts: 'art',
      culture: 'festival',
      theatre: 'theatre',
      theater: 'comedy',
      shopping: 'market',
      sports: 'sports',
      family: 'family',
      kids: 'kids',
      history: 'history',
      photography: 'exhibition',
      dance: 'dance',
      comedy: 'comedy',
      theatre: 'theatre',
      films: 'film festival',
      tech: 'technology',
    };

    const keywords = [];
    for (const interest of interests) {
      const lower = interest.toLowerCase();
      if (keywordMap[lower] && !keywords.includes(keywordMap[lower])) {
        keywords.push(keywordMap[lower]);
      }
    }
    return keywords;
  }

  /**
   * Map events to specific trip days by date.
   * Returns { 'YYYY-MM-DD': [event, ...] }
   */
  _mapEventsToDays(events, startDate, endDate) {
    const daysMap = {};
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (const event of events) {
      const eventDate = event.date || event.dateTime?.slice(0, 10);
      if (!eventDate) continue;

      const d = new Date(eventDate);
      if (d >= start && d <= end) {
        const key = eventDate;
        if (!daysMap[key]) daysMap[key] = [];
        daysMap[key].push(event);
      }
    }

    return daysMap;
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

export default new CulturalEventsAgent();
