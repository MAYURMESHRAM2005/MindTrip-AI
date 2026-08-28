import crypto from 'crypto';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import UserPreference from '../models/UserPreference.js';
import ApiError from '../utils/ApiError.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateVerificationToken,
} from '../utils/token.js';
import env from '../config/env.js';
import emailService from './email.service.js';
import { verifyFirebaseIdToken } from './firebase.service.js';
import logger from '../utils/logger.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage,
    emailVerified: user.emailVerified,
    homeLocation: user.homeLocation,
    preferredCurrency: user.preferredCurrency,
    language: user.language,
    travelStyle: user.travelStyle,
    foodPreference: user.foodPreference,
    hotelPreference: user.hotelPreference,
    transportPreference: user.transportPreference,
    interests: user.interests,
    accessibility: user.accessibility,
    savedDestinations: user.savedDestinations,
  };
}

async function issueTokens(user, req) {
  const accessToken = signAccessToken({ sub: user._id.toString(), role: user.role });
  const refreshToken = signRefreshToken({ sub: user._id.toString(), type: 'refresh' });
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: req.headers['user-agent']?.slice(0, 200) || '',
    ip: req.ip || '',
  });
  return { accessToken, refreshToken };
}

export async function register({ name, email, password }, req) {
  logger.entry('[AUTH]', 'register', { email, name });
  const existing = await User.findOne({ email });
  if (existing) {
    logger.warn(`[AUTH] Register failed — email already exists: ${email}`);
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = await User.create({
    name,
    email,
    password: await hashPassword(password),
  });
  await UserPreference.create({ user: user._id, currency: 'INR', language: 'en' });

  const verifyToken = generateVerificationToken();
  user.verifyToken = hashToken(verifyToken);
  user.verifyTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const emailResult = await emailService.sendVerificationEmail({
    to: user.email,
    name: user.name,
    token: verifyToken,
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);
  logger.info(`[AUTH] Register success: ${email} (id: ${user._id})`);
  return { user: publicUser(user), accessToken, refreshToken, emailSent: emailResult.success, emailSimulated: emailResult.simulated };
}

export async function login({ email, password }, req) {
  logger.entry('[AUTH]', 'login', { email });
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    logger.warn(`[AUTH] Login failed — user not found: ${email}`);
    throw ApiError.unauthorized('Invalid email or password');
  }
  const valid = await comparePassword(password, user.password);
  if (!valid) {
    logger.warn(`[AUTH] Login failed — invalid password: ${email}`);
    throw ApiError.unauthorized('Invalid email or password');
  }

  const { accessToken, refreshToken } = await issueTokens(user, req);
  logger.info(`[AUTH] Login success: ${email} (id: ${user._id})`);
  return { user: publicUser(user), accessToken, refreshToken };
}

export async function refreshTokens(refreshToken, req) {
  logger.entry('[AUTH]', 'refreshTokens', { hasToken: Boolean(refreshToken) });
  if (!refreshToken) throw ApiError.unauthorized('Refresh token missing');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });
  if (!stored || stored.revoked) throw ApiError.unauthorized('Refresh token revoked');
  if (stored.expiresAt < new Date()) {
    await stored.deleteOne();
    throw ApiError.unauthorized('Refresh token expired');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('User not found');

  // Rotation: revoke old, issue new
  stored.revoked = true;
  stored.replacedBy = 'rotated';
  await stored.save();

  const { accessToken, refreshToken: newRefresh } = await issueTokens(user, req);
  logger.info(`[AUTH] Token refreshed for user: ${user._id}`);
  return { user: publicUser(user), accessToken, refreshToken: newRefresh };
}

export async function logout(refreshToken) {
  logger.entry('[AUTH]', 'logout', { hasToken: Boolean(refreshToken) });
  if (refreshToken) {
    await RefreshToken.findOneAndUpdate(
      { tokenHash: hashToken(refreshToken) },
      { revoked: true }
    );
    logger.info('[AUTH] Logout success — refresh token revoked');
  }
}

export async function verifyEmail(token) {
  logger.entry('[AUTH]', 'verifyEmail', { tokenLength: token?.length || 0 });
  const hashed = hashToken(token);
  const user = await User.findOne({ verifyToken: hashed, verifyTokenExpires: { $gt: new Date() } }).select('+verifyToken +verifyTokenExpires');
  if (!user) {
    logger.warn('[AUTH] Email verification failed — invalid or expired token');
    throw ApiError.badRequest('Verification link is invalid or has expired');
  }
  user.emailVerified = true;
  user.verifyToken = null;
  user.verifyTokenExpires = null;
  await user.save({ validateBeforeSave: false });
  logger.info(`[AUTH] Email verified for user: ${user._id}`);
  return publicUser(user);
}

export async function forgotPassword(email) {
  logger.entry('[AUTH]', 'forgotPassword', { email });
  const user = await User.findOne({ email });
  // Always respond the same way to avoid user enumeration.
  if (!user) return { sent: false, simulated: true, message: 'If that email exists, a reset link has been sent.' };
  const token = generateVerificationToken();
  user.resetToken = hashToken(token);
  user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });
  const result = await emailService.sendPasswordResetEmail({ to: user.email, name: user.name, token });
  logger.info(`[AUTH] Password reset email sent: ${email} (success: ${result.success}, simulated: ${result.simulated})`);
  return { sent: result.success, simulated: result.simulated, message: 'If that email exists, a reset link has been sent.' };
}

export async function resetPassword(token, newPassword) {
  logger.entry('[AUTH]', 'resetPassword', { tokenLength: token?.length || 0 });
  const hashed = hashToken(token);
  const user = await User.findOne({ resetToken: hashed, resetTokenExpires: { $gt: new Date() } }).select('+resetToken +resetTokenExpires');
  if (!user) {
    logger.warn('[AUTH] Password reset failed — invalid or expired token');
    throw ApiError.badRequest('Reset link is invalid or has expired');
  }
  user.password = await hashPassword(newPassword);
  user.resetToken = null;
  user.resetTokenExpires = null;
  await user.save({ validateBeforeSave: false });
  await RefreshToken.deleteMany({ user: user._id }); // invalidate all sessions
  logger.info(`[AUTH] Password reset success for user: ${user._id}`);
  return publicUser(user);
}

/**
 * Firebase Auth: verify the ID token minted by the Firebase client SDK after
 * Google sign-in, then find-or-create the local user and issue our own
 * session tokens (JWT access/refresh httpOnly cookies remain unchanged).
 */
export async function firebaseLogin(idToken, req) {
  logger.entry('[AUTH]', 'firebaseLogin', { email: '***' });
  const info = await verifyFirebaseIdToken(idToken);
  if (!info.email) throw ApiError.unauthorized('Google account has no email');

  let user = await User.findOne({ email: info.email });
  if (!user) {
    user = await User.create({
      name: info.name || info.email.split('@')[0] || 'Traveler',
      email: info.email,
      firebaseUid: info.uid,
      emailVerified: Boolean(info.email_verified),
      profileImage: info.picture || '',
    });
    await UserPreference.create({ user: user._id, currency: 'INR', language: 'en' });
  } else if (user.firebaseUid && user.firebaseUid !== info.uid) {
    // Same email but a different Firebase account: never silently switch sessions.
    throw ApiError.unauthorized('This email is linked to a different account');
  } else if (!user.firebaseUid) {
    user.firebaseUid = info.uid;
    user.emailVerified = Boolean(info.email_verified);
    if (info.picture && !user.profileImage) user.profileImage = info.picture;
    await user.save({ validateBeforeSave: false });
  }
  const { accessToken, refreshToken } = await issueTokens(user, req);
  logger.info(`[AUTH] Firebase login success: ${info.email} (user: ${user._id})`);
  return { user: publicUser(user), accessToken, refreshToken };
}

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}

export default {
  register,
  login,
  refreshTokens,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword,
  firebaseLogin,
  setAuthCookies,
  clearAuthCookies,
  publicUser,
};
