import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import hotelProvider from '../providers/hotel.provider.js';
import placesProvider from '../providers/places.provider.js';
import { convert } from '../providers/currency.provider.js';
import logger from '../utils/logger.js';

/**
 * Search hotels: Amadeus offers first. When Amadeus is unconfigured we
 * fall back to Geoapify Places lodging results (live place data) clearly
 * labelled with its source - never invented inventory.
 */
export const searchHotels = asyncHandler(async (req, res) => {
  logger.entry('[CTRL:hotel]', 'searchHotels', req.query);
  const started = Date.now();
  const { city, checkIn, checkOut, adults, rooms, maxPrice, minRating, currency } = req.query;

  const amadeus = await hotelProvider.searchHotels({
    city,
    checkIn,
    checkOut,
    adults: Number(adults) || 2,
    rooms: Number(rooms) || 1,
    maxPrice: maxPrice ? Number(maxPrice) : null,
    minRating: minRating ? Number(minRating) : null,
  });

  if (amadeus.isLive) {
    logger.exit('[CTRL:hotel]', 'searchHotels', { status: 'success', provider: 'amadeus', hotelCount: amadeus.data?.length || 0, latencyMs: Date.now() - started });
    return res.json(ApiResponse.ok(amadeus.message, { hotels: amadeus.data, provider: 'amadeus', isLive: true }));
  }

  // Fallback: live Geoapify Places lodging data
  const places = await placesProvider.textSearch({ query: `${city} hotels`, type: 'hotel', limit: 10 });
  if (places.isLive) {
    const hotels = places.data.map((p) => ({
      id: p.placeId,
      name: p.name,
      address: p.address,
      coordinates: p.coordinates,
      rating: p.rating,
      priceLevel: p.priceLevel,
      amenities: [],
      price: null,
      provider: 'Geoapify Places',
      bookingUrl: '',
      isLive: true,
      dataSource: 'geoapify',
    }));
    return res.json(ApiResponse.ok('Live hotel listings from Geoapify Places (Amadeus unavailable)', { hotels, provider: 'geoapify', isLive: true, note: amadeus.message }));
  }

  logger.exit('[CTRL:hotel]', 'searchHotels', { status: 'degraded', provider: 'none', latencyMs: Date.now() - started });
  res.json(
    ApiResponse.ok('Live hotel data unavailable', {
      hotels: [],
      provider: 'none',
      isLive: false,
      message: `${amadeus.message} ${places.isLive ? '' : places.message}`.trim(),
    })
  );
});

export default { searchHotels };
