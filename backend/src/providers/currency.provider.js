import { live, unavailable, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

let cachedRates = null;
let cachedAt = 0;
const TTL = 6 * 60 * 60 * 1000; // refresh every 6 hours

/**
 * Free currency rates from open.er-api.com (no key required, updated daily).
 * Rates are used to convert budgets across currencies.
 */
export async function getRates(base = 'USD') {
  if (cachedRates && Date.now() - cachedAt < TTL) {
    logger.info('[PROVIDER:currency] Returning cached exchange rates');
    return live('exchangerate', cachedRates, 'Cached exchange rates');
  }
  logger.entry('[PROVIDER:currency]', 'getRates', { base });
  const started = Date.now();
  try {
    const data = await axiosGet(`https://open.er-api.com/v6/latest/${base}`, {}, 8000);
    if (data.result !== 'success' || !data.rates) {
      return unavailable('exchangerate', 'Exchange rate API returned an error');
    }
    cachedRates = { base: data.base_code, rates: data.rates, updated: data.time_last_update_utc };
    cachedAt = Date.now();
    logger.provider('exchangerate', 'getRates', { isLive: true, latencyMs: Date.now() - started, base, rateCount: Object.keys(data.rates || {}).length });
    return live('exchangerate', cachedRates, 'Live exchange rates');
  } catch (err) {
    logger.error(`[PROVIDER:currency] getRates error: ${err.message}`);
    return unavailable('exchangerate', `Live data unavailable: ${err.message}`);
  }
}

export async function convert(amount, from, to) {
  logger.entry('[PROVIDER:currency]', 'convert', { amount, from, to });
  if (from === to) return { amount, rate: 1 };
  const rates = await getRates();
  if (!rates.success) return { amount: null, rate: null, message: rates.message };
  const rate = rates.data.rates[to] / (rates.data.rates[from] || 1);
  const converted = Math.round(amount * rate * 100) / 100;
  logger.info(`[PROVIDER:currency] convert ${amount} ${from} → ${converted} ${to} (rate: ${rate})`);
  return { amount: converted, rate, base: rates.data.base };
}

export default { getRates, convert };
