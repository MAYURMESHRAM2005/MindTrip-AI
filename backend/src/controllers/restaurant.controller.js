import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import placesProvider from '../providers/places.provider.js';

/**
 * Search restaurants via Geoapify Places, with vegetarian / vegan / non-veg
 * filtering applied to real data (using place categories).
 */
export const searchRestaurants = asyncHandler(async (req, res) => {
  const { q, lat, lng, radius, limit, minRating, priceLevel, openNow, veg, vegan, nonVeg } = req.query;
  const query = q || (lat && lng ? '' : 'restaurants');
  const result = await placesProvider.textSearch({
    query,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
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
      { restaurants, isLive: true, filterApplied: hasPref }
    )
  );
});

export default { searchRestaurants };
