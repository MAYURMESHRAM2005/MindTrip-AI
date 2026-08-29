import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    time: { type: String, default: '' }, // "09:00"
    slot: { type: String, default: '' }, // transport | hotel | breakfast | morning | lunch | afternoon | evening | dinner | night | free | other
    period: { type: String, default: 'day' }, // morning | lunch | afternoon | evening | night
    title: { type: String, required: true, trim: true },
    place: { type: String, default: '' },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: [
        'transport', 'flight', 'train', 'bus', 'hotel', 'restaurant', 'attraction',
        'activity', 'nightlife', 'weather', 'safety', 'free', 'other',
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
      perPerson: { type: Number },
      estimateNote: { type: String, default: '' },
    },
    source: { type: String, default: 'ai-generated' }, // provider | ai-generated | user | estimate | none
    fetchedAt: { type: String, default: '' },
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
    // Geographic area for the day (real locality from provider data).
    area: { type: String, default: '' },
    areaNote: { type: String, default: '' },
    // Overnight accommodation details tied to this day.
    overnight: {
      name: { type: String, default: '' },
      area: { type: String, default: '' },
      rooms: { type: Number, default: 1 },
      nights: { type: Number, default: 0 },
      pricePerRoomNight: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      address: { type: String, default: '' },
      rating: { type: Number },
      amenities: { type: [String], default: [] },
      isLive: { type: Boolean, default: false },
      source: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
    activities: { type: [activitySchema], default: [] },
    weather: {
      tempMin: { type: Number },
      tempMax: { type: Number },
      temp: { type: Number },
      condition: { type: String },
      description: { type: String },
      rainProbability: { type: Number },
      humidity: { type: Number },
      windSpeed: { type: Number },
      sunrise: { type: Number },
      sunset: { type: Number },
      indoorPlan: { type: Boolean, default: false },
      isLive: { type: Boolean, default: false },
    },
    // Per-category daily cost breakdown + running totals.
    costBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    cumulativeCost: { type: Number, default: 0 },
    remainingBudget: { type: Number, default: null },
    dayCost: { type: Number, default: 0 },
    dayCostIsEstimate: { type: Boolean, default: true },
    notes: { type: String, default: '' },
  },
  { _id: true, timestamps: true }
);

export { activitySchema };
export default itineraryDaySchema;
