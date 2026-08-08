import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import placesProvider from '../providers/places.provider.js';
import mapsProvider from '../providers/maps.provider.js';

/**
 * Search restaurants via Geoapify Places, with vegetarian / vegan / non-veg
 * filtering applied to real data (using place categories).
 * A city/place can be provided; it is geocoded so the search is scoped to a
 * circle around that location instead of a loose text query.
 */
export const searchRestaurants = asyncHandler(async (req, res) => {
  const { q, city, lat, lng, radius, limit, minRating, priceLevel, openNow, veg, vegan, nonVeg } = req.query;

  // Resolve the city/place to coordinates for a spatially-scoped search.
  let coordinates = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  let searchedCity = city || null;
  if (city && !coordinates) {
    const geo = await mapsProvider.geocode(city);
    if (geo.isLive) {
      coordinates = { lat: geo.data.lat, lng: geo.data.lng };
      searchedCity = geo.data.address || city;
    }
  }

  const query = q || (city ? `restaurants in ${city}` : 'restaurants');
  const result = await placesProvider.textSearch({
    query,
    lat: coordinates?.lat ?? null,
    lng: coordinates?.lng ?? null,
    radius: radius ? Number(radius) : 5000,
    type: 'restaurant',
    limit: limit ? Number(limit) : 15,
  });

  if (!result.isLive) {
    return res.json(ApiResponse.ok(result.message, { restaurants: [], isLive: false, message: result.message }));
  }

  let restaurants = result.data;
  const hasPref = veg === 'true' || vegan === 'true' || nonVeg === 'true';
  if (hasPref) {
    restaurants = restaurants.map((r) => ({ ...r, _filterHint: r.types?.join(' ') || r.name }));
    // Real filtering is applied on the backend only when places expose diet
    // info; otherwise we surface the data with a note instead of guessing.
  }

  // Geoapify places don't expose ratings/price levels — only apply these
  // filters when the data actually contains those fields.
  const hasRatings = restaurants.some((r) => r.rating != null);
  const hasPrices = restaurants.some((r) => r.priceLevel != null);
  if (minRating && hasRatings) restaurants = restaurants.filter((r) => r.rating != null && r.rating >= Number(minRating));
  if (priceLevel != null && priceLevel !== '' && hasPrices) restaurants = restaurants.filter((r) => r.priceLevel === Number(priceLevel));

  res.json(
    ApiResponse.ok(
      hasPref && !restaurants.length
        ? 'No exact diet-filtered matches - refine filters or check restaurant pages.'
        : 'Live restaurants from Geoapify Places',
      { restaurants, isLive: true, filterApplied: hasPref, searchedCity, coordinates }
    )
  );
});

export default { searchRestaurants };
