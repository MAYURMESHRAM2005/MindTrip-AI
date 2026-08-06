import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/token.js';
import { ROLES } from '../utils/constants.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Require a valid Bearer access token. Attaches req.user.
 */
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.access_token || null;
  if (!token) throw ApiError.unauthorized('Authentication required');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }

  const user = await User.findById(payload.sub).select('-password -verifyToken -verifyTokenExpires -resetToken -resetTokenExpires');
  if (!user) throw ApiError.unauthorized('User no longer exists');

  req.user = user;
  req.tokenPayload = payload;
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
    }
  }
  next();
});

/**
 * Role-based access control. Use after protect.
 */
export const requireRole = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to access this resource');
    }
    next();
  });

export const isAdmin = requireRole(ROLES.ADMIN);

export default { protect, optionalAuth, requireRole, isAdmin };
