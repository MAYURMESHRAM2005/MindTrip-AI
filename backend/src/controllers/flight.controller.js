import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import flightProvider from '../providers/flight.provider.js';
import ignavProvider from '../providers/ignav.provider.js';
import logger from '../utils/logger.js';

export const searchFlights = asyncHandler(async (req, res) => {
  logger.entry('[CTRL:flight]', 'searchFlights', req.query);
  const { origin, destination, departDate, returnDate, adults, travelClass, nonStop, maxPrice } = req.query;
  const started = Date.now();
  const result = await flightProvider.searchFlights({
    origin: (origin || '').trim(),
    destination: (destination || '').trim(),
    departDate,
    returnDate: returnDate || null,
    adults: Number(adults) || 1,
    travelClass: travelClass || 'ECONOMY',
    nonStop: nonStop === 'true',
    maxPrice: maxPrice ? Number(maxPrice) : null,
  });
  logger.exit('[CTRL:flight]', 'searchFlights', { status: result.isLive ? 'success' : 'degraded', flightCount: result.data?.length || 0, provider: result.source, latencyMs: Date.now() - started });
  res.json(
    ApiResponse.ok(result.message, {
      flights: result.data || [],
      isLive: result.isLive,
      provider: result.source,
      providerStatus: flightProvider.providerStatus(),
    })
  );
});

/** Get booking links for a specific Ignav itinerary. */
export const bookingLinks = asyncHandler(async (req, res) => {
  logger.entry('[CTRL:flight]', 'bookingLinks', { ignav_id: req.body.ignav_id });
  const { ignav_id } = req.body;
  if (!ignav_id) {
    return res.status(400).json(ApiResponse.badRequest('ignav_id is required'));
  }
  const result = await ignavProvider.getBookingLinks(ignav_id);
  res.json(
    ApiResponse.ok(result.message, {
      links: result.data || [],
      isLive: result.isLive,
    })
  );
});

export default { searchFlights, bookingLinks };
