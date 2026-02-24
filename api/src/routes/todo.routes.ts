/**
 * Todo Routes - 개인 할일 CRUD + CLI 호환 external
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { llmLimit } from '../middleware/rateLimit.js';
import { linkTodoToItem } from '../services/llm.service.js';

export const todoRoutes = Router();

// GET /todos - Todo 목록
todoRoutes.get('/', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { completed, view } = req.query;

    const where: any = { userId: user.id };
    if (completed === 'true') where.completed = true;
    else if (completed === 'false') where.completed = false;

    const todos = await prisma.todo.findMany({
      where,
      include: { linkedItem: { select: { id: true, title: true } } },
      orderBy: [{ completed: 'asc' }, { endDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ todos });
  } catch (error) {
    console.error('Get todos error:', error);
    res.status(500).json({ error: 'Failed to get todos' });
  }
});

// POST /todos - Todo 직접 생성 (+LLM으로 Item 자동 연결)
todoRoutes.post('/', authenticateToken, loadUser, llmLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { title, content, startDate, endDate } = req.body;

    if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title은 필수입니다.' }); return; }

    const personalSpace = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!personalSpace) { res.status(500).json({ error: 'Personal space not found' }); return; }

    // LLM으로 파트 Item 자동 연결
    let linkedItemId: string | null = null;
    if (user.partId) {
      const partItems = await prisma.item.findMany({
        where: { level: 'PART', ownerId: user.partId, status: { not: 'COMPLETED' } },
        select: { id: true, title: true },
      });
      if (partItems.length > 0) {
        try {
          const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };
          const result = await linkTodoToItem(title, endDate, partItems, userInfo);
          linkedItemId = result.linkedItemId;
        } catch { /* LLM 실패 시 연결 없이 진행 */ }
      }
    }

    const todo = await prisma.todo.create({
      data: {
        userId: user.id,
        spaceId: personalSpace.id,
        title: String(title).slice(0, 500),
        content: content ? String(content).slice(0, 10000) : '',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        linkedItemId,
      },
      include: { linkedItem: { select: { id: true, title: true } } },
    });

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'CREATE_TODO', targetType: 'TODO', targetId: todo.id, details: todo.title },
    });

    res.json({ success: true, todo });
  } catch (error) {
    console.error('Create todo error:', error);
    res.status(500).json({ error: 'Todo 생성에 실패했습니다.' });
  }
});

// PATCH /todos/:id - Todo 수정 (LLM 안 탐)
todoRoutes.patch('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const todo = await prisma.todo.findUnique({ where: { id } });
    if (!todo) { res.status(404).json({ error: 'Todo not found' }); return; }
    if (todo.userId !== user.id) { res.status(403).json({ error: '본인의 할일만 수정할 수 있습니다.' }); return; }

    const { title, content, startDate, endDate, completed, linkedItemId } = req.body;
    const updateData: any = {};

    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (linkedItemId !== undefined) updateData.linkedItemId = linkedItemId || null;
    if (completed !== undefined) {
      updateData.completed = !!completed;
      updateData.completedAt = completed ? new Date() : null;
    }

    const updated = await prisma.todo.update({
      where: { id },
      data: updateData,
      include: { linkedItem: { select: { id: true, title: true } } },
    });

    res.json({ success: true, todo: updated });
  } catch (error) {
    console.error('Update todo error:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// DELETE /todos/:id - Todo 삭제
todoRoutes.delete('/:id', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = req.params.id as string;

    const todo = await prisma.todo.findUnique({ where: { id } });
    if (!todo) { res.status(404).json({ error: 'Todo not found' }); return; }
    if (todo.userId !== user.id) { res.status(403).json({ error: '본인의 할일만 삭제할 수 있습니다.' }); return; }

    await prisma.todo.delete({ where: { id } });

    await prisma.activityLog.create({
      data: { userId: user.id, action: 'DELETE_TODO', targetType: 'TODO', targetId: id, details: todo.title },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete todo error:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

// === CLI 호환 External endpoints ===

// GET /todos/external - loginid 기반 Todo 목록
todoRoutes.get('/external', async (req, res) => {
  try {
    const loginid = req.query.loginid as string;
    if (!loginid) { res.status(400).json({ error: 'loginid는 필수입니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }

    const completed = req.query.completed === 'true' ? true : req.query.completed === 'false' ? false : undefined;

    const todos = await prisma.todo.findMany({
      where: { userId: user.id, ...(completed !== undefined ? { completed } : {}) },
      select: { id: true, title: true, content: true, startDate: true, endDate: true, completed: true, completedAt: true, createdAt: true },
      orderBy: [{ completed: 'asc' }, { endDate: 'asc' }],
    });

    res.json({ success: true, todos, count: todos.length });
  } catch (error) {
    console.error('External get todos error:', error);
    res.status(500).json({ error: 'Todo 목록 조회에 실패했습니다.' });
  }
});

// POST /todos/external - loginid 기반 Todo 추가 (+LLM Item 연결)
todoRoutes.post('/external', llmLimit, async (req, res) => {
  try {
    const { loginid, title, content, endDate } = req.body;
    if (!loginid) { res.status(400).json({ error: 'loginid는 필수입니다.' }); return; }
    if (!title) { res.status(400).json({ error: 'title은 필수입니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }

    const personalSpace = await prisma.space.findFirst({ where: { type: 'PERSONAL', ownerId: user.id } });
    if (!personalSpace) { res.status(500).json({ error: 'Personal space not found' }); return; }

    // LLM 자동 연결
    let linkedItemId: string | null = null;
    if (user.partId) {
      const partItems = await prisma.item.findMany({
        where: { level: 'PART', ownerId: user.partId, status: { not: 'COMPLETED' } },
        select: { id: true, title: true },
      });
      if (partItems.length > 0) {
        try {
          const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };
          const result = await linkTodoToItem(title, endDate, partItems, userInfo);
          linkedItemId = result.linkedItemId;
        } catch { /* 실패 시 연결 없이 진행 */ }
      }
    }

    const todo = await prisma.todo.create({
      data: {
        userId: user.id,
        spaceId: personalSpace.id,
        title: String(title).slice(0, 500),
        content: content ? String(content).slice(0, 10000) : '',
        endDate: endDate ? new Date(endDate) : null,
        linkedItemId,
      },
    });

    res.json({ success: true, todo });
  } catch (error) {
    console.error('External create todo error:', error);
    res.status(500).json({ error: 'Todo 생성에 실패했습니다.' });
  }
});

// PATCH /todos/external/:id - loginid 기반 Todo 수정
todoRoutes.patch('/external/:id', async (req, res) => {
  try {
    const { loginid, title, content, completed, endDate } = req.body;
    const id = req.params.id as string;
    if (!loginid) { res.status(400).json({ error: 'loginid는 필수입니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }

    const todo = await prisma.todo.findUnique({ where: { id } });
    if (!todo) { res.status(404).json({ error: 'Todo not found' }); return; }
    if (todo.userId !== user.id) { res.status(403).json({ error: '본인의 할일만 수정할 수 있습니다.' }); return; }

    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).slice(0, 500);
    if (content !== undefined) updateData.content = String(content).slice(0, 10000);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (completed !== undefined) {
      updateData.completed = !!completed;
      updateData.completedAt = completed ? new Date() : null;
    }

    const updated = await prisma.todo.update({ where: { id }, data: updateData });
    res.json({ success: true, todo: updated });
  } catch (error) {
    console.error('External update todo error:', error);
    res.status(500).json({ error: 'Todo 수정에 실패했습니다.' });
  }
});

// DELETE /todos/external/:id - loginid 기반 Todo 삭제
todoRoutes.delete('/external/:id', async (req, res) => {
  try {
    const loginid = req.query.loginid as string || req.body.loginid;
    const id = req.params.id as string;
    if (!loginid) { res.status(400).json({ error: 'loginid는 필수입니다.' }); return; }

    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) { res.status(404).json({ error: `사용자를 찾을 수 없습니다: ${loginid}` }); return; }

    const todo = await prisma.todo.findUnique({ where: { id } });
    if (!todo) { res.status(404).json({ error: 'Todo not found' }); return; }
    if (todo.userId !== user.id) { res.status(403).json({ error: '본인의 할일만 삭제할 수 있습니다.' }); return; }

    await prisma.todo.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('External delete todo error:', error);
    res.status(500).json({ error: 'Todo 삭제에 실패했습니다.' });
  }
});
