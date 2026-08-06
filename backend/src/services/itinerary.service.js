import { haversineKm } from '../utils/geo.js';

/**
 * Deterministic schedule builder. Composes real provider data into a
 * day-by-day plan using a realistic daily rhythm:
 *  - Arrival day:    transport-in, hotel check-in, lunch, sightseeing, dinner
 *  - Middle days:    lunch, sightseeing, local evening, dinner, back to hotel
 *  - Departure day:  check-out, return travel (no destination activities)
 * Anything without live data is marked dataStatus:'unavailable' - nothing is
 * ever invented.
 */

const RESTAURANT_PRICE_BY_LEVEL = { 0: 150, 1: 350, 2: 700, 3: 1400, 4: 2500 };
const ATTRACTION_ENTRY_DEFAULT = { amount: 0, isEstimate: true };

function costForRestaurant(r) {
  const level = r.priceLevel ?? 1;
  const amount = RESTAURANT_PRICE_BY_LEVEL[level] ?? 350;
  return { amount, currency: 'INR', isEstimate: true, estimateNote: `Estimated from price level ${level}` };
}

function costForAttraction(a) {
  return { ...ATTRACTION_ENTRY_DEFAULT, estimateNote: 'Entry fee unknown - confirm locally' };
}

function travelBetween(a, b) {
  if (!a?.coordinates || !b?.coordinates) {
    return { distanceKm: 0, durationMin: 15, method: 'walking', isEstimate: true };
  }
  const km = haversineKm(a.coordinates.lat, a.coordinates.lng, b.coordinates.lat, b.coordinates.lng);
  const method = km < 2 ? 'walking' : km < 15 ? 'taxi/auto' : 'bus/metro';
  const durationMin = Math.round((km / (method === 'walking' ? 5 : 30)) * 60) || 15;
  return { distanceKm: Math.round(km * 10) / 10, durationMin, method, isEstimate: true };
}

export function dateRange(startDate, endDate) {
  const days = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Build the full day-by-day itinerary structure.
 */
export function buildDays({
  origin,
  destination,
  startDate,
  endDate,
  travelers,
  prefs,
  hotelResult,
  transportResult,
  weatherResult,
  attractions,
  restaurants,
  budgetAllocation,
  currency = 'INR',
}) {
  const dates = dateRange(startDate, endDate);
  const hotel = hotelResult?.data?.recommended || hotelResult?.data?.hotels?.[0] || null;
  const nights = Math.max(1, dates.length - 1);
  const hotelNightly =
    hotel?.price?.amount != null
      ? hotel.price.amount
      : budgetAllocation?.hotels?.amount != null
        ? Math.round(budgetAllocation.hotels.amount / nights)
        : null;
  const transportMode = transportResult?.mode || 'transport';
  const modeLabel = transportMode === 'flight' ? 'Flight' : transportMode === 'train' ? 'Train' : transportMode === 'bus' ? 'Bus' : 'Transport';
  const transportLive = transportResult?.data?.isLive === true;

  const attractionsPool = attractions?.slice() || [];
  const restaurantsPool = restaurants?.slice() || [];

  const days = dates.map((date, idx) => {
    const dayNumber = idx + 1;
    const isArrival = idx === 0;
    const isDeparture = idx === dates.length - 1 && dates.length > 1;
    const weather = weatherResult?.data?.forecast?.[idx] || null;
    const activities = [];

    const hotelCost = {
      amount: hotelNightly ?? 0,
      currency: hotel?.price?.currency || currency,
      isEstimate: hotelNightly == null,
      estimateNote: hotelNightly == null ? 'Estimated from accommodation budget' : 'Live price from provider',
    };
    const hotelIsLive = hotel?.isLive === true;
    const hotelEntry = (time, title, description, dataStatus, source, priority) => ({
      time,
      title,
      place: hotel?.name || destination,
      description,
      category: 'hotel',
      address: hotel?.address || '',
      coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
      cost: { ...hotelCost },
      source,
      bookingUrl: hotel?.bookingUrl || '',
      isLive: hotelIsLive,
      dataStatus,
      priority,
    });

    if (isArrival) {
      // --- Outbound transport ---
      if (transportResult?.data?.selected) {
        const t = transportResult.data.selected;
        activities.push({
          time: '07:00',
          title: `${modeLabel} to ${destination}`,
          place: t.airline ? `${t.airline} ${t.flightNumber || ''}`.trim() : t.trainName || t.operator || destination,
          description: `${origin} → ${destination}. Provider: ${t.provider || 'live provider'}.`,
          category: transportMode,
          travel: { distanceKm: 0, durationMin: 0, method: transportMode, isEstimate: false },
          cost: { amount: t.price?.amount ?? 0, currency, isEstimate: true, estimateNote: 'Price from provider when available' },
          source: 'provider',
          bookingUrl: t.bookingUrl || '',
          isLive: transportLive,
          dataStatus: transportLive ? 'live' : 'unavailable',
          priority: 1,
        });
      } else if (origin) {
        activities.push({
          time: '07:00',
          title: `Travel from ${origin} to ${destination}`,
          place: `${origin} → ${destination}`,
          description: 'Outbound transport. Live schedules unavailable - book via your preferred provider.',
          category: 'transport',
          travel: { distanceKm: 0, durationMin: 0, method: 'transport', isEstimate: true },
          cost: { amount: budgetAllocation?.transport?.amount ? Math.round(budgetAllocation.transport.amount / 2) : 0, currency, isEstimate: true, estimateNote: 'Estimated from transport budget' },
          source: 'budget-estimate',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 1,
        });
      }

      // --- Hotel check-in (arrival day only) ---
      if (hotel) {
        activities.push(hotelEntry(
          '13:00',
          `Check-in at ${hotel.name || destination}`,
          `Accommodation in ${destination}. ${hotel.provider || ''}`.trim(),
          hotelIsLive ? 'live' : 'unavailable',
          hotelIsLive ? 'amadeus-hotels' : 'budget-estimate',
          1
        ));
      } else {
        activities.push({
          time: '13:00',
          title: `Check-in · Accommodation in ${destination}`,
          place: destination,
          description: 'Live hotel data unavailable. Estimated nightly rate allocated from budget.',
          category: 'hotel',
          cost: { amount: hotelNightly ?? 0, currency, isEstimate: true, estimateNote: 'Estimated from accommodation budget' },
          source: 'budget-estimate',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 1,
        });
      }
    }

    // --- Lunch (arrival + middle days) ---
    if (!isDeparture) {
      const lunch = restaurantsPool[(idx * 2) % Math.max(1, restaurantsPool.length)];
      if (lunch) {
        activities.push({
          time: '14:00',
          title: `Lunch at ${lunch.name}`,
          place: lunch.name,
          description: `Cuisine match for ${prefs?.foodPreference || 'your preference'}. Rating ${lunch.rating ?? 'n/a'}.`,
          category: 'restaurant',
          address: lunch.address || '',
          coordinates: lunch.coordinates || null,
          cost: costForRestaurant(lunch),
          source: 'google-places',
          isLive: true,
          dataStatus: 'live',
          priority: 1,
          travel: lunch.coordinates ? {} : { distanceKm: 0, durationMin: 10, method: 'walking', isEstimate: true },
        });
      } else {
        activities.push({
          time: '14:00',
          title: 'Lunch',
          place: destination,
          description: 'Restaurant recommendation pending - live data unavailable. Use the Restaurants page when online.',
          category: 'restaurant',
          cost: { amount: budgetAllocation?.food?.amount ? Math.round((budgetAllocation.food.amount / dates.length) / 3) : 0, currency, isEstimate: true, estimateNote: 'Estimated from food budget' },
          source: 'budget-estimate',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 2,
        });
      }
    }

    // --- Afternoon attraction (arrival + middle days) ---
    if (!isDeparture) {
      const attraction = attractionsPool[idx % Math.max(1, attractionsPool.length)];
      if (attraction) {
        activities.push({
          time: '15:30',
          title: attraction.name,
          place: attraction.name,
          description: attraction.types?.join(', ') || 'Tourist attraction',
          category: 'attraction',
          address: attraction.address || '',
          coordinates: attraction.coordinates || null,
          cost: costForAttraction(attraction),
          source: 'google-places',
          isLive: true,
          dataStatus: 'live',
          priority: 1,
          travel: travelBetween(hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null, attraction.coordinates),
        });
      } else {
        activities.push({
          time: '15:30',
          title: `Explore ${destination}`,
          place: destination,
          description: 'Self-guided exploration. Attraction data unavailable - check the Maps & Places pages.',
          category: 'attraction',
          cost: { amount: 0, currency, isEstimate: true, estimateNote: 'Free / unknown entry fee' },
          source: 'none',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 3,
        });
      }
    }

    // --- Evening activity (arrival + middle days) ---
    if (!isDeparture) {
      const attraction = attractionsPool[idx % Math.max(1, attractionsPool.length)];
      const evening = attractionsPool[(idx + 1) % Math.max(1, attractionsPool.length)] || attraction;
      if (evening && evening !== attraction) {
        activities.push({
          time: '18:30',
          title: `${evening.name} (evening)`,
          place: evening.name,
          description: evening.types?.join(', ') || 'Evening activity',
          category: 'activity',
          address: evening.address || '',
          coordinates: evening.coordinates || null,
          cost: costForAttraction(evening),
          source: 'google-places',
          isLive: true,
          dataStatus: 'live',
          priority: 2,
        });
      } else {
        activities.push({
          time: '18:30',
          title: `Local evening in ${destination}`,
          place: destination,
          description: 'Markets, waterfront or local culture. Details depend on live data availability.',
          category: 'activity',
          cost: { amount: 0, currency, isEstimate: true },
          source: 'none',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 3,
        });
      }
    }

    // --- Dinner (arrival + middle days) ---
    if (!isDeparture) {
      const dinner = restaurantsPool[(idx * 2 + 1) % Math.max(1, restaurantsPool.length)];
      const lunch = restaurantsPool[(idx * 2) % Math.max(1, restaurantsPool.length)];
      if (dinner && dinner !== lunch) {
        activities.push({
          time: '20:30',
          title: `Dinner at ${dinner.name}`,
          place: dinner.name,
          description: `Rating ${dinner.rating ?? 'n/a'}. ${prefs?.foodPreference ? `Matches ${prefs.foodPreference} preference.` : ''}`,
          category: 'restaurant',
          address: dinner.address || '',
          coordinates: dinner.coordinates || null,
          cost: costForRestaurant(dinner),
          source: 'google-places',
          isLive: true,
          dataStatus: 'live',
          priority: 1,
        });
      } else {
        activities.push({
          time: '20:30',
          title: 'Dinner',
          place: destination,
          description: 'Dinner recommendation pending - live data unavailable.',
          category: 'restaurant',
          cost: { amount: budgetAllocation?.food?.amount ? Math.round((budgetAllocation.food.amount / dates.length) / 3) : 0, currency, isEstimate: true, estimateNote: 'Estimated from food budget' },
          source: 'budget-estimate',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 2,
        });
      }
    }

    // --- Night (arrival + middle days) ---
    if (!isDeparture) {
      activities.push({
        time: '22:00',
        title: hotel ? `Back to ${hotel.name}` : `Overnight in ${destination}`,
        place: hotel?.name || destination,
        description: 'Rest and recharge for tomorrow.',
        category: 'hotel',
        address: hotel?.address || '',
        coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
        cost: { amount: 0, currency, isEstimate: true },
        source: 'none',
        isLive: false,
        dataStatus: 'estimate',
        priority: 1,
      });
    }

    // --- Departure day: check-out + return travel (chronologically ordered) ---
    if (isDeparture) {
      activities.push({
        time: '09:00',
        title: `Check out · depart ${destination}`,
        place: hotel?.name || destination,
        description: 'Departure day - pack up and check out of your accommodation.',
        category: 'hotel',
        address: hotel?.address || '',
        coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
        cost: { amount: 0, currency, isEstimate: true },
        source: 'none',
        isLive: false,
        dataStatus: 'estimate',
        priority: 1,
      });
      if (origin) {
        activities.push({
          time: '11:00',
          title: `Return travel to ${origin}`,
          place: `${destination} → ${origin}`,
          description: 'Return transport. Live schedules unavailable - book via your preferred provider.',
          category: 'transport',
          cost: { amount: budgetAllocation?.transport?.amount ? Math.round(budgetAllocation.transport.amount / 2) : 0, currency, isEstimate: true, estimateNote: 'Estimated from transport budget' },
          source: 'budget-estimate',
          isLive: false,
          dataStatus: 'unavailable',
          priority: 1,
        });
      }
    }

    const dayCost = activities.reduce((s, a) => s + (a.cost?.amount || 0), 0);
    return {
      dayNumber,
      date,
      activities,
      weather: weather
        ? {
            temp: weather.tempMax ?? weather.temp ?? null,
            condition: weather.condition || '',
            rainProbability: weather.rainProbability ?? null,
            isLive: weatherResult?.data?.provider === 'live',
          }
        : null,
      dayCost: Math.round(dayCost * 100) / 100,
      dayCostIsEstimate: true,
    };
  });

  return days;
}

/**
 * Compute total estimated cost from itinerary days.
 */
export function computeItineraryCost(days) {
  return Math.round(days.reduce((sum, d) => sum + d.dayCost, 0) * 100) / 100;
}

/**
 * Turn itinerary activities into budget optimization items.
 */
export function toCostItems(days, currency) {
  const items = [];
  for (const day of days) {
    for (const act of day.activities) {
      items.push({
        id: `${day.dayNumber}-${act.title}`,
        day: day.dayNumber,
        category: act.category,
        title: act.title,
        amount: act.cost?.amount || 0,
        currency: act.cost?.currency || currency,
        droppable: (act.priority || 1) > 1 && !act.isLive, // never drop live bookings
        flexible: act.category === 'restaurant' || act.category === 'activity',
        priority: act.priority || 1,
      });
    }
  }
  return items;
}

export default { buildDays, dateRange, computeItineraryCost, toCostItems };
