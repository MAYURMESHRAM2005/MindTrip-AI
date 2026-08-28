import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import env, { isProduction } from '../config/env.js';

/**
 * Convert unknown errors into consistent ApiError responses.
 * Never leak internal stack traces in production.
 */
export function notFoundHandler(req, _res, next) {
  logger.warn(`[HTTP] 404 Not Found: ${req.method} ${req.originalUrl}`);
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (!(error instanceof ApiError)) {
    // Mongoose / Mongo errors
    if (error.name === 'ValidationError') {
      error = ApiError.badRequest('Validation failed', {
        fields: Object.fromEntries(
          Object.entries(error.errors).map(([k, v]) => [k, v.message])
        ),
      });
    } else if (error.name === 'CastError') {
      error = ApiError.badRequest(`Invalid ${error.path}: ${error.value}`);
    } else if (error.code === 11000) {
      error = ApiError.conflict('Duplicate value. Resource already exists.');
    } else if (error.type === 'entity.too.large') {
      error = ApiError.badRequest('Request body too large');
    } else {
      error = ApiError.internal(error.message || 'Internal server error');
    }
  }

  if (error.statusCode >= 500) logger.error('[HTTP] 500 Internal Server Error:', error.message, error.stack?.slice(0, 200));
  else if (error.statusCode >= 400) logger.warn(`[HTTP] ${error.statusCode} Client Error: ${error.message}`);

  const statusCode = error.statusCode || 500;
  const body = {
    success: false,
    statusCode,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(!isProduction && error.stack ? { stack: error.stack } : {}),
  };
  res.status(statusCode).json(body);
}

export default errorHandler;
