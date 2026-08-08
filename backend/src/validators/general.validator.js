import Joi from 'joi';
import { EXPENSE_CATEGORIES, CURRENCIES, TICKET_CATEGORIES, LANGUAGES } from '../utils/constants.js';

const date = Joi.date().iso();

export const searchQuery = Joi.object({
  q: Joi.string().trim().min(1).max(120).required(),
  lat: Joi.number().min(-90).max(90).allow('', null),
  lng: Joi.number().min(-180).max(180).allow('', null),
  radius: Joi.number().min(100).max(50000).default(5000),
  type: Joi.string().max(60).default('tourist_attraction'),
  limit: Joi.number().integer().min(1).max(20).default(10),
  priceLevel: Joi.number().integer().min(0).max(4).allow('', null),
  minRating: Joi.number().min(0).max(5).allow('', null),
  openNow: Joi.boolean().default(false),
  veg: Joi.boolean().default(false),
  vegan: Joi.boolean().default(false),
  nonVeg: Joi.boolean().default(false),
});

// Same fields as searchQuery, but the keyword is optional when a city/place is
// given (or when coordinates are provided for a nearby search), and the city
// is optional when a keyword is given.
export const restaurantSearchQuery = searchQuery
  .keys({
    q: Joi.string().trim().min(1).max(120).allow(''),
    city: Joi.string().trim().min(2).max(120).allow(''),
  })
  .or('q', 'city', 'lat');

export const autocompleteQuery = Joi.object({
  q: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().allow('').max(60),
  limit: Joi.number().integer().min(1).max(10).default(6),
});

export const geocodeQuery = Joi.object({
  address: Joi.string().trim().min(2).max(200).required(),
});

export const directionsQuery = Joi.object({
  origin: Joi.string().trim().min(2).max(200).required(),
  destination: Joi.string().trim().min(2).max(200).required(),
  mode: Joi.string().valid('driving', 'walking', 'transit', 'bicycling').default('driving'),
  alternatives: Joi.boolean().default(true),
});

export const weatherQuery = Joi.object({
  city: Joi.string().trim().min(2).max(120),
  lat: Joi.number().min(-90).max(90),
  lng: Joi.number().min(-180).max(180),
  units: Joi.string().valid('metric', 'imperial').default('metric'),
  days: Joi.number().integer().min(1).max(16).default(7),
}).or('city', 'lat', 'lng');

export const hotelSearchSchema = Joi.object({
  city: Joi.string().trim().min(2).max(120).required(),
  checkIn: date.required(),
  checkOut: date.required(),
  adults: Joi.number().integer().min(1).max(20).default(2),
  rooms: Joi.number().integer().min(1).max(10).default(1),
  maxPrice: Joi.number().min(0).allow('', null),
  minRating: Joi.number().min(0).max(5).allow('', null),
  amenities: Joi.array().items(Joi.string()).default([]),
});

export const flightSearchSchema = Joi.object({
  origin: Joi.string().trim().min(3).max(10).required(),
  destination: Joi.string().trim().min(3).max(10).required(),
  departDate: date.required(),
  returnDate: date.allow('', null),
  adults: Joi.number().integer().min(1).max(9).default(1),
  travelClass: Joi.string().valid('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST').default('ECONOMY'),
  nonStop: Joi.boolean().default(false),
  maxPrice: Joi.number().min(0).allow('', null),
});

export const trainBusSearchSchema = Joi.object({
  from: Joi.string().trim().min(2).max(120).required(),
  to: Joi.string().trim().min(2).max(120).required(),
  date: date.required(),
  passengers: Joi.number().integer().min(1).max(20).default(1),
  class: Joi.string().allow('').max(40),
});

export const expenseSchema = Joi.object({
  trip: Joi.string().allow('', null),
  category: Joi.string().valid(...EXPENSE_CATEGORIES).required(),
  amount: Joi.number().positive().max(1e9).required(),
  currency: Joi.string().valid(...CURRENCIES).default('INR'),
  description: Joi.string().trim().min(1).max(300).required(),
  date: date.required(),
  location: Joi.string().allow('').max(200).default(''),
  paymentMethod: Joi.string().allow('').max(60).default(''),
  isEstimate: Joi.boolean().default(false),
});

export const ticketSchema = Joi.object({
  trip: Joi.string().allow('', null),
  category: Joi.string().valid(...TICKET_CATEGORIES).required(),
  provider: Joi.string().allow('').max(80),
  title: Joi.string().trim().min(1).max(160).required(),
  reference: Joi.string().allow('').max(80),
  bookingDate: date.allow('', null),
  travelDate: date.allow('', null),
  details: Joi.object().unknown(true).default({}),
});

export const emergencyContactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80).required(),
  relationship: Joi.string().allow('').max(60),
  phone: Joi.string().trim().min(7).max(20).required(),
  email: Joi.string().email().allow('', null),
  isPrimary: Joi.boolean().default(false),
});

export const profileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80),
  homeLocation: Joi.string().allow('').max(120),
  preferredCurrency: Joi.string().valid(...CURRENCIES),
  language: Joi.string().valid(...LANGUAGES),
  travelStyle: Joi.string().valid('budget', 'backpacker', 'standard', 'luxury', 'family', 'business', 'adventure', 'romantic'),
  foodPreference: Joi.string().allow('').max(40),
  hotelPreference: Joi.string().allow('').max(40),
  transportPreference: Joi.string().allow('').max(40),
  interests: Joi.array().items(Joi.string().max(60)).max(20),
  accessibility: Joi.array().items(Joi.string().max(60)).max(20),
  profileImage: Joi.string().allow('').max(500),
});

export const translateSchema = Joi.object({
  text: Joi.string().trim().min(1).max(4000).required(),
  target: Joi.string().valid(...LANGUAGES).default('en'),
});

export const adminUpdateUserSchema = Joi.object({
  role: Joi.string().valid('user', 'admin'),
  emailVerified: Joi.boolean(),
  status: Joi.boolean(),
});
