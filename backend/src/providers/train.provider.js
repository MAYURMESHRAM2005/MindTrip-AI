import env from '../config/env.js';
import { live, unavailable, axiosPost } from './base.provider.js';

/**
 * Train provider - designed to connect to a configured legitimate train API
 * (e.g. IRCTC partner API, RailYatri B2B, or any compliant provider).
 *
 * When TRAIN_API_URL is not configured we return "Live data unavailable" and
 * never fabricate schedules or prices.
 */
export async function searchTrains({ from, to, date, passengers = 1, trainClass }) {
  if (!env.TRAIN_API_URL) {
    return unavailable(
      'train',
      'Train API provider is not configured. Set TRAIN_API_URL and TRAIN_API_KEY in backend/.env to enable live train schedules.'
    );
  }
  try {
    const url = `${env.TRAIN_API_URL.replace(/\/$/, '')}/search`;
    const body = { from, to, date, passengers, trainClass: trainClass || '' };
    const data = await axiosPost(
      url,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(env.TRAIN_API_KEY ? { Authorization: `Bearer ${env.TRAIN_API_KEY}` } : {}),
        },
      },
      10000
    );
    if (!data || !Array.isArray(data.trains)) {
      return unavailable('train', 'Train provider returned an unexpected response shape.');
    }
    return live('train', data.trains, 'Live train schedules from configured provider');
  } catch (err) {
    return unavailable('train', `Live data unavailable: ${err.message}`);
  }
}

export function providerStatus() {
  return {
    configured: Boolean(env.TRAIN_API_URL),
    endpoint: env.TRAIN_API_URL || '',
    message: env.TRAIN_API_URL ? 'Configured - live schedules available' : 'Not configured - live train data unavailable',
  };
}

export default { searchTrains, providerStatus };
