'use server';
/**
 * @fileOverview A flow to retrieve existing ad images from a Meta Ad Account.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GetAdImagesInputSchema = z.object({
  adAccountID: z.string().describe('The ID of the Meta Ad Account.'),
  apiKey: z.string().describe('The API Key (Access Token) for the Meta Ads API.'),
});

export type GetAdImagesInput = z.infer<typeof GetAdImagesInputSchema>;

const ImageSchema = z.object({
    hash: z.string(),
    name: z.string(),
    url: z.string(),
    permalink_url: z.string(),
});

const GetAdImagesOutputSchema = z.object({
    success: z.boolean(),
    count: z.number(),
    images: z.array(ImageSchema),
    error: z.string().optional(),
});
export type GetAdImagesOutput = z.infer<typeof GetAdImagesOutputSchema>;

export async function getAdImages(input: GetAdImagesInput): Promise<GetAdImagesOutput> {
    return getAdImagesFlow(input);
}

const getAdImagesFlow = ai.defineFlow(
    {
        name: 'getAdImagesFlow',
        inputSchema: GetAdImagesInputSchema,
        outputSchema: GetAdImagesOutputSchema,
    },
    async ({ adAccountID, apiKey }) => {
        try {
            const response = await fetch(
                `https://graph.facebook.com/v20.0/act_${adAccountID}/adimages?fields=hash,name,url,permalink_url&access_token=${apiKey}`
            );
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            return {
                success: true,
                count: data.data?.length || 0,
                images: data.data || [],
            };

        } catch (error: any) {
            return {
                success: false,
                count: 0,
                images: [],
                error: error.message || 'An unknown error occurred.',
            };
        }
    }
);
