import { Router } from 'express';
import logger from '../utils/logger.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import tripRoutes from './trip.routes.js';
import hotelRoutes from './hotel.routes.js';
import flightRoutes from './flight.routes.js';
import trainRoutes from './train.routes.js';
import busRoutes from './bus.routes.js';
import restaurantRoutes from './restaurant.routes.js';
import placeRoutes from './place.routes.js';
import mapRoutes from './map.routes.js';
import geocodeRoutes from './geocode.routes.js';
import routeRoutes from './routes.routes.js';
import weatherRoutes from './weather.routes.js';
import currencyRoutes from './currency.routes.js';
import chatRoutes from './chat.routes.js';
import voiceRoutes from './voice.routes.js';
import expenseRoutes from './expense.routes.js';
import ticketRoutes from './ticket.routes.js';
import emergencyRoutes from './emergency.routes.js';
import notificationRoutes from './notification.routes.js';
import translateRoutes from './translate.routes.js';
import adminRoutes from './admin.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

logger.info('[ROUTES] Mounting API routes...');

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/trips', tripRoutes);
router.use('/hotels', hotelRoutes);
router.use('/flights', flightRoutes);
router.use('/trains', trainRoutes);
router.use('/buses', busRoutes);
router.use('/restaurants', restaurantRoutes);
router.use('/places', placeRoutes);
router.use('/maps', mapRoutes);
router.use('/geocode', geocodeRoutes);
router.use('/routes', routeRoutes);
router.use('/weather', weatherRoutes);
router.use('/currency', currencyRoutes);
router.use('/chat', chatRoutes);
router.use('/voice', voiceRoutes);
router.use('/expenses', expenseRoutes);
router.use('/tickets', ticketRoutes);
router.use('/emergency', emergencyRoutes);
router.use('/notifications', notificationRoutes);
router.use('/translate', translateRoutes);
router.use('/admin', adminRoutes);

logger.info('[ROUTES] All 23 API routes mounted');

export default router;
