'use server';
/**
 * @fileOverview Simulates realistic call flows with AI agents, incorporating greetings, information delivery, and disconnections.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ReasoningBasedAgentResponseInputSchema = z.object({
  agentName: z.string().describe('The name of the agent.'),
  clientQuery: z.string().describe('The client query or input.'),
  scenario: z.string().describe('The current call scenario (e.g., greeting, information delivery, disconnection).'),
});
export type ReasoningBasedAgentResponseInput = z.infer<typeof ReasoningBasedAgentResponseInputSchema>;

const ReasoningBasedAgentResponseOutputSchema = z.object({
  agentResponse: z.string().describe('The agent\'s response based on the scenario and client query.'),
  callStatus: z.enum(['ongoing', 'ended']).describe('The status of the call (ongoing or ended).'),
});
export type ReasoningBasedAgentResponseOutput = z.infer<typeof ReasoningBasedAgentResponseOutputSchema>;

export async function reasoningBasedAgentResponse(input: ReasoningBasedAgentResponseInput): Promise<ReasoningBasedAgentResponseOutput> {
  return reasoningBasedAgentResponseFlow(input);
}

const prompt = ai.definePrompt({
  name: 'reasoningBasedAgentResponsePrompt',
  input: {schema: ReasoningBasedAgentResponseInputSchema},
  output: {schema: ReasoningBasedAgentResponseOutputSchema},
  prompt: `You are simulating a call flow with an AI agent named {{agentName}} for a martial arts academy. The current scenario is: {{scenario}}. The client says: {{clientQuery}}.

Based on the scenario and client query, determine the agent's response and the call status (ongoing or ended).

Consider these factors when crafting your response:
- **Greetings:** Start the call with a professional academy greeting.
- **Information Delivery:** Provide accurate and relevant information about class schedules, trial offers, and member benefits.
- **Disconnections:** End the call gracefully when the scenario indicates completion or client request.

Output the agent response and call status in a JSON format.`,
});

const reasoningBasedAgentResponseFlow = ai.defineFlow(
  {
    name: 'reasoningBasedAgentResponseFlow',
    inputSchema: ReasoningBasedAgentResponseInputSchema,
    outputSchema: ReasoningBasedAgentResponseOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
