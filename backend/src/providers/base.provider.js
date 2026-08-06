import axios from 'axios';

/**
 * Every provider returns a normalized result:
 * { success, isLive, data, message, source, providerConfigured }
 *
 * - success=true  → real live data was retrieved
 * - success=false → provider unavailable; NEVER fabricate data
 */
export function unavailable(source, message = '') {
  return {
    success: false,
    isLive: false,
    data: null,
    message: message || `${source} provider is not configured`,
    source,
    providerConfigured: false,
  };
}

export function live(source, data, message = 'Live data') {
  return {
    success: true,
    isLive: true,
    data,
    message,
    source,
    providerConfigured: true,
  };
}

/**
 * Shared axios instance — all external provider calls go through the backend.
 * A dead provider never hangs the pipeline thanks to the request timeout.
 */
const http = axios.create({ timeout: 10000 });

/**
 * GET with axios. Accepts either (url, params, timeoutMs) for simple calls or
 * (url, params, config, timeoutMs) when headers/options are needed.
 */
export async function axiosGet(url, params = {}, config = {}, timeoutMs = 10000) {
  if (typeof config === 'number') {
    timeoutMs = config;
    config = {};
  }
  const { data } = await http.get(url, { params, ...config, timeout: timeoutMs });
  return data;
}

/**
 * POST with axios. Accepts either (url, body, timeoutMs) for simple calls or
 * (url, body, config, timeoutMs) when headers/options are needed.
 */
export async function axiosPost(url, body = null, config = {}, timeoutMs = 10000) {
  if (typeof config === 'number') {
    timeoutMs = config;
    config = {};
  }
  const { data } = await http.post(url, body, { ...config, timeout: timeoutMs });
  return data;
}
export default { unavailable, live, axiosGet, axiosPost };
