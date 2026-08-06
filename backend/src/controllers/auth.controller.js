import ApiError from '../utils/ApiError.js';
import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import authService from '../services/auth.service.js';
import env from '../config/env.js';

const ACCESS_COOKIE_MAX = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX = 7 * 24 * 60 * 60 * 1000;

function setCookies(res, accessToken, refreshToken) {
  authService.setAuthCookies(res, accessToken, refreshToken);
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);
  setCookies(res, result.accessToken, result.refreshToken);
  res.status(201).json(
    ApiResponse.created('Account created. Please verify your email.', {
      user: result.user,
      accessToken: result.accessToken,
      emailSent: result.emailSent,
      emailSimulated: result.emailSimulated,
    })
  );
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  setCookies(res, result.accessToken, result.refreshToken);
  res.json(ApiResponse.ok('Login successful', { user: result.user, accessToken: result.accessToken }));
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.refresh_token);
  authService.clearAuthCookies(res);
  res.json(ApiResponse.ok('Logged out'));
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refreshTokens(req.cookies?.refresh_token, req);
  setCookies(res, result.accessToken, result.refreshToken);
  // Return the fresh short-lived access token so the SPA can store it in memory
  res.json(ApiResponse.ok('Session refreshed', { user: result.user, accessToken: result.accessToken }));
});

export const me = asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('Current user', { user: authService.publicUser(req.user) }));
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.params.token);
  res.json(ApiResponse.ok('Email verified successfully', { user }));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  res.json(ApiResponse.ok(result.message, { simulated: result.simulated }));
});

export const resetPassword = asyncHandler(async (req, res) => {
  const user = await authService.resetPassword(req.params.token, req.body.password);
  authService.clearAuthCookies(res);
  res.json(ApiResponse.ok('Password reset successfully. Please log in.', { user }));
});

export const googleRedirect = asyncHandler(async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw ApiError.badRequest('Google OAuth is not configured on the server');
  }
  res.redirect(authService.googleAuthUrl('travelmind'));
});

export const googleCallback = asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) throw ApiError.badRequest('Missing authorization code');
  const { info } = await authService.googleCallback(code);
  const result = await authService.googleLogin(info, req);
  setCookies(res, result.accessToken, result.refreshToken);
  res.redirect(`${env.FRONTEND_URL}/dashboard?oauth=success`);
});

export const googleToken = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin(req.body.idToken, req);
  setCookies(res, result.accessToken, result.refreshToken);
  res.json(ApiResponse.ok('Google sign-in successful', { user: result.user }));
});

export default {
  register,
  login,
  logout,
  refresh,
  me,
  verifyEmail,
  forgotPassword,
  resetPassword,
  googleRedirect,
  googleCallback,
  googleToken,
};
