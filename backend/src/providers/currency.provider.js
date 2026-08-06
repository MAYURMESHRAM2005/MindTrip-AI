import { live, unavailable, fetchWithTimeout } from './base.provider.js';

let cachedRates = null;
let cachedAt = 0;
const TTL = 6 * 60 * 60 * 1000; // refresh every 6 hours

/**
 * Free currency rates from open.er-api.com (no key required, updated daily).
 * Rates are used to convert budgets across currencies.
 */
export async function getRates(base = 'USD') {
  if (cachedRates && Date.now() - cachedAt < TTL) {
    return live('exchangerate', cachedRates, 'Cached exchange rates');
  }
  try {
    const res = await fetchWithTimeout(`https://open.er-api.com/v6/latest/${base}`, {}, 8000);
    const data = await res.json();
    if (data.result !== 'success' || !data.rates) {
      return unavailable('exchangerate', 'Exchange rate API returned an error');
    }
    cachedRates = { base: data.base_code, rates: data.rates, updated: data.time_last_update_utc };
    cachedAt = Date.now();
    return live('exchangerate', cachedRates, 'Live exchange rates');
  } catch (err) {
    return unavailable('exchangerate', `Live data unavailable: ${err.message}`);
  }
}

export async function convert(amount, from, to) {
  if (from === to) return { amount, rate: 1 };
  const rates = await getRates();
  if (!rates.success) return { amount: null, rate: null, message: rates.message };
  const rate = rates.data.rates[to] / (rates.data.rates[from] || 1);
  return { amount: Math.round(amount * rate * 100) / 100, rate, base: rates.data.base };
}

export default { getRates, convert };
