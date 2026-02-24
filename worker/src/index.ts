/**
 * FREE Worker - BullMQ 보고서 생성 Worker + Scheduled Jobs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Worker, Queue } from 'bullmq';

const prisma = new PrismaClient();

/** KST 기준 오늘 날짜 문자열 (YYYY-MM-DD) */
function getKSTTodayString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
/** YYYY-MM-DD → UTC midnight Date (@db.Date 필드 저장/쿼리용) */
function parseDateForDB(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}
/** KST 기준 오늘의 UTC midnight Date (@db.Date 필드용) */
function getKSTTodayForDB(): Date {
  return parseDateForDB(getKSTTodayString());
}
/** Date를 KST 기준 YYYY-MM-DD로 변환 */
function toKSTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function parseRedisUrl(url: string) {
  const cleaned = url.replace('redis://', '');
  const [host, portStr] = cleaned.split(':');
  return { host: host || 'localhost', port: parseInt(portStr || '15004') };
}

const redisConfig = parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:15004');
const connection = { host: redisConfig.host, port: redisConfig.port };

const LLM_PROXY_URL = process.env.LLM_PROXY_URL || '';
const LLM_SERVICE_ID = process.env.LLM_SERVICE_ID || 'free';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

// ========== LLM Helper (standalone for worker) ==========
async function callLLMWorker(messages: Array<{ role: string; content: string }>): Promise<string> {
  // 활성 LLM config 조회
  const config = await prisma.lLMConfig.findFirst({ where: { isActive: true } });

  let endpoint: string;
  let apiKey = '';
  let modelId = 'default';

  if (config) {
    endpoint = config.endpoint;
    // Decrypt API key
    if (config.apiKey && ENCRYPTION_KEY) {
      try {
        const crypto = await import('crypto');
        const [ivHex, encrypted] = config.apiKey.split(':');
        const iv = Buffer.from(ivHex!, 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        apiKey = decipher.update(encrypted!, 'hex', 'utf8') + decipher.final('utf8');
      } catch { apiKey = ''; }
    }
    modelId = config.modelId;
  } else if (LLM_PROXY_URL) {
    endpoint = LLM_PROXY_URL.replace(/\/chat\/completions$/, '');
  } else {
    throw new Error('No LLM configuration');
  }

  const chatUrl = endpoint!.endsWith('/chat/completions') ? endpoint! : `${endpoint!}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Service-Id': LLM_SERVICE_ID,
    'X-User-Id': 'system-worker',
    'X-User-Name': 'FREE%20Worker',
    'X-User-Dept': 'system',
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelId, messages, temperature: 0.3 }),
  });

  if (!response.ok) {
    throw new Error(`LLM error: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ========== Retry Logic ==========
async function callWithRetry(messages: Array<{ role: string; content: string }>, maxRetries = 5): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callLLMWorker(messages);
    } catch (error) {
      console.error(`LLM attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 10000)); // 10초 대기
      }
    }
  }

  // 5회 실패 → 10분 대기 → 재시도 5회
  console.log('First retry batch failed. Waiting 10 minutes...');
  await new Promise(r => setTimeout(r, 600000));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callLLMWorker(messages);
    } catch (error) {
      console.error(`LLM retry2 attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  }

  throw new Error('LLM call failed after all retries');
}

// ========== Report Generation ==========
async function generateReportsForTeam(teamId: string, resumeFrom?: string | null) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      groups: {
        include: {
          parts: true,
        },
      },
    },
  });
  if (!team) throw new Error(`Team ${teamId} not found`);

  // ReportJob 생성/업데이트
  let job = await prisma.reportJob.findFirst({
    where: { teamId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!job) {
    job = await prisma.reportJob.create({
      data: { teamId, status: 'IN_PROGRESS' },
    });
  } else {
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'IN_PROGRESS' },
    });
  }

  const periodEnd = getKSTTodayForDB();
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6);

  let shouldSkip = !!resumeFrom;

  try {
    // === Phase 1: 파트 보고서 ===
    for (const group of team.groups) {
      for (const part of group.parts) {
        if (shouldSkip) {
          if (resumeFrom === `PART:${part.id}`) shouldSkip = false;
          else continue;
        }

        try {
          await generatePartReportWorker(part, periodStart, periodEnd, job.id, teamId);
          await prisma.reportLog.create({
            data: { teamId, reportType: 'PART', targetName: part.name, status: 'SUCCESS' },
          });
        } catch (error: any) {
          await prisma.reportLog.create({
            data: { teamId, reportType: 'PART', targetName: part.name, status: 'FAILED', errorMessage: error.message },
          });
          await prisma.reportJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', failedAt: `PART:${part.id}`, lastError: error.message },
          });
          throw error;
        }
      }
    }

    // === Phase 2: 그룹 보고서 ===
    for (const group of team.groups) {
      if (shouldSkip) {
        if (resumeFrom === `GROUP:${group.id}`) shouldSkip = false;
        else continue;
      }

      try {
        await generateGroupReportWorker(group, periodStart, periodEnd, job.id, teamId);
        await prisma.reportLog.create({
          data: { teamId, reportType: 'GROUP', targetName: group.name, status: 'SUCCESS' },
        });
      } catch (error: any) {
        await prisma.reportLog.create({
          data: { teamId, reportType: 'GROUP', targetName: group.name, status: 'FAILED', errorMessage: error.message },
        });
        await prisma.reportJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', failedAt: `GROUP:${group.id}`, lastError: error.message },
        });
        throw error;
      }
    }

    // === Phase 3: 팀 보고서 ===
    if (shouldSkip && resumeFrom === `TEAM:${teamId}`) shouldSkip = false;
    if (!shouldSkip) {
      try {
        await generateTeamReportWorker(team, periodStart, periodEnd, job.id);
        await prisma.reportLog.create({
          data: { teamId, reportType: 'TEAM', targetName: team.name, status: 'SUCCESS' },
        });
      } catch (error: any) {
        await prisma.reportLog.create({
          data: { teamId, reportType: 'TEAM', targetName: team.name, status: 'FAILED', errorMessage: error.message },
        });
        await prisma.reportJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', failedAt: `TEAM:${teamId}`, lastError: error.message },
        });
        throw error;
      }
    }

    // 완료
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED' },
    });
    console.log(`[Worker] Report generation completed for team ${team.name}`);

  } catch (error) {
    console.error(`[Worker] Report generation failed for team ${team.name}:`, error);
    throw error;
  }
}

async function generatePartReportWorker(
  part: { id: string; name: string; groupId: string },
  periodStart: Date, periodEnd: Date,
  jobId: string, teamId: string
) {
  const users = await prisma.user.findMany({
    where: { partId: part.id },
    select: { id: true, username: true },
  });

  const userIds = users.map(u => u.id);
  const workLogs = await prisma.workLog.findMany({
    where: {
      userId: { in: userIds },
      date: { gte: periodStart, lte: periodEnd },
    },
    include: { user: { select: { username: true } } },
    orderBy: [{ date: 'desc' }],
  });

  // workLogs 데이터를 텍스트로 변환
  let itemsData = '';
  if (workLogs.length === 0) {
    itemsData = '';
  } else {
    const byUser = new Map<string, typeof workLogs>();
    for (const wl of workLogs) {
      const key = wl.user.username;
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(wl);
    }
    for (const [name, userLogs] of byUser) {
      itemsData += `\n## ${name}\n`;
      for (const wl of userLogs) {
        itemsData += `- [${toKSTDateString(wl.date)}] ${wl.title}: ${wl.content}\n`;
      }
    }
  }

  let byMember: string, byItem: string;
  if (!itemsData.trim()) {
    byMember = '해당 기간 보고할 내용이 없습니다.';
    byItem = '해당 기간 보고할 내용이 없습니다.';
  } else {
    const memberNames = users.map(u => u.username).join(', ');
    const periodStr = `${toKSTDateString(periodStart)} ~ ${toKSTDateString(periodEnd)}`;
    const partContext = `당신은 ${part.name} 파트의 7일간(${periodStr}) 주간 보고서를 작성하고 있습니다.\n파트 구성원: ${memberNames}\n\n절대로 파트원간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`;

    [byMember, byItem] = await Promise.all([
      callWithRetry([
        { role: 'system', content: `${partContext}다음은 ${part.name} 파트의 개인별 업무 기록입니다.\n각 개인이 수행한 업무를 개인별로 정리하여 주간 보고서 형태로 작성해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: itemsData },
      ]),
      callWithRetry([
        { role: 'system', content: `${partContext}다음은 ${part.name} 파트의 업무 기록입니다.\n동일하거나 유사한 업무 항목을 기준으로 정리하여 주간 보고서 형태로 작성해 주세요.\n어떤 인원이 해당 업무에 참여했는지도 명시해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: itemsData },
      ]),
    ]);
  }

  // Space 조회 및 보고서 저장
  let space = await prisma.space.findFirst({ where: { type: 'PART', ownerId: part.id } });
  if (!space) {
    space = await prisma.space.create({ data: { type: 'PART', ownerId: part.id, teamId } });
  }

  // 동일 기간 중복 보고서 방지 (resume 시)
  const existingReport = await prisma.report.findFirst({
    where: { spaceId: space.id, type: 'PART', periodStart, periodEnd },
  });
  if (existingReport) {
    await prisma.report.update({
      where: { id: existingReport.id },
      data: { byMemberContent: byMember, byItemContent: byItem, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
  } else {
    await prisma.report.create({
      data: {
        spaceId: space.id,
        type: 'PART',
        byMemberContent: byMember,
        byItemContent: byItem,
        periodStart,
        periodEnd,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log(`[Worker] Part report generated: ${part.name}`);
}

async function generateGroupReportWorker(
  group: { id: string; name: string; teamId: string; parts: { id: string; name: string }[] },
  periodStart: Date, periodEnd: Date,
  jobId: string, teamId: string
) {
  // 파트 보고서의 byItemContent 수집
  let partReportsData = '';
  for (const part of group.parts) {
    const partSpace = await prisma.space.findFirst({ where: { type: 'PART', ownerId: part.id } });
    if (partSpace) {
      const latestReport = await prisma.report.findFirst({
        where: { spaceId: partSpace.id },
        orderBy: { createdAt: 'desc' },
      });
      if (latestReport) {
        partReportsData += `\n## ${part.name} 파트\n${latestReport.byItemContent}\n`;
      }
    }
  }

  let byMember: string, byItem: string;
  if (!partReportsData.trim()) {
    byMember = '해당 기간 보고할 내용이 없습니다.';
    byItem = '해당 기간 보고할 내용이 없습니다.';
  } else {
    const partNames = group.parts.map(p => p.name).join(', ');
    const periodStr = `${toKSTDateString(periodStart)} ~ ${toKSTDateString(periodEnd)}`;
    const groupContext = `당신은 ${group.name} 그룹의 7일간(${periodStr}) 주간 보고서를 작성하고 있습니다.\n그룹 소속 파트: ${partNames}\n\n절대로 파트간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`;

    [byMember, byItem] = await Promise.all([
      callWithRetry([
        { role: 'system', content: `${groupContext}다음은 ${group.name} 그룹 내 각 파트의 주간 업무 정리입니다.\n각 파트의 업무를 파트 단위로 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: partReportsData },
      ]),
      callWithRetry([
        { role: 'system', content: `${groupContext}다음은 ${group.name} 그룹 내 각 파트의 주간 업무 정리입니다.\n파트 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: partReportsData },
      ]),
    ]);
  }

  let space = await prisma.space.findFirst({ where: { type: 'GROUP', ownerId: group.id } });
  if (!space) {
    space = await prisma.space.create({ data: { type: 'GROUP', ownerId: group.id, teamId } });
  }

  // 동일 기간 중복 보고서 방지 (resume 시)
  const existingReport = await prisma.report.findFirst({
    where: { spaceId: space.id, type: 'GROUP', periodStart, periodEnd },
  });
  if (existingReport) {
    await prisma.report.update({
      where: { id: existingReport.id },
      data: { byMemberContent: byMember, byItemContent: byItem, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
  } else {
    await prisma.report.create({
      data: {
        spaceId: space.id, type: 'GROUP',
        byMemberContent: byMember, byItemContent: byItem,
        periodStart, periodEnd,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log(`[Worker] Group report generated: ${group.name}`);
}

async function generateTeamReportWorker(
  team: { id: string; name: string; groups: { id: string; name: string }[] },
  periodStart: Date, periodEnd: Date,
  jobId: string
) {
  let groupReportsData = '';
  for (const group of team.groups) {
    const groupSpace = await prisma.space.findFirst({ where: { type: 'GROUP', ownerId: group.id } });
    if (groupSpace) {
      const latestReport = await prisma.report.findFirst({
        where: { spaceId: groupSpace.id },
        orderBy: { createdAt: 'desc' },
      });
      if (latestReport) {
        groupReportsData += `\n## ${group.name} 그룹\n${latestReport.byItemContent}\n`;
      }
    }
  }

  let byMember: string, byItem: string;
  if (!groupReportsData.trim()) {
    byMember = '해당 기간 보고할 내용이 없습니다.';
    byItem = '해당 기간 보고할 내용이 없습니다.';
  } else {
    const groupNames = team.groups.map(g => g.name).join(', ');
    const periodStr = `${toKSTDateString(periodStart)} ~ ${toKSTDateString(periodEnd)}`;
    const teamContext = `당신은 ${team.name} 팀의 7일간(${periodStr}) 주간 보고서를 작성하고 있습니다.\n팀 소속 그룹: ${groupNames}\n\n절대로 그룹간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`;

    [byMember, byItem] = await Promise.all([
      callWithRetry([
        { role: 'system', content: `${teamContext}다음은 ${team.name} 팀 내 각 그룹의 주간 업무 정리입니다.\n각 그룹의 업무를 그룹 단위로 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: groupReportsData },
      ]),
      callWithRetry([
        { role: 'system', content: `${teamContext}다음은 ${team.name} 팀 내 각 그룹의 주간 업무 정리입니다.\n그룹 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.` },
        { role: 'user', content: groupReportsData },
      ]),
    ]);
  }

  let space = await prisma.space.findFirst({ where: { type: 'TEAM', ownerId: team.id } });
  if (!space) {
    space = await prisma.space.create({ data: { type: 'TEAM', ownerId: team.id, teamId: team.id } });
  }

  // 동일 기간 중복 보고서 방지 (resume 시)
  const existingReport = await prisma.report.findFirst({
    where: { spaceId: space.id, type: 'TEAM', periodStart, periodEnd },
  });
  if (existingReport) {
    await prisma.report.update({
      where: { id: existingReport.id },
      data: { byMemberContent: byMember, byItemContent: byItem, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
  } else {
    await prisma.report.create({
      data: {
        spaceId: space.id, type: 'TEAM',
        byMemberContent: byMember, byItemContent: byItem,
        periodStart, periodEnd,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log(`[Worker] Team report generated: ${team.name}`);
}

// ========== Cleanup Jobs ==========
async function cleanupExpiredData() {
  const now = new Date();

  // WorkLog(업무 기록)은 개인이 직접 삭제하기 전까지 영구 보관
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 7일 경과 Report 삭제
  const deletedReports = await prisma.report.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  console.log(`[Cleanup] Deleted ${deletedReports.count} expired reports`);

  // 30일 경과 ActivityLog 삭제
  const deletedLogs = await prisma.activityLog.deleteMany({
    where: { createdAt: { lt: thirtyDaysAgo } },
  });
  console.log(`[Cleanup] Deleted ${deletedLogs.count} expired activity logs`);

  // 빈 파트 자동 삭제 (소속 사용자 0명)
  const allParts = await prisma.part.findMany({
    include: { _count: { select: { users: true } } },
  });
  let deletedParts = 0;
  for (const part of allParts) {
    if (part._count.users === 0) {
      try {
        // Space 내 Report 먼저 삭제 (FK 제약 해소)
        const partSpaces = await prisma.space.findMany({ where: { type: 'PART', ownerId: part.id } });
        for (const s of partSpaces) {
          await prisma.report.deleteMany({ where: { spaceId: s.id } });
        }
        await prisma.space.deleteMany({ where: { type: 'PART', ownerId: part.id } });
        await prisma.part.delete({ where: { id: part.id } });
        deletedParts++;
      } catch { /* 동시 접근 시 무시 */ }
    }
  }
  if (deletedParts > 0) console.log(`[Cleanup] Deleted ${deletedParts} empty parts`);

  // 빈 그룹 자동 삭제 (소속 사용자 0명 + 소속 파트 0개)
  const allGroups = await prisma.group.findMany({
    include: { _count: { select: { users: true, parts: true } } },
  });
  let deletedGroups = 0;
  for (const group of allGroups) {
    if (group._count.users === 0 && group._count.parts === 0) {
      try {
        // Space 내 Report 먼저 삭제 (FK 제약 해소)
        const groupSpaces = await prisma.space.findMany({ where: { type: 'GROUP', ownerId: group.id } });
        for (const s of groupSpaces) {
          await prisma.report.deleteMany({ where: { spaceId: s.id } });
        }
        await prisma.space.deleteMany({ where: { type: 'GROUP', ownerId: group.id } });
        await prisma.group.delete({ where: { id: group.id } });
        deletedGroups++;
      } catch { /* 동시 접근 시 무시 */ }
    }
  }
  if (deletedGroups > 0) console.log(`[Cleanup] Deleted ${deletedGroups} empty groups`);
}

// ========== Progress Update ==========
async function updateProgressForTeam(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { groups: { include: { parts: true } } },
  });
  if (!team) return;

  // Phase 1: 파트 Item → linkedTodos/WorkLogs 기반
  for (const group of team.groups) {
    for (const part of group.parts) {
      const partItems = await prisma.item.findMany({
        where: { level: 'PART', ownerId: part.id, status: { not: 'COMPLETED' } },
      });
      for (const item of partItems) {
        try {
          const todos = await prisma.todo.findMany({
            where: { linkedItemId: item.id },
            select: { title: true, completed: true },
          });
          const workLogs = await prisma.workLog.findMany({
            where: { linkedItemId: item.id },
            select: { title: true, date: true },
            orderBy: { date: 'desc' },
            take: 20,
          });
          if (todos.length === 0 && workLogs.length === 0) continue;

          let childData = '';
          if (todos.length > 0) {
            childData += `## 연결된 할일\n${todos.map(t => `- [${t.completed ? '완료' : '미완료'}] ${t.title}`).join('\n')}\n`;
          }
          if (workLogs.length > 0) {
            childData += `## 연결된 업무기록\n${workLogs.map(w => `- [${toKSTDateString(w.date)}] ${w.title}`).join('\n')}\n`;
          }

          const result = await callProgressLLM(item, childData);
          await prisma.item.update({
            where: { id: item.id },
            data: { progress: result.progress, summary: result.summary },
          });
        } catch (e) {
          console.error(`[Progress] Part item ${item.id} failed:`, e);
        }
      }
    }
  }

  // Phase 2: 그룹 Item → 하위 파트 Item 기반
  for (const group of team.groups) {
    const groupItems = await prisma.item.findMany({
      where: { level: 'GROUP', ownerId: group.id, status: { not: 'COMPLETED' } },
    });
    for (const item of groupItems) {
      try {
        const childItems = await prisma.item.findMany({
          where: { parentItemId: item.id },
          select: { title: true, progress: true, status: true },
        });
        if (childItems.length === 0) continue;

        const childData = `## 하위 목표\n${childItems.map(c => `- [${c.status}, ${c.progress}%] ${c.title}`).join('\n')}`;
        const result = await callProgressLLM(item, childData);
        await prisma.item.update({
          where: { id: item.id },
          data: { progress: result.progress, summary: result.summary },
        });
      } catch (e) {
        console.error(`[Progress] Group item ${item.id} failed:`, e);
      }
    }
  }

  // Phase 3: 팀 Item → 하위 그룹 Item 기반
  const teamItems = await prisma.item.findMany({
    where: { level: 'TEAM', ownerId: teamId, status: { not: 'COMPLETED' } },
  });
  for (const item of teamItems) {
    try {
      const childItems = await prisma.item.findMany({
        where: { parentItemId: item.id },
        select: { title: true, progress: true, status: true },
      });
      if (childItems.length === 0) continue;

      const childData = `## 하위 목표\n${childItems.map(c => `- [${c.status}, ${c.progress}%] ${c.title}`).join('\n')}`;
      const result = await callProgressLLM(item, childData);
      await prisma.item.update({
        where: { id: item.id },
        data: { progress: result.progress, summary: result.summary },
      });
    } catch (e) {
      console.error(`[Progress] Team item ${item.id} failed:`, e);
    }
  }

  console.log(`[Progress] Updated progress for team ${team.name}`);
}

async function callProgressLLM(
  item: { id: string; title: string; content: string },
  childData: string
): Promise<{ progress: number; summary: string }> {
  const systemPrompt = `당신은 목표 진행률 분석 도우미입니다.

## 목표
- 제목: ${item.title}
- 설명: ${item.content}

## 작업
아래 하위 데이터를 분석하여 이 목표의 진행률과 진척사항을 판단해 주세요.

다음 JSON 형식으로 출력하세요:
{ "progress": 0~100, "summary": "진척사항 1-2문장" }

반드시 유효한 JSON만 출력하세요.`;

  const result = await callWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: childData },
  ]);

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { progress: 0, summary: '' };

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    progress: Math.max(0, Math.min(100, Number(parsed.progress) || 0)),
    summary: String(parsed.summary || ''),
  };
}

// ========== OrgWorkLog Aggregation ==========
async function generateOrgWorkLogs() {
  const yesterday = getKSTTodayForDB();
  yesterday.setDate(yesterday.getDate() - 1);

  const teams = await prisma.team.findMany({
    include: {
      businessUnit: true,
      groups: { include: { parts: true } },
    },
  });

  for (const team of teams) {
    try {
      // Phase A: Part OrgWorkLog — 개인 WorkLog → Part 요약
      for (const group of team.groups) {
        for (const part of group.parts) {
          const partGoals = await prisma.item.findMany({
            where: { level: 'PART', ownerId: part.id },
          });
          for (const goal of partGoals) {
            try {
              const workLogs = await prisma.workLog.findMany({
                where: { linkedItemId: goal.id, date: yesterday },
                include: { user: { select: { username: true } } },
              });
              if (workLogs.length === 0) continue;

              const logsText = workLogs.map(w => `- ${w.user.username}: ${w.title} - ${w.content}`).join('\n');
              const content = await callOrgWorkLogLLM(part.name, goal.title, logsText);

              await prisma.orgWorkLog.upsert({
                where: { level_ownerId_goalId_date: { level: 'PART', ownerId: part.id, goalId: goal.id, date: yesterday } },
                update: { content },
                create: { level: 'PART', ownerId: part.id, goalId: goal.id, date: yesterday, content },
              });
            } catch (e) {
              console.error(`[OrgWorkLog] Part goal ${goal.id} failed:`, e);
            }
          }
        }
      }

      // Phase B: Group OrgWorkLog — Part OrgWorkLog → Group 요약
      for (const group of team.groups) {
        const groupGoals = await prisma.item.findMany({
          where: { level: 'GROUP', ownerId: group.id },
          include: { childItems: { select: { id: true, ownerId: true } } },
        });
        for (const goal of groupGoals) {
          try {
            const childGoalIds = goal.childItems.map(c => c.id);
            if (childGoalIds.length === 0) continue;

            const partLogs = await prisma.orgWorkLog.findMany({
              where: { level: 'PART', goalId: { in: childGoalIds }, date: yesterday },
              include: { goal: { select: { title: true, ownerId: true } } },
            });
            if (partLogs.length === 0) continue;

            // ownerId → part name 맵
            const partIds = [...new Set(partLogs.map(l => l.goal.ownerId))];
            const parts = await prisma.part.findMany({ where: { id: { in: partIds } }, select: { id: true, name: true } });
            const partNameMap = new Map(parts.map(p => [p.id, p.name]));

            const logsText = partLogs.map(l => `- ${partNameMap.get(l.goal.ownerId) || '파트'} (${l.goal.title}): ${l.content}`).join('\n');
            const content = await callOrgWorkLogLLM(group.name, goal.title, logsText);

            await prisma.orgWorkLog.upsert({
              where: { level_ownerId_goalId_date: { level: 'GROUP', ownerId: group.id, goalId: goal.id, date: yesterday } },
              update: { content },
              create: { level: 'GROUP', ownerId: group.id, goalId: goal.id, date: yesterday, content },
            });
          } catch (e) {
            console.error(`[OrgWorkLog] Group goal ${goal.id} failed:`, e);
          }
        }
      }

      // Phase C: Team OrgWorkLog — Group OrgWorkLog → Team 요약
      const teamGoals = await prisma.item.findMany({
        where: { level: 'TEAM', ownerId: team.id },
        include: { childItems: { select: { id: true, ownerId: true } } },
      });
      for (const goal of teamGoals) {
        try {
          const childGoalIds = goal.childItems.map(c => c.id);
          if (childGoalIds.length === 0) continue;

          const groupLogs = await prisma.orgWorkLog.findMany({
            where: { level: 'GROUP', goalId: { in: childGoalIds }, date: yesterday },
            include: { goal: { select: { title: true, ownerId: true } } },
          });
          if (groupLogs.length === 0) continue;

          const groupIds = [...new Set(groupLogs.map(l => l.goal.ownerId))];
          const groups = await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } });
          const groupNameMap = new Map(groups.map(g => [g.id, g.name]));

          const logsText = groupLogs.map(l => `- ${groupNameMap.get(l.goal.ownerId) || '그룹'} (${l.goal.title}): ${l.content}`).join('\n');
          const content = await callOrgWorkLogLLM(team.name, goal.title, logsText);

          await prisma.orgWorkLog.upsert({
            where: { level_ownerId_goalId_date: { level: 'TEAM', ownerId: team.id, goalId: goal.id, date: yesterday } },
            update: { content },
            create: { level: 'TEAM', ownerId: team.id, goalId: goal.id, date: yesterday, content },
          });
        } catch (e) {
          console.error(`[OrgWorkLog] Team goal ${goal.id} failed:`, e);
        }
      }

      console.log(`[OrgWorkLog] Completed for team ${team.name}`);
    } catch (e) {
      console.error(`[OrgWorkLog] Team ${team.name} failed:`, e);
    }
  }

  // Phase D: BU OrgWorkLog — Team OrgWorkLog → BU 요약
  const bus = await prisma.businessUnit.findMany({ include: { teams: true } });
  for (const bu of bus) {
    const buGoals = await prisma.item.findMany({
      where: { level: 'BU', ownerId: bu.id },
      include: { childItems: { select: { id: true, ownerId: true } } },
    });
    for (const goal of buGoals) {
      try {
        const childGoalIds = goal.childItems.map(c => c.id);
        if (childGoalIds.length === 0) continue;

        const teamLogs = await prisma.orgWorkLog.findMany({
          where: { level: 'TEAM', goalId: { in: childGoalIds }, date: yesterday },
          include: { goal: { select: { title: true, ownerId: true } } },
        });
        if (teamLogs.length === 0) continue;

        const teamIds = [...new Set(teamLogs.map(l => l.goal.ownerId))];
        const buTeams = await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } });
        const teamNameMap = new Map(buTeams.map(t => [t.id, t.name]));

        const logsText = teamLogs.map(l => `- ${teamNameMap.get(l.goal.ownerId) || '팀'} (${l.goal.title}): ${l.content}`).join('\n');
        const content = await callOrgWorkLogLLM(bu.name, goal.title, logsText);

        await prisma.orgWorkLog.upsert({
          where: { level_ownerId_goalId_date: { level: 'BU', ownerId: bu.id, goalId: goal.id, date: yesterday } },
          update: { content },
          create: { level: 'BU', ownerId: bu.id, goalId: goal.id, date: yesterday, content },
        });
      } catch (e) {
        console.error(`[OrgWorkLog] BU goal ${goal.id} failed:`, e);
      }
    }
    if (buGoals.length > 0) console.log(`[OrgWorkLog] Completed for BU ${bu.name}`);
  }

  // BU 목표 진행률 업데이트
  for (const bu of bus) {
    const buGoals = await prisma.item.findMany({
      where: { level: 'BU', ownerId: bu.id, status: { not: 'COMPLETED' } },
    });
    for (const item of buGoals) {
      try {
        const childItems = await prisma.item.findMany({
          where: { parentItemId: item.id },
          select: { title: true, progress: true, status: true },
        });
        if (childItems.length === 0) continue;

        const childData = `## 하위 목표\n${childItems.map(c => `- [${c.status}, ${c.progress}%] ${c.title}`).join('\n')}`;
        const result = await callProgressLLM(item, childData);
        await prisma.item.update({
          where: { id: item.id },
          data: { progress: result.progress, summary: result.summary },
        });
      } catch (e) {
        console.error(`[Progress] BU item ${item.id} failed:`, e);
      }
    }
  }
}

async function callOrgWorkLogLLM(orgName: string, goalTitle: string, logsText: string): Promise<string> {
  const systemPrompt = `당신은 조직 업무 요약 도우미입니다.

"${orgName}"의 "${goalTitle}" 목표에 연결된 어제 업무 기록을 1-3문장으로 요약해 주세요.
구체적 수치/결과를 포함하고, 핵심만 간결하게 작성하세요.

반드시 요약 텍스트만 출력하세요. 다른 형식이나 태그는 포함하지 마세요.`;

  return await callWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: logsText },
  ]);
}

// ========== BullMQ Workers ==========
const cleanupWorker = new Worker('cleanup', async () => {
  await cleanupExpiredData();
}, { connection });

// progress-update Worker
const progressWorker = new Worker('progress-update', async (job) => {
  if (job.data.type === 'scheduled') {
    const teams = await prisma.team.findMany();
    for (const team of teams) {
      try {
        await updateProgressForTeam(team.id);
      } catch (e) {
        console.error(`[Progress] Team ${team.name} failed:`, e);
      }
    }
  } else if (job.data.teamId) {
    await updateProgressForTeam(job.data.teamId);
  }
}, { connection, concurrency: 1 });

progressWorker.on('failed', (job, err) => {
  console.error(`[Progress] Job ${job?.id} failed:`, err.message);
});

// OrgWorkLog Worker
const orgWorkLogWorker = new Worker('org-worklog', async () => {
  await generateOrgWorkLogs();
}, { connection, concurrency: 1 });

orgWorkLogWorker.on('failed', (job, err) => {
  console.error(`[OrgWorkLog] Job ${job?.id} failed:`, err.message);
});

// ========== Scheduled Jobs ==========
const reportQueue = new Queue('report-generation', { connection });
const cleanupQueue = new Queue('cleanup', { connection });
const progressQueue = new Queue('progress-update', { connection });
const orgWorkLogQueue = new Queue('org-worklog', { connection });

async function setupScheduledJobs() {
  // 매일 0시 - 보고서 생성 (팀별 병렬)
  await reportQueue.upsertJobScheduler('daily-report', {
    pattern: '0 0 * * *', // 매일 0시
    tz: 'Asia/Seoul',
  }, {
    name: 'daily-report-trigger',
    data: { type: 'scheduled' },
  });

  // 매일 1시 - 만료 데이터 정리
  await cleanupQueue.upsertJobScheduler('daily-cleanup', {
    pattern: '0 1 * * *', // 매일 1시
    tz: 'Asia/Seoul',
  }, {
    name: 'daily-cleanup',
    data: {},
  });

  // 매일 1시 30분 - 목표 진행률 업데이트 (보고서 후)
  await progressQueue.upsertJobScheduler('daily-progress', {
    pattern: '30 1 * * *', // 매일 1시 30분
    tz: 'Asia/Seoul',
  }, {
    name: 'daily-progress',
    data: { type: 'scheduled' },
  });

  // 매일 2시 - OrgWorkLog 합산 (진행률 업데이트 후)
  await orgWorkLogQueue.upsertJobScheduler('daily-org-worklog', {
    pattern: '0 2 * * *', // 매일 2시
    tz: 'Asia/Seoul',
  }, {
    name: 'daily-org-worklog',
    data: {},
  });

  console.log('[Worker] Scheduled jobs configured');
}

// 보고서 생성 Worker (스케줄 트리거 + 개별 팀 보고서 + resume 모두 처리)
const reportWorker = new Worker('report-generation', async (job) => {
  if (job.data.type === 'scheduled') {
    // 모든 팀에 대해 보고서 생성 작업 추가 (팀 간 병렬)
    const teams = await prisma.team.findMany();
    for (const team of teams) {
      await reportQueue.add(`team-report-${team.id}`, {
        teamId: team.id,
      });
    }
  } else if (job.data.teamId) {
    await generateReportsForTeam(job.data.teamId, job.data.resumeFrom);
  }
}, { connection, concurrency: 10 });

reportWorker.on('completed', async (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
  // 보고서 완료 후 해당 팀 진행률 업데이트 트리거
  if (job.data.teamId) {
    try {
      await progressQueue.add(`post-report-${job.data.teamId}`, { teamId: job.data.teamId });
      console.log(`[Worker] Progress update triggered after report for team ${job.data.teamId}`);
    } catch (e) {
      console.error(`[Worker] Failed to trigger progress update:`, e);
    }
  }
});

reportWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

// ========== Start ==========
async function start() {
  console.log('[FREE Worker] Starting...');
  await setupScheduledJobs();
  console.log('[FREE Worker] Ready. Listening for jobs...');
}

start().catch(console.error);

process.on('SIGTERM', async () => {
  await reportWorker.close();
  await cleanupWorker.close();
  await progressWorker.close();
  await orgWorkLogWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
