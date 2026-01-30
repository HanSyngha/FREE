/**
 * Auth Routes - ONCE와 동일한 SSO 기반 인증
 */
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import {
  authenticateToken, AuthenticatedRequest, signToken,
  isSuperAdmin, extractBusinessUnit, extractTeamName,
} from '../middleware/auth.js';

export const authRoutes = Router();

function safeDecodeURIComponent(text: string): string {
  if (!text) return text;
  try {
    if (!text.includes('%')) return text;
    return decodeURIComponent(text);
  } catch { return text; }
}

/**
 * 사용자 및 Space 초기화
 */
async function initializeUserAndSpaces(loginid: string, username: string, deptname: string) {
  const businessUnit = extractBusinessUnit(deptname);
  const teamName = extractTeamName(deptname);

  // 1. User upsert
  const user = await prisma.user.upsert({
    where: { loginid },
    update: { deptname, username, businessUnit, lastActive: new Date() },
    create: { loginid, deptname, username, businessUnit },
  });

  // 2. Team 조회/생성
  let team = await prisma.team.findUnique({
    where: { name_businessUnit: { name: teamName, businessUnit } },
  });

  if (!team) {
    team = await prisma.team.create({
      data: { name: teamName, businessUnit },
    });
    // Team Space 생성
    await prisma.space.create({
      data: { type: 'TEAM', ownerId: team.id, teamId: team.id },
    });
  }

  // 3. User에 teamId 연결
  if (user.teamId !== team.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: { teamId: team.id },
    });
  }

  // 4. 개인 Space 생성
  let personalSpace = await prisma.space.findFirst({
    where: { type: 'PERSONAL', ownerId: user.id },
  });
  if (!personalSpace) {
    personalSpace = await prisma.space.create({
      data: { type: 'PERSONAL', ownerId: user.id, teamId: team.id },
    });
  }

  // Team Space 조회
  const teamSpace = await prisma.space.findFirst({
    where: { type: 'TEAM', ownerId: team.id },
  });

  // 그룹/파트 이름 조회
  const group = user.groupId ? await prisma.group.findUnique({ where: { id: user.groupId } }) : null;
  const part = user.partId ? await prisma.part.findUnique({ where: { id: user.partId } }) : null;

  return {
    user: {
      id: user.id, loginid: user.loginid, username: user.username,
      deptname: user.deptname, businessUnit,
      teamId: team.id, groupId: user.groupId, partId: user.partId,
      teamName, groupName: group?.name || null, partName: part?.name || null,
    },
    personalSpaceId: personalSpace.id,
    teamSpaceId: teamSpace?.id || null,
    teamId: team.id,
    teamName,
    needsOnboarding: !user.groupId || !user.partId,
  };
}

// POST /auth/login
authRoutes.post('/login', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const loginid = req.user.loginid;
    const deptname = safeDecodeURIComponent(req.user.deptname || '');
    const username = safeDecodeURIComponent(req.user.username || '');

    const result = await initializeUserAndSpaces(loginid, username, deptname);

    // Redis tracking
    await redis.set(`free:active:${loginid}`, Date.now().toString(), 'EX', 86400);

    const superAdmin = isSuperAdmin(loginid);
    let isTeamAdmin = false;
    if (result.teamId) {
      const ta = await prisma.teamAdmin.findUnique({
        where: { userId_teamId: { userId: result.user.id, teamId: result.teamId } },
      });
      isTeamAdmin = !!ta;
    }

    const sessionToken = signToken({ loginid, deptname, username });

    res.json({
      success: true,
      user: result.user,
      spaces: {
        personalSpaceId: result.personalSpaceId,
        teamSpaceId: result.teamSpaceId,
        teamId: result.teamId,
        teamName: result.teamName,
      },
      sessionToken,
      isSuperAdmin: superAdmin,
      isTeamAdmin,
      needsOnboarding: result.needsOnboarding,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me
authRoutes.get('/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const user = await prisma.user.findUnique({
      where: { loginid: req.user.loginid },
      include: {
        team: true,
        group: true,
        part: true,
        teamAdmins: { select: { teamId: true } },
      },
    });

    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    await prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } });

    const personalSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    const teamSpace = user.teamId
      ? await prisma.space.findFirst({ where: { type: 'TEAM', ownerId: user.teamId } })
      : null;

    res.json({
      user: {
        id: user.id, loginid: user.loginid, username: user.username,
        deptname: user.deptname, businessUnit: user.businessUnit,
        teamId: user.teamId, groupId: user.groupId, partId: user.partId,
        teamName: user.team?.name || null,
        groupName: user.group?.name || null,
        partName: user.part?.name || null,
        createdAt: user.createdAt, lastActive: user.lastActive,
      },
      spaces: {
        personalSpaceId: personalSpace?.id || null,
        teamSpaceId: teamSpace?.id || null,
        teamId: user.teamId,
      },
      isSuperAdmin: isSuperAdmin(user.loginid),
      isTeamAdmin: user.teamAdmins.length > 0,
      needsOnboarding: !user.groupId || !user.partId,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// POST /auth/refresh
authRoutes.post('/refresh', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { loginid, deptname, username } = req.user;
    res.json({ success: true, sessionToken: signToken({ loginid, deptname, username }) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// POST /auth/logout
authRoutes.post('/logout', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    await redis.del(`free:active:${req.user.loginid}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});
