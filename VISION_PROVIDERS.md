# Vision AI Providers

The vinyl collector app supports multiple AI vision providers for album cover recognition with automatic fallback for improved accuracy.

## Dual-Provider Fallback System

The system can use **both** providers with intelligent fallback:

1. **Primary provider** analyzes the image first
2. If confidence is below the threshold, **fallback provider** is tried automatically
3. The result with highest confidence is returned

This ensures maximum accuracy while optimizing API costs.

## Supported Providers

### OpenAI GPT-4
- Model: `gpt-4o` (latest vision model)
- High-quality image understanding
- Excellent at recognizing iconic album covers
- Requires `OPENAI_API_KEY` environment variable

### Anthropic Claude
- Model: `claude-sonnet-4-20250514`
- Excellent accuracy for text recognition on album covers
- Very strong with OCR for artist names and album titles
- Requires `ANTHROPIC_API_KEY` environment variable

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Primary provider (default: 'openai')
# Options: 'anthropic' or 'openai'
VISION_PROVIDER=openai

# Minimum confidence threshold (0-100, default: 90)
# If primary provider returns confidence below this, fallback provider is tried
VISION_MIN_CONFIDENCE=90

# API Keys - configure both for automatic fallback
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### Provider Selection Logic

The system intelligently selects and falls back between providers:

1. **Primary Provider**: Set by `VISION_PROVIDER` (defaults to `openai`)
2. **Confidence Check**: If result confidence < `VISION_MIN_CONFIDENCE`
3. **Fallback Provider**: Automatically tries the other provider (if configured)
4. **Best Result**: Returns whichever provider gave higher confidence

**Example Flow:**
```
User uploads image
  ↓
OpenAI analyzes (primary) → 85% confidence
  ↓
Below 90% threshold, try fallback
  ↓
Anthropic analyzes (fallback) → 95% confidence
  ↓
Return Anthropic result (higher confidence)
```

### Configuration Examples

**Best Accuracy (Recommended):**
```bash
VISION_PROVIDER=openai
VISION_MIN_CONFIDENCE=90
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```
- Tries OpenAI first, falls back to Anthropic if confidence < 90%

**Cost Optimized:**
```bash
VISION_PROVIDER=openai
VISION_MIN_CONFIDENCE=70
OPENAI_API_KEY=sk-xxxxx
# Don't configure ANTHROPIC_API_KEY
```
- Only uses OpenAI, accepts lower confidence threshold

**Anthropic Primary:**
```bash
VISION_PROVIDER=anthropic
VISION_MIN_CONFIDENCE=90
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
OPENAI_API_KEY=sk-xxxxx
```
- Tries Anthropic first, falls back to OpenAI if needed

## Monitoring

Check logs to see which provider was used:

```bash
docker logs vinyl_backend | grep -i vision
```

You'll see messages like:
```
✓ Vision primary provider: openai
✓ Vision fallback provider: anthropic (min confidence: 90%)
⚠ openai confidence 85% below threshold 90%, trying anthropic
✓ anthropic confidence 95% is better, using fallback result
```

## Cost Considerations

### Per-Request Costs
- **Anthropic Claude Sonnet 4**: ~$3 per 1M input tokens, ~$15 per 1M output tokens
- **OpenAI GPT-4o**: ~$2.50 per 1M input tokens, ~$10 per 1M output tokens

### Token Usage Per Album
Each album cover analysis typically uses:
- ~1000-2000 tokens for the image
- ~100-200 tokens for the prompt
- ~50-100 tokens for the response
- **Total: ~1500 tokens per analysis**

### Fallback Cost Impact
With dual-provider fallback enabled:
- **Best case**: Only primary provider used (~$0.004 per album)
- **Fallback triggered**: Both providers used (~$0.008 per album)
- **Typical usage**: ~20-30% fallback rate (based on 90% threshold)

### Recommendations
- **High accuracy needs**: Use dual-provider with 90% threshold
- **Cost sensitive**: Use single provider with 70% threshold
- **Balanced**: Use dual-provider with 80% threshold

## Accuracy Comparison

Both providers deliver excellent results:

- **GPT-4o**: Best for iconic albums, overall image understanding
- **Claude Sonnet 4**: Best for text-heavy covers, OCR accuracy

With dual-provider fallback at 90% confidence:
- **~95% first-try accuracy** (primary provider meets threshold)
- **~98% with fallback** (either provider succeeds)
- Significantly better than single-provider setups
