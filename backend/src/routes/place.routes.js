import { Router } from 'express';
import placeController from '../controllers/place.controller.js';
import { protect } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import { searchQuery } from '../validators/general.validator.js';
import { uploadImage } from '../middleware/upload.js';
import Joi from 'joi';

const router = Router();
router.use(protect);

const nearbySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  type: Joi.string().max(60).default('hospital'),
  radius: Joi.number().min(100).max(50000).default(5000),
  limit: Joi.number().integer().min(1).max(20).default(12),
});

const savePlaceSchema = Joi.object({
  placeId: Joi.string().allow('', null),
  name: Joi.string().trim().min(1).max(160).required(),
  category: Joi.string().max(60).default('tourist_attraction'),
  address: Joi.string().allow('').max(300),
  coordinates: Joi.object({ lat: Joi.number(), lng: Joi.number() }).allow(null),
  rating: Joi.number().allow(null),
  notes: Joi.string().allow('').max(500),
});

router.get('/search', validate(searchQuery, 'query'), placeController.textSearch);
router.get('/nearby', validate(nearbySchema, 'query'), placeController.nearbySearch);
router.get('/photo', placeController.photoUrl);

router.get('/saved', placeController.listSavedPlaces);
router.post('/saved', validate(savePlaceSchema), placeController.savePlace);
router.delete('/saved/:id', placeController.deleteSavedPlace);

// Image-based place search (Gemini multimodal + Places)
router.post('/image-search', aiLimiter, uploadImage.single('image'), placeController.imageSearch);

export default router;
