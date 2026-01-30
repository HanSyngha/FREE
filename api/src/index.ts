import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { authRoutes } from './routes/auth.routes.js';
import { onboardingRoutes } from './routes/onboarding.routes.js';
import { itemRoutes } from './routes/item.routes.js';
import { spaceRoutes } from './routes/space.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { teamAdminRoutes } from './routes/teamAdmin.routes.js';
import { ratingRoutes } from './routes/rating.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { announcementRoutes } from './routes/announcement.routes.js';

export const prisma = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:15004');

const app = express();
const PORT = parseInt(process.env.PORT || '15002');

// CORS
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:15001').split(',').map(s => s.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));

// Body parsing
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'free-api', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/items', itemRoutes);
app.use('/spaces', spaceRoutes);
app.use('/reports', reportRoutes);
app.use('/admin', adminRoutes);
app.use('/team-admin', teamAdminRoutes);
app.use('/ratings', ratingRoutes);
app.use('/profile', profileRoutes);
app.use('/announcements', announcementRoutes);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FREE API] Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
