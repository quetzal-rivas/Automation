'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

/**
 * Generic HTTP Tool for Genkit.
 * This tool acts as a universal adapter, allowing the LLM to call any documented
 * external API by providing the URL, method, and payload.
 */
export const callExternalApi = ai.defineTool(
  {
    name: 'callExternalApi',
    description: 'Sends an HTTP request to an external service. Use this for lead management, scheduling, or analytical data retrieval based on provided documentation.',
    inputSchema: z.object({
      url: z.string().describe('The full destination URL (e.g., https://api.example.com/v1/resource)'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET').describe('The HTTP verb to use.'),
      headers: z.record(z.string()).optional().describe('Optional HTTP headers like Authorization.'),
      params: z.record(z.string()).optional().describe('URL Query parameters.'),
      body: z.any().optional().describe('The JSON payload for POST/PUT/PATCH requests.'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    try {
      const url = new URL(input.url);
      
      // Append query parameters if present
      if (input.params) {
        Object.entries(input.params).forEach(([key, val]) => {
          url.searchParams.append(key, val);
        });
      }

      const headers = {
        'Content-Type': 'application/json',
        ...input.headers,
      };

      console.log(`[AI TOOL] Executing ${input.method} to ${url.toString()}`);

      const response = await fetch(url.toString(), {
        method: input.method,
        headers: headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('[AI TOOL ERROR]', error);
      return { error: error.message };
    }
  }
);
