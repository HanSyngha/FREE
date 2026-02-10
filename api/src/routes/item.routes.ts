/**
 * Item Routes - 업무 기록 CRUD
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { itemCreateLimit, llmLimit } from '../middleware/rateLimit.js';
import { parseItemsWithLLM } from '../services/llm.service.js';
import { getKSTTodayString, getKSTMidnight, parseKSTDate } from '../utils/date.js';

export const itemRoutes = Router();

// POST /items - 텍스트 제출 → LLM item 분리 → 저장
itemRoutes.post('/', authenticateToken, loadUser, itemCreateLimit, llmLimit, async (req: AuthenticatedRequest, res) => {
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

    // 개인 Space 조회
    const personalSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    if (!personalSpace) {
      res.status(500).json({ error: 'Personal space not found' });
      return;
    }

    // User context
    const team = await prisma.team.findUnique({ where: { id: user.teamId! } });
    const group = await prisma.group.findUnique({ where: { id: user.groupId } });
    const part = await prisma.part.findUnique({ where: { id: user.partId } });

    const today = getKSTTodayString();

    // 날짜 유효성 검사 (29일 전 ~ 오늘, 미래 불가, KST 기준)
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

    // LLM으로 item 분리
    // today는 항상 실제 오늘 날짜 (날짜 검증용), defaultDate는 사용자가 선택한 날짜 (fallback용)
    const preferences = (user.preferences as Record<string, string>) || {};
    const parsedItems = await parseItemsWithLLM(
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
      },
      {
        loginid: user.loginid,
        username: user.username,
        deptname: user.deptname,
      }
    );

    // LLM이 빈 결과를 반환한 경우
    if (!parsedItems || parsedItems.length === 0) {
      res.status(400).json({ error: '입력 내용에서 업무 항목을 추출할 수 없었습니다. 다시 시도해 주세요.' });
      return;
    }

    // DB 저장
    const createdItems = await Promise.all(
      parsedItems.map(item =>
        prisma.item.create({
          data: {
            userId: user.id,
            spaceId: personalSpace.id,
            title: item.title,
            content: item.content,
            date: parseKSTDate(item.date),
          },
        })
      )
    );

    // 활동 로그
    for (const item of createdItems) {
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'CREATE_ITEM',
          targetType: 'ITEM',
          targetId: item.id,
          details: item.title,
        },
      });
    }

    // requestCount 증가 (atomic update로 race condition 방지)
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { requestCount: { increment: 1 } },
    });

    // Rating 체크 (20회마다)
    const shouldRate = updatedUser.requestCount > 0 && updatedUser.requestCount % 20 === 0;

    res.json({
      success: true,
      items: createdItems,
      shouldRate,
      requestCount: updatedUser?.requestCount || 0,
    });
  } catch (error: any) {
    console.error('Create items error:', error);
    res.status(500).json({ error: '정리에 실패했습니다. 다시 시도해 주세요.' });
  }
});

// PUT /items/:id - Item 수정
itemRoutes.put('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    if (item.userId !== user.id) { res.status(403).json({ error: '본인의 item만 수정할 수 있습니다.' }); return; }

    const { title, content, link, date } = req.body;
    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (link !== undefined) {
      if (link === '' || link === null) {
        updateData.link = null;
      } else {
        // URL 검증: http/https만 허용 (javascript: XSS 방지)
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
      if (isNaN(newDate.getTime())) {
        res.status(400).json({ error: '유효하지 않은 날짜 형식입니다.' });
        return;
      }
      const todayMidnight = getKSTMidnight();
      const minDate = new Date(todayMidnight);
      minDate.setDate(minDate.getDate() - 29);
      if (newDate > todayMidnight || newDate < minDate) {
        res.status(400).json({ error: '유효하지 않은 날짜입니다.' });
        return;
      }
      updateData.date = newDate;
    }

    const updated = await prisma.item.update({ where: { id }, data: updateData });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'UPDATE_ITEM',
        targetType: 'ITEM',
        targetId: id,
        details: updated.title,
      },
    });

    res.json({ success: true, item: updated });
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// POST /items/external - 인증 없이 loginid로 업무 항목 직접 추가
itemRoutes.post('/external', async (req, res) => {
  try {
    const { loginid, items } = req.body;
    if (!loginid || typeof loginid !== 'string') {
      res.status(400).json({ error: 'loginid는 필수입니다.' }); return;
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items 배열은 필수입니다.' });
      return;
    }
    if (items.length > 100) {
      res.status(400).json({ error: '한 번에 최대 100개 항목까지 입력 가능합니다.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) {
      res.status(404).json({
        error: `사용자를 찾을 수 없습니다: ${loginid}. 먼저 웹에서 로그인하세요.`,
        link: 'https://52.78.246.50.nip.io:6090',
      });
      return;
    }
    if (!user.teamId) {
      res.status(400).json({
        error: `해당 사용자(${loginid})의 팀이 배정되지 않았습니다. 먼저 웹에서 로그인하세요.`,
        link: 'https://52.78.246.50.nip.io:6090',
      });
      return;
    }
    if (!user.groupId || !user.partId) {
      res.status(400).json({
        error: `해당 사용자(${loginid})의 그룹/파트 설정이 필요합니다. 먼저 웹에서 온보딩을 완료하세요.`,
        link: 'https://52.78.246.50.nip.io:6090',
      });
      return;
    }

    const personalSpace = await prisma.space.findFirst({
      where: { type: 'PERSONAL', ownerId: user.id },
    });
    if (!personalSpace) {
      res.status(500).json({ error: `사용자(${loginid})의 개인 공간이 없습니다.` });
      return;
    }

    const todayDate = getKSTMidnight();
    const minDate = new Date(todayDate);
    minDate.setDate(minDate.getDate() - 29);

    // 사전 검증 (DB 쓰기 전에 모든 항목 유효성 확인)
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        res.status(400).json({ error: 'items 배열의 각 요소는 객체여야 합니다.' });
        return;
      }
      if (!item.title || !item.content) {
        res.status(400).json({ error: '각 항목에 title과 content가 필요합니다.' });
        return;
      }
      if (item.date) {
        const d = parseKSTDate(item.date);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: `유효하지 않은 날짜 형식입니다: ${item.date}` });
          return;
        }
        if (d > todayDate || d < minDate) {
          res.status(400).json({ error: `유효하지 않은 날짜입니다: ${item.date} (29일 전 ~ 오늘)` });
          return;
        }
      }
    }

    // 트랜잭션으로 전체 생성 (중간 실패 시 롤백)
    const createdItems = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        const itemDate = item.date ? parseKSTDate(item.date) : todayDate;

        const created = await tx.item.create({
          data: {
            userId: user.id,
            spaceId: personalSpace.id,
            title: String(item.title).slice(0, 500),
            content: String(item.content).slice(0, 10000),
            date: itemDate,
          },
        });
        results.push(created);

        await tx.activityLog.create({
          data: {
            userId: user.id,
            action: 'CREATE_ITEM',
            targetType: 'ITEM',
            targetId: created.id,
            details: `[External] ${created.title}`,
          },
        });
      }
      return results;
    });

    console.log(`[External] ${createdItems.length} items created for ${loginid}`);
    res.json({
      success: true,
      items: createdItems,
      count: createdItems.length,
      message: `${createdItems.length}건의 업무가 추가되었습니다. 아래 링크에서 확인하세요.`,
      link: 'https://52.78.246.50.nip.io:6090',
    });
  } catch (error) {
    console.error('External create items error:', error);
    res.status(500).json({ error: '업무 항목 생성에 실패했습니다.' });
  }
});

// DELETE /items/:id - Item 영구 삭제
itemRoutes.delete('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    if (item.userId !== user.id) { res.status(403).json({ error: '본인의 item만 삭제할 수 있습니다.' }); return; }

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'DELETE_ITEM',
        targetType: 'ITEM',
        targetId: id,
        details: item.title,
      },
    });

    await prisma.item.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});
