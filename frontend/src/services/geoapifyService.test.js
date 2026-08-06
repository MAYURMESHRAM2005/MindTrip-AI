import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  geocodeApi: { geocode: vi.fn() },
  routesApi: { directions: vi.fn() },
  mapsApi: { nearby: vi.fn() },
}));

import { geocodeApi, routesApi, mapsApi } from './apiClient';

const mockedGeocode = vi.mocked(geocodeApi.geocode);
const mockedRoutes = vi.mocked(routesApi.directions);
const mockedNearby = vi.mocked(mapsApi.nearby);

let service;

beforeAll(async () => {
  ({ default: service } = await import('./geoapifyService'));
});

beforeEach(() => {
  mockedGeocode.mockReset();
  mockedRoutes.mockReset();
  mockedNearby.mockReset();
});

describe('geoapifyService (backend proxy)', () => {
  it('geocodes through the backend and normalizes coordinates', async () => {
    mockedGeocode.mockResolvedValue({
      data: { data: { geocode: { lat: 21.1458, lng: 79.0882, address: 'Nagpur, Maharashtra', placeId: 'abc' }, isLive: true } },
    });
    const res = await service.geocode('Nagpur');

    expect(mockedGeocode).toHaveBeenCalledWith('Nagpur');
    expect(res.isLive).toBe(true);
    expect(res.lat).toBe(21.1458);
    expect(res.lng).toBe(79.0882);
  });

  it('returns a friendly message when the backend cannot geocode', async () => {
    mockedGeocode.mockResolvedValue({
      data: { message: 'Geocoding failed: no results', data: { geocode: null, isLive: false } },
    });
    const res = await service.geocode('Atlantis');

    expect(res.isLive).toBe(false);
    expect(res.message).toMatch(/no results/i);
  });

  it('requests routes from the backend and decodes the polyline', async () => {
    mockedRoutes.mockResolvedValue({
      data: {
        data: {
          isLive: true,
          directions: {
            routes: [{ distanceKm: 12, durationMin: 20, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }],
            originPoint: { lat: 21.1, lng: 79.0 },
            destinationPoint: { lat: 21.2, lng: 79.1 },
          },
        },
      },
    });
    const res = await service.getRoute('21.1,79.0', '21.2,79.1', 'drive');

    // Geoapify-style 'drive' must be normalized to the backend's 'driving' mode.
    expect(mockedRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'driving', alternatives: false })
    );
    expect(res.isLive).toBe(true);
    expect(res.distanceKm).toBe(12);
    expect(res.originPoint.lat).toBe(21.1);
    expect(Array.isArray(res.route)).toBe(true);
  });

  it('fetches nearby places grouped by category through the backend', async () => {
    mockedNearby.mockResolvedValue({
      data: {
        data: {
          isLive: true,
          results: { hotel: [{ placeId: 'h1', name: 'Hotel X', coordinates: { lat: 21.1, lng: 79.0 } }] },
        },
      },
    });
    const res = await service.getNearby({ lat: 21.1, lng: 79.0, radius: 6000 });

    expect(mockedNearby).toHaveBeenCalledWith(expect.objectContaining({ lat: 21.1, lng: 79.0 }));
    expect(res.isLive).toBe(true);
    expect(res.results.hotel[0].name).toBe('Hotel X');
  });

  it('never rejects for provider/network failures', async () => {
    mockedGeocode.mockRejectedValue(new Error('Network Error'));
    const res = await service.geocode('Goa');
    expect(res.isLive).toBe(false);
    expect(res.message).toMatch(/Network Error|unavailable/i);
  });
});
