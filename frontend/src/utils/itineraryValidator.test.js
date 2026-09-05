import { describe, it, expect } from 'vitest';
import { validateItinerary } from './itineraryValidator';

describe('validateItinerary', () => {
  it('returns no warnings for an empty itinerary', () => {
    const { warnings, counts } = validateItinerary([]);
    expect(warnings).toHaveLength(0);
    expect(counts.providerDuplicates).toBe(0);
    expect(counts.attractionDuplicates).toBe(0);
    expect(counts.restaurantDuplicates).toBe(0);
    expect(counts.nameDuplicates).toBe(0);
  });

  it('returns no warnings for unique attractions across days', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'attraction', place: 'Gateway of India', title: 'Gateway of India', provider: 'google', providerId: 'goi-1' },
          { category: 'restaurant', place: 'Leopold Cafe', title: 'Leopold Cafe', provider: 'google', providerId: 'lc-1' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'attraction', place: 'Marine Drive', title: 'Marine Drive', provider: 'google', providerId: 'md-1' },
          { category: 'restaurant', place: 'Trishna', title: 'Trishna', provider: 'google', providerId: 'tr-1' },
        ],
      },
    ];
    const { warnings, counts } = validateItinerary(days);
    expect(warnings).toHaveLength(0);
    expect(counts.providerDuplicates).toBe(0);
    expect(counts.attractionDuplicates).toBe(0);
    expect(counts.restaurantDuplicates).toBe(0);
  });

  it('detects duplicate provider IDs across days', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'attraction', place: 'Gateway of India', title: 'Gateway of India', provider: 'google', providerId: 'goi-1' },
        ],
      },
      {
        dayNumber: 3,
        activities: [
          { category: 'attraction', place: 'Gateway of India', title: 'Gateway of India', provider: 'google', providerId: 'goi-1' },
        ],
      },
    ];
    const { warnings, counts } = validateItinerary(days);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(counts.providerDuplicates).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain('Day 1');
    expect(warnings[0]).toContain('Day 3');
    expect(warnings[0]).toContain('Gateway of India');
  });

  it('detects duplicate attraction names across days', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'attraction', place: 'Gateway of India', title: 'Gateway of India' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'attraction', place: 'Gateway of India', title: 'Gateway of India' },
        ],
      },
    ];
    const { counts } = validateItinerary(days);
    expect(counts.attractionDuplicates).toBeGreaterThanOrEqual(1);
  });

  it('detects duplicate restaurant names across days', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'restaurant', place: 'Leopold Cafe', title: 'Leopold Cafe' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'restaurant', place: 'Leopold Cafe', title: 'Leopold Cafe' },
        ],
      },
    ];
    const { counts } = validateItinerary(days);
    expect(counts.restaurantDuplicates).toBeGreaterThanOrEqual(1);
  });

  it('does not flag hotels as duplicates across nights', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'hotel', place: 'Taj Mahal Palace', title: 'Overnight at Taj Mahal Palace', provider: 'amadeus', providerId: 'taj-1' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'hotel', place: 'Taj Mahal Palace', title: 'Overnight at Taj Mahal Palace', provider: 'amadeus', providerId: 'taj-1' },
        ],
      },
    ];
    const { warnings, counts } = validateItinerary(days);
    expect(counts.providerDuplicates).toBe(0);
    expect(counts.nameDuplicates).toBe(0);
    // No warnings should be produced for repeated hotels
    expect(warnings).toHaveLength(0);
  });

  it('does not flag transport as duplicates', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'flight', place: 'Mumbai → Delhi', title: 'Flight to Delhi', provider: 'transport-intelligence', providerId: 'AI-201' },
        ],
      },
      {
        dayNumber: 3,
        activities: [
          { category: 'flight', place: 'Delhi → Mumbai', title: 'Flight to Mumbai', provider: 'transport-intelligence', providerId: 'AI-201' },
        ],
      },
    ];
    const { warnings, counts } = validateItinerary(days);
    expect(counts.providerDuplicates).toBe(0);
    // Transport is excluded from name duplicates too
    expect(warnings).toHaveLength(0);
  });

  it('ignores unavailable/unavailable entries', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'attraction', place: 'Unknown Place', title: 'Unknown Place', dataStatus: 'unavailable', source: 'none' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'attraction', place: 'Unknown Place', title: 'Unknown Place', dataStatus: 'unavailable', source: 'none' },
        ],
      },
    ];
    const { warnings, counts } = validateItinerary(days);
    expect(warnings).toHaveLength(0);
    expect(counts.attractionDuplicates).toBe(0);
    expect(counts.nameDuplicates).toBe(0);
  });

  it('detects suspicious identical names across different categories', () => {
    const days = [
      {
        dayNumber: 1,
        activities: [
          { category: 'attraction', place: 'Colaba Market', title: 'Colaba Market' },
        ],
      },
      {
        dayNumber: 2,
        activities: [
          { category: 'activity', place: 'Colaba Market', title: 'Colaba Market' },
        ],
      },
    ];
    const { counts } = validateItinerary(days);
    expect(counts.nameDuplicates).toBeGreaterThanOrEqual(1);
  });
});
