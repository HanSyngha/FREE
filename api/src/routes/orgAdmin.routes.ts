/**
 * OrgAdmin Routes - 조직 관리 권한 CRUD
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireTeamAdminOrHigher } from '../middleware/auth.js';

export const orgAdminRoutes = Router();

// GET /org-admin - OrgAdmin 목록
orgAdminRoutes.get('/', authenticateToken, requireTeamAdminOrHigher, async (req: AuthenticatedRequest, res) => {
  try {
    const orgAdmins = await prisma.orgAdmin.findMany({
      include: {
        user: { select: { id: true, loginid: true, username: true, teamId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ orgAdmins });
  } catch (error) {
    console.error('Get org admins error:', error);
    res.status(500).json({ error: 'Failed to get org admins' });
  }
});

// POST /org-admin - OrgAdmin 지정
orgAdminRoutes.post('/', authenticateToken, requireTeamAdminOrHigher, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, level, targetId } = req.body;
    if (!userId || !level || !targetId) {
      res.status(400).json({ error: 'userId, level, targetId는 필수입니다.' });
      return;
    }
    if (!['TEAM', 'GROUP', 'PART'].includes(level)) {
      res.status(400).json({ error: 'level은 TEAM/GROUP/PART 중 하나여야 합니다.' });
      return;
    }

    const existing = await prisma.orgAdmin.findUnique({
      where: { userId_level_targetId: { userId, level, targetId } },
    });
    if (existing) { res.status(409).json({ error: '이미 해당 권한이 부여되어 있습니다.' }); return; }

    const orgAdmin = await prisma.orgAdmin.create({
      data: { userId, level: level as any, targetId },
      include: { user: { select: { id: true, loginid: true, username: true } } },
    });

    res.json({ success: true, orgAdmin });
  } catch (error) {
    console.error('Add org admin error:', error);
    res.status(500).json({ error: 'Failed to add org admin' });
  }
});

// DELETE /org-admin/:id - OrgAdmin 해제
orgAdminRoutes.delete('/:id', authenticateToken, requireTeamAdminOrHigher, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    await prisma.orgAdmin.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Remove org admin error:', error);
    res.status(500).json({ error: 'Failed to remove org admin' });
  }
});
