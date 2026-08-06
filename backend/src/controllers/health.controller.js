import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import mongoose from 'mongoose';
import { geminiConfigured } from '../services/gemini.service.js';
import { providerStatuses } from '../providers/index.js';

export const health = asyncHandler(async (_req, res) => {
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json(
    ApiResponse.ok('Service health', {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbState,
      ai: geminiConfigured ? 'configured' : 'not-configured',
      providers: providerStatuses(),
    })
  );
});

export default { health };
