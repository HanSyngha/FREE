/**
 * Onboarding Routes - 최초 로그인 조직 설정
 * BU/팀 선택 → 그룹 선택(직속 포함) → 파트 선택(직속 포함) → 부서장 역할 설정
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';

export const onboardingRoutes = Router();

// GET /onboarding/business-units - 전체 사업부 목록
onboardingRoutes.get('/business-units', authenticateToken, async (_req: AuthenticatedRequest, res) => {
  try {
    const bus = await prisma.businessUnit.findMany({ orderBy: { name: 'asc' } });
    res.json({ businessUnits: bus });
  } catch (error) {
    console.error('Get business units error:', error);
    res.status(500).json({ error: 'Failed to get business units' });
  }
});

// GET /onboarding/teams?buId={id} - 사업부 내 팀 목록
onboardingRoutes.get('/teams', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const buId = req.query.buId as string;
    if (!buId) { res.status(400).json({ error: 'buId is required' }); return; }

    const teams = await prisma.team.findMany({
      where: { businessUnitId: buId },
      orderBy: { name: 'asc' },
    });
    res.json({ teams });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Failed to get teams' });
  }
});

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

// POST /onboarding/setup - 전체 조직 설정 (BU/팀/그룹/파트/부서장)
onboardingRoutes.post('/setup', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const {
      buId, buName,       // BU 선택 또는 생성
      teamId, teamName,   // 팀 선택 또는 생성
      groupId, groupName, // 그룹 선택 또는 생성
      partId, partName,   // 파트 선택 또는 생성
      isDirect,           // 직속 여부 (팀 직속이면 그룹+파트 모두 "직속")
      isGroupDirect,      // 그룹 직속 여부 (파트만 "직속")
      adminRole,          // 부서장 역할: 'BU' | 'TEAM' | 'GROUP' | 'PART' | null
    } = req.body;

    // ── 1. BU/팀 처리 (teamId 없는 경우) ──────────────────
    let finalTeamId = user.teamId;
    let finalBuId = buId;

    if (!finalTeamId) {
      // BU 처리
      if (!finalBuId && buName) {
        const existing = await prisma.businessUnit.findUnique({ where: { name: buName.trim() } });
        if (existing) {
          finalBuId = existing.id;
        } else {
          const newBu = await prisma.businessUnit.create({ data: { name: buName.trim() } });
          finalBuId = newBu.id;
        }
      }
      if (!finalBuId) { res.status(400).json({ error: '사업부 선택이 필요합니다.' }); return; }

      // 팀 처리
      if (teamId) {
        finalTeamId = teamId;
      } else if (teamName) {
        const existing = await prisma.team.findUnique({
          where: { name_businessUnitId: { name: teamName.trim(), businessUnitId: finalBuId } },
        });
        if (existing) {
          finalTeamId = existing.id;
        } else {
          const newTeam = await prisma.team.create({
            data: { name: teamName.trim(), businessUnitId: finalBuId },
          });
          // Team Space 생성
          await prisma.space.create({ data: { type: 'TEAM', ownerId: newTeam.id, teamId: newTeam.id } });
          finalTeamId = newTeam.id;
        }
      }
      if (!finalTeamId) { res.status(400).json({ error: '팀 선택이 필요합니다.' }); return; }

      // user.teamId 업데이트 (아래에서 한번에 처리)
    }

    // ── 2. 그룹/파트 처리 ──────────────────────────────────
    let finalGroupId = groupId;
    let finalPartId = partId;

    if (isDirect) {
      // 팀 직속: "직속" 그룹 + "직속" 파트 자동 생성/조회
      const directGroup = await prisma.group.upsert({
        where: { name_teamId: { name: '직속', teamId: finalTeamId! } },
        update: {},
        create: { name: '직속', teamId: finalTeamId! },
      });
      // Group Space 생성 (없으면)
      const gSpace = await prisma.space.findFirst({ where: { type: 'GROUP', ownerId: directGroup.id } });
      if (!gSpace) await prisma.space.create({ data: { type: 'GROUP', ownerId: directGroup.id, teamId: finalTeamId! } });

      const directPart = await prisma.part.upsert({
        where: { name_groupId: { name: '직속', groupId: directGroup.id } },
        update: {},
        create: { name: '직속', groupId: directGroup.id },
      });
      const pSpace = await prisma.space.findFirst({ where: { type: 'PART', ownerId: directPart.id } });
      if (!pSpace) await prisma.space.create({ data: { type: 'PART', ownerId: directPart.id, teamId: finalTeamId! } });

      finalGroupId = directGroup.id;
      finalPartId = directPart.id;
    } else {
      // 그룹 처리 (기존 선택 또는 신규 생성)
      if (!groupId && groupName) {
        const existing = await prisma.group.findUnique({
          where: { name_teamId: { name: groupName.trim(), teamId: finalTeamId! } },
        });
        if (existing) {
          res.status(409).json({ error: '같은 이름의 그룹이 이미 존재합니다.' });
          return;
        }
        const newGroup = await prisma.group.create({ data: { name: groupName.trim(), teamId: finalTeamId! } });
        await prisma.space.create({ data: { type: 'GROUP', ownerId: newGroup.id, teamId: finalTeamId! } });
        finalGroupId = newGroup.id;
      }
      if (!finalGroupId) { res.status(400).json({ error: '그룹 선택이 필요합니다.' }); return; }

      // 파트 처리
      if (isGroupDirect) {
        // 그룹 직속: "직속" 파트 자동 생성/조회
        const directPart = await prisma.part.upsert({
          where: { name_groupId: { name: '직속', groupId: finalGroupId } },
          update: {},
          create: { name: '직속', groupId: finalGroupId },
        });
        const pSpace = await prisma.space.findFirst({ where: { type: 'PART', ownerId: directPart.id } });
        if (!pSpace) await prisma.space.create({ data: { type: 'PART', ownerId: directPart.id, teamId: finalTeamId! } });
        finalPartId = directPart.id;
      } else if (!partId && partName) {
        const existing = await prisma.part.findUnique({
          where: { name_groupId: { name: partName.trim(), groupId: finalGroupId } },
        });
        if (existing) {
          res.status(409).json({ error: '같은 이름의 파트가 이미 존재합니다.' });
          return;
        }
        const newPart = await prisma.part.create({ data: { name: partName.trim(), groupId: finalGroupId } });
        await prisma.space.create({ data: { type: 'PART', ownerId: newPart.id, teamId: finalTeamId! } });
        finalPartId = newPart.id;
      }
      if (!finalPartId) { res.status(400).json({ error: '파트 선택이 필요합니다.' }); return; }
    }

    // ── 3. 이전 조직 기록 ──────────────────────────────────
    const oldGroupId = user.groupId;
    const oldPartId = user.partId;

    // ── 4. User 업데이트 ──────────────────────────────────
    await prisma.user.update({
      where: { id: user.id },
      data: {
        teamId: finalTeamId,
        groupId: finalGroupId,
        partId: finalPartId,
      },
    });

    // ── 5. 부서장 역할 설정 ──────────────────────────────────
    if (adminRole && ['BU', 'TEAM', 'GROUP', 'PART'].includes(adminRole)) {
      let targetId = '';
      if (adminRole === 'BU') {
        // BU장: finalBuId 또는 user의 team.businessUnitId
        if (finalBuId) {
          targetId = finalBuId;
        } else {
          const team = await prisma.team.findUnique({ where: { id: finalTeamId! }, select: { businessUnitId: true } });
          targetId = team?.businessUnitId || '';
        }
      } else if (adminRole === 'TEAM') {
        targetId = finalTeamId!;
      } else if (adminRole === 'GROUP') {
        targetId = finalGroupId;
      } else if (adminRole === 'PART') {
        targetId = finalPartId;
      }

      if (targetId) {
        await prisma.orgAdmin.upsert({
          where: { userId_level_targetId: { userId: user.id, level: adminRole as any, targetId } },
          update: {},
          create: { userId: user.id, level: adminRole as any, targetId },
        });
      }
    }

    // ── 6. 활동 로그 ──────────────────────────────────────
    if (oldGroupId && oldGroupId !== finalGroupId) {
      const oldGroup = await prisma.group.findUnique({ where: { id: oldGroupId } });
      const newGroup = await prisma.group.findUnique({ where: { id: finalGroupId } });
      await prisma.activityLog.create({
        data: {
          userId: user.id, action: 'CHANGE_GROUP', targetType: 'GROUP', targetId: finalGroupId,
          details: `${oldGroup?.name || '없음'} → ${newGroup?.name || ''}`,
        },
      });
    }
    if (oldPartId && oldPartId !== finalPartId) {
      const oldPart = await prisma.part.findUnique({ where: { id: oldPartId } });
      const newPart = await prisma.part.findUnique({ where: { id: finalPartId } });
      await prisma.activityLog.create({
        data: {
          userId: user.id, action: 'CHANGE_PART', targetType: 'PART', targetId: finalPartId,
          details: `${oldPart?.name || '없음'} → ${newPart?.name || ''}`,
        },
      });
    }

    // ── 7. 빈 조직 자동 정리 ──────────────────────────────
    if (oldPartId && oldPartId !== finalPartId) {
      try {
        await prisma.$transaction(async (tx) => {
          const partUsers = await tx.user.count({ where: { partId: oldPartId } });
          if (partUsers === 0) {
            const spaces = await tx.space.findMany({ where: { type: 'PART', ownerId: oldPartId } });
            for (const s of spaces) await tx.report.deleteMany({ where: { spaceId: s.id } });
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
              for (const s of spaces) await tx.report.deleteMany({ where: { spaceId: s.id } });
              await tx.space.deleteMany({ where: { type: 'GROUP', ownerId: oldGroupId } });
              await tx.group.delete({ where: { id: oldGroupId } });
            }
          }
        });
      } catch { /* 동시 접근 시 무시 */ }
    }

    // ── 8. 결과 반환 ──────────────────────────────────────
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
