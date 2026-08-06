import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import env from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { httpLogger } from './utils/logger.js';

const app = express();

// Security headers
app.use(helmet());

// CORS whitelist - only configured origins. Denied origins get a clear 403.
app.use(
  cors({
    origin(origin, cb) {
      const whitelist = env.FRONTEND_URL.split(',').map((u) => u.trim());
      if (!origin || whitelist.includes(origin)) return cb(null, true);
      const err = new Error('Origin not allowed by CORS');
      err.status = 403;
      return cb(err);
    },
    credentials: true,
  })
);

// Parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());

// Logging
app.use(httpLogger);

// General rate limiting
app.use('/api', apiLimiter);

// Routes
app.use('/api', routes);

// Root health
app.get('/', (_req, res) => {
  res.json({ name: 'TravelMind AI API', version: '1.0.0', docs: '/api/health' });
});

// 404 + central error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
