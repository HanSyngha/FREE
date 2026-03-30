/**
 * Authentication Middleware
 * SSO/JWT - ONCE와 동일한 패턴
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
  editLevel: 'SUPER' | 'TEAM' | 'GROUP' | 'PART' | 'PERSONAL';
  teamId?: string;
  groupId?: string;
  partId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'free-jwt-secret-change-in-production';

function getDevelopers(): string[] {
  const developers = process.env.DEVELOPERS || '';
  return developers.split(',').map(d => d.trim()).filter(Boolean);
}

export function isSuperAdmin(loginid: string): boolean {
  return getDevelopers().includes(loginid);
}

/**
 * deptname에서 businessUnit 추출
 * "AI플랫폼팀(DS부문)" → "DS부문"
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
 * "AI플랫폼팀(DS부문)" → "AI플랫폼팀"
 */
export function extractTeamName(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/^([^(]+)/);
  if (match) return match[1].trim();
  const parts = deptname.split('/');
  return parts[parts.length - 1]?.trim() || deptname;
}

function safeDecodeURIComponent(str: string): string {
  if (!str) return '';
  try {
    if (str.includes('%')) return decodeURIComponent(str);
    return str;
  } catch {
    return str;
  }
}

/**
 * SSO 토큰 디코딩 (Unicode-safe base64) - ONCE와 동일
 */
function decodeSSOToken(base64Token: string): JWTPayload | null {
  try {
    const binaryString = Buffer.from(base64Token, 'base64').toString('binary');
    const jsonString = decodeURIComponent(
      binaryString.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    const payload = JSON.parse(jsonString);
    return {
      loginid: safeDecodeURIComponent(payload.loginid || ''),
      deptname: safeDecodeURIComponent(payload.deptname || ''),
      username: safeDecodeURIComponent(payload.username || ''),
    };
  } catch (error) {
    console.error('SSO token decode error:', error);
    return null;
  }
}

function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    return {
      loginid: safeDecodeURIComponent(payload.loginid || payload.sub || payload.user_id || ''),
      deptname: safeDecodeURIComponent(payload.deptname || payload.department || ''),
      username: safeDecodeURIComponent(payload.username || payload.name || ''),
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function verifyInternalToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * JWT 토큰 인증 미들웨어 - ONCE와 동일 패턴
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    // 1. 내부 토큰 확인
    const internalPayload = verifyInternalToken(token);
    if (internalPayload && internalPayload.loginid) {
      req.user = internalPayload;
      next();
      return;
    }

    // 2. SSO 토큰 형식 확인 (sso.base64EncodedData)
    if (token.startsWith('sso.')) {
      const ssoData = decodeSSOToken(token.substring(4));
      if (ssoData && ssoData.loginid) {
        req.user = ssoData;
        next();
        return;
      }
    }

    // 3. 유효하지 않은 토큰 - 내부 JWT 검증 실패 및 SSO 형식이 아닌 경우
    res.status(403).json({ error: 'Invalid token' });
    return;
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

export async function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }
  res.status(403).json({ error: 'Super admin access required' });
}

export async function requireTeamAdminOrHigher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }

  const user = await prisma.user.findUnique({
    where: { loginid: req.user.loginid },
    include: { teamAdmins: { select: { teamId: true } } },
  });

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
 * 목표 수정 권한 미들웨어
 * SuperAdmin/TeamAdmin → 통과
 * OrgAdmin → 목표 level이 자기 editLevel 이하인지 확인
 * 일반 사용자 → 403
 */
export function requireGoalEdit() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const user = req.dbUser || await prisma.user.findUnique({ where: { loginid: req.user.loginid } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // SuperAdmin → 통과
    if (isSuperAdmin(req.user.loginid)) { req.isSuperAdmin = true; next(); return; }

    // TeamAdmin → 통과
    const teamAdmins = await prisma.teamAdmin.findMany({ where: { userId: user.id } });
    if (teamAdmins.length > 0) {
      req.isTeamAdmin = true;
      next();
      return;
    }

    // OrgAdmin 체크
    const orgAdmins = await prisma.orgAdmin.findMany({ where: { userId: user.id } });
    if (orgAdmins.length > 0) {
      req.orgAdminLevels = orgAdmins.map(oa => ({ level: oa.level, targetId: oa.targetId }));
      next();
      return;
    }

    // 소속 그룹/파트 멤버 → 자기 조직의 목표만 수정 가능
    const goalId = req.params.id as string | undefined;
    if (goalId && (user.groupId || user.partId)) {
      const goal = await prisma.item.findUnique({ where: { id: goalId }, select: { level: true, ownerId: true } });
      if (goal &&
        ((goal.level === 'GROUP' && goal.ownerId === user.groupId) ||
         (goal.level === 'PART' && goal.ownerId === user.partId))) {
        next();
        return;
      }
    }

    res.status(403).json({ error: '목표 수정 권한이 없습니다.' });
  };
}

/**
 * OrgAdmin 권한 체크 미들웨어
 * 상위 레벨 권한도 하위 레벨 접근 허용 (TEAM > GROUP > PART)
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

    const levelHierarchy: Record<string, number> = { BU: 4, TEAM: 3, GROUP: 2, PART: 1 };
    const requiredLevel = levelHierarchy[level] || 0;

    const hasAccess = orgAdmins.some(oa => {
      const oaLevel = levelHierarchy[oa.level] || 0;
      if (oaLevel >= requiredLevel && oa.targetId === targetId) return true;
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
 * 사용자의 열람/수정 가능 범위 반환
 * View는 1단계 상위까지, Edit는 동등+하위
 */
export async function getVisibleScope(userId: string): Promise<VisibleScope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      teamAdmins: { select: { teamId: true } },
      orgAdmins: true,
    },
  });
  if (!user) return { level: 'PERSONAL', editLevel: 'PERSONAL' };

  // SuperAdmin → 전체
  if (isSuperAdmin(user.loginid)) return { level: 'SUPER', editLevel: 'SUPER' };

  // TeamAdmin → 팀 전체
  if (user.teamAdmins.length > 0) {
    return { level: 'TEAM', editLevel: 'TEAM', teamId: user.teamId || undefined };
  }

  // OrgAdmin 중 최상위 레벨 반환
  if (user.orgAdmins && user.orgAdmins.length > 0) {
    const levelOrder: Record<string, number> = { TEAM: 3, GROUP: 2, PART: 1 };
    const highest = user.orgAdmins.reduce((max, oa) =>
      (levelOrder[oa.level] || 0) > (levelOrder[max.level] || 0) ? oa : max
    );

    // View = 1단계 상위, Edit = 동등+하위
    if (highest.level === 'TEAM') {
      return { level: 'TEAM', editLevel: 'TEAM', teamId: highest.targetId };
    }
    if (highest.level === 'GROUP') {
      return { level: 'TEAM', editLevel: 'GROUP', groupId: highest.targetId, teamId: user.teamId || undefined };
    }
    if (highest.level === 'PART') {
      return { level: 'GROUP', editLevel: 'PART', partId: highest.targetId, groupId: user.groupId || undefined };
    }
  }

  // 일반 사용자 → View는 파트, Edit는 개인
  if (user.partId) {
    return { level: 'PART', editLevel: 'PERSONAL', partId: user.partId };
  }
  return { level: 'PERSONAL', editLevel: 'PERSONAL' };
}
