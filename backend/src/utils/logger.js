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
};

export const httpLogger = morgan(isProduction ? 'combined' : 'dev', {
  skip: () => env.NODE_ENV === 'test',
});

export default logger;
