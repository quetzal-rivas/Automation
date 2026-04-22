'use server';
/**
 * @fileOverview A flow for generating an AI-powered status report for a lead.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const LeadReportDataSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  status: z.string(),
  source: z.string(),
  capturedDate: z.string(),
  notes: z.string().optional(),
});

export type GenerateLeadReportInput = z.infer<typeof LeadReportDataSchema>;

const GenerateLeadReportOutputSchema = z.object({
  report: z.string().describe('A concise AI-generated summary of the lead status.'),
});
export type GenerateLeadReportOutput = z.infer<typeof GenerateLeadReportOutputSchema>;

export async function generateLeadReport(input: GenerateLeadReportInput): Promise<GenerateLeadReportOutput> {
  return generateLeadReportFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateLeadReportPrompt',
  input: {schema: LeadReportDataSchema},
  output: {schema: GenerateLeadReportOutputSchema},
  prompt: `You are an AI academy director. Analyze this lead and provide a 2-sentence tactical summary.
  Focus on their potential interest and current status.

  Lead Details:
  - Name: {{{name}}}
  - Email: {{{email}}}
  - Status: {{{status}}}
  - Source: {{{source}}}
  - Captured: {{{capturedDate}}}
  {{#if notes}}- Internal Notes: {{{notes}}}{{/if}}
  `,
});

const generateLeadReportFlow = ai.defineFlow(
  {
    name: 'generateLeadReportFlow',
    inputSchema: LeadReportDataSchema,
    outputSchema: GenerateLeadReportOutputSchema,
  },
  async (leadData) => {
    const {output} = await prompt(leadData);
    return output!;
  }
);
