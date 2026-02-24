/**
 * WorkLog Routes - 업무 기록 CRUD (기존 Item)
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser, isSuperAdmin } from '../middleware/auth.js';
import { itemCreateLimit, llmLimit } from '../middleware/rateLimit.js';
import { parseTextWithLLM } from '../services/llm.service.js';
import { getKSTTodayString, getKSTMidnight, parseKSTDate } from '../utils/date.js';

export const worklogRoutes = Router();

// POST /worklogs - 텍스트 제출 → LLM → WorkLog + Todo 분리 → 저장
worklogRoutes.post('/', authenticateToken, loadUser, itemCreateLimit, llmLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.groupId || !user.partId) {
      res.status(400).json({ error: '그룹/파트 설정이 필요합니다.' });
      return;
    }

    const { text, date } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: '텍스트를 입력해 주세요.' });
      return;
    }
    if (text.length > 50000) {
      res.status(400).json({ error: '최대 50,000자까지 입력 가능합니다.' });
      return;
    }

    const personalSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    if (!personalSpace) {
      res.status(500).json({ error: 'Personal space not found' });
      return;
    }

    const team = await prisma.team.findUnique({ where: { id: user.teamId! } });
    const group = await prisma.group.findUnique({ where: { id: user.groupId } });
    const part = await prisma.part.findUnique({ where: { id: user.partId } });

    const today = getKSTTodayString();

    if (date) {
      const inputDate = parseKSTDate(date);
      if (isNaN(inputDate.getTime())) {
        res.status(400).json({ error: '유효하지 않은 날짜 형식입니다.' });
        return;
      }
      const todayDate = getKSTMidnight();
      const minDate = new Date(todayDate);
      minDate.setDate(minDate.getDate() - 29);
      if (inputDate > todayDate || inputDate < minDate) {
        res.status(400).json({ error: '날짜는 29일 전부터 오늘까지만 선택 가능합니다.' });
        return;
      }
    }

    // 파트 Item(목표) 목록 조회 (LLM 연결용)
    const partItems = await prisma.item.findMany({
      where: { level: 'PART', ownerId: user.partId, status: { not: 'COMPLETED' } },
      select: { id: true, title: true },
    });

    // 미완료 Todo 목록 조회 (중복 방지용)
    const existingTodos = await prisma.todo.findMany({
      where: { userId: user.id, completed: false },
      select: { id: true, title: true },
    });

    const preferences = (user.preferences as Record<string, string>) || {};
    const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };

    const parsed = await parseTextWithLLM(
      text,
      {
        username: user.username,
        businessUnit: user.businessUnit,
        teamName: team?.name || '',
        groupName: group?.name || '',
        partName: part?.name || '',
        today,
        defaultDate: date || today,
        preferences,
        partItems: partItems.map(i => ({ id: i.id, title: i.title })),
        existingTodos: existingTodos.map(t => ({ id: t.id, title: t.title })),
      },
      userInfo
    );

    if ((!parsed.workLogs || parsed.workLogs.length === 0) && (!parsed.todos || parsed.todos.length === 0)) {
      res.status(400).json({ error: '입력 내용에서 업무 항목을 추출할 수 없었습니다. 다시 시도해 주세요.' });
      return;
    }

    // WorkLog 저장
    const createdWorkLogs = await Promise.all(
      (parsed.workLogs || []).map(wl =>
        prisma.workLog.create({
          data: {
            userId: user.id,
            spaceId: personalSpace.id,
            title: wl.title,
            content: wl.content,
            date: parseKSTDate(wl.date),
            linkedItemId: wl.linkedItemId || null,
          },
        })
      )
    );

    // Todo 저장
    const createdTodos = await Promise.all(
      (parsed.todos || []).map(todo =>
        prisma.todo.create({
          data: {
            userId: user.id,
            spaceId: personalSpace.id,
            title: todo.title,
            endDate: todo.endDate ? parseKSTDate(todo.endDate) : null,
            linkedItemId: todo.linkedItemId || null,
          },
        })
      )
    );

    // 활동 로그
    for (const wl of createdWorkLogs) {
      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CREATE_WORKLOG', targetType: 'WORKLOG', targetId: wl.id, details: wl.title },
      });
    }
    for (const todo of createdTodos) {
      await prisma.activityLog.create({
        data: { userId: user.id, action: 'CREATE_TODO', targetType: 'TODO', targetId: todo.id, details: todo.title },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { requestCount: { increment: 1 } },
    });

    const shouldRate = updatedUser.requestCount > 0 && updatedUser.requestCount % 20 === 0;

    res.json({
      success: true,
      workLogs: createdWorkLogs,
      todos: createdTodos,
      shouldRate,
      requestCount: updatedUser.requestCount,
    });
  } catch (error: any) {
    console.error('Create worklogs error:', error);
    res.status(500).json({ error: '정리에 실패했습니다. 다시 시도해 주세요.' });
  }
});

// GET /worklogs/external - 인증 없이 loginid로 오늘의 업무 목록 조회
worklogRoutes.get('/external', async (req, res) => {
  try {
    const loginid = req.query.loginid as string;
    if (!loginid || typeof loginid !== 'string') {
      res.status(400).json({ error: 'loginid는 필수입니다.' }); return;
    }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) {
      res.status(404).json({
        error: `사용자를 찾을 수 없습니다: ${loginid}. 먼저 웹에서 로그인하세요.`,
        link: 'https://52.78.246.50.nip.io:6090',
      });
      return;
    }

    const dateStr = (req.query.date as string) || getKSTTodayString();
    const targetDate = parseKSTDate(dateStr);
    if (isNaN(targetDate.getTime())) {
      res.status(400).json({ error: '유효하지 않은 날짜 형식입니다.' }); return;
    }

    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const workLogs = await prisma.workLog.findMany({
      where: { userId: user.id, date: { gte: targetDate, lt: nextDate } },
      select: { id: true, title: true, content: true, date: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, items: workLogs, count: workLogs.length, date: dateStr });
  } catch (error) {
    console.error('External get worklogs error:', error);
    res.status(500).json({ error: '업무 목록 조회에 실패했습니다.' });
  }
});

// PUT /worklogs/external/:id - 인증 없이 loginid로 개별 worklog 수정
worklogRoutes.put('/external/:id', async (req, res) => {
  try {
    const { loginid, title, content } = req.body;
    const worklogId = req.params.id as string;

    if (!loginid || typeof loginid !== 'string') {
      res.status(400).json({ error: 'loginid는 필수입니다.' }); return;
    }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) {
      res.status(404).json({
        error: `사용자를 찾을 수 없습니다: ${loginid}. 먼저 웹에서 로그인하세요.`,
        link: 'https://52.78.246.50.nip.io:6090',
      });
      return;
    }

    const worklog = await prisma.workLog.findUnique({ where: { id: worklogId } });
    if (!worklog) { res.status(404).json({ error: 'WorkLog not found' }); return; }
    if (worklog.userId !== user.id) { res.status(403).json({ error: '본인의 업무 기록만 수정할 수 있습니다.' }); return; }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: '수정할 항목(title 또는 content)이 필요합니다.' }); return;
    }

    const updated = await prisma.workLog.update({ where: { id: worklogId }, data: updateData });

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'UPDATE_WORKLOG', targetType: 'WORKLOG', targetId: worklogId, details: `[External] ${updated.title}` },
    });

    res.json({ success: true, item: updated });
  } catch (error) {
    console.error('External update worklog error:', error);
    res.status(500).json({ error: '업무 항목 수정에 실패했습니다.' });
  }
});

// PUT /worklogs/:id - WorkLog 수정
worklogRoutes.put('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const worklog = await prisma.workLog.findUnique({ where: { id } });
    if (!worklog) { res.status(404).json({ error: 'WorkLog not found' }); return; }
    if (worklog.userId !== user.id) { res.status(403).json({ error: '본인의 업무 기록만 수정할 수 있습니다.' }); return; }

    const { title, content, link, date, linkedItemId } = req.body;
    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (link !== undefined) {
      if (link === '' || link === null) {
        updateData.link = null;
      } else {
        try {
          const url = new URL(String(link));
          if (!['http:', 'https:'].includes(url.protocol)) {
            res.status(400).json({ error: '유효하지 않은 URL입니다. http 또는 https URL만 허용됩니다.' });
            return;
          }
          updateData.link = url.toString();
        } catch {
          res.status(400).json({ error: '유효하지 않은 URL 형식입니다.' });
          return;
        }
      }
    }
    if (date !== undefined) {
      const newDate = parseKSTDate(date);
      if (isNaN(newDate.getTime())) { res.status(400).json({ error: '유효하지 않은 날짜 형식입니다.' }); return; }
      const todayMidnight = getKSTMidnight();
      const minDate = new Date(todayMidnight);
      minDate.setDate(minDate.getDate() - 29);
      if (newDate > todayMidnight || newDate < minDate) { res.status(400).json({ error: '유효하지 않은 날짜입니다.' }); return; }
      updateData.date = newDate;
    }
    if (linkedItemId !== undefined) {
      updateData.linkedItemId = linkedItemId || null;
    }

    const updated = await prisma.workLog.update({ where: { id }, data: updateData });

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'UPDATE_WORKLOG', targetType: 'WORKLOG', targetId: id, details: updated.title },
    });

    res.json({ success: true, item: updated });
  } catch (error) {
    console.error('Update worklog error:', error);
    res.status(500).json({ error: 'Failed to update worklog' });
  }
});

// POST /worklogs/external - 인증 없이 loginid로 업무 항목 직접 추가
worklogRoutes.post('/external', async (req, res) => {
  try {
    const { loginid, items } = req.body;
    if (!loginid || typeof loginid !== 'string') { res.status(400).json({ error: 'loginid는 필수입니다.' }); return; }
    if (!items || !Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'items 배열은 필수입니다.' }); return; }
    if (items.length > 100) { res.status(400).json({ error: '한 번에 최대 100개 항목까지 입력 가능합니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) {
      res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}. 먼저 웹에서 로그인하세요.`, link: 'https://52.78.246.50.nip.io:6090' });
      return;
    }
    if (!user.teamId) { res.status(400).json({ error: `해당 사용자(${loginid})의 팀이 배정되지 않았습니다.`, link: 'https://52.78.246.50.nip.io:6090' }); return; }
    if (!user.groupId || !user.partId) { res.status(400).json({ error: `해당 사용자(${loginid})의 그룹/파트 설정이 필요합니다.`, link: 'https://52.78.246.50.nip.io:6090' }); return; }

    const personalSpace = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!personalSpace) { res.status(500).json({ error: `사용자(${loginid})의 개인 공간이 없습니다.` }); return; }

    const todayDate = getKSTMidnight();
    const minDate = new Date(todayDate);
    minDate.setDate(minDate.getDate() - 29);

    for (const item of items) {
      if (!item || typeof item !== 'object') { res.status(400).json({ error: 'items 배열의 각 요소는 객체여야 합니다.' }); return; }
      if (!item.title || !item.content) { res.status(400).json({ error: '각 항목에 title과 content가 필요합니다.' }); return; }
      if (item.date) {
        const d = parseKSTDate(item.date);
        if (isNaN(d.getTime())) { res.status(400).json({ error: `유효하지 않은 날짜 형식입니다: ${item.date}` }); return; }
        if (d > todayDate || d < minDate) { res.status(400).json({ error: `유효하지 않은 날짜입니다: ${item.date} (29일 전 ~ 오늘)` }); return; }
      }
    }

    const createdItems = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        const itemDate = item.date ? parseKSTDate(item.date) : todayDate;
        const created = await tx.workLog.create({
          data: { userId: user.id, spaceId: personalSpace.id, title: String(item.title).slice(0, 500), content: String(item.content).slice(0, 10000), date: itemDate },
        });
        results.push(created);
        await tx.activityLog.create({
          data: { userId: user.id, action: 'CREATE_WORKLOG', targetType: 'WORKLOG', targetId: created.id, details: `[External] ${created.title}` },
        });
      }
      return results;
    });

    res.json({ success: true, items: createdItems, count: createdItems.length, message: `${createdItems.length}건의 업무가 추가되었습니다.`, link: 'https://52.78.246.50.nip.io:6090' });
  } catch (error) {
    console.error('External create worklogs error:', error);
    res.status(500).json({ error: '업무 항목 생성에 실패했습니다.' });
  }
});

// DELETE /worklogs/:id - WorkLog 영구 삭제
worklogRoutes.delete('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const worklog = await prisma.workLog.findUnique({ where: { id } });
    if (!worklog) { res.status(404).json({ error: 'WorkLog not found' }); return; }
    if (worklog.userId !== user.id && !isSuperAdmin(user.loginid)) {
      res.status(403).json({ error: '본인의 업무 기록만 삭제할 수 있습니다.' }); return;
    }

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'DELETE_WORKLOG', targetType: 'WORKLOG', targetId: id, details: worklog.title },
    });

    await prisma.workLog.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete worklog error:', error);
    res.status(500).json({ error: 'Failed to delete worklog' });
  }
});
