import fs from 'fs';
import morgan from 'morgan';
import env, { isProduction } from '../config/env.js';

/**
 * Lightweight logger that writes to stdout in dev and to a daily file in
 * production. No external log service required.
 */
function write(level, args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`;
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](line);
  if (isProduction) {
    try {
      const dir = 'logs';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(`${dir}/${new Date().toISOString().slice(0, 10)}.log`, `${line}\n`);
    } catch {
      /* logging must never crash the app */
    }
  }
}

const logger = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),

  /**
   * Structured entry log — call at the start of any significant operation.
   * @param {string} context - module or operation name, e.g. '[AGENT:flight]'
   * @param {string} action  - what's happening, e.g. 'searchFlights'
   * @param {object} params  - input parameters (will be JSON-stringified)
   */
  entry(context, action, params = {}) {
    const paramsStr = Object.keys(params).length
      ? ` | params: ${JSON.stringify(params)}`
      : '';
    logger.info(`${context} ▶ ${action}${paramsStr}`);
  },

  /**
   * Structured exit log — call when an operation completes.
   * @param {string} context
   * @param {string} action
   * @param {object} result  - { status, latencyMs, ... }
   */
  exit(context, action, result = {}) {
    const { status, latencyMs, ...rest } = result;
    const extra = Object.keys(rest).length ? ` | ${JSON.stringify(rest)}` : '';
    const latency = latencyMs != null ? ` (${latencyMs}ms)` : '';
    logger.info(`${context} ◀ ${action}${status ? ` [${status}]` : ''}${latency}${extra}`);
  },

  /**
   * Structured provider log — call after every external API call.
   * @param {string} provider   - e.g. 'amadeus', 'geoapify', 'ignav'
   * @param {string} operation  - e.g. 'searchHotels', 'geocode'
   * @param {object} result     - { isLive, count, latencyMs, message }
   */
  provider(provider, operation, result = {}) {
    const { isLive, count, latencyMs, message, ...rest } = result;
    const extra = Object.keys(rest).length ? ` | ${JSON.stringify(rest)}` : '';
    const latency = latencyMs != null ? ` (${latencyMs}ms)` : '';
    logger.info(
      `[PROVIDER:${provider}] ${operation} → ${isLive ? '✅ LIVE' : '⚠️ DEGRADED'}${count != null ? ` (${count} results)` : ''}${latency}${message ? `: ${message}` : ''}${extra}`
    );
  },

  /**
   * Structured agent log — call after every agent run.
   * @param {string} agentName
n   * @param {string} action
   * @param {object} result     - { status, latencyMs, usedAI, source, ... }
   */
  agent(agentName, action, result = {}) {
    const { status, latencyMs, usedAI, source, ...rest } = result;
    const extra = Object.keys(rest).length ? ` | ${JSON.stringify(rest)}` : '';
    const latency = latencyMs != null ? ` (${latencyMs}ms)` : '';
    logger.info(
      `[AGENT:${agentName}] ${action} → ${status?.toUpperCase() || 'DONE'}${latency}${usedAI ? ' [AI]' : ' [LOCAL]'}${source ? ` (${source})` : ''}${extra}`
    );
  },

  /**
   * Request/response lifecycle log for controllers.
   * @param {string} method   - HTTP method
   * @param {string} path     - request path
   * @param {number} statusCode
   * @param {number} latencyMs
   * @param {object} meta     - extra context
   */
  request(method, path, statusCode, latencyMs, meta = {}) {
    const extra = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    const latency = latencyMs != null ? ` (${latencyMs}ms)` : '';
    const level = statusCode >= 400 ? 'warn' : 'info';
    logger[level](`[HTTP] ${method} ${path} → ${statusCode}${latency}${extra}`);
  },
};

export const httpLogger = morgan(isProduction ? 'combined' : 'dev', {
  skip: () => env.NODE_ENV === 'test',
});

export default logger;
