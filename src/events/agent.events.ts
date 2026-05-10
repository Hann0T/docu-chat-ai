import { eventBus } from '../lib/events';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export const AGENT_EVENTS = {
  COMPLETED: 'agent:completed',
} as const;

eventBus.on(AGENT_EVENTS.COMPLETED, async (data: any) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'agent_run',
        tokens: data.totalTokens,
        costUsd: data.totalCostUsd,
        metadata: JSON.stringify({
          correlationId: data.correlationId,
          iterations: data.iterations,
          terminationReason: data.terminationReason,
          toolsUsed: data.toolsUsed,
          confidence: data.confidence,
          durationMs: data.durationMs
        }),
      },
    });
  } catch (error: any) {
    logger.error(`Failed Handle ${AGENT_EVENTS.COMPLETED} event`, {
      userId: data.userId,
      correlationId: data.correlationId,
      message: error.message
    });
  }
});
