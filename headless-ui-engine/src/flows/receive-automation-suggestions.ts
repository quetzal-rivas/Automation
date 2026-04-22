'use server';
/**
 * @fileOverview This file provides an AI-powered flow for suggesting automation triggers, conditions, and actions
 * based on a formal Action Catalog. This ensures consistency between AI suggestions and app capabilities.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AutomationSuggestionInputSchema = z.object({
  context: z.string().optional().describe('Optional natural language description of the academy\'s needs or a specific automation goal.'),
});
export type AutomationSuggestionInput = z.infer<typeof AutomationSuggestionInputSchema>;

const AutomationSuggestionOutputSchema = z.object({
  triggers: z.array(z.string()).describe('Suggested event-based or time-based triggers.'),
  conditions: z.array(z.string()).describe('Suggested logical conditions.'),
  actions: z.array(z.object({
    id: z.string().describe('The internal action ID (e.g., push_webhook, crm_upsert).'),
    label: z.string().describe('User-friendly name of the action.'),
    description: z.string().describe('Briefly explain what this action does in the suggested context.'),
    type: z.enum(['push', 'pull', 'utility']).describe('The category of the action.'),
  })).describe('Suggested actions from the formal catalog.'),
});
export type AutomationSuggestionOutput = z.infer<typeof AutomationSuggestionOutputSchema>;

export async function receiveAutomationSuggestions(input: AutomationSuggestionInput): Promise<AutomationSuggestionOutput> {
  return receiveAutomationSuggestionsFlow(input);
}

const automationSuggestionPrompt = ai.definePrompt({
  name: 'automationSuggestionPrompt',
  input: { schema: AutomationSuggestionInputSchema },
  output: { schema: AutomationSuggestionOutputSchema },
  prompt: `You are an expert automation architect for Gracie Barra martial arts academies. 
Your goal is to suggest automation components based on the following **Action Catalog**. 

### ACTION CATALOG
You MUST ONLY suggest actions from this list:

1. **push_webhook** (Category: push)
   - Description: Send lead data to an external URL immediately.
   - Usage: Best for real-time CRM sync.

2. **crm_upsert** (Category: push)
   - Description: Sync or update a lead in a supported CRM (HubSpot, GoHighLevel).
   - Usage: Standard lead management sync.

3. **notify_staff** (Category: utility)
   - Description: Send an internal notification (Slack, WhatsApp, Email) to the team.
   - Usage: Instant alerts for hot leads.

4. **update_lead_status** (Category: utility)
   - Description: Change the lead status or add tags within GracieFlow.
   - Usage: Keeping the internal database organized.

5. **configure_export_endpoint** (Category: pull)
   - Description: Set up a secure endpoint for external software to pull data.
   - Usage: When the partner system prefers to fetch data periodically.

6. **wait_delay** (Category: utility)
   - Description: Pause the automation for a specific duration.
   - Usage: Sending follow-ups after 24 hours.

### TRIGGERS & CONDITIONS
- Triggers: lead.created, lead.updated, lead.status_changed, hourly, daily, weekly.
- Conditions: Filter by source, campaign, status, or specific fields (e.g., source='Facebook').

### CONTEXT
{{{context}}}

Provide specific, actionable suggestions. If the user wants "Push" functionality, prioritize push_webhook and crm_upsert. If they want "Pull", prioritize configure_export_endpoint.`,
});

const receiveAutomationSuggestionsFlow = ai.defineFlow(
  {
    name: 'receiveAutomationSuggestionsFlow',
    inputSchema: AutomationSuggestionInputSchema,
    outputSchema: AutomationSuggestionOutputSchema,
  },
  async (input) => {
    const { output } = await automationSuggestionPrompt(input);
    return output!;
  }
);
