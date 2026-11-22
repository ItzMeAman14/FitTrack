import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import aiRoutes from './routes/aiRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import authRoutes from './routes/authRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import dietRoutes from './routes/dietRoutes.js';
import measurementRoutes from './routes/measurementRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import savedPlanRoutes from './routes/savedPlanRoutes.js';
import workoutRoutes from './routes/workoutRoutes.js';
import { errorHandler, notFoundHandler } from './utils/error.js';

dotenv.config();

export interface CreateApiAppOptions {
  includeErrorHandler?: boolean;
}

export function createApiApp(options: CreateApiAppOptions = {}): express.Express {
  const { includeErrorHandler = true } = options;
  const app = express();

  const extraCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  const vercelBranchOrigin = process.env.VERCEL_BRANCH_URL
    ? `https://${process.env.VERCEL_BRANCH_URL}`
    : undefined;

  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = new Set(
      [
        process.env.APP_URL,
        process.env.FRONTEND_URL,
        vercelOrigin,
        vercelBranchOrigin,
        ...extraCorsOrigins,
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ].filter((v): v is string => Boolean(v))
    );

    const isAllowedOrigin =
      typeof origin === 'string' &&
      (allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/i.test(origin));

    if (origin && isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, status: 'ok', service: 'fittrack-api' });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api', dietRoutes);
  app.use('/api', workoutRoutes);
  app.use('/api/measurements', measurementRoutes);
  app.use('/api/saved-plans', savedPlanRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/data', dataRoutes);

  // API 404 handler
  app.use('/api', notFoundHandler);

  if (includeErrorHandler) {
    app.use(errorHandler);
  }

  return app;
}
