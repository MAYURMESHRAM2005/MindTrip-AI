import mongoose from 'mongoose';
import { TRIP_STATUS, TRAVEL_STYLES, CURRENCIES } from '../utils/constants.js';

const tripSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    status: { type: String, enum: TRIP_STATUS, default: 'planned', index: true },
    origin: { type: String, default: '' },
    destination: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    travelers: {
      adults: { type: Number, default: 1, min: 1, max: 20 },
      children: { type: Number, default: 0, min: 0, max: 20 },
    },
    budget: {
      total: { type: Number, required: true, min: 0 },
      currency: { type: String, enum: CURRENCIES, default: 'INR' },
    },
    preferences: {
      travelStyle: { type: String, enum: TRAVEL_STYLES, default: 'standard' },
      interests: { type: [String], default: [] },
      foodPreference: { type: String, default: '' },
      hotelPreference: { type: String, default: '' },
      transportPreference: { type: String, default: '' },
      activityLevel: { type: String, default: 'moderate' },
      accessibility: { type: [String], default: [] },
    },
    totalEstimatedCost: { type: Number, default: 0 },
    totalOptimizedCost: { type: Number, default: 0 },
    moneySaved: { type: Number, default: 0 },
    isOverBudget: { type: Boolean, default: false },
    coverImage: { type: String, default: '' },
    notes: { type: String, maxlength: 5000, default: '' },
  },
  { timestamps: true }
);

tripSchema.index({ user: 1, createdAt: -1 });
tripSchema.index({ destination: 1 });

const Trip = mongoose.model('Trip', tripSchema);
export default Trip;
