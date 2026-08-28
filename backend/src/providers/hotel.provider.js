import env from '../config/env.js';
import { live, unavailable, axiosPost, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const url =
    env.AMADEUS_ENV === 'production'
      ? 'https://api.amadeus.com/v1/security/oauth2/token'
      : 'https://test.api.amadeus.com/v1/security/oauth2/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.AMADEUS_CLIENT_ID,
    client_secret: env.AMADEUS_CLIENT_SECRET,
  });
  const data = await axiosPost(
    url,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    8000
  );
  if (!data.access_token) throw new Error(data.error_description || 'Amadeus auth failed');
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export async function searchHotels({ city, checkIn, checkOut, adults = 2, rooms = 1, maxPrice, minRating, limit = 15 }) {
  logger.entry('[PROVIDER:hotel]', 'searchHotels', { city, checkIn, checkOut, adults, rooms, maxPrice });
  const started = Date.now();
  if (!env.AMADEUS_CLIENT_ID || !env.AMADEUS_CLIENT_SECRET) {
    return unavailable('amadeus-hotels', 'Amadeus API credentials not configured');
  }
  try {
    const token = await getToken();
    const host = env.AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';

    // 1. Hotel list by city keyword
    const listUrl = `${host}/v1/reference-data/locations/hotels/by-city?cityCode=${encodeURIComponent(city)}`;
    const listData = await axiosGet(listUrl, {}, { headers: { Authorization: `Bearer ${token}` } }, 10000);
    const hotels = listData.data || [];

    const hotelIds = hotels
      .filter((h) => (!minRating || h.rating >= minRating))
      .slice(0, limit)
      .map((h) => h.hotelId);

    if (hotelIds.length === 0) {
      return live('amadeus-hotels', [], 'No hotels found for city code');
    }

    // 2. Hotel offers for those hotels
    const offersUrl = `${host}/v3/shopping/hotel-offers?hotelIds=${hotelIds.join(',')}&checkInDate=${checkIn}&checkOutDate=${checkOut}&adults=${adults}&roomQuantity=${rooms}&currency=INR`;
    const offersData = await axiosGet(offersUrl, {}, { headers: { Authorization: `Bearer ${token}` } }, 12000);
    const offers = (offersData.data || []).map((item) => {
      const offer = item.offers?.[0] || {};
      const price = offer.price?.total ? Number(offer.price.total) : null;
      return {
        id: item.hotel?.hotelId || item.hotelId,
        name: item.hotel?.name || '',
        provider: 'Amadeus',
        cityCode: item.hotel?.cityCode || '',
        latitude: item.hotel?.latitude,
        longitude: item.hotel?.longitude,
        address: item.hotel?.address?.lines?.join(', ') || '',
        rating: item.hotel?.rating ?? null,
        amenities: offer.boardType ? [offer.boardType] : [],
        price: { amount: price, currency: offer.price?.currency || 'INR' },
        checkIn, checkOut,
        bookingUrl: 'https://www.amadeus.net/',
        isLive: true,
      };
    });
    const filtered = maxPrice ? offers.filter((o) => o.price.amount && o.price.amount <= maxPrice) : offers;
    logger.provider('amadeus', 'searchHotels', { isLive: true, count: filtered.length, latencyMs: Date.now() - started });
    return live('amadeus-hotels', filtered, 'Live hotel offers from Amadeus');
  } catch (err) {
    logger.error(`[PROVIDER:hotel] Amadeus error: ${err.message}`);
    return unavailable('amadeus-hotels', `Live data unavailable: ${err.message}`);
  }
}

export default { searchHotels };
