/**
 * Profile Routes - 프로필 및 설정
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { generalLimit } from '../middleware/rateLimit.js';

export const profileRoutes = Router();

// GET /profile - 내 프로필 정보
profileRoutes.get('/', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        team: { select: { id: true, name: true, businessUnit: true } },
        group: { select: { id: true, name: true } },
        part: { select: { id: true, name: true } },
      },
    });

    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    res.json({
      user: {
        id: user.id,
        loginid: user.loginid,
        username: user.username,
        deptname: user.deptname,
        businessUnit: user.businessUnit,
        team: user.team,
        group: user.group,
        part: user.part,
        createdAt: user.createdAt,
        lastActive: user.lastActive,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /profile/organization - 그룹/파트 변경
profileRoutes.put('/organization', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const { groupId, groupName, partId, partName } = req.body;

    let finalGroupId = groupId;
    let finalPartId = partId;

    // 신규 그룹
    if (!groupId && groupName) {
      const existing = await prisma.group.findUnique({
        where: { name_teamId: { name: groupName, teamId: user.teamId } },
      });
      if (existing) { res.status(409).json({ error: '같은 이름의 그룹이 이미 존재합니다.' }); return; }
      const newGroup = await prisma.group.create({ data: { name: groupName, teamId: user.teamId } });
      await prisma.space.create({ data: { type: 'GROUP', ownerId: newGroup.id, teamId: user.teamId } });
      finalGroupId = newGroup.id;
    }

    if (!finalGroupId) { res.status(400).json({ error: 'Group selection required' }); return; }

    // 신규 파트
    if (!partId && partName) {
      const existing = await prisma.part.findUnique({
        where: { name_groupId: { name: partName, groupId: finalGroupId } },
      });
      if (existing) { res.status(409).json({ error: '같은 이름의 파트가 이미 존재합니다.' }); return; }
      const newPart = await prisma.part.create({ data: { name: partName, groupId: finalGroupId } });
      await prisma.space.create({ data: { type: 'PART', ownerId: newPart.id, teamId: user.teamId } });
      finalPartId = newPart.id;
    }

    if (!finalPartId) { res.status(400).json({ error: 'Part selection required' }); return; }

    const oldGroupId = user.groupId;
    const oldPartId = user.partId;

    // User 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { groupId: finalGroupId, partId: finalPartId },
    });

    // 활동 로그
    if (oldGroupId !== finalGroupId) {
      const oldGroup = oldGroupId ? await prisma.group.findUnique({ where: { id: oldGroupId } }) : null;
      const newGroup = await prisma.group.findUnique({ where: { id: finalGroupId } });
      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CHANGE_GROUP', targetType: 'GROUP', targetId: finalGroupId, details: `${oldGroup?.name || '없음'} → ${newGroup?.name}` },
      });
    }
    if (oldPartId !== finalPartId) {
      const oldPart = oldPartId ? await prisma.part.findUnique({ where: { id: oldPartId } }) : null;
      const newPart = await prisma.part.findUnique({ where: { id: finalPartId } });
      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CHANGE_PART', targetType: 'PART', targetId: finalPartId, details: `${oldPart?.name || '없음'} → ${newPart?.name}` },
      });
    }

    // 빈 그룹/파트 자동 삭제 (트랜잭션으로 race condition 방지)
    if (oldPartId && oldPartId !== finalPartId) {
      try {
        await prisma.$transaction(async (tx) => {
          const count = await tx.user.count({ where: { partId: oldPartId } });
          if (count === 0) {
            const spaces = await tx.space.findMany({ where: { type: 'PART', ownerId: oldPartId } });
            for (const s of spaces) {
              await tx.report.deleteMany({ where: { spaceId: s.id } });
            }
            await tx.space.deleteMany({ where: { type: 'PART', ownerId: oldPartId } });
            await tx.part.delete({ where: { id: oldPartId } });
          }
        });
      } catch { /* 동시 접근 시 무시 */ }
    }
    if (oldGroupId && oldGroupId !== finalGroupId) {
      try {
        await prisma.$transaction(async (tx) => {
          const userCount = await tx.user.count({ where: { groupId: oldGroupId } });
          if (userCount === 0) {
            const partCount = await tx.part.count({ where: { groupId: oldGroupId } });
            if (partCount === 0) {
              const spaces = await tx.space.findMany({ where: { type: 'GROUP', ownerId: oldGroupId } });
              for (const s of spaces) {
                await tx.report.deleteMany({ where: { spaceId: s.id } });
              }
              await tx.space.deleteMany({ where: { type: 'GROUP', ownerId: oldGroupId } });
              await tx.group.delete({ where: { id: oldGroupId } });
            }
          }
        });
      } catch { /* 동시 접근 시 무시 */ }
    }

    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { team: true, group: true, part: true },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// GET /profile/activity-log - 활동 로그 (최근 30일)
profileRoutes.get('/activity-log', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logs = await prisma.activityLog.findMany({
      where: {
        userId: req.userId!,
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ logs });
  } catch (error) {
    console.error('Get activity log error:', error);
    res.status(500).json({ error: 'Failed to get activity log' });
  }
});
