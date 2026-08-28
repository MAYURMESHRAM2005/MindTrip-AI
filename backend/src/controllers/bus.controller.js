import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import busProvider from '../providers/bus.provider.js';
import logger from '../utils/logger.js';

export const searchBuses = asyncHandler(async (req, res) => {
  logger.entry('[CTRL:bus]', 'searchBuses', req.query);
  const { from, to, date, passengers } = req.query;
  const started = Date.now();
  const result = await busProvider.searchBuses({
    from,
    to,
    date,
    passengers: Number(passengers) || 1,
  });
  logger.exit('[CTRL:bus]', 'searchBuses', { status: result.isLive ? 'success' : 'degraded', busCount: result.data?.length || 0, latencyMs: Date.now() - started });
  res.json(
    ApiResponse.ok(result.message, {
      buses: result.data || [],
      isLive: result.isLive,
      providerStatus: busProvider.providerStatus(),
      debug: result._debug || null,
      externalSources: [{ name: 'RedBus', url: 'https://www.redbus.in' }, { name: 'abhibus', url: 'https://www.abhibus.com' }],
    })
  );
});

export const searchCities = asyncHandler(async (req, res) => {
  logger.debug(`[CTRL:bus] searchCities: ${req.query.q}`);
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    res.json(ApiResponse.ok('Query too short', { cities: [] }));
    return;
  }
  const result = await busProvider.searchCities(q.trim());
  res.json(ApiResponse.ok(result.message, { cities: result.cities }));
});

export const seatLayout = asyncHandler(async (req, res) => {
  const { tripId } = req.query;
  if (!tripId) {
    res.status(400).json(ApiResponse.badRequest('tripId is required'));
    return;
  }
  const result = await busProvider.getSeatLayout(tripId);
  res.json(ApiResponse.ok(result.message, {
    seats: result.seats,
    boarding: result.boarding,
    dropping: result.dropping,
  }));
});

export const bookBus = asyncHandler(async (req, res) => {
  logger.entry('[CTRL:bus]', 'bookBus', { tripId: req.body.tripId, email: req.body.email, passengerCount: req.body.passengers?.length });
  const { tripId, boardingId, droppingId, email, mobile, passengers, reference } = req.body;
  if (!tripId || !email || !mobile || !passengers?.length) {
    res.status(400).json(ApiResponse.badRequest('tripId, email, mobile, and passengers are required'));
    return;
  }
  const result = await busProvider.bookSeats({
    tripId,
    boardingId,
    droppingId,
    email,
    mobile,
    passengers,
    reference,
  });
  if (result.success) {
    res.json(ApiResponse.ok(result.message, {
      pnr: result.pnr,
      amount: result.amount,
      currency: result.currency,
      seats: result.seats,
    }));
  } else {
    res.status(400).json(ApiResponse.badRequest(result.message));
  }
});

export default { searchBuses, searchCities, seatLayout, bookBus };
