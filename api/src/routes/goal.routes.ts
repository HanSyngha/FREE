/**
 * Goal Routes - 조직 목표 CRUD + LLM 입력 + 자동 매핑
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser, requireGoalEdit } from '../middleware/auth.js';
import { llmLimit } from '../middleware/rateLimit.js';
import { parseGoalsWithLLM, autoMapNewGoal, autoMapTodosAndWorkLogs } from '../services/llm.service.js';
import { parseDateForDB } from '../utils/date.js';

export const goalRoutes = Router();

// POST /goals - 조직장 Item 입력 (LLM 분리+매핑)
goalRoutes.post('/', authenticateToken, loadUser, llmLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { text, level, ownerId } = req.body;

    if (!text || typeof text !== 'string') { res.status(400).json({ error: '텍스트를 입력해 주세요.' }); return; }
    if (!level || !['TEAM', 'GROUP', 'PART'].includes(level)) { res.status(400).json({ error: 'level은 TEAM/GROUP/PART 중 하나여야 합니다.' }); return; }
    if (!ownerId) { res.status(400).json({ error: 'ownerId는 필수입니다.' }); return; }

    if (!user.teamId) { res.status(400).json({ error: '팀이 배정되지 않았습니다.' }); return; }

    // 기존 상위/하위 Item 리스트 조회
    const existingItems = await prisma.item.findMany({
      where: { level, ownerId },
      select: { id: true, title: true, status: true },
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
      parentItems,
    }, userInfo);

    // 목표 생성
    const createdGoals = [];
    for (const goal of parsedGoals) {
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
          startDate: goal.startDate ? parseDateForDB(goal.startDate) : null,
          endDate: goal.endDate ? parseDateForDB(goal.endDate) : null,
          level: level as any,
          ownerId,
          parentItemId,
        },
        include: {
          childItems: { select: { id: true, title: true, progress: true, status: true, level: true } },
          parentItem: { select: { id: true, title: true, level: true } },
        },
      });

      createdGoals.push(created);

      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CREATE_GOAL', targetType: 'GOAL', targetId: created.id, details: created.title },
      });

      // 자동 하위 매핑 (비동기, 에러 무시)
      autoMapChildItems(created, level, userInfo).catch(e =>
        console.error('[AutoMap] Error:', e.message)
      );
    }

    res.json({ success: true, goals: createdGoals });
  } catch (error: any) {
    console.error('Create goals error:', error);
    res.status(500).json({ error: '목표 생성에 실패했습니다.' });
  }
});

/** 새로 생성된 목표에 대해 미매핑 하위 Item 자동 연결 */
async function autoMapChildItems(
  created: { id: string; title: string; content: string },
  level: string,
  userInfo: { loginid: string; username: string; deptname: string }
) {
  let childLevel: string | null = null;
  let childOwnerIds: string[] = [];

  if (level === 'TEAM') {
    childLevel = 'GROUP';
    // 해당 팀의 모든 그룹
    const item = await prisma.item.findUnique({ where: { id: created.id } });
    if (!item) return;
    const groups = await prisma.group.findMany({ where: { teamId: item.ownerId }, select: { id: true } });
    childOwnerIds = groups.map(g => g.id);
  } else if (level === 'GROUP') {
    childLevel = 'PART';
    const item = await prisma.item.findUnique({ where: { id: created.id } });
    if (!item) return;
    const parts = await prisma.part.findMany({ where: { groupId: item.ownerId }, select: { id: true } });
    childOwnerIds = parts.map(p => p.id);
  } else if (level === 'PART') {
    // PART 목표 → 미매핑 Todo/WorkLog 연결
    const item = await prisma.item.findUnique({ where: { id: created.id } });
    if (!item) return;
    const partUsers = await prisma.user.findMany({ where: { partId: item.ownerId }, select: { id: true } });
    const userIds = partUsers.map(u => u.id);

    const unmappedTodos = await prisma.todo.findMany({
      where: { userId: { in: userIds }, linkedItemId: null, completed: false },
      select: { id: true, title: true },
      take: 50,
    });
    const unmappedWorkLogs = await prisma.workLog.findMany({
      where: { userId: { in: userIds }, linkedItemId: null },
      select: { id: true, title: true },
      orderBy: { date: 'desc' },
      take: 50,
    });

    if (unmappedTodos.length === 0 && unmappedWorkLogs.length === 0) return;

    const result = await autoMapTodosAndWorkLogs(
      { id: created.id, title: created.title, content: created.content },
      unmappedTodos, unmappedWorkLogs, userInfo
    );

    if (result.todoIds.length > 0) {
      await prisma.todo.updateMany({
        where: { id: { in: result.todoIds } },
        data: { linkedItemId: created.id },
      });
    }
    if (result.workLogIds.length > 0) {
      await prisma.workLog.updateMany({
        where: { id: { in: result.workLogIds } },
        data: { linkedItemId: created.id },
      });
    }
    return;
  }

  if (!childLevel || childOwnerIds.length === 0) return;

  const unmappedChildren = await prisma.item.findMany({
    where: { level: childLevel as any, ownerId: { in: childOwnerIds }, parentItemId: null },
    select: { id: true, title: true },
    take: 50,
  });

  if (unmappedChildren.length === 0) return;

  const result = await autoMapNewGoal(
    { id: created.id, title: created.title, content: created.content, level },
    unmappedChildren, userInfo
  );

  if (result.childItemIds.length > 0) {
    await prisma.item.updateMany({
      where: { id: { in: result.childItemIds } },
      data: { parentItemId: created.id },
    });
  }
}

// GET /goals - 목표 목록 (level, ownerId, status 필터)
goalRoutes.get('/', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { level, ownerId, status } = req.query;

    const where: any = {};
    if (level) where.level = level;
    if (ownerId) where.ownerId = ownerId;
    if (status) where.status = status;

    const goals = await prisma.item.findMany({
      where,
      include: {
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

// GET /goals/:id - 목표 상세
goalRoutes.get('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const goal = await prisma.item.findUnique({
      where: { id },
      include: {
        childItems: {
          orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
          select: { id: true, title: true, progress: true, status: true, level: true, ownerId: true },
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

// PUT /goals/:id - 목표 수정
goalRoutes.put('/:id', authenticateToken, loadUser, requireGoalEdit(), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const { title, content, status, startDate, endDate, progress, summary } = req.body;

    const goal = await prisma.item.findUnique({ where: { id } });
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (status !== undefined && ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(status)) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate ? parseDateForDB(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? parseDateForDB(endDate) : null;
    if (progress !== undefined) updateData.progress = Math.max(0, Math.min(100, Number(progress)));
    if (summary !== undefined) updateData.summary = summary;

    const updated = await prisma.item.update({ where: { id }, data: updateData });

    // title/content 변경 시 자동 재매핑 트리거 (비동기)
    if (updateData.title || updateData.content) {
      const userInfo = { loginid: req.dbUser!.loginid, username: req.dbUser!.username, deptname: req.dbUser!.deptname };
      autoMapChildItems(
        { id: updated.id, title: updated.title, content: updated.content },
        updated.level, userInfo
      ).catch(e => console.error('[AutoMap] Re-map error:', e.message));
    }

    const result = await prisma.item.findUnique({
      where: { id },
      include: {
        childItems: { select: { id: true, title: true, progress: true, status: true, level: true } },
        parentItem: { select: { id: true, title: true, level: true } },
      },
    });

    res.json({ success: true, goal: result });
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// PUT /goals/:id/mapping - 매핑 수정
goalRoutes.put('/:id/mapping', authenticateToken, loadUser, requireGoalEdit(), async (req: AuthenticatedRequest, res) => {
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
goalRoutes.delete('/:id', authenticateToken, loadUser, requireGoalEdit(), async (req: AuthenticatedRequest, res) => {
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
