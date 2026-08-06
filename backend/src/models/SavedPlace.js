import mongoose from 'mongoose';
import { PLACE_TYPES } from '../utils/constants.js';

const savedPlaceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
    placeId: { type: String, default: '' }, // Google Place ID when available
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: PLACE_TYPES, default: 'tourist_attraction' },
    address: { type: String, default: '' },
    coordinates: { lat: { type: Number }, lng: { type: Number } },
    rating: { type: Number, default: null },
    priceLevel: { type: Number, default: null },
    photoRef: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

savedPlaceSchema.index({ user: 1, placeId: 1 });

const SavedPlace = mongoose.model('SavedPlace', savedPlaceSchema);
export default SavedPlace;
