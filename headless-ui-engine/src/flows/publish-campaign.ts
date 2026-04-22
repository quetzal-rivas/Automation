'use server';

/**
 * @fileOverview A flow to publish a complete Facebook Ads campaign.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import {
    uploadImage,
    createCampaign,
    createAdSet,
    createAdCreative,
    createAd,
} from '@/lib/meta-ads';
import { META_COMPATIBILITY_MAP } from '@/lib/meta-options';

const PublishCampaignInputSchema = z.object({
    adAccountID: z.string().describe('The ID of the Meta Ad Account.'),
    apiKey: z.string().describe('The API Key (Access Token) for the Meta Ads API.'),
    pageID: z.string().describe('The ID of the Facebook Page to associate with the ad.'),
    campaignName: z.string().describe('The name of the campaign.'),
    adSetName: z.string().describe('The name of the ad set.'),
    adCreativeTexts: z.array(z.string()).describe('The text variations for the ad creative.'),
    imageURI: z.string().optional().describe("A new ad image to upload, as a data URI."),
    imageHashes: z.array(z.string()).optional().describe("The hashes of existing ad images."),
    isAutopilot: z.boolean().describe("Whether to use Advantage+ (CBO and Dynamic Creative)."),
    budgetType: z.enum(['daily', 'lifetime']),
    dailyBudget: z.number().optional(),
    lifetimeBudget: z.number().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    targeting: z.object({
        age_min: z.number().optional(),
        age_max: z.number().optional(),
        geo_locations: z.any(),
    }).describe("The targeting specification for the ad set."),
    campaignObjective: z.string().describe("The main objective for the campaign."),
    optimizationGoal: z.string().describe("The optimization goal for the ad set."),
    callToActionType: z.string().describe("The type of the call to action button."),
    callToActionLink: z.string().url().describe("The destination URL for the call to action button."),
});

const PublishCampaignOutputSchema = z.object({
    campaignId: z.string(),
    adSetId: z.string(),
    adId: z.string(),
});

export async function publishCampaign(input: z.infer<typeof PublishCampaignInputSchema>): Promise<z.infer<typeof PublishCampaignOutputSchema>> {
  return publishCampaignFlow(input);
}

const publishCampaignFlow = ai.defineFlow(
    {
        name: 'publishCampaignFlow',
        inputSchema: PublishCampaignInputSchema,
        outputSchema: PublishCampaignOutputSchema,
    },
    async (input) => {
        const allowedGoals = META_COMPATIBILITY_MAP[input.campaignObjective as keyof typeof META_COMPATIBILITY_MAP];
        if (!allowedGoals || !allowedGoals.includes(input.optimizationGoal)) {
             throw new Error(`Configuration conflict: The objective "${input.campaignObjective}" is not compatible with the optimization goal "${input.optimizationGoal}".`);
        }

        const finalImageHashes: string[] = [...(input.imageHashes || [])];
        if (input.imageURI) {
            const { hash } = await uploadImage(input.adAccountID, input.apiKey, input.imageURI);
            finalImageHashes.push(hash);
        }
        
        const budgetConfig = {
            type: input.budgetType,
            dailyBudget: input.dailyBudget,
            lifetimeBudget: input.lifetimeBudget,
            startTime: input.startTime,
            endTime: input.endTime,
        };
        
        if (input.isAutopilot) {
            const { id: campaignId } = await createCampaign(input.adAccountID, input.apiKey, input.campaignName, input.campaignObjective, budgetConfig, 'LOWEST_COST_WITHOUT_BID');
            const { id: adSetId } = await createAdSet(input.adAccountID, input.apiKey, campaignId, input.adSetName, null, input.targeting, input.optimizationGoal, true);
            const assetFeedSpec = {
                images: finalImageHashes.map(hash => ({ hash })),
                bodies: input.adCreativeTexts.map(text => ({ text })),
                call_to_actions: [{ 
                    type: input.callToActionType,
                    value: { link: input.callToActionLink }
                }],
            };
            const { id: creativeId } = await createAdCreative(input.adAccountID, input.apiKey, input.pageID, null, null, null, null, assetFeedSpec);
            const adName = `${input.campaignName} - Ad`;
            const { id: adId } = await createAd(input.adAccountID, input.apiKey, adSetId, creativeId, adName);
            return { campaignId, adSetId, adId };
        } else {
            const { id: campaignId } = await createCampaign(input.adAccountID, input.apiKey, input.campaignName, input.campaignObjective);
            const { id: adSetId } = await createAdSet(input.adAccountID, input.apiKey, campaignId, input.adSetName, budgetConfig, input.targeting, input.optimizationGoal);
            const { id: creativeId } = await createAdCreative(input.adAccountID, input.apiKey, input.pageID, input.adCreativeTexts[0], finalImageHashes[0], input.callToActionType, input.callToActionLink);
            const adName = `${input.campaignName} - Ad`;
            const { id: adId } = await createAd(input.adAccountID, input.apiKey, adSetId, creativeId, adName);
            return { campaignId, adSetId, adId };
        }
    }
);
