/**
 * Announcement Routes - 팀 공지
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, requireTeamAdminOrHigher, loadUser } from '../middleware/auth.js';

export const announcementRoutes = Router();

// GET /announcements/team - 팀 공지 조회
announcementRoutes.get('/team', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    const announcement = await prisma.announcement.findUnique({
      where: { teamId: user.teamId },
      include: { author: { select: { username: true, loginid: true } } },
    });

    res.json({ announcement });
  } catch (error) {
    console.error('Get announcement error:', error);
    res.status(500).json({ error: 'Failed to get announcement' });
  }
});

// POST /announcements/team - 팀 공지 작성/수정
announcementRoutes.post('/team', authenticateToken, requireTeamAdminOrHigher, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    // Team Admin은 자신의 팀 공지만 작성 가능
    if (req.isTeamAdmin && !req.isSuperAdmin) {
      if (!req.teamAdminTeamIds?.includes(user.teamId)) {
        res.status(403).json({ error: '본인 팀의 공지만 작성할 수 있습니다.' });
        return;
      }
    }

    const { title, content } = req.body;
    if (!title || !content) { res.status(400).json({ error: 'title and content are required' }); return; }

    // 입력 길이 제한
    const sanitizedTitle = String(title).slice(0, 200);
    const sanitizedContent = String(content).slice(0, 5000);

    const announcement = await prisma.announcement.upsert({
      where: { teamId: user.teamId },
      update: { title: sanitizedTitle, content: sanitizedContent, authorId: user.id },
      create: { teamId: user.teamId, title: sanitizedTitle, content: sanitizedContent, authorId: user.id },
    });

    res.json({ success: true, announcement });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// DELETE /announcements/team - 팀 공지 삭제
announcementRoutes.delete('/team', authenticateToken, requireTeamAdminOrHigher, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    if (!user.teamId) { res.status(400).json({ error: 'Team not assigned' }); return; }

    // Team Admin은 자신의 팀 공지만 삭제 가능
    if (req.isTeamAdmin && !req.isSuperAdmin) {
      if (!req.teamAdminTeamIds?.includes(user.teamId)) {
        res.status(403).json({ error: '본인 팀의 공지만 삭제할 수 있습니다.' });
        return;
      }
    }

    await prisma.announcement.delete({ where: { teamId: user.teamId } }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});
