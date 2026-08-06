import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import placesProvider from '../providers/places.provider.js';
import geminiService from '../services/gemini.service.js';
import SavedPlace from '../models/SavedPlace.js';

export const textSearch = asyncHandler(async (req, res) => {
  const { q, lat, lng, radius, type, limit } = req.query;
  const result = await placesProvider.textSearch({
    query: q,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    radius: radius ? Number(radius) : 5000,
    type: type || 'tourist_attraction',
    limit: limit ? Number(limit) : 12,
  });
  res.json(ApiResponse.ok(result.message, { places: result.data || [], isLive: result.isLive }));
});

export const nearbySearch = asyncHandler(async (req, res) => {
  const { lat, lng, type, radius, limit } = req.query;
  const result = await placesProvider.nearbySearch({
    lat: Number(lat),
    lng: Number(lng),
    type: type || 'hospital',
    radius: radius ? Number(radius) : 5000,
    limit: limit ? Number(limit) : 12,
  });
  res.json(ApiResponse.ok(result.message, { places: result.data || [], isLive: result.isLive }));
});

export const savePlace = asyncHandler(async (req, res) => {
  const place = await SavedPlace.create({ ...req.body, user: req.user._id });
  res.status(201).json(ApiResponse.created('Place saved', { place }));
});

export const listSavedPlaces = asyncHandler(async (req, res) => {
  const places = await SavedPlace.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json(ApiResponse.ok('Saved places', { places }));
});

export const deleteSavedPlace = asyncHandler(async (req, res) => {
  await SavedPlace.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  res.json(ApiResponse.ok('Place removed'));
});

export const photoUrl = asyncHandler(async (req, res) => {
  const { ref } = req.query;
  const url = placesProvider.photoUrl(ref, 600);
  if (!url) {
    return res.status(404).json({ success: false, message: 'Photo unavailable' });
  }
  res.json(ApiResponse.ok('Photo URL', { url }));
});

export const imageSearch = asyncHandler(async (req, res) => {
  if (!req.file) return res.json(ApiResponse.ok('No image uploaded', { analysis: null, places: [], isLive: false }));

  const base64 = req.file.buffer.toString('base64');
  const prompt = `Analyze this travel photo. Identify the landmark/destination/city/country if recognizable.
Respond in valid JSON:
{"landmark":"... or null","city":"... or null","country":"... or null","description":"...","confidence":"low|medium|high","keywords":["..."]}`;

  const analysis = await geminiService.analyzeImage({
    imageBase64: base64,
    mimeType: req.file.mimetype,
    prompt,
    userId: req.user?._id?.toString(),
  });

  const guess = analysis.data?.city || analysis.data?.landmark || analysis.data?.keywords?.[0];
  let places = [];
  let placesLive = false;
  let placesMessage = '';
  if (guess) {
    const placesResult = await placesProvider.textSearch({ query: guess, limit: 8 });
    places = placesResult.data || [];
    placesLive = placesResult.isLive;
    placesMessage = placesResult.message;
  }

  res.json(
    ApiResponse.ok('Image analyzed', {
      analysis: analysis.data || null,
      aiConfigured: analysis.configured,
      aiMessage: analysis.message,
      places,
      placesLive,
      placesMessage,
    })
  );
});

export default {
  textSearch,
  nearbySearch,
  savePlace,
  listSavedPlaces,
  deleteSavedPlace,
  photoUrl,
  imageSearch,
};
