import Joi from 'joi';
import { TRAVEL_STYLES, CURRENCIES } from '../utils/constants.js';

const dateSchema = Joi.date().iso();

export const generateTripSchema = Joi.object({
  origin: Joi.string().trim().min(2).max(120).allow(''),
  destination: Joi.string().trim().min(2).max(120).allow(''),
  suggestDestination: Joi.boolean().default(false),
  startDate: dateSchema.required(),
  endDate: dateSchema.required(),
  adults: Joi.number().integer().min(1).max(20).default(1),
  children: Joi.number().integer().min(0).max(20).default(0),
  numTravelers: Joi.number().integer().min(1).max(50).default(1),
  travelerType: Joi.string().valid('solo', 'couple', 'family', 'friends', 'business').default('solo'),
  totalBudget: Joi.number().positive().max(1e9).required(),
  currency: Joi.string()
    .valid(...CURRENCIES)
    .default('INR'),
  accommodationType: Joi.string().valid('budget', 'standard', 'luxury', 'hostel', 'boutique', 'resort', 'homestay').default('budget'),
  travelStyle: Joi.string()
    .valid(...TRAVEL_STYLES)
    .default('standard'),
  interests: Joi.array().items(Joi.string().trim().max(60)).default([]),
  foodPreference: Joi.string().allow('').max(40).default(''),
  hotelPreference: Joi.string().allow('').max(40).default(''),
  transportPreference: Joi.string().allow('').max(40).default(''),
  activityLevel: Joi.string().valid('relaxed', 'moderate', 'active').default('moderate'),
  accessibility: Joi.array().items(Joi.string().trim().max(60)).default([]),
  title: Joi.string().trim().max(160).allow(''),
}).custom((obj, helpers) => {
  // Cross-field: endDate must not be before startDate
  if (obj.startDate && obj.endDate) {
    const start = new Date(obj.startDate);
    const end = new Date(obj.endDate);
    if (end < start) {
      return helpers.error('any.invalid', { message: 'End date must not be before start date' });
    }
  }
  // Cross-field: at least one traveler
  const totalTravelers = (obj.adults || 0) + (obj.children || 0);
  if (totalTravelers < 1) {
    return helpers.error('any.invalid', { message: 'At least one traveler (adult or child) is required' });
  }
  // Cross-field: destination required unless suggestDestination is true
  if (!obj.suggestDestination && (!obj.destination || !obj.destination.trim())) {
    return helpers.error('any.invalid', { message: 'Destination is required unless suggestDestination is true' });
  }
  return obj;
});

export const updateTripSchema = Joi.object({
  title: Joi.string().trim().max(160),
  status: Joi.string().valid('draft', 'planned', 'confirmed', 'completed', 'cancelled'),
  notes: Joi.string().max(5000),
  totalBudget: Joi.number().positive().max(1e9),
  currency: Joi.string().valid(...CURRENCIES),
});

export const tripIdParams = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid trip id'),
});

export const moveActivitySchema = Joi.object({
  fromDay: Joi.number().integer().min(1).required(),
  activityId: Joi.string().required(),
  toDay: Joi.number().integer().min(1).required(),
});

export const chatSchema = Joi.object({
  message: Joi.string().trim().min(1).max(2000).required(),
  conversationId: Joi.string().allow('', null),
});

export const voiceSchema = Joi.object({
  transcript: Joi.string().trim().min(1).max(2000).required(),
  conversationId: Joi.string().allow('', null),
  lang: Joi.string().max(10).default('en'),
});
