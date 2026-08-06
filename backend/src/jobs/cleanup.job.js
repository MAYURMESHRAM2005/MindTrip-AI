import RefreshToken from '../models/RefreshToken.js';
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';

const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export async function runCleanup() {
  try {
    const [tokens, notifications] = await Promise.all([
      RefreshToken.deleteMany({ expiresAt: { $lt: new Date() } }),
      Notification.deleteMany({ createdAt: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, read: true }),
    ]);
    if (tokens.deletedCount || notifications.deletedCount) {
      logger.info(`[JOB] Cleanup: removed ${tokens.deletedCount} expired tokens, ${notifications.deletedCount} old notifications`);
    }
  } catch (err) {
    logger.error('[JOB] Cleanup failed:', err.message);
  }
}

export function startCleanupJob() {
  runCleanup();
  setInterval(runCleanup, INTERVAL_MS).unref();
  logger.info('[JOB] Cleanup job started');
}

export default { runCleanup, startCleanupJob };
