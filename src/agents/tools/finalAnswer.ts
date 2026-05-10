import { z } from "zod";
import type { ToolDefinition } from ".";

export const finalAnswerTool: ToolDefinition = {
  name: 'final_answer',
  description:
    'Provide the final answer to the user\'s question. ' +
    'Call this when you have gathered enough information.',
  parameters: z.object({
    answer: z.string().min(1).describe('The final answer to the user\'s question'),
    sources: z.array(z.string()).describe('List of document names used as sources'),
    confidence: z.enum(['high', 'medium', 'low']).describe('How confident are you in the answer'),
  }),
  handler: async (params, _) => {
    return {
      success: true,
      data: params,
    };
  }
}
