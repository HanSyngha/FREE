/**
 * Admin Routes - Super Admin 전용
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireSuperAdmin, requireTeamAdminOrHigher, loadUser, getVisibleScope } from '../middleware/auth.js';
import { fetchAvailableModels } from '../services/llm.service.js';
import { getKSTMidnight, parseKSTDate } from '../utils/date.js';
import { Queue } from 'bullmq';

function parseRedisUrl(url: string) {
  const cleaned = url.replace('redis://', '');
  const [host, portStr] = cleaned.split(':');
  return { host: host || 'localhost', port: parseInt(portStr || '6379') };
}

const redisConfig = parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:6379');
const reportQueue = new Queue('report-generation', {
  connection: { host: redisConfig.host, port: redisConfig.port },
});
const progressQueue = new Queue('progress-update', {
  connection: { host: redisConfig.host, port: redisConfig.port },
});

export const adminRoutes = Router();

// GET /admin/teams - 전체 팀 + 사용자 목록
adminRoutes.get('/teams', authenticateToken, requireSuperAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        groups: { include: { parts: true } },
        users: {
          select: {
            id: true, loginid: true, username: true,
            groupId: true, partId: true,
            group: { select: { name: true } },
            part: { select: { name: true } },
          },
        },
        teamAdmins: {
          include: { user: { select: { id: true, loginid: true, username: true } } },
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

    const existing = await prisma.teamAdmin.findUnique({ where: { userId_teamId: { userId, teamId } } });
    if (existing) { res.status(409).json({ error: '이미 Team Admin입니다.' }); return; }

    const teamAdmin = await prisma.teamAdmin.create({ data: { userId, teamId } });
    res.json({ success: true, teamAdmin });
  } catch (error) {
    console.error('Add team admin error:', error);
    res.status(500).json({ error: 'Failed to add team admin' });
  }
});

// DELETE /admin/team-admin/:id - Team Admin 해제
adminRoutes.delete('/team-admin/:id', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await prisma.teamAdmin.delete({ where: { id: req.params.id as string } });
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
    if (!loginid || typeof loginid !== 'string') { res.status(400).json({ error: 'loginid is required' }); return; }
    if (!items || !Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'items array is required' }); return; }
    if (items.length > 100) { res.status(400).json({ error: '한 번에 최대 100개 항목까지 입력 가능합니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }
    if (!user.teamId) { res.status(400).json({ error: `해당 사용자(${loginid})의 팀이 배정되지 않았습니다.` }); return; }
    if (!user.groupId || !user.partId) { res.status(400).json({ error: `해당 사용자(${loginid})의 그룹/파트 설정이 필요합니다.` }); return; }

    const personalSpace = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!personalSpace) { res.status(500).json({ error: `사용자(${loginid})의 Personal space가 없습니다.` }); return; }

    const todayDate = getKSTMidnight();
    const minDate = new Date(todayDate);
    minDate.setDate(minDate.getDate() - 29);

    for (const item of items) {
      if (!item || typeof item !== 'object') { res.status(400).json({ error: 'items 배열의 각 요소는 객체여야 합니다.' }); return; }
      if (!item.title || !item.content) { res.status(400).json({ error: 'Each item must have title and content' }); return; }
      if (item.date) {
        const d = parseKSTDate(item.date);
        if (isNaN(d.getTime()) || d > todayDate || d < minDate) {
          res.status(400).json({ error: `유효하지 않은 날짜입니다: ${item.date}` }); return;
        }
      }
    }

    const createdItems = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        const itemDate = item.date ? parseKSTDate(item.date) : todayDate;
        const created = await tx.workLog.create({
          data: { userId: user.id, spaceId: personalSpace.id, title: String(item.title).slice(0, 500), content: String(item.content).slice(0, 10000), date: itemDate },
        });
        results.push(created);
        await tx.activityLog.create({
          data: { userId: user.id, action: 'CREATE_WORKLOG', targetType: 'WORKLOG', targetId: created.id, details: `[Admin] ${created.title}` },
        });
      }
      return results;
    });

    res.json({ success: true, items: createdItems, count: createdItems.length });
  } catch (error) {
    console.error('Admin create items error:', error);
    res.status(500).json({ error: 'Failed to create items' });
  }
});

// POST /admin/trigger-report - 수동 보고서 생성 트리거
adminRoutes.post('/trigger-report', authenticateToken, requireTeamAdminOrHigher, async (req: AuthenticatedRequest, res) => {
  try {
    const { teamId } = req.body;

    if (teamId) {
      // 특정 팀
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

      const inProgress = await prisma.reportJob.findFirst({ where: { teamId, status: 'IN_PROGRESS' } });
      if (inProgress) { res.status(409).json({ error: '이미 해당 팀의 보고서 생성이 진행 중입니다.' }); return; }

      await reportQueue.add(`manual-report-${team.id}`, { teamId });
      console.log(`[Admin] Manual report triggered for team: ${team.name} by ${req.user?.loginid}`);
      res.json({ success: true, message: `${team.name} 팀 보고서 생성이 시작되었습니다.` });
    } else {
      // 전체 팀 (SuperAdmin만)
      if (!req.isSuperAdmin) { res.status(403).json({ error: 'Super admin required for all-team trigger' }); return; }
      const teams = await prisma.team.findMany();
      for (const team of teams) {
        await reportQueue.add(`manual-report-${team.id}`, { teamId: team.id });
      }
      res.json({ success: true, message: `${teams.length}개 팀 보고서 생성이 시작되었습니다.` });
    }
  } catch (error) {
    console.error('Trigger report error:', error);
    res.status(500).json({ error: 'Failed to trigger report generation' });
  }
});

// POST /admin/trigger-progress - 수동 진행률 업데이트 트리거
adminRoutes.post('/trigger-progress', authenticateToken, requireTeamAdminOrHigher, async (req: AuthenticatedRequest, res) => {
  try {
    const { teamId } = req.body;

    if (teamId) {
      await progressQueue.add(`manual-progress-${teamId}`, { teamId });
      res.json({ success: true, message: '진행률 업데이트가 시작되었습니다.' });
    } else {
      if (!req.isSuperAdmin) { res.status(403).json({ error: 'Super admin required for all-team trigger' }); return; }
      await progressQueue.add('manual-progress-all', { type: 'scheduled' });
      res.json({ success: true, message: '전체 팀 진행률 업데이트가 시작되었습니다.' });
    }
  } catch (error) {
    console.error('Trigger progress error:', error);
    res.status(500).json({ error: 'Failed to trigger progress update' });
  }
});

// ========== LLM Operation Config API ==========

// GET /admin/llm-operations - 모든 작업별 모델 설정
adminRoutes.get('/llm-operations', authenticateToken, requireSuperAdmin, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const operations = await prisma.lLMOperationConfig.findMany({
      orderBy: { operation: 'asc' },
    });

    // Dashboard에서 사용 가능한 모델 목록 직접 조회
    const availableModels = await fetchAvailableModels({
      loginid: req.user!.loginid,
      username: req.user!.username,
      deptname: req.user!.deptname,
    });

    const operationTypes = [
      { key: 'PARSE_GOALS', label: '조직 목표 분리' },
      { key: 'PARSE_TEXT', label: '개인 텍스트 → WorkLog+Todo' },
      { key: 'LINK_TODO', label: 'Todo → 목표 연결' },
      { key: 'AUTO_MAP', label: '생성/수정 시 양방향 매핑' },
      { key: 'UPDATE_PROGRESS', label: '진행률 자동 업데이트' },
      { key: 'REPORT', label: '보고서 생성' },
    ];

    res.json({ operations, operationTypes, availableModels });
  } catch (error) {
    console.error('Get LLM operations error:', error);
    res.status(500).json({ error: 'Failed to get LLM operations' });
  }
});

// PUT /admin/llm-operations/:operation - 특정 작업의 모델 변경
adminRoutes.put('/llm-operations/:operation', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const operation = req.params.operation as string;
    const { modelId } = req.body;
    if (!modelId) { res.status(400).json({ error: 'modelId is required' }); return; }

    const config = await prisma.lLMOperationConfig.upsert({
      where: { operation },
      update: { modelId },
      create: { operation, modelId },
    });

    res.json({ success: true, config });
  } catch (error) {
    console.error('Update LLM operation error:', error);
    res.status(500).json({ error: 'Failed to update LLM operation' });
  }
});

// DELETE /admin/llm-operations/:operation - 특정 작업 설정 삭제 (기본 모델로 복귀)
adminRoutes.delete('/llm-operations/:operation', authenticateToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const operation = req.params.operation as string;
    await prisma.lLMOperationConfig.delete({ where: { operation } }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete LLM operation error:', error);
    res.status(500).json({ error: 'Failed to delete LLM operation' });
  }
});

// GET /admin/auth/me-scope - 현재 사용자의 권한 범위 (프론트엔드용)
adminRoutes.get('/auth/me-scope', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const visibleScope = await getVisibleScope(user.id);

    const orgAdmins = await prisma.orgAdmin.findMany({
      where: { userId: user.id },
      select: { level: true, targetId: true },
    });

    res.json({ visibleScope, orgAdminLevels: orgAdmins });
  } catch (error) {
    console.error('Get me scope error:', error);
    res.status(500).json({ error: 'Failed to get scope' });
  }
});
