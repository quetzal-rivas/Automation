'use server';
/**
 * @fileOverview This file implements a Genkit flow to generate initial conversation flows and responses
 * for omnichannel customer service agents (WhatsApp, Messenger, SMS) based on an academy's unique offerings.
 *
 * - initializeOmnichannelAssistant - A function that initiates the conversation flow generation process.
 * - OmnichannelAssistantInitializerInput - The input type for the initializeOmnichannelAssistant function.
 * - OmnichannelAssistantInitializerOutput - The return type for the initializeOmnichannelAssistant function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const OmnichannelAssistantInitializerInputSchema = z.object({
  academyName: z.string().describe('The name of the academy.'),
  offerings: z.array(z.string()).describe('A list of unique courses, services, or programs offered by the academy.'),
  targetAudience: z.string().optional().describe('A description of the academy\'s primary target audience, if available.'),
  channels: z.array(z.enum(['WhatsApp', 'Messenger', 'SMS'])).describe('The communication channels for which to generate conversation flows.'),
});
export type OmnichannelAssistantInitializerInput = z.infer<typeof OmnichannelAssistantInitializerInputSchema>;

const ConversationFlowSchema = z.object({
  initialGreeting: z.string().describe('The first message the AI agent sends to a new lead.'),
  qualificationQuestions: z.array(z.string()).describe('A series of questions the AI agent asks to qualify a lead.'),
  responseExamples: z.array(z.string()).describe('Examples of how the AI agent should respond to common lead inquiries based on academy offerings.'),
  leadCaptureInstructions: z.string().describe('Instructions for the AI agent on how to capture essential lead information (e.g., name, contact, interest).'),
  escalationPath: z.string().describe('Guidance on when and how to escalate a conversation to a human agent.'),
});

const OmnichannelAssistantInitializerOutputSchema = z.object({
  whatsappFlow: ConversationFlowSchema.optional().describe('Generated conversation flow for WhatsApp.'),
  messengerFlow: ConversationFlowSchema.optional().describe('Generated conversation flow for Messenger.'),
  smsFlow: ConversationFlowSchema.optional().describe('Generated conversation flow for SMS.'),
});
export type OmnichannelAssistantInitializerOutput = z.infer<typeof OmnichannelAssistantInitializerOutputSchema>;

export async function initializeOmnichannelAssistant(input: OmnichannelAssistantInitializerInput): Promise<OmnichannelAssistantInitializerOutput> {
  return omnichannelAssistantInitializerFlow(input);
}

const prompt = ai.definePrompt({
  name: 'omnichannelAssistantInitializerPrompt',
  input: { schema: OmnichannelAssistantInitializerInputSchema },
  output: { schema: OmnichannelAssistantInitializerOutputSchema },
  prompt: `You are an expert in designing effective customer service conversation flows for lead capture and qualification, specifically tailored for academies.

Generate initial conversation flows and responses for the following academy and its offerings. The goal is to quickly capture and qualify leads across the specified communication channels.

Academy Name: {{{academyName}}}
Offerings: {{#each offerings}}- {{{this}}}
{{/each}}

{{#if targetAudience}}
Target Audience: {{{targetAudience}}}
{{/if}}

Channels: {{#each channels}}- {{{this}}}
{{/each}}

For each requested channel, provide the following:
- initialGreeting: A concise and engaging opening message.
- qualificationQuestions: 3-5 clear questions to determine lead interest and qualification.
- responseExamples: 2-3 examples of how the AI should respond to common inquiries related to the academy's offerings.
- leadCaptureInstructions: Clear guidance on what lead information to collect.
- escalationPath: A brief instruction on when and how to hand over to a human.

Ensure the tone is professional, helpful, and aligns with an educational institution.
`,
});

const omnichannelAssistantInitializerFlow = ai.defineFlow(
  {
    name: 'omnichannelAssistantInitializerFlow',
    inputSchema: OmnichannelAssistantInitializerInputSchema,
    outputSchema: OmnichannelAssistantInitializerOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    // The prompt is designed to directly return the structured output,
    // but we need to ensure that only the requested channels are populated.
    // The model might try to generate for all if not precisely guided.
    const result: OmnichannelAssistantInitializerOutput = {};

    if (input.channels.includes('WhatsApp')) {
      result.whatsappFlow = output?.whatsappFlow;
    }
    if (input.channels.includes('Messenger')) {
      result.messengerFlow = output?.messengerFlow;
    }
    if (input.channels.includes('SMS')) {
      result.smsFlow = output?.smsFlow;
    }

    return result;
  }
);
