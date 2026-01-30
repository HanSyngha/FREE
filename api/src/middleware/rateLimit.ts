import rateLimit from 'express-rate-limit';

export const itemCreateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: any) => req.user?.loginid || req.ip,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

export const llmLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req: any) => req.user?.loginid || req.ip,
  message: { error: 'LLM 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

export const generalLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req: any) => req.user?.loginid || req.ip,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});
