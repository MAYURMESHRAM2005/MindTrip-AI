import app from './app.js';
import env from './config/env.js';
import { connectDB } from './config/db.js';
import logger from './utils/logger.js';
import { startCleanupJob } from './jobs/cleanup.job.js';

async function bootstrap() {
  try {
    await connectDB(env.MONGODB_URI);
    startCleanupJob();

    const server = app.listen(env.PORT, () => {
      logger.info(`[SERVER] TravelMind AI backend running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    });

    const shutdown = async (signal) => {
      logger.info(`[SERVER] ${signal} received, shutting down gracefully...`);
      server.close(async () => {
        const mongoose = (await import('mongoose')).default;
        await mongoose.disconnect();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('[SERVER] Failed to start:', err.message);
    process.exit(1);
  }
}

bootstrap();
