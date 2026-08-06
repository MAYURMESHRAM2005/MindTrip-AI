import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import flightProvider from '../providers/flight.provider.js';

export const searchFlights = asyncHandler(async (req, res) => {
  const { origin, destination, departDate, returnDate, adults, travelClass, nonStop, maxPrice } = req.query;
  const result = await flightProvider.searchFlights({
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    departDate,
    returnDate: returnDate || null,
    adults: Number(adults) || 1,
    travelClass: travelClass || 'ECONOMY',
    nonStop: nonStop === 'true',
    maxPrice: maxPrice ? Number(maxPrice) : null,
  });
  res.json(ApiResponse.ok(result.message, { flights: result.data || [], isLive: result.isLive, provider: result.source }));
});

export default { searchFlights };
