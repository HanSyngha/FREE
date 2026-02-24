/**
 * Auth Routes - OAuth 기반 인증
 */
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import {
  authenticateToken, AuthenticatedRequest, signToken,
  isSuperAdmin, checkAdminStatus,
} from '../middleware/auth.js';

export const authRoutes = Router();

// GET /auth/me
authRoutes.get('/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const user = await prisma.user.findUnique({
      where: { loginid: req.user.loginid },
      include: {
        team: { include: { businessUnit: true } },
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

    // Admin 체크 (DB 기반)
    let superAdmin = isSuperAdmin(user.loginid);
    if (!superAdmin && user.email) {
      const { isAdmin, adminRole } = await checkAdminStatus(user.email);
      if (isAdmin && adminRole === 'SUPER_ADMIN') superAdmin = true;
    }

    res.json({
      user: {
        id: user.id, loginid: user.loginid, username: user.username,
        deptname: user.deptname, businessUnit: user.businessUnit,
        email: user.email, profileImage: user.profileImage, provider: user.provider,
        teamId: user.teamId, groupId: user.groupId, partId: user.partId,
        teamName: user.team?.name || null,
        businessUnitId: user.team?.businessUnit?.id || null,
        businessUnitName: user.team?.businessUnit?.name || null,
        groupName: user.group?.name || null,
        partName: user.part?.name || null,
        createdAt: user.createdAt, lastActive: user.lastActive,
      },
      spaces: {
        personalSpaceId: personalSpace?.id || null,
        teamSpaceId: teamSpace?.id || null,
        teamId: user.teamId,
      },
      isSuperAdmin: superAdmin,
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
