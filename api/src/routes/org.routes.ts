/**
 * Org Routes - 조직 구조 CRUD (그룹/파트 생성/수정/삭제, 사용자 재배치)
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import {
  authenticateToken, AuthenticatedRequest,
  isSuperAdmin, checkAdminStatus,
} from '../middleware/auth.js';

export const orgRoutes = Router();

// ── 권한 헬퍼 ──────────────────────────────────────────

async function resolveUser(req: AuthenticatedRequest) {
  if (!req.user) return null;
  return prisma.user.findUnique({
    where: { loginid: req.user.loginid },
    include: {
      teamAdmins: { select: { teamId: true } },
      orgAdmins: { select: { level: true, targetId: true } },
    },
  });
}

async function isSuperOrDbAdmin(loginid: string, email: string | null): Promise<boolean> {
  if (isSuperAdmin(loginid)) return true;
  if (email) {
    const { isAdmin } = await checkAdminStatus(email);
    if (isAdmin) return true;
  }
  return false;
}

/** 그룹 관리 권한 (생성/이름수정/삭제/사용자재배치) */
async function canManageGroup(user: any, groupId: string): Promise<boolean> {
  if (await isSuperOrDbAdmin(user.loginid, user.email)) return true;
  if (user.teamAdmins.length > 0) return true;

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { teamId: true } });
  if (!group) return false;

  return user.orgAdmins.some((oa: any) => {
    if (oa.level === 'TEAM' && oa.targetId === group.teamId) return true;
    if (oa.level === 'GROUP' && oa.targetId === groupId) return true;
    return false;
  });
}

/** 팀 레벨 관리 권한 (그룹 생성 등) */
async function canManageTeam(user: any, teamId: string): Promise<boolean> {
  if (await isSuperOrDbAdmin(user.loginid, user.email)) return true;
  if (user.teamAdmins.some((ta: any) => ta.teamId === teamId)) return true;
  return user.orgAdmins.some((oa: any) => oa.level === 'TEAM' && oa.targetId === teamId);
}

/** 파트 관리 권한 */
async function canManagePart(user: any, partId: string): Promise<boolean> {
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: { groupId: true, group: { select: { teamId: true } } },
  });
  if (!part) return false;
  return canManageGroup(user, part.groupId);
}

// ── GET /org/tree ──────────────────────────────────────

orgRoutes.get('/tree', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    // BU-level tree (SuperAdmin 사업부 전체 조회)
    const buId = req.query.buId as string;
    if (buId) {
      const bu = await prisma.businessUnit.findUnique({
        where: { id: buId },
        include: {
          teams: {
            orderBy: { name: 'asc' },
            include: {
              groups: {
                orderBy: { name: 'asc' },
                include: {
                  parts: {
                    orderBy: { name: 'asc' },
                    include: { _count: { select: { users: true } } },
                  },
                  _count: { select: { users: true } },
                },
              },
              _count: { select: { users: true } },
            },
          },
        },
      });
      if (!bu) { res.status(404).json({ error: 'Business unit not found' }); return; }

      const tree = {
        id: bu.id,
        name: bu.name,
        type: 'BU' as const,
        children: bu.teams.map(team => ({
          id: team.id,
          name: team.name,
          type: 'TEAM' as const,
          memberCount: team._count.users,
          children: team.groups.map(g => ({
            id: g.id,
            name: g.name,
            type: 'GROUP' as const,
            memberCount: g._count.users,
            children: g.parts.map(p => ({
              id: p.id,
              name: p.name,
              type: 'PART' as const,
              memberCount: p._count.users,
              children: [] as any[],
            })),
          })),
        })),
      };
      res.json({ tree });
      return;
    }

    // Single team tree
    const teamId = (req.query.teamId as string) || user.teamId;
    if (!teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        businessUnit: { select: { id: true, name: true } },
        groups: {
          orderBy: { name: 'asc' },
          include: {
            parts: {
              orderBy: { name: 'asc' },
              include: { _count: { select: { users: true } } },
            },
            _count: { select: { users: true } },
          },
        },
        _count: { select: { users: true } },
      },
    });

    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    // 파트에 직접 속한 사용자 + 그룹에 속하지만 파트 없는 사용자 합산
    const tree = {
      id: team.id,
      name: team.name,
      type: 'TEAM' as const,
      memberCount: team._count.users,
      businessUnit: team.businessUnit,
      children: team.groups.map(g => ({
        id: g.id,
        name: g.name,
        type: 'GROUP' as const,
        memberCount: g._count.users,
        children: g.parts.map(p => ({
          id: p.id,
          name: p.name,
          type: 'PART' as const,
          memberCount: p._count.users,
          children: [] as any[],
        })),
      })),
    };

    res.json({ tree });
  } catch (error) {
    console.error('Get org tree error:', error);
    res.status(500).json({ error: 'Failed to get org tree' });
  }
});

// ── POST /org/groups ──────────────────────────────────

orgRoutes.post('/groups', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const { teamId, name } = req.body;
    if (!teamId || !name?.trim()) { res.status(400).json({ error: 'teamId, name은 필수입니다.' }); return; }

    if (!(await canManageTeam(user, teamId))) {
      res.status(403).json({ error: '그룹 생성 권한이 없습니다.' }); return;
    }

    const group = await prisma.group.create({ data: { name: name.trim(), teamId } });
    await prisma.space.create({ data: { type: 'GROUP', ownerId: group.id, teamId } });

    res.json({ success: true, group });
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: '이미 존재하는 그룹 이름입니다.' }); return; }
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// ── PUT /org/groups/:id ──────────────────────────────

orgRoutes.put('/groups/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const id = req.params.id as string;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'name은 필수입니다.' }); return; }

    if (!(await canManageGroup(user, id))) {
      res.status(403).json({ error: '그룹 이름 수정 권한이 없습니다.' }); return;
    }

    const group = await prisma.group.update({ where: { id }, data: { name: name.trim() } });
    res.json({ success: true, group });
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: '이미 존재하는 그룹 이름입니다.' }); return; }
    if (error.code === 'P2025') { res.status(404).json({ error: '그룹을 찾을 수 없습니다.' }); return; }
    console.error('Rename group error:', error);
    res.status(500).json({ error: 'Failed to rename group' });
  }
});

// ── DELETE /org/groups/:id ──────────────────────────────

orgRoutes.delete('/groups/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const id = req.params.id as string;

    if (!(await canManageTeam(user, ''))) {
      // 그룹 삭제는 TeamAdmin+ 전용 → 먼저 그룹의 teamId 확인
      const group = await prisma.group.findUnique({ where: { id }, select: { teamId: true } });
      if (!group) { res.status(404).json({ error: '그룹을 찾을 수 없습니다.' }); return; }
      if (!(await canManageTeam(user, group.teamId))) {
        res.status(403).json({ error: '그룹 삭제 권한이 없습니다.' }); return;
      }
    }

    // 소속 사용자 체크
    const userCount = await prisma.user.count({ where: { groupId: id } });
    if (userCount > 0) {
      res.status(409).json({ error: `소속 사용자가 ${userCount}명 있어 삭제할 수 없습니다. 먼저 사용자를 재배치하세요.` });
      return;
    }

    // 하위 파트 체크
    const partCount = await prisma.part.count({ where: { groupId: id } });
    if (partCount > 0) {
      res.status(409).json({ error: `하위 파트가 ${partCount}개 있어 삭제할 수 없습니다. 먼저 파트를 삭제하세요.` });
      return;
    }

    // Space 삭제 → Group 삭제
    await prisma.space.deleteMany({ where: { type: 'GROUP', ownerId: id } });
    await prisma.group.delete({ where: { id } });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: '그룹을 찾을 수 없습니다.' }); return; }
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ── POST /org/parts ──────────────────────────────────

orgRoutes.post('/parts', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const { groupId, name } = req.body;
    if (!groupId || !name?.trim()) { res.status(400).json({ error: 'groupId, name은 필수입니다.' }); return; }

    if (!(await canManageGroup(user, groupId))) {
      res.status(403).json({ error: '파트 생성 권한이 없습니다.' }); return;
    }

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { teamId: true } });
    if (!group) { res.status(404).json({ error: '그룹을 찾을 수 없습니다.' }); return; }

    const part = await prisma.part.create({ data: { name: name.trim(), groupId } });
    await prisma.space.create({ data: { type: 'PART', ownerId: part.id, teamId: group.teamId } });

    res.json({ success: true, part });
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: '이미 존재하는 파트 이름입니다.' }); return; }
    console.error('Create part error:', error);
    res.status(500).json({ error: 'Failed to create part' });
  }
});

// ── PUT /org/parts/:id ──────────────────────────────

orgRoutes.put('/parts/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const id = req.params.id as string;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'name은 필수입니다.' }); return; }

    if (!(await canManagePart(user, id))) {
      res.status(403).json({ error: '파트 이름 수정 권한이 없습니다.' }); return;
    }

    const part = await prisma.part.update({ where: { id }, data: { name: name.trim() } });
    res.json({ success: true, part });
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: '이미 존재하는 파트 이름입니다.' }); return; }
    if (error.code === 'P2025') { res.status(404).json({ error: '파트를 찾을 수 없습니다.' }); return; }
    console.error('Rename part error:', error);
    res.status(500).json({ error: 'Failed to rename part' });
  }
});

// ── DELETE /org/parts/:id ──────────────────────────────

orgRoutes.delete('/parts/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const id = req.params.id as string;

    const part = await prisma.part.findUnique({
      where: { id },
      select: { groupId: true, group: { select: { teamId: true } } },
    });
    if (!part) { res.status(404).json({ error: '파트를 찾을 수 없습니다.' }); return; }

    if (!(await canManageGroup(user, part.groupId))) {
      res.status(403).json({ error: '파트 삭제 권한이 없습니다.' }); return;
    }

    // 소속 사용자 체크
    const userCount = await prisma.user.count({ where: { partId: id } });
    if (userCount > 0) {
      res.status(409).json({ error: `소속 사용자가 ${userCount}명 있어 삭제할 수 없습니다. 먼저 사용자를 재배치하세요.` });
      return;
    }

    await prisma.space.deleteMany({ where: { type: 'PART', ownerId: id } });
    await prisma.part.delete({ where: { id } });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: '파트를 찾을 수 없습니다.' }); return; }
    console.error('Delete part error:', error);
    res.status(500).json({ error: 'Failed to delete part' });
  }
});

// ── PUT /org/users/:id/reassign ──────────────────────

orgRoutes.put('/users/:id/reassign', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const callerUser = await resolveUser(req);
    if (!callerUser) { res.status(401).json({ error: 'Authentication required' }); return; }

    const id = req.params.id as string;
    const { groupId, partId } = req.body;
    if (!groupId || !partId) { res.status(400).json({ error: 'groupId, partId는 필수입니다.' }); return; }

    // 대상 사용자
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, groupId: true, partId: true, teamId: true },
    });
    if (!targetUser) { res.status(404).json({ error: '사용자를 찾을 수 없습니다.' }); return; }

    // 이동 대상 그룹/파트 존재 확인
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, teamId: true } });
    if (!group) { res.status(404).json({ error: '대상 그룹을 찾을 수 없습니다.' }); return; }

    const part = await prisma.part.findUnique({ where: { id: partId }, select: { id: true, groupId: true } });
    if (!part || part.groupId !== groupId) {
      res.status(400).json({ error: '파트가 해당 그룹에 속하지 않습니다.' }); return;
    }

    // 권한: 출발지 또는 도착지 그룹 관리 가능해야 함
    const canSrc = targetUser.groupId ? await canManageGroup(callerUser, targetUser.groupId) : true;
    const canDst = await canManageGroup(callerUser, groupId);
    if (!canSrc && !canDst) {
      res.status(403).json({ error: '사용자 재배치 권한이 없습니다.' }); return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { groupId, partId },
      select: { id: true, username: true, groupId: true, partId: true },
    });

    res.json({ success: true, user: updated });
  } catch (error) {
    console.error('Reassign user error:', error);
    res.status(500).json({ error: 'Failed to reassign user' });
  }
});
