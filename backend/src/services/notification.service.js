import Notification from '../models/Notification.js';

export async function createNotification({ user, type = 'system', title, message = '', link = '', icon = 'bell' }) {
  try {
    return await Notification.create({ user, type, title, message, link, icon });
  } catch (err) {
    // Notifications must never break the main flow
    console.error('[NOTIFICATION]', err.message);
    return null;
  }
}

export async function notifyTripPlanned(userId, tripId, title) {
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
