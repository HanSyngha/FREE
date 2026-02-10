/**
 * OAuth Routes - Dashboard Delegated Authentication
 *
 * FREE는 자체 OAuth를 수행하지 않고 Dashboard에 위임한다.
 * 프론트엔드가 Dashboard에서 받은 JWT를 이 엔드포인트로 보내면,
 * Dashboard /api/auth/me로 검증 후 로컬 JWT를 발급한다.
 */

import { Router, Request, Response } from 'express';
import { prisma, redis } from '../index.js';
import {
  signToken,
  ensureFirstUserAdmin,
} from '../middleware/auth.js';

export const oauthRoutes = Router();

const DASHBOARD_URL = process.env['DASHBOARD_URL'] || '';

interface DashboardUserInfo {
  user: {
    id: string;
    providerId: string;
    email: string | null;
    displayName: string;
    provider: string;
    profileImage: string | null;
  };
  isAdmin: boolean;
  adminRole: string | null;
}

/**
 * Dashboard JWT를 사용해 사용자 정보 조회 + 토큰 검증
 */
async function verifyDashboardToken(dashboardToken: string): Promise<DashboardUserInfo | null> {
  if (!DASHBOARD_URL) {
    console.error('[OAuth] DASHBOARD_URL is not configured');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${dashboardToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[OAuth] Dashboard /api/auth/me returned ${response.status}`);
      return null;
    }

    return (await response.json()) as DashboardUserInfo;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      console.error('[OAuth] Dashboard token verification timed out');
    } else {
      console.error('[OAuth] Failed to verify Dashboard token:', error);
    }
    return null;
  }
}

/**
 * POST /auth/exchange
 * Dashboard JWT → FREE 로컬 JWT
 *
 * Body: { dashboardToken: string }
 * Response: { success, token, user }
 */
oauthRoutes.post('/exchange', async (req: Request, res: Response) => {
  const { dashboardToken } = req.body;

  if (!dashboardToken || typeof dashboardToken !== 'string') {
    res.status(400).json({ error: 'dashboardToken is required' });
    return;
  }

  try {
    // 1. Dashboard에서 사용자 정보 조회 (토큰 검증)
    const dashboardInfo = await verifyDashboardToken(dashboardToken);

    if (!dashboardInfo?.user) {
      res.status(401).json({ error: 'Invalid or expired Dashboard token' });
      return;
    }

    const { user: dashUser } = dashboardInfo;
    const providerId = dashUser.providerId || dashUser.id;
    const loginid = dashUser.email || `${dashUser.provider}_${providerId}`;

    // 2. 로컬 DB에 User upsert
    const user = await prisma.user.upsert({
      where: {
        provider_providerId: {
          provider: dashUser.provider,
          providerId,
        },
      },
      update: {
        lastActive: new Date(),
        username: dashUser.displayName,
        email: dashUser.email,
        profileImage: dashUser.profileImage,
      },
      create: {
        provider: dashUser.provider,
        providerId,
        loginid,
        email: dashUser.email,
        username: dashUser.displayName,
        profileImage: dashUser.profileImage,
        deptname: '',
        businessUnit: '',
      },
    });

    // 3. 개인 Space 생성 (없으면)
    const existingSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });

    if (!existingSpace) {
      await prisma.space.create({
        data: { type: 'PERSONAL', ownerId: user.id },
      });
      console.log(`[OAuth] Personal space created for ${loginid}`);
    }

    // 4. Redis 활성 사용자 추적
    await redis.set(`free:active:${loginid}`, Date.now().toString(), 'EX', 86400);

    // 5. 최초 사용자 자동 SUPER_ADMIN
    await ensureFirstUserAdmin(user.id, user.email);

    // 6. 내부 JWT 발급
    const jwtToken = signToken({
      loginid: user.loginid,
      deptname: user.deptname,
      username: user.username,
    });

    // 7. 활동 로그
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        details: JSON.stringify({ method: 'dashboard_oauth', provider: dashUser.provider }),
      },
    });

    // 8. 응답
    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        loginid: user.loginid,
        username: user.username,
        email: user.email,
        provider: user.provider,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    console.error('[OAuth] Token exchange error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});
