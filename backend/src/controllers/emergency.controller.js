import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import EmergencyContact from '../models/EmergencyContact.js';
import placesProvider from '../providers/places.provider.js';

/**
 * Nearby emergency services (hospitals, police, pharmacies, embassies) via
 * Geoapify Places. Live data only - never fabricated.
 */
export const nearby = asyncHandler(async (req, res) => {
  const { lat, lng, radius } = req.query;
  const latNum = Number(lat);
  const lngNum = Number(lng);

  const categories = [
    { key: 'hospitals', type: 'hospital', query: 'hospital' },
    { key: 'police', type: 'police', query: 'police station' },
    { key: 'pharmacies', type: 'pharmacy', query: 'pharmacy' },
    { key: 'embassies', type: 'embassy', query: 'embassy consulate' },
  ];

  const results = {};
  let anyLive = false;
  for (const cat of categories) {
    const r = await placesProvider.nearbySearch({
      lat: latNum,
      lng: lngNum,
      type: cat.type,
      radius: radius ? Number(radius) : 5000,
      limit: 8,
    });
    results[cat.key] = r.data || [];
    if (r.isLive) anyLive = true;
    results[`${cat.key}Message`] = r.message;
  }

  res.json(
    ApiResponse.ok(anyLive ? 'Nearby emergency services' : 'Live data unavailable for emergency services', {
      results,
      isLive: anyLive,
      location: { lat: latNum, lng: lngNum },
    })
  );
});

export const listContacts = asyncHandler(async (req, res) => {
  const contacts = await EmergencyContact.find({ user: req.user._id }).sort({ isPrimary: -1, createdAt: -1 });
  res.json(ApiResponse.ok('Emergency contacts', { contacts }));
});

export const addContact = asyncHandler(async (req, res) => {
  if (req.body.isPrimary) {
    await EmergencyContact.updateMany({ user: req.user._id }, { $set: { isPrimary: false } });
  }
  const contact = await EmergencyContact.create({ ...req.body, user: req.user._id });
  res.status(201).json(ApiResponse.created('Contact saved', { contact }));
});

export const updateContact = asyncHandler(async (req, res) => {
  const contact = await EmergencyContact.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: req.body },
    { new: true }
  );
  if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
  res.json(ApiResponse.ok('Contact updated', { contact }));
});

export const deleteContact = asyncHandler(async (req, res) => {
  await EmergencyContact.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  res.json(ApiResponse.ok('Contact deleted'));
});

export default { nearby, listContacts, addContact, updateContact, deleteContact };
