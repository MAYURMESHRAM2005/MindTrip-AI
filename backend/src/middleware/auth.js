import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/token.js';
import { ROLES } from '../utils/constants.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import logger from '../utils/logger.js';

/**
 * Require a valid Bearer access token. Attaches req.user.
 */
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.access_token || null;
  if (!token) {
    logger.warn(`[AUTH:MIDDLEWARE] No token provided for ${req.method} ${req.originalUrl}`);
    throw ApiError.unauthorized('Authentication required');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    logger.warn(`[AUTH:MIDDLEWARE] Invalid/expired token: ${err.message}`);
    throw ApiError.unauthorized('Invalid or expired access token');
  }

  const user = await User.findById(payload.sub).select('-password -verifyToken -verifyTokenExpires -resetToken -resetTokenExpires');
  if (!user) {
    logger.warn(`[AUTH:MIDDLEWARE] User not found: ${payload.sub}`);
    throw ApiError.unauthorized('User no longer exists');
  }

  req.user = user;
  req.tokenPayload = payload;
  logger.debug(`[AUTH:MIDDLEWARE] Authenticated user: ${user._id} for ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * Optional auth - attaches req.user when a valid token exists, else continues.
 */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('-password');
      if (user) req.user = user;
    } catch {
      /* ignore - treat as anonymous */
      logger.debug(`[AUTH:MIDDLEWARE] Optional auth: invalid token, treating as anonymous`);
    }
  }
  next();
});

/**
 * Role-based access control. Use after protect.
 */
export const requireRole = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      logger.warn('[AUTH:MIDDLEWARE] requireRole: no user attached');
      throw ApiError.unauthorized();
    }
    if (!roles.includes(req.user.role)) {
      logger.warn(`[AUTH:MIDDLEWARE] Role forbidden: user=${req.user._id} role=${req.user.role}, required=${roles.join(',')}`);
      throw ApiError.forbidden('You do not have permission to access this resource');
    }
    next();
  });

export const isAdmin = requireRole(ROLES.ADMIN);

export default { protect, optionalAuth, requireRole, isAdmin };
