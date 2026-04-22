'use server';

/**
 * @fileOverview A flow to generate a Facebook Ads campaign structure.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { META_COMPATIBILITY_MAP, CALL_TO_ACTION_TYPES, CAMPAIGN_OBJECTIVES } from '@/lib/meta-options';

// Main Input/Output Schemas
const GenerateCampaignStructureInputSchema = z.object({
  businessInformation: z.string().describe('Detailed information about the business, including its products, services, target audience, and goals.'),
  imageURIs: z.array(z.string()).describe("Images to be used in the ad, as an array of data URIs. Each URI must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  isAutopilot: z.boolean().optional().describe("If true, generate a unique ad copy variation for each provided image."),
});
export type GenerateCampaignStructureInput = z.infer<typeof GenerateCampaignStructureInputSchema>;

const GenerateCampaignStructureOutputSchema = z.object({
  campaignName: z.string().describe('The generated name for the campaign.'),
  adSetName: z.string().describe('The generated name for the ad set.'),
  adCreativeTexts: z.array(z.string()).describe('The generated text variations for the ad creative.'),
  campaignObjective: z.string().describe('The suggested campaign objective (e.g., OUTCOME_TRAFFIC, OUTCOME_LEADS).'),
  optimizationGoal: z.string().describe('The suggested optimization goal compatible with the objective.'),
  callToActionType: z.string().describe('The suggested call to action type (e.g., LEARN_MORE, SHOP_NOW).'),
});
export type GenerateCampaignStructureOutput = z.infer<typeof GenerateCampaignStructureOutputSchema>;

export async function generateCampaignStructure(input: GenerateCampaignStructureInput): Promise<GenerateCampaignStructureOutput> {
  return generateCampaignStructureFlow(input);
}

const singleCampaignPrompt = ai.definePrompt({
  name: 'singleCampaignPrompt',
  input: {schema: z.object({
      businessInformation: z.string(),
      imageURI: z.string(),
  })},
  output: {schema: GenerateCampaignStructureOutputSchema},
  prompt: `You are an expert in creating Facebook Ads campaigns for academies.
  Based on the provided business information and image, generate a complete campaign structure.

  Business Information: {{{businessInformation}}}
  Image: {{media url=imageURI}}
  
  Your task is to generate:
  1.  A campaign name.
  2.  An ad set name.
  3.  ONE engaging text for the ad creative.
  4.  A suitable Campaign Objective. Choose from: ${CAMPAIGN_OBJECTIVES.join(', ')}.
  5.  A suitable Optimization Goal. Compatibility: ${JSON.stringify(META_COMPATIBILITY_MAP)}.
  6.  A suggested Call to Action type. Choose from: ${CALL_TO_ACTION_TYPES.join(', ')}.

  Return the output in JSON format.
  `,
});

const campaignBasePrompt = ai.definePrompt({
    name: 'campaignBasePrompt',
    input: { schema: z.object({ businessInformation: z.string() }) },
    output: { schema: GenerateCampaignStructureOutputSchema.omit({ adCreativeTexts: true }) },
    prompt: `You are an expert in creating Facebook Ads campaigns.
    Based on the provided business information, generate the foundational structure for a campaign.

    Business Information: {{{businessInformation}}}

    Your task is to generate:
    1.  A campaign name.
    2.  An ad set name.
    3.  A suitable Campaign Objective. Choose from: ${CAMPAIGN_OBJECTIVES.join(', ')}.
    4.  A suitable Optimization Goal compatible with your chosen campaign objective. Compatibility: ${JSON.stringify(META_COMPATIBILITY_MAP)}.
    5.  A suggested Call to Action type. Choose from: ${CALL_TO_ACTION_TYPES.join(', ')}.

    Return the output in JSON format.
    `,
});

const adCopyPrompt = ai.definePrompt({
    name: 'adCopyPrompt',
    input: { schema: z.object({
        businessInformation: z.string(),
        imageURI: z.string(),
    })},
    output: { schema: z.object({ adCreativeText: z.string() }) },
    prompt: `You are an expert in writing ad copy for Facebook Ads.
    Based on the business information and the provided image, write a single, compelling ad creative text.

    Business Information: {{{businessInformation}}}
    Image: {{media url=imageURI}}

    Return the output as a JSON object with a single key "adCreativeText".
    `,
});

const generateCampaignStructureFlow = ai.defineFlow(
  {
    name: 'generateCampaignStructureFlow',
    inputSchema: GenerateCampaignStructureInputSchema,
    outputSchema: GenerateCampaignStructureOutputSchema,
  },
  async (input) => {
    if (!input.isAutopilot || input.imageURIs.length <= 1) {
        const { output } = await singleCampaignPrompt({
            businessInformation: input.businessInformation,
            imageURI: input.imageURIs[0],
        });
        return output!;
    } else {
        const { output: baseStructure } = await campaignBasePrompt({ businessInformation: input.businessInformation });
        const adCopyPromises = input.imageURIs.map(imageURI => 
            adCopyPrompt({
                businessInformation: input.businessInformation,
                imageURI: imageURI,
            })
        );
        const adCopyResults = await Promise.all(adCopyPromises);
        const adCreativeTexts = adCopyResults.map(result => result.output!.adCreativeText);
        return {
            ...baseStructure!,
            adCreativeTexts,
        };
    }
  }
);
