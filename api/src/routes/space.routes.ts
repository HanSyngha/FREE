/**
 * Space Routes - 개인/파트/그룹/팀 Space 조회
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { generalLimit } from '../middleware/rateLimit.js';
import { getKSTTodayForDB } from '../utils/date.js';

export const spaceRoutes = Router();

function getDateRange7Days(): { start: Date; end: Date } {
  const end = getKSTTodayForDB();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start, end };
}

// GET /spaces/personal - 내 개인 Space
spaceRoutes.get('/personal', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { start, end } = getDateRange7Days();

    const space = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!space) { res.status(404).json({ error: 'Personal space not found' }); return; }

    const workLogs = await prisma.workLog.findMany({
      where: { userId: user.id, spaceId: space.id, date: { gte: start, lte: end } },
      include: { linkedItem: { select: { id: true, title: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const todos = await prisma.todo.findMany({
      where: { userId: user.id, spaceId: space.id },
      include: { linkedItem: { select: { id: true, title: true } } },
      orderBy: [{ completed: 'asc' }, { endDate: 'asc' }, { createdAt: 'desc' }],
    });

    const reports = await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      space,
      items: workLogs, // 하위 호환
      workLogs,
      todos,
      reports,
      user: { id: user.id, username: user.username, loginid: user.loginid },
    });
  } catch (error) {
    console.error('Get personal space error:', error);
    res.status(500).json({ error: 'Failed to get personal space' });
  }
});

// GET /spaces/personal/:userId - 특정 사용자 개인 Space
spaceRoutes.get('/personal/:userId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = req.dbUser!;
    const userId = req.params.userId as string;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: true, group: true, part: true },
    });
    if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }

    if (targetUser.teamId !== currentUser.teamId) {
      res.status(403).json({ error: '같은 팀의 사용자만 조회할 수 있습니다.' });
      return;
    }

    const { start, end } = getDateRange7Days();

    const space = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: userId } });
    if (!space) { res.status(404).json({ error: 'Personal space not found' }); return; }

    const workLogs = await prisma.workLog.findMany({
      where: { userId, spaceId: space.id, date: { gte: start, lte: end } },
      include: { linkedItem: { select: { id: true, title: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      space,
      items: workLogs,
      workLogs,
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

    if (part.group.teamId !== currentUser.teamId) {
      res.status(403).json({ error: '같은 팀의 파트만 조회할 수 있습니다.' });
      return;
    }

    const { start, end } = getDateRange7Days();

    const users = await prisma.user.findMany({
      where: { partId },
      select: { id: true, username: true, loginid: true },
    });

    const userIds = users.map(u => u.id);
    const workLogs = await prisma.workLog.findMany({
      where: { userId: { in: userIds }, date: { gte: start, lte: end } },
      include: {
        user: { select: { id: true, username: true, loginid: true } },
        linkedItem: { select: { id: true, title: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    // 파트 목표(Item) 조회
    const goals = await prisma.item.findMany({
      where: { level: 'PART', ownerId: partId },
      include: {
        parentItem: { select: { id: true, title: true, level: true } },
        linkedTodos: {
          select: { id: true, title: true, completed: true, endDate: true, user: { select: { id: true, username: true } } },
          orderBy: { completed: 'asc' },
        },
        linkedWorkLogs: {
          select: { id: true, title: true, date: true, user: { select: { id: true, username: true } } },
          orderBy: { date: 'desc' },
          take: 20,
        },
        orgWorkLogs: { orderBy: { date: 'desc' }, take: 7 },
      },
      orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
    });

    const space = await prisma.space.findFirst({ where: { type: 'PART', ownerId: partId } });
    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    res.json({ part, users, items: workLogs, workLogs, goals, reports, space });
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

    const parts = await prisma.part.findMany({
      where: { groupId },
      include: { users: { select: { id: true } } },
    });

    const allUserIds = parts.flatMap(p => p.users.map(u => u.id));
    const workLogs = await prisma.workLog.findMany({
      where: { userId: { in: allUserIds }, date: { gte: start, lte: end } },
      include: {
        user: { select: { id: true, username: true, loginid: true, partId: true } },
        linkedItem: { select: { id: true, title: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    // 그룹 목표 + 하위 파트 목표
    const goals = await prisma.item.findMany({
      where: { level: 'GROUP', ownerId: groupId },
      include: {
        childItems: { select: { id: true, title: true, progress: true, status: true, level: true, ownerId: true } },
        parentItem: { select: { id: true, title: true, level: true } },
        orgWorkLogs: { orderBy: { date: 'desc' }, take: 7 },
      },
      orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
    });

    // childOrgNames: partId → partName
    const partOwnerIds = new Set<string>();
    goals.forEach(g => g.childItems.forEach(c => { if (c.level === 'PART') partOwnerIds.add(c.ownerId); }));
    const childOrgNames: Record<string, string> = {};
    if (partOwnerIds.size > 0) {
      const partsForNames = await prisma.part.findMany({
        where: { id: { in: [...partOwnerIds] } },
        select: { id: true, name: true },
      });
      partsForNames.forEach(p => { childOrgNames[p.id] = p.name; });
    }

    const space = await prisma.space.findFirst({ where: { type: 'GROUP', ownerId: groupId } });
    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    res.json({ group, parts, items: workLogs, workLogs, goals, childOrgNames, reports, space });
  } catch (error) {
    console.error('Get group space error:', error);
    res.status(500).json({ error: 'Failed to get group space' });
  }
});

// GET /spaces/bu/:buId - 사업부 Space
spaceRoutes.get('/bu/:buId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const buId = req.params.buId as string;

    const bu = await prisma.businessUnit.findUnique({
      where: { id: buId },
      include: {
        teams: {
          orderBy: { name: 'asc' },
          include: {
            groups: {
              orderBy: { name: 'asc' },
              include: { parts: { orderBy: { name: 'asc' } } },
            },
          },
        },
      },
    });
    if (!bu) { res.status(404).json({ error: 'Business unit not found' }); return; }

    const goals = await prisma.item.findMany({
      where: { level: 'BU', ownerId: buId },
      include: {
        childItems: {
          select: { id: true, title: true, progress: true, status: true, level: true, ownerId: true },
        },
        orgWorkLogs: {
          orderBy: { date: 'desc' },
          take: 7,
        },
      },
      orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
    });

    // 하위 Team 목표의 조직명 맵
    const teamGoalOwnerIds = new Set<string>();
    goals.forEach(g => g.childItems.forEach(c => teamGoalOwnerIds.add(c.ownerId)));
    const childOrgNames: Record<string, string> = {};
    if (teamGoalOwnerIds.size > 0) {
      const teams = await prisma.team.findMany({
        where: { id: { in: [...teamGoalOwnerIds] } },
        select: { id: true, name: true },
      });
      teams.forEach(t => { childOrgNames[t.id] = t.name; });
    }

    res.json({ bu, goals, childOrgNames });
  } catch (error) {
    console.error('Get BU space error:', error);
    res.status(500).json({ error: 'Failed to get BU space' });
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
        businessUnit: true,
        groups: {
          orderBy: { name: 'asc' },
          include: {
            parts: {
              orderBy: { name: 'asc' },
              include: {
                users: {
                  select: { id: true, username: true, loginid: true },
                  orderBy: { username: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const { start, end } = getDateRange7Days();

    const teamUsers = await prisma.user.findMany({
      where: { teamId: user.teamId },
      select: { id: true },
    });
    const userIds = teamUsers.map(u => u.id);

    const workLogs = await prisma.workLog.findMany({
      where: { userId: { in: userIds }, date: { gte: start, lte: end } },
      include: {
        user: {
          select: {
            id: true, username: true, loginid: true,
            groupId: true, partId: true,
            group: { select: { id: true, name: true } },
            part: { select: { id: true, name: true } },
          },
        },
        linkedItem: { select: { id: true, title: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    // 팀 목표 + 하위 그룹 목표
    const goals = await prisma.item.findMany({
      where: { level: 'TEAM', ownerId: user.teamId },
      include: {
        childItems: { select: { id: true, title: true, progress: true, status: true, level: true, ownerId: true } },
        parentItem: { select: { id: true, title: true, level: true } },
        orgWorkLogs: { orderBy: { date: 'desc' }, take: 7 },
      },
      orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
    });

    // childOrgNames: groupId → groupName
    const groupOwnerIds = new Set<string>();
    goals.forEach(g => g.childItems.forEach(c => { if (c.level === 'GROUP') groupOwnerIds.add(c.ownerId); }));
    const childOrgNames: Record<string, string> = {};
    if (groupOwnerIds.size > 0) {
      const groups = await prisma.group.findMany({
        where: { id: { in: [...groupOwnerIds] } },
        select: { id: true, name: true },
      });
      groups.forEach(g => { childOrgNames[g.id] = g.name; });
    }

    const space = await prisma.space.findFirst({ where: { type: 'TEAM', ownerId: user.teamId } });
    const reports = space ? await prisma.report.findMany({
      where: { spaceId: space.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }) : [];

    const failedJob = await prisma.reportJob.findFirst({
      where: { teamId: user.teamId, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
    });

    const announcement = await prisma.announcement.findUnique({
      where: { teamId: user.teamId },
      include: { author: { select: { username: true, loginid: true } } },
    });

    res.json({ team, items: workLogs, workLogs, goals, childOrgNames, reports, space, failedJob, announcement });
  } catch (error) {
    console.error('Get team space error:', error);
    res.status(500).json({ error: 'Failed to get team space' });
  }
});
