/**
 * Rating Routes - LLM 사용 평가
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest, loadUser } from '../middleware/auth.js';
import { submitRating, fetchAvailableModels } from '../services/llm.service.js';

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

    const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };
    const models = await fetchAvailableModels(userInfo);
    const modelId = models[0]?.id || 'unknown';
    const modelName = models[0]?.displayName || modelId;

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
        modelName,
        score,
        userInfo
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
    let shouldRate = user.requestCount > 0 && user.requestCount % 20 === 0;

    // 이미 이 milestone에서 rating을 제출했는지 확인
    if (shouldRate) {
      const existingRating = await prisma.lLMRating.findFirst({
        where: { userId: user.id, requestCount: user.requestCount },
      });
      if (existingRating) shouldRate = false;
    }

    const userInfo = { loginid: user.loginid, username: user.username, deptname: user.deptname };
    const models = await fetchAvailableModels(userInfo);

    res.json({
      shouldRate,
      requestCount: user.requestCount,
      modelId: models[0]?.id || null,
      modelName: models[0]?.displayName || null,
    });
  } catch (error) {
    console.error('Check rating error:', error);
    res.status(500).json({ error: 'Failed to check rating' });
  }
});
