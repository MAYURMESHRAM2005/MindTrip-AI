import env from '../config/env.js';
import { isGoogleMapsConfigured } from '../config/googleMaps.js';
import flightProvider from './flight.provider.js';
import trainProvider from './train.provider.js';
import busProvider from './bus.provider.js';
import hotelProvider from './hotel.provider.js';
import googlePlacesProvider from './googlePlaces.provider.js';
import googleGeocodingProvider from './googleGeocoding.provider.js';
import googleRoutesProvider from './googleRoutes.provider.js';
import weatherProvider from './weather.provider.js';
import currencyProvider from './currency.provider.js';

/**
 * Registry of all external providers. Admin dashboard reads this to show
 * which providers are configured and their live status.
 */
export const providers = {
  flightProvider,
  trainProvider,
  busProvider,
  hotelProvider,
  placesProvider: googlePlacesProvider,
  geocodingProvider: googleGeocodingProvider,
  routesProvider: googleRoutesProvider,
  weatherProvider,
  currencyProvider,
};

export function providerStatuses() {
  const mapsConfigured = isGoogleMapsConfigured();
  return [
    { name: 'Gemini AI', configured: Boolean(env.GEMINI_API_KEY), kind: 'ai' },
    { name: 'Groq AI (Fallback)', configured: Boolean(env.GROQ_API_KEY), kind: 'ai' },
    // The Maps JavaScript API runs in the BROWSER with a separate referrer-
    // restricted key (VITE_GOOGLE_MAPS_BROWSER_KEY) that the backend cannot see.
    // It must never be reported as configured just because the server key exists
    // — the Admin page checks the frontend env var and overrides this entry.
    { name: 'Google Maps JavaScript API', configured: false, kind: 'maps', api: 'Maps JavaScript API (browser)', frontendCheck: true, message: 'Uses frontend VITE_GOOGLE_MAPS_BROWSER_KEY — verified in the browser' },
    { name: 'Google Geocoding API', configured: mapsConfigured, kind: 'maps', api: 'Google Maps Platform' },
    { name: 'Google Places API', configured: mapsConfigured, kind: 'maps', api: 'Google Maps Platform' },
    { name: 'Google Routes API', configured: mapsConfigured, kind: 'maps', api: 'Google Maps Platform' },
    { name: 'OpenWeatherMap', configured: Boolean(env.OPENWEATHER_API_KEY), kind: 'weather' },
    { name: 'AviationStack (Flights)', configured: Boolean(env.AVIATIONSTACK_API_KEY), kind: 'flights' },
    { name: 'Amadeus (Hotels)', configured: Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET), kind: 'hotels' },
    { name: 'Trains', ...trainProvider.providerStatus(), kind: 'trains' },
    { name: 'Buses', ...busProvider.providerStatus(), kind: 'buses' },
    { name: 'Exchange Rates', configured: true, kind: 'currency' },
    { name: 'Email (SMTP)', configured: Boolean(env.SMTP_HOST && env.SMTP_USER), kind: 'email' },
  ];
}

export default { providers, providerStatuses };
