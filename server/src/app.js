import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config, isAllowedOrigin } from './config.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import roomRoutes from './routes/rooms.js';
import publicRoomRoutes from './routes/publicRooms.js';
import moderationRoutes from './routes/moderation.js';
import eventRoutes from './routes/events.js';
import notificationRoutes from './routes/notifications.js';
import crypto from 'node:crypto';
import { log } from './lib/logger.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  app.disable('x-powered-by');

  // Every request gets an id (returned in X-Request-Id) and one structured log line when it finishes.
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/api/health' || req.path === '/api/ready') return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log[res.statusCode >= 500 ? 'error' : 'info']('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and non-browser requests have no Origin header.
        if (isAllowedOrigin(origin)) return cb(null, true);
        cb(new HttpError(403, 'CORS_BLOCKED', 'Origin not allowed.'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.isTest ? 10_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } },
    })
  );

  // Liveness: the process is up. Readiness: it can actually serve (database reachable).
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
  });
  app.get('/api/ready', async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('not connected');
      await mongoose.connection.db.admin().ping();
      res.json({ ready: true, db: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ ready: false, db: 'unavailable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/rooms', publicRoomRoutes); // must come first: /public would otherwise match /:code
  app.use('/api/rooms', roomRoutes);
  app.use('/api/rooms', moderationRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.')));

  // Optional: serve the built client from the same origin (single-service deploys).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(here, '../../client/dist');
  if (config.isProd && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // Central error handler: never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.details } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body must be valid JSON.' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request is too large.' } });
    }
    // Database outages should read as "unavailable", not as a bug in the app.
    if (err?.name === 'MongoNetworkError' || err?.name === 'MongooseServerSelectionError' || err?.name === 'MongoServerSelectionError') {
      log.error('database unavailable', { id: _req.id, message: err.message });
      return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'SyncSpace can’t reach its database right now. Try again shortly.' } });
    }
    log.error('unhandled error', { id: _req.id, err });
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Try again.', requestId: _req.id } });
  });

  return app;
}
