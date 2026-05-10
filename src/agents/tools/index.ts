import { z } from "zod";

export interface ToolContext {
  userId: string;
  correlationId: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  tokensCost?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  handler: (params: any, context: ToolContext) => Promise<ToolResult>;
}
