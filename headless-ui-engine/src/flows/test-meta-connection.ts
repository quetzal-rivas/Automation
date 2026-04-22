'use server';
/**
 * @fileOverview A flow to test the connection to the Meta Ads API.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const TestMetaConnectionInputSchema = z.object({
  adAccountID: z.string().describe('The ID of the Meta Ad Account.'),
  apiKey: z.string().describe('The API Key (Access Token) for the Meta Ads API.'),
});

export type TestMetaConnectionInput = z.infer<typeof TestMetaConnectionInputSchema>;

const TestMetaConnectionOutputSchema = z.object({
    connected: z.boolean(),
    accountName: z.string().optional(),
    error: z.string().optional(),
});
export type TestMetaConnectionOutput = z.infer<typeof TestMetaConnectionOutputSchema>;

export async function testMetaConnection(input: TestMetaConnectionInput): Promise<TestMetaConnectionOutput> {
    return testMetaConnectionFlow(input);
}

const testMetaConnectionFlow = ai.defineFlow(
    {
        name: 'testMetaConnectionFlow',
        inputSchema: TestMetaConnectionInputSchema,
        outputSchema: TestMetaConnectionOutputSchema,
    },
    async ({ adAccountID, apiKey }) => {
        try {
            const response = await fetch(
                `https://graph.facebook.com/v20.0/act_${adAccountID}?fields=name,account_status&access_token=${apiKey}`
            );
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            return {
                connected: true,
                accountName: data.name,
            };

        } catch (error: any) {
            return {
                connected: false,
                error: error.message || 'An unknown error occurred.',
            };
        }
    }
);
