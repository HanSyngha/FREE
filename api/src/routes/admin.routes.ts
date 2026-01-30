/**
 * Admin Routes - Super Admin 전용
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireSuperAdmin, loadUser } from '../middleware/auth.js';
import { syncModelsFromEndpoint } from '../services/llm.service.js';
import { encrypt } from '../utils/encryption.js';

export const adminRoutes = Router();

// POST /admin/llm/endpoint - LLM endpoint 설정
adminRoutes.post('/llm/endpoint', authenticateToken, requireSuperAdmin, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { endpoint, apiKey } = req.body;
    if (!endpoint) { res.status(400).json({ error: 'endpoint is required' }); return; }

    // 기존 config 비활성화
    await prisma.lLMConfig.updateMany({ where: { isActive: true }, data: { isActive: false } });

    // 새 config 생성 (modelId는 sync 후 설정)
    const config = await prisma.lLMConfig.create({
      data: {
        endpoint,
        apiKey: apiKey ? encrypt(apiKey) : '',
        modelId: '',
        modelName: '',
        isActive: false,
      },
    });

    res.json({ success: true, config: { id: config.id, endpoint: config.endpoint } });
  } catch (error) {
    console.error('Set endpoint error:', error);
    res.status(500).json({ error: 'Failed to set endpoint' });
  }
});

// POST /admin/llm/sync - endpoint에서 model list 동기화
adminRoutes.post('/llm/sync', authenticateToken, requireSuperAdmin, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { endpoint, apiKey } = req.body;

    const targetEndpoint = endpoint || (await prisma.lLMConfig.findFirst({
      orderBy: { createdAt: 'desc' },
    }))?.endpoint;

    if (!targetEndpoint) { res.status(400).json({ error: 'No endpoint configured' }); return; }

    const models = await syncModelsFromEndpoint(
      targetEndpoint,
      apiKey || '',
      {
        loginid: req.user!.loginid,
        username: req.user!.username,
        deptname: req.user!.deptname,
      }
    );

    res.json({ models, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Sync models error:', error);
    res.status(500).json({ error: 'Failed to sync models' });
  }
});

// GET /admin/llm/models - Sync된 model 목록
adminRoutes.get('/llm/models', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const configs = await prisma.lLMConfig.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, endpoint: true, modelId: true, modelName: true,
        isActive: true, lastSyncAt: true, createdAt: true,
      },
    });

    // 현재 활성 endpoint에서 models 가져오기
    const latestConfig = configs[0];
    let availableModels: any[] = [];

    if (latestConfig) {
      try {
        availableModels = await syncModelsFromEndpoint(
          latestConfig.endpoint,
          '',
          {
            loginid: req.user!.loginid,
            username: req.user!.username,
            deptname: req.user!.deptname,
          }
        );
      } catch { /* ignore sync errors */ }
    }

    res.json({ configs, availableModels });
  } catch (error) {
    console.error('Get models error:', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

// PUT /admin/llm/activate/:modelId - model 활성화
adminRoutes.put('/llm/activate/:modelId', authenticateToken, requireSuperAdmin, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const modelId = req.params.modelId as string;
    const { modelName, endpoint, apiKey } = req.body;

    // 기존 모두 비활성화
    await prisma.lLMConfig.updateMany({ where: { isActive: true }, data: { isActive: false } });

    // 새 config 생성 또는 업데이트
    const config = await prisma.lLMConfig.create({
      data: {
        endpoint: endpoint || '',
        apiKey: apiKey ? encrypt(apiKey) : '',
        modelId,
        modelName: modelName || modelId,
        isActive: true,
        lastSyncAt: new Date(),
      },
    });

    res.json({ success: true, config: { id: config.id, modelId: config.modelId, modelName: config.modelName, isActive: true } });
  } catch (error) {
    console.error('Activate model error:', error);
    res.status(500).json({ error: 'Failed to activate model' });
  }
});

// GET /admin/teams - 전체 팀 + 사용자 목록
adminRoutes.get('/teams', authenticateToken, requireSuperAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        groups: {
          include: {
            parts: true,
          },
        },
        users: {
          select: {
            id: true, loginid: true, username: true,
            groupId: true, partId: true,
            group: { select: { name: true } },
            part: { select: { name: true } },
          },
        },
        teamAdmins: {
          include: {
            user: { select: { id: true, loginid: true, username: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ teams });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Failed to get teams' });
  }
});

// POST /admin/team-admin - Team Admin 부여
adminRoutes.post('/team-admin', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, teamId } = req.body;
    if (!userId || !teamId) { res.status(400).json({ error: 'userId and teamId are required' }); return; }

    const existing = await prisma.teamAdmin.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (existing) { res.status(409).json({ error: '이미 Team Admin입니다.' }); return; }

    const teamAdmin = await prisma.teamAdmin.create({
      data: { userId, teamId },
    });

    res.json({ success: true, teamAdmin });
  } catch (error) {
    console.error('Add team admin error:', error);
    res.status(500).json({ error: 'Failed to add team admin' });
  }
});

// DELETE /admin/team-admin/:id - Team Admin 해제
adminRoutes.delete('/team-admin/:id', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    await prisma.teamAdmin.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Remove team admin error:', error);
    res.status(500).json({ error: 'Failed to remove team admin' });
  }
});
