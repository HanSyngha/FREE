/**
 * Rating Routes - LLM 사용 평가
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { submitRating, getActiveLLMConfig } from '../services/llm.service.js';

export const ratingRoutes = Router();

// POST /ratings - Rating 제출
ratingRoutes.post('/', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    const { score } = req.body;

    if (!score || score < 1 || score > 5) {
      res.status(400).json({ error: 'Score must be between 1 and 5' });
      return;
    }

    const config = await getActiveLLMConfig();
    const modelId = config?.modelId || 'unknown';

    // DB에 rating 저장
    const rating = await prisma.lLMRating.create({
      data: {
        userId: user.id,
        score,
        requestCount: user.requestCount,
        modelId,
      },
    });

    // Dashboard에도 rating 전송 (ONCE 패턴)
    try {
      await submitRating(
        config?.modelName || modelId,
        score,
        { loginid: user.loginid, username: user.username, deptname: user.deptname }
      );
    } catch (e) {
      console.error('Failed to submit rating to dashboard:', e);
    }

    res.json({ success: true, rating });
  } catch (error) {
    console.error('Submit rating error:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// GET /ratings/check - Rating 요청 필요 여부
ratingRoutes.get('/check', authenticateToken, loadUser, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.dbUser!;
    let shouldRate = user.requestCount > 0;

    // 이미 이 milestone에서 rating을 제출했는지 확인
    if (shouldRate) {
      const existingRating = await prisma.lLMRating.findFirst({
        where: { userId: user.id, requestCount: user.requestCount },
      });
      if (existingRating) shouldRate = false;
    }

    const config = await getActiveLLMConfig();

    res.json({
      shouldRate,
      requestCount: user.requestCount,
      modelId: config?.modelId || null,
      modelName: config?.modelName || null,
    });
  } catch (error) {
    console.error('Check rating error:', error);
    res.status(500).json({ error: 'Failed to check rating' });
  }
});
