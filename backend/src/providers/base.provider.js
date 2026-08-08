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

/**
 * Normalize a configured provider base URL: add https:// when the protocol is
 * missing (a common .env mistake that otherwise yields "Invalid URL").
 */
export function providerBaseUrl(host) {
  let url = String(host || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

/**
 * Build auth headers for a configured provider. RapidAPI hosts authenticate
 * via x-rapidapi-key/x-rapidapi-host; other providers use a Bearer token.
 */
export function providerHeaders(host, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey) return headers;
  const h = providerBaseUrl(host).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (/\.p\.rapidapi\.com$/i.test(h)) {
    headers['x-rapidapi-key'] = apiKey;
    headers['x-rapidapi-host'] = h;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export default { unavailable, live, axiosGet, axiosPost, providerBaseUrl, providerHeaders };
