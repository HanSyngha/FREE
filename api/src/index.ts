import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { authRoutes } from './routes/auth.routes.js';
import { onboardingRoutes } from './routes/onboarding.routes.js';
import { worklogRoutes } from './routes/worklog.routes.js';
import { goalRoutes } from './routes/goal.routes.js';
import { todoRoutes } from './routes/todo.routes.js';
import { orgAdminRoutes } from './routes/orgAdmin.routes.js';
import { spaceRoutes } from './routes/space.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { teamAdminRoutes } from './routes/teamAdmin.routes.js';
import { ratingRoutes } from './routes/rating.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { announcementRoutes } from './routes/announcement.routes.js';
import { syncModelsFromEndpoint } from './services/llm.service.js';

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
app.use('/worklogs', worklogRoutes);
app.use('/items', worklogRoutes); // 하위 호환 (1개월 후 삭제)
app.use('/goals', goalRoutes);
app.use('/todos', todoRoutes);
app.use('/org-admin', orgAdminRoutes);
app.use('/spaces', spaceRoutes);
app.use('/reports', reportRoutes);
app.use('/admin', adminRoutes);
app.use('/team-admin', teamAdminRoutes);
app.use('/ratings', ratingRoutes);
app.use('/profile', profileRoutes);
app.use('/announcements', announcementRoutes);

// Auto-initialize and validate LLM config on startup
async function initLLMConfig() {
  try {
    const proxyUrl = process.env.LLM_PROXY_URL;
    if (!proxyUrl) return;

    // 현재 사용 가능한 모델 목록 조회
    console.log('[Init] Fetching available models from proxy...');
    const models = await syncModelsFromEndpoint(proxyUrl, '', {
      loginid: 'system',
      username: 'system',
      deptname: 'system',
    });

    const availableModelIds = models.map(m => m.id);
    console.log(`[Init] Available models: ${availableModelIds.join(', ') || '(none)'}`);

    // 기존 활성 config 확인
    const existing = await prisma.lLMConfig.findFirst({ where: { isActive: true } });

    if (existing) {
      // 기존 활성 모델이 더 이상 사용 불가능한 경우 비활성화
      if (!availableModelIds.includes(existing.modelId)) {
        console.log(`[Init] Active model '${existing.modelId}' no longer available, deactivating...`);
        await prisma.lLMConfig.update({
          where: { id: existing.id },
          data: { isActive: false },
        });

        // 사용 가능한 첫 번째 모델로 자동 전환
        if (models.length > 0) {
          const first = models[0]!;
          await prisma.lLMConfig.create({
            data: {
              endpoint: proxyUrl,
              apiKey: '',
              modelId: first.id,
              modelName: first.displayName,
              isActive: true,
              lastSyncAt: new Date(),
            },
          });
          console.log(`[Init] Auto-switched to model: ${first.displayName} (${first.id})`);
        }
      } else {
        console.log(`[Init] Active model '${existing.modelId}' is valid`);
      }
      return;
    }

    // 활성 config가 없으면 새로 생성
    if (models.length === 0) {
      console.log('[Init] No models available from proxy');
      return;
    }

    const first = models[0]!;
    await prisma.lLMConfig.create({
      data: {
        endpoint: proxyUrl,
        apiKey: '',
        modelId: first.id,
        modelName: first.displayName,
        isActive: true,
        lastSyncAt: new Date(),
      },
    });

    console.log(`[Init] Default LLM config created: ${first.displayName} (${first.id})`);
  } catch (error) {
    console.error('[Init] LLM config init failed (non-fatal):', error);
  }
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[FREE API] Server running on port ${PORT}`);
  await initLLMConfig();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
