import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    time: { type: String, default: '' }, // "09:00"
    title: { type: String, required: true, trim: true },
    place: { type: String, default: '' },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: [
        'transport', 'flight', 'train', 'bus', 'hotel', 'restaurant', 'attraction',
        'activity', 'weather', 'safety', 'free', 'other',
      ],
      default: 'other',
    },
    address: { type: String, default: '' },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    travel: {
      distanceKm: { type: Number, default: 0 },
      durationMin: { type: Number, default: 0 },
      method: { type: String, default: 'walking' },
      isEstimate: { type: Boolean, default: true },
    },
    cost: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      isEstimate: { type: Boolean, default: true },
    },
    source: { type: String, default: 'ai-generated' }, // provider | ai-generated | user
    bookingUrl: { type: String, default: '' },
    isLive: { type: Boolean, default: false },
    dataStatus: {
      type: String,
      enum: ['live', 'estimate', 'unavailable'],
      default: 'estimate',
    },
    priority: { type: Number, default: 1 }, // 1 = must-do, higher = droppable when over budget
    notes: { type: String, default: '' },
  },
  { _id: true, timestamps: true }
);

const itineraryDaySchema = new mongoose.Schema(
  {
    dayNumber: { type: Number, required: true },
    date: { type: Date, required: true },
    activities: { type: [activitySchema], default: [] },
    weather: {
      temp: { type: Number },
      condition: { type: String },
      rainProbability: { type: Number },
      isLive: { type: Boolean, default: false },
    },
    dayCost: { type: Number, default: 0 },
    dayCostIsEstimate: { type: Boolean, default: true },
    notes: { type: String, default: '' },
  },
  { _id: true, timestamps: true }
);

export { activitySchema };
export default itineraryDaySchema;
