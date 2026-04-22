'use server';
/**
 * @fileOverview This file implements a Genkit flow for generating AI-powered ad copy and image suggestions for Meta ad campaigns.
 *
 * - aiAdContentGenerator - An asynchronous function that triggers the AI ad content generation flow.
 * - AiAdContentGeneratorInput - The input type definition for the ad content generation.
 * - AiAdContentGeneratorOutput - The output type definition for the generated ad content.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AiAdContentGeneratorInputSchema = z.object({
  productService: z
    .string()
    .describe(
      'The product or service being advertised (e.g., "martial arts classes", "coding bootcamp").'
    ),
  targetAudience: z
    .string()
    .describe(
      'The target audience for the ad (e.g., "parents of children aged 5-10", "young adults seeking career change").'
    ),
  keySellingPoints: z
    .array(z.string())
    .describe('A list of key selling points or unique benefits of the product/service.'),
  desiredTone: z
    .string()
    .describe(
      'The desired tone for the ad copy (e.g., "professional", "energetic", "empathetic").'
    ),
});
export type AiAdContentGeneratorInput = z.infer<
  typeof AiAdContentGeneratorInputSchema
>;

const AiAdContentGeneratorOutputSchema = z.object({
  adCopies: z.array(z.string()).describe('An array of generated ad copy variations.'),
  imageSuggestions: z
    .array(z.string())
    .describe('An array of descriptive text suggestions for ad images.'),
});
export type AiAdContentGeneratorOutput = z.infer<
  typeof AiAdContentGeneratorOutputSchema
>;

export async function aiAdContentGenerator(
  input: AiAdContentGeneratorInput
): Promise<AiAdContentGeneratorOutput> {
  return aiAdContentGeneratorFlow(input);
}

const aiAdContentGeneratorPrompt = ai.definePrompt({
  name: 'aiAdContentGeneratorPrompt',
  input: { schema: AiAdContentGeneratorInputSchema },
  output: { schema: AiAdContentGeneratorOutputSchema },
  prompt: `You are an expert marketing copywriter and creative director specializing in Meta ad campaigns. Your task is to generate compelling ad copy and relevant image suggestions based on the provided information.

Product/Service: {{{productService}}}
Target Audience: {{{targetAudience}}}
Key SellingPoints:
{{#each keySellingPoints}}- {{{this}}}
{{/each}}
Desired Tone: {{{desiredTone}}}

Generate 3-5 distinct ad copy variations, each suitable for a Meta ad. For each ad copy, also provide a short, descriptive suggestion for an accompanying image that would resonate with the target audience.

Return the output as a JSON object.`,
});

const aiAdContentGeneratorFlow = ai.defineFlow(
  {
    name: 'aiAdContentGeneratorFlow',
    inputSchema: AiAdContentGeneratorInputSchema,
    outputSchema: AiAdContentGeneratorOutputSchema,
  },
  async (input) => {
    const { output } = await aiAdContentGeneratorPrompt(input);
    return output!;
  }
);
