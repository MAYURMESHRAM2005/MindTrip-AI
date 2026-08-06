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
 * fetch with timeout so a dead provider never hangs the pipeline.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText} ${text.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export default { unavailable, live, fetchWithTimeout };
