'use server';

/**
 * @fileOverview A flow to enhance an image using a text prompt.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const EnhanceImageInputSchema = z.object({
    imageUri: z.string().describe("The image to enhance, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
    prompt: z.string().describe('A text prompt describing the desired enhancements to the image.'),
});

export type EnhanceImageInput = z.infer<typeof EnhanceImageInputSchema>;

const EnhanceImageOutputSchema = z.object({
    enhancedImageUri: z.string().describe('The enhanced image, as a data URI.'),
});

export type EnhanceImageOutput = z.infer<typeof EnhanceImageOutputSchema>;

export async function enhanceImage(input: EnhanceImageInput): Promise<EnhanceImageOutput> {
    return enhanceImageFlow(input);
}

const enhanceImageFlow = ai.defineFlow(
    {
        name: 'enhanceImageFlow',
        inputSchema: EnhanceImageInputSchema,
        outputSchema: EnhanceImageOutputSchema,
    },
    async ({ imageUri, prompt }) => {
        const { media } = await ai.generate({
            model: 'googleai/gemini-2.5-flash-image-preview',
            prompt: [
                { media: { url: imageUri } },
                { text: `Enhance this image based on the following prompt: ${prompt}` },
            ],
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
            },
        });

        if (!media.url) {
            throw new Error('Image enhancement failed to produce an image.');
        }

        return {
            enhancedImageUri: media.url,
        };
    }
);
