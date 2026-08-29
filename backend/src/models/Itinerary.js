import mongoose from 'mongoose';
import itineraryDaySchema from './ItineraryDay.js';

const itinerarySchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    days: { type: [itineraryDaySchema], default: [] },
    summary: { type: String, default: '' },
    currency: { type: String, default: 'INR' },
    totalEstimatedCost: { type: Number, default: 0 },
    transport: {
      mode: { type: String, default: 'not-set' },
      details: { type: mongoose.Schema.Types.Mixed, default: null },
      isLive: { type: Boolean, default: false },
      alternatives: { type: [mongoose.Schema.Types.Mixed], default: [] },
      modesChecked: { type: [String], default: [] },
      message: { type: String, default: '' },
    },
    accommodation: {
      name: { type: String, default: '' },
      address: { type: String, default: '' },
      pricePerNight: { type: Number },
      isLive: { type: Boolean, default: false },
      source: { type: String, default: '' },
    },
    safetyNotes: { type: String, default: '' },
    emergencyInfo: { type: mongoose.Schema.Types.Mixed, default: null },
    agentReport: { type: mongoose.Schema.Types.Mixed, default: null },
    validation: {
      passed: { type: Boolean, default: false },
      issues: { type: [String], default: [] },
      warnings: { type: [String], default: [] },
      validatedAt: { type: Date },
    },
    optimizedBudget: { type: mongoose.Schema.Types.Mixed, default: null },
    budgetAllocation: { type: mongoose.Schema.Types.Mixed, default: null },
    // Enriched sections rendered on the AI Itinerary page (summary, budget
    // planning, hotels/restaurants/attractions, transport, weather, tips,
    // recommendations, map data). Built deterministically at generation time.
    extras: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const Itinerary = mongoose.model('Itinerary', itinerarySchema);
export default Itinerary;
