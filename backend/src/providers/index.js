import env from '../config/env.js';
import flightProvider from './flight.provider.js';
import trainProvider from './train.provider.js';
import busProvider from './bus.provider.js';
import hotelProvider from './hotel.provider.js';
import placesProvider from './places.provider.js';
import weatherProvider from './weather.provider.js';
import mapsProvider from './maps.provider.js';
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
  placesProvider,
  weatherProvider,
  mapsProvider,
  currencyProvider,
};

export function providerStatuses() {
  return [
    { name: 'Gemini AI', configured: Boolean(env.GEMINI_API_KEY), kind: 'ai' },
    { name: 'Groq AI (Fallback)', configured: Boolean(env.GROQ_API_KEY), kind: 'ai' },
    { name: 'Geoapify (Maps & Places)', configured: Boolean(env.GEOAPIFY_API_KEY), kind: 'maps' },
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
