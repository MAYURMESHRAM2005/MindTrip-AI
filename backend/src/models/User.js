import mongoose from 'mongoose';
import { ROLES, TRAVEL_STYLES } from '../utils/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER, index: true },
    profileImage: { type: String, default: '' },
    firebaseUid: { type: String, unique: true, sparse: true },
    emailVerified: { type: Boolean, default: false },
    verifyToken: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    resetToken: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },

    // Travel profile
    homeLocation: { type: String, default: '' },
    preferredCurrency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
    language: { type: String, default: 'en', maxlength: 5 },
    travelStyle: { type: String, enum: TRAVEL_STYLES, default: 'standard' },
    foodPreference: { type: String, default: '' }, // vegetarian | vegan | non-vegetarian
    hotelPreference: { type: String, default: '' }, // budget | boutique | luxury | hostel | resort
    transportPreference: { type: String, default: '' }, // flight | train | bus | public | drive
    interests: { type: [String], default: [] },
    accessibility: { type: [String], default: [] },
    savedDestinations: { type: [String], default: [] },
    previousTrips: { type: [mongoose.Schema.Types.ObjectId], ref: 'Trip', default: [] },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
export default User;
