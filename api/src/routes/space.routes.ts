/**
 * Space Routes - 개인/파트/그룹/팀 Space 조회
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { generalLimit } from '../middleware/rateLimit.js';

export const spaceRoutes = Router();

function getDateRange7Days(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// GET /spaces/personal - 내 개인 Space
spaceRoutes.get('/personal', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { start, end } = getDateRange7Days();

    const space = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    if (!space) { res.status(404).json({ error: 'Personal space not found' }); return; }

    const items = await prisma.item.findMany({
      where: {
        userId: user.id,
        spaceId: space.id,
        date: { gte: start, lte: end },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const reports = await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ space, items, reports, user: { id: user.id, username: user.username, loginid: user.loginid } });
  } catch (error) {
    console.error('Get personal space error:', error);
    res.status(500).json({ error: 'Failed to get personal space' });
  }
});

// GET /spaces/personal/:userId - 특정 사용자 개인 Space (팀 내 전체 조회 가능)
spaceRoutes.get('/personal/:userId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = req.dbUser!;
    const userId = req.params.userId as string;
    const date = req.query.date as string | undefined;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: true, group: true, part: true },
    });
    if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }

    // 팀 내 접근 권한 체크
    if (targetUser.teamId !== currentUser.teamId) {
      res.status(403).json({ error: '같은 팀의 사용자만 조회할 수 있습니다.' });
      return;
    }

    const { start, end } = getDateRange7Days();

    const space = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: userId },
    });
    if (!space) { res.status(404).json({ error: 'Personal space not found' }); return; }

    const items = await prisma.item.findMany({
      where: {
        userId,
        spaceId: space.id,
        date: { gte: start, lte: end },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      space,
      items,
      user: {
        id: targetUser.id, username: targetUser.username,
        loginid: targetUser.loginid, groupName: targetUser.group?.name,
        partName: targetUser.part?.name,
      },
    });
  } catch (error) {
    console.error('Get user space error:', error);
    res.status(500).json({ error: 'Failed to get user space' });
  }
});

// GET /spaces/part/:partId - 파트 Space
spaceRoutes.get('/part/:partId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = req.dbUser!;
    const partId = req.params.partId as string;

    const part = await prisma.part.findUnique({
      where: { id: partId },
      include: { group: { include: { team: true } } },
    });
    if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

    // 팀 내 접근 권한 체크
    if (part.group.teamId !== currentUser.teamId) {
      res.status(403).json({ error: '같은 팀의 파트만 조회할 수 있습니다.' });
      return;
    }

    const { start, end } = getDateRange7Days();

    // 파트 내 모든 사용자의 item
    const users = await prisma.user.findMany({
      where: { partId },
      select: { id: true, username: true, loginid: true },
    });

    const userIds = users.map(u => u.id);
    const items = await prisma.item.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: start, lte: end },
      },
      include: { user: { select: { id: true, username: true, loginid: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    // 파트 Space의 보고서
    const space = await prisma.space.findFirst({
      where: { type: 'PART', ownerId: partId },
    });

    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    res.json({ part, users, items, reports, space });
  } catch (error) {
    console.error('Get part space error:', error);
    res.status(500).json({ error: 'Failed to get part space' });
  }
});

// GET /spaces/group/:groupId - 그룹 Space
spaceRoutes.get('/group/:groupId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = req.dbUser!;
    const groupId = req.params.groupId as string;

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { team: true, parts: true },
    });
    if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

    if (group.teamId !== currentUser.teamId) {
      res.status(403).json({ error: '같은 팀의 그룹만 조회할 수 있습니다.' });
      return;
    }

    const { start, end } = getDateRange7Days();

    // 그룹 내 모든 파트의 item (title만)
    const parts = await prisma.part.findMany({
      where: { groupId },
      include: {
        users: { select: { id: true } },
      },
    });

    const allUserIds = parts.flatMap(p => p.users.map(u => u.id));
    const items = await prisma.item.findMany({
      where: {
        userId: { in: allUserIds },
        date: { gte: start, lte: end },
      },
      include: {
        user: { select: { id: true, username: true, loginid: true, partId: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const space = await prisma.space.findFirst({
      where: { type: 'GROUP', ownerId: groupId },
    });

    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    res.json({ group, parts, items, reports, space });
  } catch (error) {
    console.error('Get group space error:', error);
    res.status(500).json({ error: 'Failed to get group space' });
  }
});

// GET /spaces/team - 팀 Space
spaceRoutes.get('/team', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const team = await prisma.team.findUnique({
      where: { id: user.teamId },
      include: {
        groups: {
          include: {
            parts: true,
          },
        },
      },
    });
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const { start, end } = getDateRange7Days();

    // 팀 내 모든 그룹의 item
    const teamUsers = await prisma.user.findMany({
      where: { teamId: user.teamId },
      select: { id: true },
    });
    const userIds = teamUsers.map(u => u.id);

    const items = await prisma.item.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: start, lte: end },
      },
      include: {
        user: {
          select: {
            id: true, username: true, loginid: true,
            groupId: true, partId: true,
            group: { select: { id: true, name: true } },
            part: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const space = await prisma.space.findFirst({
      where: { type: 'TEAM', ownerId: user.teamId },
    });

    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    // 실패한 보고서 job 확인
    const failedJob = await prisma.reportJob.findFirst({
      where: { teamId: user.teamId, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
    });

    // 공지 조회
    const announcement = await prisma.announcement.findUnique({
      where: { teamId: user.teamId },
      include: { author: { select: { username: true, loginid: true } } },
    });

    res.json({ team, items, reports, space, failedJob, announcement });
  } catch (error) {
    console.error('Get team space error:', error);
    res.status(500).json({ error: 'Failed to get team space' });
  }
});
