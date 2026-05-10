import type { ToolDefinition } from ".";
import { finalAnswerTool } from "./finalAnswer";
import { searchDocumentsTool } from "./searchDocuments";

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  search_documents: searchDocumentsTool,
  // get_document_summary: getDocumentSummaryTool,
  // analyze_chunks: analyzeChunksTool,
  final_answer: finalAnswerTool,
};

// convert to OpenAI function schema format for model to consume
export function getToolSchemas() {
  return Object.values(TOOL_REGISTRY)
    .filter(tool => tool.name !== 'final_answer') // final_answer handled separately
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      }
    }));
}
