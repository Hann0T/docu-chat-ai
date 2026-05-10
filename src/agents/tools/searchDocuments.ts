import { z } from 'zod';
import type { ToolDefinition } from ".";
import { semanticSearch } from '../../services/search.service';

export const searchDocumentsTool: ToolDefinition = {
  name: 'search_documents',
  description: 'Search across the user\'s uploaded documents for information ' +
    'relevant to a specific query. Returns the most relevant text ' +
    'passages with similarity scores.',
  parameters: z.object({
    query: z.string().min(3, 'Query cannot be empty').max(500, 'Query is too long'),
    documentId: z.uuid().optional().describe('Optional: search within a specific document'),
    topK: z.number().int().min(1).max(10).default(5).describe('Number of results to return'),
  }),
  handler: async (params, context) => {
    const results = await semanticSearch({
      query: params.query,
      userId: context.userId,
      documentId: params.documentId,
      topK: params.topK,
    }, context.correlationId);

    return {
      success: true,
      data: {
        results: results.map(r => ({
          document: r.documentTitle,
          content: r.content,
          score: r.score,
        })),
        totalResults: results.length,
      }
    };
  }
}
