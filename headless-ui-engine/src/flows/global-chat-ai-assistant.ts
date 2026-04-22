'use server';

/**
 * @fileOverview Refactored AI assistant flow supporting persistent chat history and tool calling.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { callExternalApi } from '@/ai/tools/call-external-api';

const MessageSchema = z.object({
  role: z.enum(['user', 'model', 'system']),
  content: z.array(z.object({ text: z.string().optional() })),
});

const ChatAssistantInputSchema = z.object({
  history: z.array(MessageSchema).optional().describe('The conversation history.'),
  message: z.string().describe('The latest user message.'),
});
export type ChatAssistantInput = z.infer<typeof ChatAssistantInputSchema>;

export async function chatAssistant(input: ChatAssistantInput) {
  const response = await ai.generate({
    history: input.history as any,
    prompt: input.message,
    tools: [callExternalApi],
    system: `You are the Academy Operations Controller. Your mission is to provide tactical support to the academy staff.
    
### OPERATIONAL DIRECTIVE:
- Use the 'callExternalApi' tool to execute backend actions.
- Base URL for internal services: 'https://api.your-academy-domain.com'
- Maintain a professional, disciplined, and efficient tone.
- If a request lacks required parameters, ask for clarification before using a tool.

### CRITICAL: BEFORE ANALYSIS OR RECOMMENDATIONS
Always fetch the business state first:
  GET /api/business-state (Authorization: Bearer <token>)
This returns structured data: leads by stage, conversion rate, at-risk students, failed payments, recent activity.
NEVER reason from memory or raw events. Always start from the state snapshot.

### NEW CAPABILITY: TACTICAL WORKFLOWS (MISSION DAG)
To start a complex multi-step mission:
POST /start-mission with:
{
  "tasks": [
    { "action": "ADD_LEAD", "taskId": "t1", "payload": { ... } },
    { "action": "SEND_EMAIL", "taskId": "t2", "dependsOn": ["t1"], "payload": { "templateType": "welcome" } }
  ]
}

### LIFECYCLE TRIGGERS (Automated Events)
You can fire lifecycle events directly:
POST /lifecycle-trigger with: { "eventType": "CLASS_MISSED|PAYMENT_FAILED|STUDENT_INACTIVE|LEAD_CREATED", "tenantId": "...", "studentId": "..." }

### TACTICAL BACKEND DIRECTORY:
1. Business Intelligence
   - Business State: GET /api/business-state (ALWAYS query this first)
   
2. Lead Management
   - Start Mission: POST /start-mission | Body: { tasks: [...] }
   - Get Leads: GET /get-leads | Params: ?status=active|processed

3. Lifecycle & Engagement
   - Lifecycle Trigger: POST /lifecycle-trigger | Body: { eventType, tenantId, studentId }
   - Task Status: POST /api/tasks/status | Body: { workflowId }

Today's date is ${new Date().toISOString().split('T')[0]}.`,
  });

  // Extract workflowId from tool results if present
  const workflowId = response.toolResponses?.find(r => r.content?.workflowId)?.content?.workflowId;

  return {
    text: response.text,
    history: response.history,
    workflowId: workflowId as string | undefined
  };
}
