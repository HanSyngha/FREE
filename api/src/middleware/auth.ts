/**
 * Authentication Middleware (OAuth-based)
 * JWT 인증 및 권한 체크
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

export interface JWTPayload {
  loginid: string;
  deptname: string;
  username: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  userId?: string;
  dbUser?: {
    id: string;
    loginid: string;
    username: string;
    deptname: string;
    businessUnit: string;
    teamId: string | null;
    groupId: string | null;
    partId: string | null;
    requestCount: number;
    preferences: unknown;
    createdAt: Date;
    lastActive: Date;
  };
  isSuperAdmin?: boolean;
  isTeamAdmin?: boolean;
  teamAdminTeamIds?: string[];
  orgAdminLevels?: Array<{ level: string; targetId: string }>;
}

export interface VisibleScope {
  level: 'SUPER' | 'TEAM' | 'GROUP' | 'PART' | 'PERSONAL';
  teamId?: string;
  groupId?: string;
  partId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'free-jwt-secret-change-in-production';

/**
 * 최초 사용자인지 확인하고, 맞으면 자동 SUPER_ADMIN 등록
 */
export async function ensureFirstUserAdmin(userId: string, email: string | null): Promise<void> {
  if (!email) return;

  const adminCount = await prisma.admin.count();
  if (adminCount > 0) return;

  await prisma.admin.create({
    data: { email, role: 'SUPER_ADMIN' },
  });
  console.log(`[Auth] First user '${email}' auto-promoted to SUPER_ADMIN`);
}

/**
 * Admin인지 확인 (DB 기반)
 */
export async function checkAdminStatus(email: string | null): Promise<{ isAdmin: boolean; adminRole: string | null }> {
  if (!email) return { isAdmin: false, adminRole: null };

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (admin) return { isAdmin: true, adminRole: admin.role };
  return { isAdmin: false, adminRole: null };
}

/**
 * Super Admin 여부 확인 (환경변수 DEVELOPERS)
 */
export function isSuperAdmin(loginid: string): boolean {
  const developers = process.env.DEVELOPERS || '';
  return developers.split(',').map(d => d.trim()).filter(Boolean).includes(loginid);
}

/**
 * deptname에서 businessUnit 추출
 */
export function extractBusinessUnit(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/\(([^)]+)\)/);
  if (match) return match[1];
  const parts = deptname.split('/');
  return parts[0]?.trim() || '';
}

/**
 * deptname에서 팀명 추출
 */
export function extractTeamName(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/^([^(]+)/);
  if (match) return match[1].trim();
  const parts = deptname.split('/');
  return parts[parts.length - 1]?.trim() || deptname;
}

/**
 * 내부 토큰 검증
 */
export function verifyInternalToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 내부 토큰 발급
 */
export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * JWT 토큰 인증 미들웨어 (OAuth JWT만 검증)
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const payload = verifyInternalToken(token);
    if (!payload || !payload.loginid) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

export async function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }

  // DB Admin 테이블 체크
  const user = await prisma.user.findUnique({
    where: { loginid: req.user.loginid },
    select: { email: true },
  });
  if (user?.email) {
    const { isAdmin, adminRole } = await checkAdminStatus(user.email);
    if (isAdmin && adminRole === 'SUPER_ADMIN') { req.isSuperAdmin = true; next(); return; }
  }

  res.status(403).json({ error: 'Super admin access required' });
}

export async function requireTeamAdminOrHigher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }

  const user = await prisma.user.findUnique({
    where: { loginid: req.user.loginid },
    include: { teamAdmins: { select: { teamId: true } } },
  });

  if (user?.email) {
    const { isAdmin } = await checkAdminStatus(user.email);
    if (isAdmin) { req.isSuperAdmin = true; next(); return; }
  }

  if (user && user.teamAdmins.length > 0) {
    req.isTeamAdmin = true;
    req.teamAdminTeamIds = user.teamAdmins.map(ta => ta.teamId);
    next();
    return;
  }

  res.status(403).json({ error: 'Team admin or higher access required' });
}

export async function loadUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { loginid: req.user.loginid } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    req.userId = user.id;
    req.dbUser = user;
    next();
  } catch {
    res.status(500).json({ error: 'Failed to load user' });
  }
}

/**
 * OrgAdmin 권한 체크 미들웨어
 * 상위 레벨 권한도 하위 레벨 접근 허용 (TEAM > GROUP > PART)
 * SuperAdmin / TeamAdmin은 항상 통과
 */
export function requireOrgAdmin(level: string, targetIdParam: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const user = await prisma.user.findUnique({
      where: { loginid: req.user.loginid },
      include: { teamAdmins: { select: { teamId: true } } },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    req.userId = user.id;
    req.dbUser = user;

    // SuperAdmin은 항상 통과
    if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }
    if (user.email) {
      const { isAdmin } = await checkAdminStatus(user.email);
      if (isAdmin) { req.isSuperAdmin = true; next(); return; }
    }

    // TeamAdmin은 항상 통과
    if (user.teamAdmins.length > 0) {
      req.isTeamAdmin = true;
      req.teamAdminTeamIds = user.teamAdmins.map(ta => ta.teamId);
      next();
      return;
    }

    // OrgAdmin 체크
    const targetId = req.params[targetIdParam] || req.body[targetIdParam];
    if (!targetId) { res.status(400).json({ error: 'targetId is required' }); return; }

    const orgAdmins = await prisma.orgAdmin.findMany({
      where: { userId: user.id },
    });

    const levelHierarchy: Record<string, number> = { TEAM: 3, GROUP: 2, PART: 1 };
    const requiredLevel = levelHierarchy[level] || 0;

    // 직접 매칭 또는 상위 레벨 권한 보유 시 통과
    const hasAccess = orgAdmins.some(oa => {
      const oaLevel = levelHierarchy[oa.level] || 0;
      if (oaLevel >= requiredLevel && oa.targetId === targetId) return true;
      // 상위 레벨이면 하위도 접근 가능 (같은 조직 내)
      if (oaLevel > requiredLevel) return true;
      return false;
    });

    if (hasAccess) {
      req.orgAdminLevels = orgAdmins.map(oa => ({ level: oa.level, targetId: oa.targetId }));
      next();
      return;
    }

    res.status(403).json({ error: '조직 관리 권한이 필요합니다.' });
  };
}

/**
 * 사용자의 열람 가능 범위 반환
 */
export async function getVisibleScope(userId: string): Promise<VisibleScope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      teamAdmins: { select: { teamId: true } },
      orgAdmins: true,
    },
  });
  if (!user) return { level: 'PERSONAL' };

  // SuperAdmin → 전체
  if (isSuperAdmin(user.loginid)) return { level: 'SUPER' };
  if (user.email) {
    const { isAdmin } = await checkAdminStatus(user.email);
    if (isAdmin) return { level: 'SUPER' };
  }

  // TeamAdmin → 사업부 내 모든 기록
  if (user.teamAdmins.length > 0) {
    return { level: 'TEAM', teamId: user.teamId || undefined };
  }

  // OrgAdmin 중 최상위 레벨 반환
  if (user.orgAdmins && user.orgAdmins.length > 0) {
    const levelOrder: Record<string, number> = { TEAM: 3, GROUP: 2, PART: 1 };
    const highest = user.orgAdmins.reduce((max, oa) =>
      (levelOrder[oa.level] || 0) > (levelOrder[max.level] || 0) ? oa : max
    );
    if (highest.level === 'TEAM') return { level: 'TEAM', teamId: highest.targetId };
    if (highest.level === 'GROUP') return { level: 'GROUP', groupId: highest.targetId };
    if (highest.level === 'PART') return { level: 'PART', partId: highest.targetId };
  }

  // 일반 사용자 → 파트 내 기록
  if (user.partId) return { level: 'PART', partId: user.partId };
  return { level: 'PERSONAL' };
}
