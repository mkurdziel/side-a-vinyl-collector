import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const { openaiCreate, anthropicCreate } = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

describe('Vision Service - Cover Recognition', () => {
  let image: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    vi.stubEnv('VISION_PROVIDER', 'openai');
    vi.stubEnv('VISION_MIN_CONFIDENCE', '90');
    vi.stubEnv('ANTHROPIC_VISION_MODEL', '');
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    }).png().toBuffer();
    image = `data:image/png;base64,${buffer.toString('base64')}`;
  });

  afterEach(() => vi.unstubAllEnvs());

  it('sends an Astra-compatible image request and preserves album metadata', async () => {
    openaiCreate.mockImplementation(async (request) => {
      expect(request.model).toBe('gpt-6-astra');
      expect(request).not.toHaveProperty('temperature');
      expect(request).not.toHaveProperty('max_tokens');
      expect(request.reasoning_effort).toBe('low');
      expect(request.max_completion_tokens).toBeGreaterThan(1024);
      expect(request.messages[0].content).toContainEqual({
        type: 'image_url', image_url: { url: image, detail: 'high' },
      });
      return { choices: [{ message: { content: JSON.stringify({
        artist: 'Portishead', album: 'Dummy', year: 1994, confidence: 98,
      }) } }] };
    });
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).resolves.toEqual({
      artist: 'Portishead', album: 'Dummy', year: 1994, confidence: 98,
      provider: 'openai', usedFallback: false,
    });
    expect(openaiCreate).toHaveBeenCalledOnce();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('preserves null metadata when OpenAI cannot identify a cover', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    openaiCreate.mockResolvedValue({ choices: [{ message: {
      content: '{"artist":null,"album":null,"year":null,"confidence":0}',
    } }] });
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).resolves.toEqual({
      artist: undefined, album: undefined, year: undefined, confidence: 0,
      provider: 'openai', usedFallback: false,
    });
  });

  it('still falls back to Anthropic if the OpenAI model request fails', async () => {
    openaiCreate.mockRejectedValue(new Error('Model unavailable'));
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text',
      text: '{"artist":"Portishead","album":"Dummy","year":1994,"confidence":95}',
    }] });
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).resolves.toMatchObject({
      artist: 'Portishead', album: 'Dummy', confidence: 95,
      provider: 'anthropic', usedFallback: true,
    });
    expect(anthropicCreate).toHaveBeenCalledOnce();
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-5-5', max_tokens: 8192, output_config: { effort: 'low' },
    }));
  });

  it('keeps a successful identification when the confidence fallback fails', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: {
      content: '{"artist":"Portishead","album":"Dummy","year":1994,"confidence":75}',
    } }] });
    anthropicCreate.mockRejectedValue(new Error('Provider unavailable'));
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).resolves.toMatchObject({
      artist: 'Portishead', album: 'Dummy', confidence: 75,
      provider: 'openai', usedFallback: false,
    });
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  it('recognizes a file whose browser supplies an octet-stream data URI', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: {
      content: '{"artist":"Portishead","album":"Dummy","confidence":98}',
    } }] });
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image.replace('image/png', 'application/octet-stream')))
      .resolves.toMatchObject({ artist: 'Portishead', album: 'Dummy' });
    expect(openaiCreate.mock.calls[0]![0].messages[0].content[0].image_url.url).toBe(image);
  });

  it('allows an Anthropic-only installation', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_VISION_MODEL', 'claude-sonnet-4-6');
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text',
      text: '{"artist":"Portishead","album":"Dummy","confidence":95}',
    }] });
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).resolves.toMatchObject({ provider: 'anthropic' });
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }));
  });

  it('reports an unavailable image service without preventing startup', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { default: vision } = await import('../../src/services/vision');

    await expect(vision.extractAlbumInfo(image)).rejects.toMatchObject({
      message: 'Image recognition is not configured', statusCode: 503,
    });
  });
});
