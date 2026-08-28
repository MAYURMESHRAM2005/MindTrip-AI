import rateLimit from 'express-rate-limit';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

/**
 * General API limiter.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
  handler: (req, res) => {
    logger.warn(`[RATE_LIMIT] General API limit hit: ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.status(429).json({
      success: false,
      statusCode: 429,
      message: 'Too many requests, please try again later.',
    });
  },
});

/**
 * Stricter limiter for authentication endpoints (brute-force protection).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts, please try again later.',
  handler: (req, res) => {
    logger.warn(`[RATE_LIMIT] Auth limit hit: ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.status(429).json({
      success: false,
      statusCode: 429,
      message: 'Too many login attempts, please try again later.',
    });
  },
});

/**
 * Limiter for expensive AI endpoints.
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`[RATE_LIMIT] AI endpoint limit hit: ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.status(429).json({
      success: false,
      statusCode: 429,
      message: 'AI generation limit reached. Please wait a minute.',
    });
  },
});

export default { apiLimiter, authLimiter, aiLimiter };
