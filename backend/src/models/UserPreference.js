import mongoose from 'mongoose';
import { TRAVEL_STYLES, LANGUAGES } from '../utils/constants.js';

const userPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    currency: { type: String, default: 'INR', uppercase: true },
    language: { type: String, enum: LANGUAGES, default: 'en' },
    travelStyle: { type: String, enum: TRAVEL_STYLES, default: 'standard' },
    foodPreference: { type: String, default: '' },
    hotelPreference: { type: String, default: '' },
    transportPreference: { type: String, default: '' },
    activityLevel: { type: String, enum: ['relaxed', 'moderate', 'active'], default: 'moderate' },
    interests: { type: [String], default: [] },
    accessibility: { type: [String], default: [] },
    homeLocation: { type: String, default: '' },
    budgetTier: { type: String, enum: ['budget', 'mid', 'luxury'], default: 'mid' },
    familyWithKids: { type: Boolean, default: false },
    petFriendly: { type: Boolean, default: false },
    notificationsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);
export default UserPreference;
