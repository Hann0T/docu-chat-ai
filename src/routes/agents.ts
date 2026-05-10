import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/cache';
import { authenticate } from '../middleware/auth';
import { chatLimiter } from '../middleware/rateLimiter';
import { requirePermission } from '../middleware/authorize';
import { runAgent } from '../agents/executor';
import { eventBus } from '../lib/events';
import { AGENT_EVENTS } from '../events/agent.events';
import { agentCost, agentIterations, agentTerminations } from '../lib/metrics';

const router = Router();
router.use(authenticate);

router.get('/research',
  chatLimiter,
  requirePermission('conversations:create'),
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const correlationId = (req as any).correlationId;
      const startTime = Date.now();

      const result = await runAgent({
        question: req.body.question,
        userId,
        correlationId: (req as any).correlationId,
      });

      eventBus.emit(AGENT_EVENTS.COMPLETED, {
        userId,
        correlationId,
        iterations: result.iterations,
        totalCostUsd: result.totalCostUsd,
        terminationReason: result.terminationReason,
        toolsUsed: result.trace
          .filter(s => s.tool)
          .map(s => s.tool),
        confidence: result.confidence,
        durationMs: Date.now() - startTime,
      });

      agentIterations.observe(result.iterations);
      agentCost.observe(result.totalCostUsd);
      agentTerminations.inc({
        reason: result.terminationReason
      });

      res.json({
        success: true,
        data: {
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          metadata: {
            iterations: result.iterations,
            costUsd: result.totalCostUsd,
            terminationReason: result.terminationReason
          }
        }
      });
    } catch (error: any) {
      next(error);
    }
  }
);
