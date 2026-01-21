import Anthropic from '@anthropic-ai/sdk';
import { VisionExtractionResult } from '../types';

class VisionService {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('⚠ ANTHROPIC_API_KEY not set - Image recognition will not work');
    }
    this.client = new Anthropic({ apiKey });
  }

  async extractAlbumInfo(base64Image: string): Promise<VisionExtractionResult> {
    try {
      // Extract base64 data and detect media type
      const base64Match = base64Image.match(/^data:image\/(\w+);base64,(.+)$/);
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
      let imageData = base64Image;

      if (base64Match) {
        // Has data URI prefix - extract media type and data
        const detectedType = base64Match[1].toLowerCase();
        // Map to supported types (Claude only supports jpeg, png, gif, webp)
        if (detectedType === 'jpeg' || detectedType === 'jpg') {
          mediaType = 'image/jpeg';
        } else if (detectedType === 'png') {
          mediaType = 'image/png';
        } else if (detectedType === 'gif') {
          mediaType = 'image/gif';
        } else if (detectedType === 'webp') {
          mediaType = 'image/webp';
        } else {
          // Unsupported format (HEIC, etc.) - default to jpeg
          console.warn(`Unsupported image format: ${detectedType}, defaulting to jpeg`);
          mediaType = 'image/jpeg';
        }
        imageData = base64Match[2];
      } else {
        // No data URI prefix - assume raw base64
        imageData = base64Image.replace(/^data:image\/\w+;base64,/, '');
      }

      const message = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageData,
                },
              },
              {
                type: 'text',
                text: `What album is this? Look at the album cover and identify the artist name, album title, and year if visible.

Also provide a confidence score (0-100) indicating how certain you are about the identification.

Return ONLY JSON:
{"artist":"Artist Name","album":"Album Title","year":1994,"confidence":85}

Use null for any field you cannot determine. Confidence scoring guide:
- 90-100: Very certain, clear text and recognizable album
- 70-89: Confident, most details visible
- 50-69: Moderate confidence, some details unclear
- 30-49: Low confidence, image quality or partial visibility issues
- 0-29: Very uncertain, guessing based on limited information`
              }
            ]
          }
        ]
      });

      const textContent = message.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      console.log('Claude raw text response:', textContent.text);

      // Parse JSON from response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse JSON from Claude response');
      }

      const extracted = JSON.parse(jsonMatch[0]);

      console.log('Claude Vision response:', JSON.stringify(extracted, null, 2));

      return {
        artist: extracted.artist || undefined,
        album: extracted.album || undefined,
        year: extracted.year || undefined,
        confidence: extracted.confidence || 0,
      };
    } catch (error) {
      console.error('Vision extraction error:', error);
      throw new Error('Failed to extract album information from image');
    }
  }
}

export default new VisionService();
