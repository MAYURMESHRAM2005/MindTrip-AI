import env from '../config/env.js';
import { live, unavailable, fetchWithTimeout } from './base.provider.js';

/**
 * Bus provider - designed to connect to a configured legitimate bus API.
 * When BUS_API_URL is not configured we return "Live data unavailable" and
 * never fabricate schedules or prices.
 */
export async function searchBuses({ from, to, date, passengers = 1 }) {
  if (!env.BUS_API_URL) {
    return unavailable(
      'bus',
      'Bus API provider is not configured. Set BUS_API_URL and BUS_API_KEY in backend/.env to enable live bus schedules.'
    );
  }
  try {
    const url = `${env.BUS_API_URL.replace(/\/$/, '')}/search`;
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.BUS_API_KEY ? { Authorization: `Bearer ${env.BUS_API_KEY}` } : {}),
        },
        body: JSON.stringify({ from, to, date, passengers }),
      },
      10000
    );
    const data = await res.json();
    if (!data || !Array.isArray(data.buses)) {
      return unavailable('bus', 'Bus provider returned an unexpected response shape.');
    }
    return live('bus', data.buses, 'Live bus schedules from configured provider');
  } catch (err) {
    return unavailable('bus', `Live data unavailable: ${err.message}`);
  }
}

export function providerStatus() {
  return {
    configured: Boolean(env.BUS_API_URL),
    endpoint: env.BUS_API_URL || '',
    message: env.BUS_API_URL ? 'Configured - live schedules available' : 'Not configured - live bus data unavailable',
  };
}

export default { searchBuses, providerStatus };
