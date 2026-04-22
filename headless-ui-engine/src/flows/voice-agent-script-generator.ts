'use server';
/**
 * @fileOverview A Genkit flow for generating detailed lead qualification scripts for voice agents.
 *
 * - generateVoiceAgentScript - A function that handles the script generation process.
 * - VoiceAgentScriptGeneratorInput - The input type for the generateVoiceAgentScript function.
 * - VoiceAgentScriptGeneratorOutput - The return type for the generateVoiceAgentScript function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const VoiceAgentScriptGeneratorInputSchema = z.object({
  academyServices: z
    .string()
    .describe(
      "A detailed description of the academy's services, offerings, and target audience."
    ),
});
export type VoiceAgentScriptGeneratorInput = z.infer<
  typeof VoiceAgentScriptGeneratorInputSchema
>;

const VoiceAgentScriptGeneratorOutputSchema = z.object({
  scriptTitle: z.string().describe('A suitable title for the qualification script.'),
  introduction: z
    .string()
    .describe('An introductory statement for the voice agent to greet leads.'),
  qualificationQuestions: z
    .array(
      z.object({
        question: z.string().describe('A question for lead qualification.'),
        expectedResponses: z
          .array(z.string())
          .describe('Examples of expected lead responses to the question.'),
        responseHandling: z
          .string()
          .describe('Instructions on how the voice agent should handle the expected responses.'),
      })
    )
    .describe('A list of detailed qualification questions with response handling.'),
  closingStatement: z
    .string()
    .describe('A closing statement for the voice agent after qualification.'),
  disclaimer: z
    .string()
    .optional()
    .describe('Any optional disclaimers or legal notices relevant to the conversation.'),
});
export type VoiceAgentScriptGeneratorOutput = z.infer<
  typeof VoiceAgentScriptGeneratorOutputSchema
>;

export async function generateVoiceAgentScript(
  input: VoiceAgentScriptGeneratorInput
): Promise<VoiceAgentScriptGeneratorOutput> {
  return voiceAgentScriptGeneratorFlow(input);
}

const prompt = ai.definePrompt({
  name: 'voiceAgentScriptGeneratorPrompt',
  input: {schema: VoiceAgentScriptGeneratorInputSchema},
  output: {schema: VoiceAgentScriptGeneratorOutputSchema},
  prompt: `You are an expert in designing effective lead qualification scripts for voice agents. Your task is to generate a comprehensive script based on the provided academy services.

Generate a script that includes a title, an introduction, a series of detailed qualification questions with example expected responses and instructions for handling those responses, and a closing statement.

The script should be tailored to accurately qualify leads and gather basic information relevant to the academy's offerings.

Academy Services: {{{academyServices}}}
`,
});

const voiceAgentScriptGeneratorFlow = ai.defineFlow(
  {
    name: 'voiceAgentScriptGeneratorFlow',
    inputSchema: VoiceAgentScriptGeneratorInputSchema,
    outputSchema: VoiceAgentScriptGeneratorOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
