import env from '../config/env.js';
import { live, unavailable, axiosPost, axiosGet } from './base.provider.js';

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

/**
 * Search flight offers via Amadeus Flight Offers Search API.
 */
export async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, travelClass = 'ECONOMY', nonStop = false, maxPrice }) {
  if (!env.AMADEUS_CLIENT_ID || !env.AMADEUS_CLIENT_SECRET) {
    return unavailable('amadeus-flights', 'Amadeus API credentials not configured');
  }
  try {
    const token = await getToken();
    const host = env.AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';
    let url = `${host}/v2/shopping/flight-offers?originLocationCode=${encodeURIComponent(
      origin
    )}&destinationLocationCode=${encodeURIComponent(destination)}&departureDate=${departDate}&adults=${adults}&travelClass=${travelClass}&currencyCode=INR&max=20`;
    if (returnDate) url += `&returnDate=${returnDate}`;
    if (nonStop) url += '&nonStop=true';
    const data = await axiosGet(url, {}, { headers: { Authorization: `Bearer ${token}` } }, 12000);
    if (data.errors) {
      return unavailable('amadeus-flights', data.errors.map((e) => e.detail).join('; '));
    }
    const offers = (data.data || []).map((offer) => {
      const first = offer.itineraries?.[0]?.segments?.[0];
      const last = offer.itineraries?.[0]?.segments?.slice(-1)?.[0];
      return {
        id: offer.id,
        provider: 'Amadeus',
        airline: first?.carrierCode || '',
        flightNumber: first?.number || '',
        origin: first?.departure?.iataCode || '',
        destination: last?.arrival?.iataCode || '',
        departAt: first?.departure?.at || '',
        arriveAt: last?.arrival?.at || '',
        stops: (offer.itineraries?.[0]?.segments?.length || 1) - 1,
        duration: offer.itineraries?.[0]?.duration || '',
        price: { amount: Number(offer.price?.total || 0), currency: offer.price?.currency || 'INR' },
        cabin: travelClass,
        isLive: true,
        bookingUrl: `https://www.amadeus.net/`,
      };
    });
    const filtered = maxPrice ? offers.filter((o) => o.price.amount <= maxPrice) : offers;
    return live('amadeus-flights', filtered, 'Live flight offers from Amadeus');
  } catch (err) {
    return unavailable('amadeus-flights', `Live data unavailable: ${err.message}`);
  }
}

export default { searchFlights };
