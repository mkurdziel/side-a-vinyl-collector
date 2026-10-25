# Vision AI Providers

The vinyl collector app supports multiple AI vision providers for album cover recognition with automatic fallback for improved accuracy.

## Dual-Provider Fallback System

The system can use **both** providers with intelligent fallback:

1. **Primary provider** analyzes the image first
2. If confidence is below the threshold, **fallback provider** is tried automatically
3. The result with highest confidence is returned

This ensures maximum accuracy while optimizing API costs.

## Supported Providers

### OpenAI GPT-6 Astra
- Model: `gpt-6-astra` ([official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra), checked September 13, 2026)
- OpenAI's most capable model, with image input support
- Uses high-detail images and low reasoning effort for interactive cover recognition
- Requires `OPENAI_API_KEY` environment variable

### Anthropic Claude
- Default model: `claude-sonnet-5-5` ([official model documentation](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), checked October 25, 2026)
- Set `ANTHROPIC_VISION_MODEL` to override the default model
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

# Optional Anthropic model override
ANTHROPIC_VISION_MODEL=claude-sonnet-5-5

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
- **OpenAI GPT-6 Astra**: $10 per 1M input tokens, $50 per 1M output tokens at standard rates for this workload ([pricing](https://developers.openai.com/api/docs/models/gpt-6-astra))

### Token Usage Per Album
Usage depends on image dimensions, prompt length, and reasoning. The OpenAI request allows up to 8,192 completion tokens, including reasoning and the JSON result; this is a ceiling, not expected usage.

### Fallback Cost Impact
With dual-provider fallback enabled, a fallback attempt adds the second provider's usage cost. Measure actual token usage and fallback frequency on your covers before estimating per-album cost.

### Recommendations
- **High accuracy needs**: Use dual-provider with 90% threshold
- **Cost sensitive**: Use single provider with 70% threshold
- **Balanced**: Use dual-provider with 80% threshold

## Accuracy Comparison

Cover recognition accuracy has not been benchmarked for GPT-6 Astra in this app. Evaluate it on representative album photos; the providers' confidence scores are self-reported and are not measured accuracy percentages.
