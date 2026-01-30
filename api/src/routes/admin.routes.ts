/**
 * Admin Routes - Super Admin 전용
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireSuperAdmin, loadUser } from '../middleware/auth.js';
import { syncModelsFromEndpoint } from '../services/llm.service.js';
import { encrypt } from '../utils/encryption.js';
import { Queue } from 'bullmq';

function parseRedisUrl(url: string) {
  const cleaned = url.replace('redis://', '');
  const [host, portStr] = cleaned.split(':');
  return { host: host || 'localhost', port: parseInt(portStr || '15004') };
}

const redisConfig = parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:15004');
const reportQueue = new Queue('report-generation', {
  connection: { host: redisConfig.host, port: redisConfig.port },
});

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

// POST /admin/items - SuperAdmin이 특정 사용자에게 업무 항목 직접 추가
adminRoutes.post('/items', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { loginid, items } = req.body;
    if (!loginid || typeof loginid !== 'string') {
      res.status(400).json({ error: 'loginid is required' }); return;
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }
    if (items.length > 100) {
      res.status(400).json({ error: '한 번에 최대 100개 항목까지 입력 가능합니다.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }
    if (!user.groupId || !user.partId) {
      res.status(400).json({ error: `해당 사용자(${loginid})의 그룹/파트 설정이 필요합니다.` });
      return;
    }

    const personalSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    if (!personalSpace) {
      res.status(500).json({ error: `사용자(${loginid})의 Personal space가 없습니다.` });
      return;
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const minDate = new Date(todayDate);
    minDate.setDate(minDate.getDate() - 29);

    // 사전 검증 (DB 쓰기 전에 모든 항목 유효성 확인)
    for (const item of items) {
      if (!item.title || !item.content) {
        res.status(400).json({ error: 'Each item must have title and content' });
        return;
      }
      if (item.date) {
        const d = new Date(item.date);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: `유효하지 않은 날짜 형식입니다: ${item.date}` });
          return;
        }
        if (d > todayDate || d < minDate) {
          res.status(400).json({ error: `유효하지 않은 날짜입니다: ${item.date}` });
          return;
        }
      }
    }

    // 트랜잭션으로 전체 생성 (중간 실패 시 롤백)
    const createdItems = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        const itemDate = item.date ? new Date(item.date) : todayDate;

        const created = await tx.item.create({
          data: {
            userId: user.id,
            spaceId: personalSpace.id,
            title: String(item.title).slice(0, 500),
            content: String(item.content).slice(0, 10000),
            date: itemDate,
          },
        });
        results.push(created);

        await tx.activityLog.create({
          data: {
            userId: user.id,
            action: 'CREATE_ITEM',
            targetType: 'ITEM',
            targetId: created.id,
            details: `[Admin] ${created.title}`,
          },
        });
      }
      return results;
    });

    console.log(`[Admin] ${createdItems.length} items created for ${loginid} by ${req.user?.loginid}`);
    res.json({ success: true, items: createdItems, count: createdItems.length });
  } catch (error) {
    console.error('Admin create items error:', error);
    res.status(500).json({ error: 'Failed to create items' });
  }
});

// POST /admin/trigger-report - 수동 보고서 생성 트리거
adminRoutes.post('/trigger-report', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { teamId } = req.body;
    if (!teamId) { res.status(400).json({ error: 'teamId is required' }); return; }

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    // 이미 진행 중인 작업이 있는지 확인
    const inProgress = await prisma.reportJob.findFirst({
      where: { teamId, status: 'IN_PROGRESS' },
    });
    if (inProgress) {
      res.status(409).json({ error: '이미 해당 팀의 보고서 생성이 진행 중입니다.' });
      return;
    }

    // BullMQ 큐에 작업 추가 (worker의 reportWorker가 처리)
    await reportQueue.add(`manual-report-${team.id}`, { teamId });

    console.log(`[Admin] Manual report triggered for team: ${team.name} by ${req.user?.loginid}`);
    res.json({ success: true, message: `${team.name} 팀 보고서 생성이 시작되었습니다.` });
  } catch (error) {
    console.error('Trigger report error:', error);
    res.status(500).json({ error: 'Failed to trigger report generation' });
  }
});
