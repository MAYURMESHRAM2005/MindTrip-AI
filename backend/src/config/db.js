import mongoose from 'mongoose';
import logger from '../utils/logger.js';

/**
 * Connect to MongoDB with sensible retry behaviour.
 */
export async function connectDB(uri) {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    logger.info(`[DB] Connected to MongoDB at ${uri.split('@').pop()}`);
    return mongoose.connection;
  } catch (err) {
    logger.error(`[DB] MongoDB connection failed: ${err.message}`);
    throw err;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
  logger.info('[DB] MongoDB disconnected');
}
