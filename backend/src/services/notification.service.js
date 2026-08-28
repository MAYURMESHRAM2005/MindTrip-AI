import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';

export async function createNotification({ user, type = 'system', title, message = '', link = '', icon = 'bell' }) {
  try {
    const notification = await Notification.create({ user, type, title, message, link, icon });
    logger.info(`[NOTIFICATION] Created: type=${type}, title='${title}', user=${user}`);
    return notification;
  } catch (err) {
    // Notifications must never break the main flow
    logger.error(`[NOTIFICATION] Failed to create: ${err.message}`);
    return null;
  }
}

export async function notifyTripPlanned(userId, tripId, title) {
  logger.info(`[NOTIFICATION] Sending trip planned notification for trip: ${tripId}`);
  return createNotification({
    user: userId,
    type: 'trip',
    title: 'Trip planned ✈️',
    message: `Your trip "${title}" has been planned by the AI agents.`,
    link: `/itinerary/${tripId}`,
    icon: 'plane',
  });
}

export async function notifyBudgetOptimized(userId, tripId, saved) {
  logger.info(`[NOTIFICATION] Sending budget optimized notification: saved=${saved}`);
  return createNotification({
    user: userId,
    type: 'budget',
    title: 'Budget optimized 💰',
    message: saved > 0 ? `We saved ${saved} on your trip with cheaper alternatives.` : 'Your trip fits the budget.',
    link: `/budget?trip=${tripId}`,
    icon: 'wallet',
  });
}

export default { createNotification, notifyTripPlanned, notifyBudgetOptimized };
