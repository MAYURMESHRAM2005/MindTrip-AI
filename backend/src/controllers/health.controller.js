import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { geminiConfigured } from '../services/gemini.service.js';
import { groqConfigured } from '../services/groq.service.js';
import { providerStatuses } from '../providers/index.js';

export const health = asyncHandler(async (_req, res) => {
  logger.debug('[HEALTH] Health check requested');
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json(
    ApiResponse.ok('Service health', {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbState,
      ai: geminiConfigured ? 'configured' : 'not-configured',
      aiFallback: groqConfigured ? 'configured' : 'not-configured',
      providers: providerStatuses(),
    })
  );
});

export default { health };
