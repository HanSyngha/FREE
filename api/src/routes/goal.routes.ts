/**
 * Goal Routes - 조직 목표 CRUD + LLM 입력
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser, requireTeamAdminOrHigher } from '../middleware/auth.js';
import { llmLimit } from '../middleware/rateLimit.js';
import { parseGoalsWithLLM } from '../services/llm.service.js';

export const goalRoutes = Router();

// POST /goals - 조직장 Item 입력 (LLM 분리+태그+매핑)
goalRoutes.post('/', authenticateToken, loadUser, llmLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { text, level, ownerId } = req.body;

    if (!text || typeof text !== 'string') { res.status(400).json({ error: '텍스트를 입력해 주세요.' }); return; }
    if (!level || !['TEAM', 'GROUP', 'PART'].includes(level)) { res.status(400).json({ error: 'level은 TEAM/GROUP/PART 중 하나여야 합니다.' }); return; }
    if (!ownerId) { res.status(400).json({ error: 'ownerId는 필수입니다.' }); return; }

    // 권한 체크: 해당 레벨의 조직장 or SuperAdmin/TeamAdmin
    // 간소화: loadUser 후 팀 소속 확인
    if (!user.teamId) { res.status(400).json({ error: '팀이 배정되지 않았습니다.' }); return; }

    // 기존 상위/하위 Item 리스트 조회
    const existingItems = await prisma.item.findMany({
      where: { level, ownerId },
      select: { id: true, title: true, status: true },
    });

    // 기존 태그 목록
    const existingTags = await prisma.tag.findMany({
      where: { teamId: user.teamId },
      select: { id: true, name: true },
    });

    // 상위 레벨 Item 목록 (매핑용)
    let parentItems: Array<{ id: string; title: string }> = [];
    if (level === 'PART') {
      const part = await prisma.part.findUnique({ where: { id: ownerId }, select: { groupId: true } });
      if (part) {
        parentItems = await prisma.item.findMany({
          where: { level: 'GROUP', ownerId: part.groupId },
          select: { id: true, title: true },
        });
      }
    } else if (level === 'GROUP') {
      const group = await prisma.group.findUnique({ where: { id: ownerId }, select: { teamId: true } });
      if (group) {
        parentItems = await prisma.item.findMany({
          where: { level: 'TEAM', ownerId: group.teamId },
          select: { id: true, title: true },
        });
      }
    }

    const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };

    const parsedGoals = await parseGoalsWithLLM(text, {
      level,
      existingItems: existingItems.map(i => ({ id: i.id, title: i.title })),
      existingTags: existingTags.map(t => t.name),
      parentItems,
    }, userInfo);

    // 목표 생성
    const createdGoals = [];
    for (const goal of parsedGoals) {
      // Tag upsert
      const tagIds: string[] = [];
      for (const tagName of (goal.tags || [])) {
        const tag = await prisma.tag.upsert({
          where: { name_teamId: { name: tagName, teamId: user.teamId } },
          update: {},
          create: { name: tagName, teamId: user.teamId },
        });
        tagIds.push(tag.id);
      }

      // parentItemId 매핑
      let parentItemId: string | null = null;
      if (goal.parentTitle && parentItems.length > 0) {
        const match = parentItems.find(p => p.title === goal.parentTitle);
        if (match) parentItemId = match.id;
      }

      const created = await prisma.item.create({
        data: {
          title: goal.title,
          content: goal.content || '',
          status: (goal.status as any) || 'PLANNED',
          startDate: goal.startDate ? new Date(goal.startDate) : null,
          endDate: goal.endDate ? new Date(goal.endDate) : null,
          level: level as any,
          ownerId,
          parentItemId,
          itemTags: {
            create: tagIds.map(tagId => ({ tagId })),
          },
        },
        include: { itemTags: { include: { tag: true } } },
      });

      createdGoals.push(created);

      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CREATE_GOAL', targetType: 'GOAL', targetId: created.id, details: created.title },
      });
    }

    res.json({ success: true, goals: createdGoals });
  } catch (error: any) {
    console.error('Create goals error:', error);
    res.status(500).json({ error: '목표 생성에 실패했습니다.' });
  }
});

// GET /goals - 목표 목록 (level, ownerId, tag 필터)
goalRoutes.get('/', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { level, ownerId, tag, status } = req.query;

    const where: any = {};
    if (level) where.level = level;
    if (ownerId) where.ownerId = ownerId;
    if (status) where.status = status;
    if (tag) {
      where.itemTags = { some: { tag: { name: tag as string } } };
    }

    const goals = await prisma.item.findMany({
      where,
      include: {
        itemTags: { include: { tag: true } },
        childItems: { select: { id: true, title: true, progress: true, status: true, level: true } },
        parentItem: { select: { id: true, title: true, level: true } },
        _count: { select: { linkedWorkLogs: true, linkedTodos: true } },
      },
      orderBy: [{ status: 'asc' }, { endDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ goals });
  } catch (error) {
    console.error('Get goals error:', error);
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

// GET /goals/tags - 팀 내 태그 목록
goalRoutes.get('/tags', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const tags = await prisma.tag.findMany({
      where: { teamId: user.teamId },
      include: { _count: { select: { itemTags: true } } },
      orderBy: { name: 'asc' },
    });

    res.json({ tags });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// GET /goals/dashboard - 대시보드 (태그별 진행률, Gantt 데이터)
goalRoutes.get('/dashboard', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    // 팀 내 모든 목표
    const allGoals = await prisma.item.findMany({
      where: {
        OR: [
          { level: 'TEAM', ownerId: user.teamId },
          { level: 'GROUP', ownerId: { in: (await prisma.group.findMany({ where: { teamId: user.teamId }, select: { id: true } })).map(g => g.id) } },
          { level: 'PART', ownerId: { in: (await prisma.part.findMany({ where: { group: { teamId: user.teamId } }, select: { id: true } })).map(p => p.id) } },
        ],
      },
      include: {
        itemTags: { include: { tag: true } },
        parentItem: { select: { id: true, title: true, level: true } },
      },
    });

    // 태그별 진행률 집계
    const tagMap = new Map<string, { name: string; goals: typeof allGoals; avgProgress: number }>();
    for (const goal of allGoals) {
      for (const it of goal.itemTags) {
        if (!tagMap.has(it.tag.name)) {
          tagMap.set(it.tag.name, { name: it.tag.name, goals: [], avgProgress: 0 });
        }
        tagMap.get(it.tag.name)!.goals.push(goal);
      }
    }
    for (const [, data] of tagMap) {
      data.avgProgress = data.goals.length > 0
        ? Math.round(data.goals.reduce((sum, g) => sum + g.progress, 0) / data.goals.length)
        : 0;
    }

    const tagProgress = Array.from(tagMap.values()).map(({ name, goals, avgProgress }) => ({
      tag: name,
      count: goals.length,
      avgProgress,
      completed: goals.filter(g => g.status === 'COMPLETED').length,
    }));

    // Gantt 데이터
    const ganttData = allGoals
      .filter(g => g.startDate || g.endDate)
      .map(g => ({
        id: g.id,
        title: g.title,
        level: g.level,
        status: g.status,
        progress: g.progress,
        startDate: g.startDate,
        endDate: g.endDate,
        tags: g.itemTags.map(it => it.tag.name),
        parentItem: g.parentItem || null,
      }));

    res.json({ tagProgress, ganttData, totalGoals: allGoals.length });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

// GET /goals/:id - 목표 상세
goalRoutes.get('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const goal = await prisma.item.findUnique({
      where: { id },
      include: {
        itemTags: { include: { tag: true } },
        childItems: {
          include: { itemTags: { include: { tag: true } } },
          orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
        },
        parentItem: { select: { id: true, title: true, level: true } },
        linkedWorkLogs: {
          select: { id: true, title: true, date: true, user: { select: { username: true } } },
          orderBy: { date: 'desc' },
          take: 20,
        },
        linkedTodos: {
          select: { id: true, title: true, completed: true, endDate: true, user: { select: { username: true } } },
          orderBy: { completed: 'asc' },
        },
      },
    });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    res.json({ goal });
  } catch (error) {
    console.error('Get goal error:', error);
    res.status(500).json({ error: 'Failed to get goal' });
  }
});

// PUT /goals/:id - 목표 수정 (LLM 안 탐)
goalRoutes.put('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const { title, content, status, startDate, endDate, progress, summary, tags } = req.body;

    const goal = await prisma.item.findUnique({ where: { id } });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (status !== undefined && ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(status)) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (progress !== undefined) updateData.progress = Math.max(0, Math.min(100, Number(progress)));
    if (summary !== undefined) updateData.summary = summary;

    const updated = await prisma.item.update({ where: { id }, data: updateData });

    // 태그 업데이트
    if (tags !== undefined && Array.isArray(tags)) {
      const user = req.dbUser!;
      if (user.teamId) {
        // 기존 태그 삭제
        await prisma.itemTag.deleteMany({ where: { itemId: id } });
        // 새 태그 연결
        for (const tagName of tags) {
          const tag = await prisma.tag.upsert({
            where: { name_teamId: { name: tagName, teamId: user.teamId } },
            update: {},
            create: { name: tagName, teamId: user.teamId },
          });
          await prisma.itemTag.create({ data: { itemId: id, tagId: tag.id } });
        }
      }
    }

    const result = await prisma.item.findUnique({
      where: { id },
      include: { itemTags: { include: { tag: true } } },
    });

    res.json({ success: true, goal: result });
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// PUT /goals/:id/mapping - 매핑 수정
goalRoutes.put('/:id/mapping', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const { parentItemId, childItemIds } = req.body;

    const goal = await prisma.item.findUnique({ where: { id } });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    if (parentItemId !== undefined) {
      await prisma.item.update({ where: { id }, data: { parentItemId: parentItemId || null } });
    }

    if (childItemIds !== undefined && Array.isArray(childItemIds)) {
      // 기존 자식의 parentItemId 해제
      await prisma.item.updateMany({
        where: { parentItemId: id },
        data: { parentItemId: null },
      });
      // 새 자식 매핑
      for (const childId of childItemIds) {
        await prisma.item.update({
          where: { id: childId },
          data: { parentItemId: id },
        });
      }
    }

    const updated = await prisma.item.findUnique({
      where: { id },
      include: {
        parentItem: { select: { id: true, title: true } },
        childItems: { select: { id: true, title: true, progress: true, status: true } },
      },
    });

    res.json({ success: true, goal: updated });
  } catch (error) {
    console.error('Update mapping error:', error);
    res.status(500).json({ error: 'Failed to update mapping' });
  }
});

// DELETE /goals/:id - 목표 삭제
goalRoutes.delete('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const user = req.dbUser!;

    const goal = await prisma.item.findUnique({ where: { id } });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    // 자식 Item의 parentItemId 해제
    await prisma.item.updateMany({ where: { parentItemId: id }, data: { parentItemId: null } });
    // linkedWorkLog/Todo 연결 해제
    await prisma.workLog.updateMany({ where: { linkedItemId: id }, data: { linkedItemId: null } });
    await prisma.todo.updateMany({ where: { linkedItemId: id }, data: { linkedItemId: null } });
    // ItemTag 삭제
    await prisma.itemTag.deleteMany({ where: { itemId: id } });
    // 목표 삭제
    await prisma.item.delete({ where: { id } });

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'DELETE_GOAL', targetType: 'GOAL', targetId: id, details: goal.title },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete goal error:', error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});
