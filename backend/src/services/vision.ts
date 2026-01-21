import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { VisionExtractionResult } from '../types';

type VisionProvider = 'anthropic' | 'openai';

class VisionService {
  private anthropicClient: Anthropic;
  private openaiClient: OpenAI;
  private primaryProvider: VisionProvider;
  private fallbackProvider: VisionProvider | null;
  private minConfidence: number;
  private hasOpenAI: boolean;
  private hasAnthropic: boolean;

  constructor() {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    this.hasOpenAI = !!openaiKey;
    this.hasAnthropic = !!anthropicKey;

    // Get minimum confidence threshold (default 90%)
    this.minConfidence = parseInt(process.env.VISION_MIN_CONFIDENCE || '90', 10);
    if (this.minConfidence < 0 || this.minConfidence > 100) {
      console.warn(`Invalid VISION_MIN_CONFIDENCE: ${process.env.VISION_MIN_CONFIDENCE}, using default 90`);
      this.minConfidence = 90;
    }

    // Determine primary provider based on configuration
    const configuredProvider = process.env.VISION_PROVIDER as VisionProvider;

    if (configuredProvider === 'openai' && openaiKey) {
      this.primaryProvider = 'openai';
      this.fallbackProvider = anthropicKey ? 'anthropic' : null;
    } else if (configuredProvider === 'anthropic' && anthropicKey) {
      this.primaryProvider = 'anthropic';
      this.fallbackProvider = openaiKey ? 'openai' : null;
    } else if (openaiKey) {
      // Default to OpenAI if available
      this.primaryProvider = 'openai';
      this.fallbackProvider = anthropicKey ? 'anthropic' : null;
    } else if (anthropicKey) {
      // Fallback to Anthropic
      this.primaryProvider = 'anthropic';
      this.fallbackProvider = null;
    } else {
      console.warn('⚠ No vision API keys configured - Image recognition will not work');
      this.primaryProvider = 'openai'; // Default fallback
      this.fallbackProvider = null;
    }

    this.anthropicClient = new Anthropic({ apiKey: anthropicKey });
    this.openaiClient = new OpenAI({ apiKey: openaiKey });

    console.log(`✓ Vision primary provider: ${this.primaryProvider}`);
    if (this.fallbackProvider) {
      console.log(`✓ Vision fallback provider: ${this.fallbackProvider} (min confidence: ${this.minConfidence}%)`);
    }
  }

  async extractAlbumInfo(base64Image: string): Promise<VisionExtractionResult> {
    // Try primary provider
    try {
      const result = await this.extractWithProvider(this.primaryProvider, base64Image);

      // Check if confidence meets threshold
      if (result.confidence && result.confidence >= this.minConfidence) {
        console.log(`✓ ${this.primaryProvider} confidence ${result.confidence}% meets threshold ${this.minConfidence}%`);
        return result;
      }

      // If confidence is too low and we have a fallback provider, try it
      if (this.fallbackProvider) {
        console.log(`⚠ ${this.primaryProvider} confidence ${result.confidence}% below threshold ${this.minConfidence}%, trying ${this.fallbackProvider}`);
        const fallbackResult = await this.extractWithProvider(this.fallbackProvider, base64Image);

        // Return whichever result has higher confidence
        if (fallbackResult.confidence && fallbackResult.confidence > (result.confidence || 0)) {
          console.log(`✓ ${this.fallbackProvider} confidence ${fallbackResult.confidence}% is better, using fallback result`);
          return fallbackResult;
        }

        console.log(`✓ ${this.primaryProvider} confidence ${result.confidence}% is still better, using primary result`);
      }

      return result;
    } catch (error) {
      // If primary provider fails and we have a fallback, try it
      if (this.fallbackProvider) {
        console.warn(`✗ ${this.primaryProvider} failed, trying ${this.fallbackProvider}:`, error);
        return this.extractWithProvider(this.fallbackProvider, base64Image);
      }
      throw error;
    }
  }

  private async extractWithProvider(provider: VisionProvider, base64Image: string): Promise<VisionExtractionResult> {
    if (provider === 'openai') {
      return this.extractWithOpenAI(base64Image);
    } else {
      return this.extractWithAnthropic(base64Image);
    }
  }

  private async extractWithOpenAI(base64Image: string): Promise<VisionExtractionResult> {
    try {
      // Extract base64 data URL if present
      let imageUrl = base64Image;
      if (!base64Image.startsWith('data:')) {
        imageUrl = `data:image/jpeg;base64,${base64Image}`;
      }

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o', // Latest GPT-4 with vision
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                }
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
        ],
        max_tokens: 1024,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      console.log('OpenAI raw response:', content);

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse JSON from OpenAI response');
      }

      const extracted = JSON.parse(jsonMatch[0]);

      console.log('OpenAI Vision response:', JSON.stringify(extracted, null, 2));

      return {
        artist: extracted.artist || undefined,
        album: extracted.album || undefined,
        year: extracted.year || undefined,
        confidence: extracted.confidence || 0,
      };
    } catch (error) {
      console.error('OpenAI vision extraction error:', error);
      throw new Error('Failed to extract album information from image using OpenAI');
    }
  }

  private async extractWithAnthropic(base64Image: string): Promise<VisionExtractionResult> {
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

      const message = await this.anthropicClient.messages.create({
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
      console.error('Anthropic vision extraction error:', error);
      throw new Error('Failed to extract album information from image using Anthropic');
    }
  }
}

export default new VisionService();
