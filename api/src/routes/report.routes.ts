/**
 * Report Routes - 보고서 조회/내보내기/재개
 */
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { generalLimit } from '../middleware/rateLimit.js';
import { exportToDocx, exportToXlsx } from '../services/export.service.js';
import { Queue } from 'bullmq';

export const reportRoutes = Router();

function parseRedisUrl(url: string) {
  const cleaned = url.replace('redis://', '');
  const [host, portStr] = cleaned.split(':');
  return { host: host || 'localhost', port: parseInt(portStr || '6379') };
}

const redisConn = parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:6379');
const reportQueue = new Queue('report-generation', {
  connection: { host: redisConn.host, port: redisConn.port },
});

// POST /reports/personal - 개인 보고서 수동 생성
reportRoutes.post('/personal', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;

    // 개인 Space 조회
    const space = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!space) { res.status(404).json({ error: 'Personal space not found' }); return; }

    // 최근 7일 items 조회
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setHours(0, 0, 0, 0);
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 6);

    const items = await prisma.item.findMany({
      where: {
        userId: user.id,
        spaceId: space.id,
        date: { gte: periodStart, lte: periodEnd },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    if (items.length === 0) {
      res.status(400).json({ error: '최근 7일간 등록된 업무 기록이 없습니다.' });
      return;
    }

    // items를 날짜별 텍스트로 변환
    let itemsData = '';
    for (const item of items) {
      itemsData += `- [${item.date.toISOString().split('T')[0]}] ${item.title}: ${item.content}\n`;
    }

    const periodStr = `${periodStart.toISOString().split('T')[0]} ~ ${periodEnd.toISOString().split('T')[0]}`;
    const context = `당신은 ${user.username}의 7일간(${periodStr}) 개인 업무 보고서를 작성하고 있습니다.\n\n모든 업무가 빠짐없이 드러나도록 정리해 주세요. 업무를 생략하거나 축약하지 마시오.\n\n`;

    // LLM 호출 (callLLM 사용)
    const { callLLM } = await import('../services/llm.service.js');
    const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };

    const [byMember, byItem] = await Promise.all([
      callLLM([
        { role: 'system', content: `${context}다음은 ${user.username}의 업무 기록입니다.\n날짜별로 수행한 업무를 빠짐없이 정리하여 주간 보고서 형태로 작성해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: itemsData },
      ], userInfo),
      callLLM([
        { role: 'system', content: `${context}다음은 ${user.username}의 업무 기록입니다.\n동일하거나 유사한 업무를 항목별로 묶어 정리해 주세요. 모든 업무가 빠짐없이 포함되어야 합니다.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: itemsData },
      ], userInfo),
    ]);

    // 보고서 저장
    const report = await prisma.report.create({
      data: {
        spaceId: space.id,
        type: 'PERSONAL',
        byMemberContent: byMember,
        byItemContent: byItem,
        periodStart,
        periodEnd,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({ success: true, report });
  } catch (error) {
    console.error('Generate personal report error:', error);
    res.status(500).json({ error: '개인 보고서 생성에 실패했습니다.' });
  }
});

// GET /reports/space/:spaceId - Space의 보고서 목록
reportRoutes.get('/space/:spaceId', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const spaceId = req.params.spaceId as string;

    // 팀 간 데이터 격리 체크
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (space?.teamId && space.teamId !== user.teamId) {
      res.status(403).json({ error: '같은 팀의 보고서만 조회할 수 있습니다.' });
      return;
    }

    const reports = await prisma.report.findMany({
      where: {
        spaceId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ reports });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

// GET /reports/:id - 보고서 상세
reportRoutes.get('/:id', authenticateToken, loadUser, generalLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;
    const report = await prisma.report.findUnique({
      where: { id },
      include: { space: true },
    });
    if (!report) { res.status(404).json({ error: 'Report not found' }); return; }

    // 팀 간 데이터 격리 체크
    if (report.space.teamId && report.space.teamId !== user.teamId) {
      res.status(403).json({ error: '같은 팀의 보고서만 조회할 수 있습니다.' });
      return;
    }

    res.json({ report });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

// GET /reports/:id/export?format=docx|xlsx - 보고서 내보내기
reportRoutes.get('/:id/export', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const format = (req.query.format as string) || 'docx';

    const user = req.dbUser!;
    const report = await prisma.report.findUnique({ where: { id }, include: { space: true } });
    if (!report) { res.status(404).json({ error: 'Report not found' }); return; }

    // 팀 간 데이터 격리 체크
    if (report.space.teamId && report.space.teamId !== user.teamId) {
      res.status(403).json({ error: '같은 팀의 보고서만 내보낼 수 있습니다.' });
      return;
    }

    // Space에서 이름 조회
    const space = report.space;
    let targetName = '';
    if (space) {
      if (space.type === 'PART') {
        const part = await prisma.part.findUnique({ where: { id: space.ownerId } });
        targetName = part?.name || '';
      } else if (space.type === 'GROUP') {
        const group = await prisma.group.findUnique({ where: { id: space.ownerId } });
        targetName = group?.name || '';
      } else if (space.type === 'TEAM') {
        const team = await prisma.team.findUnique({ where: { id: space.ownerId } });
        targetName = team?.name || '';
      }
    }

    const typeLabel = report.type === 'PART' ? '파트' : report.type === 'GROUP' ? '그룹' : '팀';
    const reportData = {
      title: `${targetName} ${typeLabel} 주간 보고서`,
      periodStart: report.periodStart.toISOString().split('T')[0]!,
      periodEnd: report.periodEnd.toISOString().split('T')[0]!,
      createdAt: report.createdAt.toISOString().split('T')[0]!,
      byMemberContent: report.byMemberContent,
      byItemContent: report.byItemContent,
      type: report.type,
    };

    if (format === 'xlsx') {
      const buffer = await exportToXlsx(reportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(reportData.title)}.xlsx"`);
      res.send(buffer);
    } else {
      const buffer = await exportToDocx(reportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(reportData.title)}.docx"`);
      res.send(buffer);
    }
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// DELETE /reports/:id - 보고서 삭제 (Team Admin / Super Admin)
reportRoutes.delete('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;
    const report = await prisma.report.findUnique({
      where: { id },
      include: { space: true },
    });
    if (!report) { res.status(404).json({ error: '보고서를 찾을 수 없습니다.' }); return; }

    // 권한 체크: SuperAdmin 또는 해당 팀의 TeamAdmin
    const { isSuperAdmin } = await import('../middleware/auth.js');
    const isSA = isSuperAdmin(req.user!.loginid);

    if (!isSA) {
      // TeamAdmin 체크
      const teamAdmin = await prisma.teamAdmin.findFirst({
        where: { userId: user.id, teamId: report.space.teamId! },
      });
      if (!teamAdmin) {
        res.status(403).json({ error: 'Team Admin 이상 권한이 필요합니다.' });
        return;
      }
    }

    await prisma.report.delete({ where: { id } });
    res.json({ success: true, message: '보고서가 삭제되었습니다.' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: '보고서 삭제에 실패했습니다.' });
  }
});

// POST /reports/resume - 실패한 보고서 생성 재개
reportRoutes.post('/resume', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const failedJob = await prisma.reportJob.findFirst({
      where: { teamId: user.teamId, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!failedJob) {
      res.status(404).json({ error: '재개할 작업이 없습니다.' });
      return;
    }

    // Job 상태 업데이트
    await prisma.reportJob.update({
      where: { id: failedJob.id },
      data: { status: 'PENDING', retryCount: 0 },
    });

    // BullMQ에 재개 작업 추가
    await reportQueue.add('resume-report', {
      teamId: user.teamId,
      jobId: failedJob.id,
      resumeFrom: failedJob.failedAt,
    });

    res.json({ success: true, message: '보고서 생성을 재개합니다.' });
  } catch (error) {
    console.error('Resume report error:', error);
    res.status(500).json({ error: 'Failed to resume report generation' });
  }
});
