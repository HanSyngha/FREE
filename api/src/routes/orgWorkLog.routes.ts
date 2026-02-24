/**
 * OrgWorkLog Routes - 조직 업무 기록 조회/수정
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser, requireGoalEdit } from '../middleware/auth.js';

export const orgWorkLogRoutes = Router();

// GET /org-worklogs?goalId= - 목표별 OrgWorkLog 조회
orgWorkLogRoutes.get('/', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { goalId, level, ownerId } = req.query;

    const where: any = {};
    if (goalId) where.goalId = goalId;
    if (level) where.level = level;
    if (ownerId) where.ownerId = ownerId;

    const orgWorkLogs = await prisma.orgWorkLog.findMany({
      where,
      include: { goal: { select: { id: true, title: true, level: true } } },
      orderBy: { date: 'desc' },
      take: 30,
    });

    res.json({ orgWorkLogs });
  } catch (error) {
    console.error('Get org work logs error:', error);
    res.status(500).json({ error: 'Failed to get org work logs' });
  }
});

// PUT /org-worklogs/:id - OrgWorkLog 수정
orgWorkLogRoutes.put('/:id', authenticateToken, loadUser, requireGoalEdit(), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content는 필수입니다.' });
      return;
    }

    const existing = await prisma.orgWorkLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'OrgWorkLog not found' }); return; }

    const updated = await prisma.orgWorkLog.update({
      where: { id },
      data: { content },
    });

    res.json({ success: true, orgWorkLog: updated });
  } catch (error) {
    console.error('Update org work log error:', error);
    res.status(500).json({ error: 'Failed to update org work log' });
  }
});
