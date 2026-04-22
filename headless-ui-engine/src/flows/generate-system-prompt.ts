
'use server';
/**
 * @fileOverview A Genkit flow for generating a comprehensive system prompt based on a high-level description of an AI agent's role or behavior.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateSystemPromptInputSchema = z.object({
  description: z
    .string()
    .describe("A high-level description of the AI agent's desired role or behavior."),
});
export type GenerateSystemPromptInput = z.infer<typeof GenerateSystemPromptInputSchema>;

const GenerateSystemPromptOutputSchema = z.object({
  systemPrompt: z.string().describe('The comprehensive AI system prompt generated.'),
});
export type GenerateSystemPromptOutput = z.infer<typeof GenerateSystemPromptOutputSchema>;

export async function generateSystemPrompt(
  input: GenerateSystemPromptInput
): Promise<GenerateSystemPromptOutput> {
  return generateSystemPromptFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateSystemPromptPrompt',
  input: {schema: GenerateSystemPromptInputSchema},
  output: {schema: GenerateSystemPromptOutputSchema},
  prompt: `You are an expert AI prompt engineer designing personalities for a martial arts academy.

Given the following description of an AI agent's role, generate a robust 'System Prompt'.

Academy Context: Gracie Barra / Martial Arts Academy.
Tone: Professional, disciplined, motivating, and helpful.

Consider:
- Core purpose (lead capture, student support).
- Specific academy rules.
- Interaction style.

Provide only the system prompt text as the output.

Description: {{{description}}}`,
});

const generateSystemPromptFlow = ai.defineFlow(
  {
    name: 'generateSystemPromptFlow',
    inputSchema: GenerateSystemPromptInputSchema,
    outputSchema: GenerateSystemPromptOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
