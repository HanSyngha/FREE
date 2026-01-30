/**
 * Team Admin Routes
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireTeamAdminOrHigher, loadUser } from '../middleware/auth.js';
import { generalLimit } from '../middleware/rateLimit.js';

export const teamAdminRoutes = Router();

// GET /team-admin/users - 팀 내 사용자 목록
teamAdminRoutes.get('/users', authenticateToken, requireTeamAdminOrHigher, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { groupId, partId, teamId: queryTeamId } = req.query;

    // Super Admin은 teamId 쿼리 파라미터로 다른 팀 조회 가능
    // Team Admin은 자신이 관리하는 팀만 조회 가능
    let targetTeamId = user.teamId;
    if (req.isSuperAdmin && queryTeamId) {
      targetTeamId = queryTeamId as string;
    } else if (req.isTeamAdmin && queryTeamId && req.teamAdminTeamIds?.includes(queryTeamId as string)) {
      targetTeamId = queryTeamId as string;
    }

    if (!targetTeamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    // Team Admin은 관리 권한이 있는 팀만 접근 가능
    if (req.isTeamAdmin && !req.isSuperAdmin && !req.teamAdminTeamIds?.includes(targetTeamId)) {
      res.status(403).json({ error: '해당 팀에 대한 관리 권한이 없습니다.' });
      return;
    }

    const where: any = { teamId: targetTeamId };
    if (groupId) where.groupId = groupId;
    if (partId) where.partId = partId;

    const users = await prisma.user.findMany({
      where,
      include: {
        group: { select: { id: true, name: true } },
        part: { select: { id: true, name: true } },
      },
      orderBy: { username: 'asc' },
    });

    // 그룹/파트 드롭다운 데이터
    const groups = await prisma.group.findMany({
      where: { teamId: targetTeamId },
      orderBy: { name: 'asc' },
    });
    const parts = groupId
      ? await prisma.part.findMany({
          where: { groupId: groupId as string },
          orderBy: { name: 'asc' },
        })
      : [];

    res.json({ users, groups, parts });
  } catch (error) {
    console.error('Get team users error:', error);
    res.status(500).json({ error: 'Failed to get team users' });
  }
});

// GET /team-admin/report-logs - 보고서 생성 로그
teamAdminRoutes.get('/report-logs', authenticateToken, requireTeamAdminOrHigher, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { teamId: queryTeamId } = req.query;

    // Super Admin은 teamId 쿼리 파라미터로 다른 팀 조회 가능
    // Team Admin은 자신이 관리하는 팀만 조회 가능
    let targetTeamId = user.teamId;
    if (req.isSuperAdmin && queryTeamId) {
      targetTeamId = queryTeamId as string;
    } else if (req.isTeamAdmin && queryTeamId && req.teamAdminTeamIds?.includes(queryTeamId as string)) {
      targetTeamId = queryTeamId as string;
    }

    if (!targetTeamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    // Team Admin은 관리 권한이 있는 팀만 접근 가능
    if (req.isTeamAdmin && !req.isSuperAdmin && !req.teamAdminTeamIds?.includes(targetTeamId)) {
      res.status(403).json({ error: '해당 팀에 대한 관리 권한이 없습니다.' });
      return;
    }

    const logs = await prisma.reportLog.findMany({
      where: { teamId: targetTeamId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ logs });
  } catch (error) {
    console.error('Get report logs error:', error);
    res.status(500).json({ error: 'Failed to get report logs' });
  }
});
