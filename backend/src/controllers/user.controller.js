import ApiError from '../utils/ApiError.js';
import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sanitizeObject } from '../utils/sanitize.js';
import User from '../models/User.js';
import UserPreference from '../models/UserPreference.js';
import authService from '../services/auth.service.js';

export const getMe = asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('Profile', { user: authService.publicUser(req.user) }));
});

export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'homeLocation', 'preferredCurrency', 'language', 'travelStyle',
    'foodPreference', 'hotelPreference', 'transportPreference', 'interests',
    'accessibility', 'profileImage',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) req.user[key] = req.body[key];
  }
  await req.user.save();

  // Keep UserPreference in sync
  const prefs = await UserPreference.findOneAndUpdate(
    { user: req.user._id },
    {
      $set: {
        currency: req.body.preferredCurrency ?? undefined,
        language: req.body.language ?? undefined,
        travelStyle: req.body.travelStyle ?? undefined,
        foodPreference: req.body.foodPreference ?? undefined,
        hotelPreference: req.body.hotelPreference ?? undefined,
        transportPreference: req.body.transportPreference ?? undefined,
        interests: req.body.interests ?? undefined,
        accessibility: req.body.accessibility ?? undefined,
        homeLocation: req.body.homeLocation ?? undefined,
      },
    },
    { upsert: true }
  ).then((doc) => doc || UserPreference.create({ user: req.user._id }));

  res.json(ApiResponse.ok('Profile updated', { user: authService.publicUser(req.user) }));
});

export const getPreferences = asyncHandler(async (req, res) => {
  let prefs = await UserPreference.findOne({ user: req.user._id });
  if (!prefs) {
    prefs = await UserPreference.create({ user: req.user._id });
  }
  res.json(ApiResponse.ok('Travel preferences', { preferences: prefs }));
});

const PREFERENCE_KEYS = Object.freeze([
  'currency', 'language', 'travelStyle', 'foodPreference', 'hotelPreference',
  'transportPreference', 'activityLevel', 'interests', 'accessibility',
  'homeLocation', 'budgetTier', 'familyWithKids', 'petFriendly', 'notificationsEnabled',
]);

export const updatePreferences = asyncHandler(async (req, res) => {
  // Whitelist + sanitize: never let arbitrary user keys reach $set
  const clean = {};
  for (const key of PREFERENCE_KEYS) {
    if (req.body[key] !== undefined) clean[key] = sanitizeObject(req.body[key]);
  }
  const prefs = await UserPreference.findOneAndUpdate(
    { user: req.user._id },
    { $set: clean },
    { upsert: true, new: true }
  );
  res.json(ApiResponse.ok('Travel preferences updated', { preferences: prefs }));
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const id = req.user._id;
  await User.findByIdAndDelete(id);
  await UserPreference.deleteMany({ user: id });
  authService.clearAuthCookies(res);
  res.json(ApiResponse.ok('Account deleted'));
});

export const saveDestination = asyncHandler(async (req, res) => {
  const { destination } = req.body;
  if (!destination) throw ApiError.badRequest('destination required');
  if (!req.user.savedDestinations.includes(destination)) {
    req.user.savedDestinations.push(destination);
    await req.user.save();
  }
  res.json(ApiResponse.ok('Destination saved', { savedDestinations: req.user.savedDestinations }));
});

export default {
  getMe,
  updateProfile,
  getPreferences,
  updatePreferences,
  deleteAccount,
  saveDestination,
};
