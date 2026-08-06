import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import env from '../config/env.js';

/**
 * Sign an access token (short lived, stateless).
 */
export function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

/**
 * Sign a refresh token (long lived). Stored hashed in DB for rotation.
 * A random jti guarantees uniqueness even when two tokens are minted for the
 * same user within the same second (prevents unique-index collisions on
 * tokenHash in RefreshToken).
 */
export function signRefreshToken(payload) {
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString('hex') },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

/**
 * Hash a token so a DB leak does not expose usable refresh tokens.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Cookie options: httpOnly always; secure in production; sameSite=lax for OAuth flow.
 */
export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}
