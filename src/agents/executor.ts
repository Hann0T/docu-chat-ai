import { AGENT_SYSTEM_PROMPT } from "../config/prompts";
import { openaiBreaker } from "../lib/http/openai.breaker";
import { logger } from "../lib/logger";
import { getToolSchemas, TOOL_REGISTRY } from "./tools/registry";

interface AgentConfig {
  maxIterations: number;
  timeoutMs: number;
  costCeilingUsd: number;
  model: string;
}

interface TraceStep {
  step: number;
  phase: 'think' | 'act' | 'observe';
  tool?: string;
  input?: any;
  output?: any;
  durationMs: number;
  costUsd: number;
}

interface AgentResult {
  answer: string;
  sources: string[];
  confidence: string;
  iterations: number;
  totalCostUsd: number;
  terminationReason: 'completed' | 'iteration_limit' | 'timeout' | 'cost_limit' | 'error';
  trace: TraceStep[];
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 10,
  timeoutMs: 60_000,
  costCeilingUsd: 0.50,
  model: 'gpt-4o',
}

export async function runAgent(options: {
  question: string;
  userId: string;
  correlationId: string;
  config?: Partial<AgentConfig>;
}): Promise<AgentResult> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const { question, userId, correlationId } = options;

  const trace: TraceStep[] = [];
  let totalCostUsd = 0;
  let iteration = 0;

  const startTime = Date.now();

  const messages: any[] = [
    {role: 'system', content: AGENT_SYSTEM_PROMPT},
    { role: 'user', content: question }
  ];

  const toolSchemas = getToolSchemas();

  logger.info('Agent started', {
    correlationId, question: question.substring(0, 100),
    maxIterations: config.maxIterations,
    costCeiling: config.costCeilingUsd,
  });

  while (iteration < config.maxIterations) {
    const elapsed = Date.now() - startTime;

    if (elapsed > config.timeoutMs) {
      logger.warn('Agent Timeout', { correlationId, iteration, elapsed });
      return buildResult('timeout', trace, totalCostUsd, iteration);
    }

    if (totalCostUsd >= config.costCeilingUsd) {
      logger.warn('Agent cost limit hit', { correlationId, iteration, totalCostUsd });
      return buildResult('cost_limit', trace, totalCostUsd, iteration);
    }

    iteration++;

    const stepStartTime = Date.now();

    // THINK
    const response = await openaiBreaker.fire('/chat/completions', {
      model: config.model,
      messages,
      tools: toolSchemas,
      tool_choise: 'auto',
      temperature: 0.1,
    });

    const usage = response.data?.usage;
    const stepCost = (
      (usage.prompt_tokens / 1_000_000) * 2.50 +
      (usage.completion_tokens / 1_000_000) * 10.00
    );

    totalCostUsd += stepCost;

    const choice = response.data?.choices[0];
    const assistantMessage = choice.message;

    messages.push(assistantMessage);

    // NO TOOL CALL
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      trace.push({
        step: iteration,
        phase: 'think',
        output: assistantMessage.content,
        durationMs: Date.now() - stepStartTime,
        costUsd: stepCost,
      });

      return {
        answer: assistantMessage.content,
        sources: [],
        confidence: 'medium',
        iterations: iteration,
        totalCostUsd,
        terminationReason: 'completed',
        trace,
      }
    }

    // ACT
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function_name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      logger.info('Agent tool call', {
        correlationId, iteration, tool: toolName,
        args: toolArgs
      });

      const tool = TOOL_REGISTRY[toolName];
      if (!tool) {
        const error = {
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: `Error: unknown tool "${toolName}"`
        }

        messages.push(error);

        trace.push({
          step: iteration,
          phase: 'act',
          tool: toolName,
          input: toolArgs,
          output: { error: 'Unknown tool' },
          durationMs: Date.now() - stepStartTime,
          costUsd: stepCost
        });

        continue;
      }

      if (toolName === 'final_answer') {
        trace.push({
          step: iteration,
          phase: 'act',
          tool: toolName,
          input: toolArgs,
          durationMs: Date.now() - stepStartTime,
          costUsd: stepCost
        });

        return {
          answer: toolArgs.answer,
          sources: toolArgs.sources || [],
          confidence: toolArgs.confidence || 'medium',
          iterations: iteration,
          totalCostUsd,
          terminationReason: 'completed',
          trace,
        }
      }

      // Zod validation
      const validation = tool.parameters.safeParse(toolArgs);
      if (!validation.success) {
        const error = {
          role: 'tool' as const,
          tool_call: toolCall.id,
          content: `Validation error: ${validation.error.message}`
        }

        messages.push(error);
        continue;
      }

      try {
        const result = await tool.handler(
          validation.data,
          { userId, correlationId }
        );

        // OBSERVE: feed the result to the model
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.data),
        });

        trace.push({
          step: iteration,
          phase: 'observe',
          tool: toolName,
          input: toolArgs,
          output: result.data,
          durationMs: Date.now() - stepStartTime,
          costUsd: stepCost
        });
      } catch (error: any) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Tool error: "${(error as Error).message}"`
        });

        trace.push({
          step: iteration, phase: 'observe', tool: toolName,
          input: toolArgs,
          output: { error: (error as Error).message },
          durationMs: Date.now() - stepStartTime, costUsd: stepCost,
        });
      }
    }
  }

  logger.warn('Agent iteration limit', {
    correlationId, iterations: iteration, totalCostUsd
  });

  return buildResult('iteration_limit', trace, totalCostUsd, iteration);
}

function buildResult(
  reason: AgentResult['terminationReason'], // enums?
  trace: TraceStep[],
  costUsd: number,
  iterations: number
): AgentResult {
  // last model reasoning
  const lastObserve = [...trace]
    .reverse()
    .find(s => s.phase === 'observe' && s.output);

  return {
    answer: `I was unable to complete my analysis (${reason})` +
      (lastObserve
        ? `Here is what I found so far: ${JSON.stringify(lastObserve.output)}.`
        : `No partial results are available.`
      ),
    sources: [],
    confidence: 'low',
    iterations,
    totalCostUsd: costUsd,
    terminationReason: reason,
    trace
  }
}
