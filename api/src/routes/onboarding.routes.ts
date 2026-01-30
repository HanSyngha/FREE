/**
 * Onboarding Routes - 최초 로그인 그룹/파트 선택
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { normalizeNameWithLLM } from '../services/llm.service.js';
import { llmLimit } from '../middleware/rateLimit.js';

export const onboardingRoutes = Router();

// GET /onboarding/groups - 팀 내 그룹 목록
onboardingRoutes.get('/groups', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const groups = await prisma.group.findMany({
      where: { teamId: user.teamId },
      orderBy: { name: 'asc' },
    });

    res.json({ groups });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// GET /onboarding/parts?groupId={id} - 그룹 내 파트 목록
onboardingRoutes.get('/parts', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.query;
    if (!groupId) { res.status(400).json({ error: 'groupId is required' }); return; }

    const parts = await prisma.part.findMany({
      where: { groupId: groupId as string },
      orderBy: { name: 'asc' },
    });

    res.json({ parts });
  } catch (error) {
    console.error('Get parts error:', error);
    res.status(500).json({ error: 'Failed to get parts' });
  }
});

// POST /onboarding/setup - 그룹/파트 선택 또는 신규 등록
onboardingRoutes.post('/setup', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const { groupId, groupName, partId, partName } = req.body;

    let finalGroupId = groupId;
    let finalPartId = partId;

    // 그룹 처리
    if (!groupId && groupName) {
      // 신규 그룹 생성
      const existing = await prisma.group.findUnique({
        where: { name_teamId: { name: groupName, teamId: user.teamId } },
      });
      if (existing) {
        res.status(409).json({ error: '같은 이름의 그룹이 이미 존재합니다.' });
        return;
      }
      const newGroup = await prisma.group.create({
        data: { name: groupName, teamId: user.teamId },
      });
      // Group Space 생성
      await prisma.space.create({
        data: { type: 'GROUP', ownerId: newGroup.id, teamId: user.teamId },
      });
      finalGroupId = newGroup.id;
    }

    if (!finalGroupId) { res.status(400).json({ error: 'Group selection required' }); return; }

    // 파트 처리
    if (!partId && partName) {
      const existing = await prisma.part.findUnique({
        where: { name_groupId: { name: partName, groupId: finalGroupId } },
      });
      if (existing) {
        res.status(409).json({ error: '같은 이름의 파트가 이미 존재합니다.' });
        return;
      }
      const newPart = await prisma.part.create({
        data: { name: partName, groupId: finalGroupId },
      });
      // Part Space 생성
      await prisma.space.create({
        data: { type: 'PART', ownerId: newPart.id, teamId: user.teamId },
      });
      finalPartId = newPart.id;
    }

    if (!finalPartId) { res.status(400).json({ error: 'Part selection required' }); return; }

    // 이전 그룹/파트 기록
    const oldGroupId = user.groupId;
    const oldPartId = user.partId;

    // User 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { groupId: finalGroupId, partId: finalPartId },
    });

    // Item 이관 (기존 item이 있으면)
    if (oldGroupId || oldPartId) {
      const personalSpace = await prisma.space.findFirst({
        where: { type: 'PERSONAL', ownerId: user.id },
      });
      if (personalSpace) {
        // items는 개인 space에 속하므로 이관 불필요 (space는 user 기반)
      }

      // 활동 로그
      const oldGroup = oldGroupId ? await prisma.group.findUnique({ where: { id: oldGroupId } }) : null;
      const oldPart = oldPartId ? await prisma.part.findUnique({ where: { id: oldPartId } }) : null;
      const newGroup = await prisma.group.findUnique({ where: { id: finalGroupId } });
      const newPart = await prisma.part.findUnique({ where: { id: finalPartId } });

      if (oldGroupId !== finalGroupId) {
        await prisma.activityLog.create({
          data: {
            userId: user.id,
            action: 'CHANGE_GROUP',
            targetType: 'GROUP',
            targetId: finalGroupId,
            details: `${oldGroup?.name || '없음'} → ${newGroup?.name || ''}`,
          },
        });
      }
      if (oldPartId !== finalPartId) {
        await prisma.activityLog.create({
          data: {
            userId: user.id,
            action: 'CHANGE_PART',
            targetType: 'PART',
            targetId: finalPartId,
            details: `${oldPart?.name || '없음'} → ${newPart?.name || ''}`,
          },
        });
      }

      // 빈 그룹/파트 자동 삭제 (트랜잭션으로 race condition 방지)
      if (oldPartId && oldPartId !== finalPartId) {
        try {
          await prisma.$transaction(async (tx) => {
            const partUsers = await tx.user.count({ where: { partId: oldPartId } });
            if (partUsers === 0) {
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
            const groupUsers = await tx.user.count({ where: { groupId: oldGroupId } });
            if (groupUsers === 0) {
              const groupParts = await tx.part.count({ where: { groupId: oldGroupId } });
              if (groupParts === 0) {
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
    }

    // 결과 반환
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { team: true, group: true, part: true },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Onboarding setup error:', error);
    res.status(500).json({ error: 'Failed to setup organization' });
  }
});

// POST /onboarding/normalize-name - LLM 이름 정규화
onboardingRoutes.post('/normalize-name', authenticateToken, loadUser, llmLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }

    const normalized = await normalizeNameWithLLM(name, {
      loginid: req.user!.loginid,
      username: req.user!.username,
      deptname: req.user!.deptname,
    });

    res.json({ original: name, normalized });
  } catch (error) {
    console.error('Normalize name error:', error);
    res.status(500).json({ error: '이름 정규화에 실패했습니다.' });
  }
});
