'use server';
/**
 * @fileOverview An AI tool to interpret complex IRS/California tax rules for accountants.
 *
 * - interpretTaxRules - A function that interprets tax rules based on a query.
 * - InterpretTaxRulesInput - The input type for the interpretTaxRules function.
 * - InterpretTaxRulesOutput - The return type for the interpretTaxRules function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const InterpretTaxRulesInputSchema = z.object({
  query: z
    .string()
    .describe(
      'The accountant\'s query about IRS/California tax rules, specifically regarding 1099-NEC and sales tax applicability.'
    ),
});
export type InterpretTaxRulesInput = z.infer<typeof InterpretTaxRulesInputSchema>;

const InterpretTaxRulesOutputSchema = z.object({
  explanation: z
    .string()
    .describe('A simplified, actionable explanation of the tax rules.'),
  keyConsiderations: z
    .array(z.string())
    .describe('Key considerations or action items based on the explanation.'),
});
export type InterpretTaxRulesOutput = z.infer<typeof InterpretTaxRulesOutputSchema>;

export async function interpretTaxRules(
  input: InterpretTaxRulesInput
): Promise<InterpretTaxRulesOutput> {
  return interpretTaxRulesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'interpretTaxRulesPrompt',
  input: {schema: InterpretTaxRulesInputSchema},
  output: {schema: InterpretTaxRulesOutputSchema},
  prompt: `You are an expert tax advisor specializing in IRS and California tax rules for martial arts academies. Your focus is on 1099-NEC and sales tax applicability for service providers.

Analyze the following query and provide a clear, concise explanation. Break down complex concepts into easily digestible points. Always highlight key considerations or action items for the accountant to ensure compliance.

Today's date is ${new Date().toISOString().split('T')[0]}.

Query: {{{query}}}`,
});

const interpretTaxRulesFlow = ai.defineFlow(
  {
    name: 'interpretTaxRulesFlow',
    inputSchema: InterpretTaxRulesInputSchema,
    outputSchema: InterpretTaxRulesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
