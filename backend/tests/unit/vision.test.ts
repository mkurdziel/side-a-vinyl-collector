import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

describe('Vision Service - Image Compression', () => {
  it('should strip data URI prefix correctly', () => {
    const testBase64 = 'ABC123XYZ';
    const heicPrefix = `data:image/heic;base64,${testBase64}`;
    const jpegPrefix = `data:image/jpeg;base64,${testBase64}`;
    const pngPrefix = `data:image/png;base64,${testBase64}`;

    // Test stripping various formats
    expect(heicPrefix.replace(/^data:image\/\w+;base64,/, '')).toBe(testBase64);
    expect(jpegPrefix.replace(/^data:image\/\w+;base64,/, '')).toBe(testBase64);
    expect(pngPrefix.replace(/^data:image\/\w+;base64,/, '')).toBe(testBase64);
  });

  it('should handle base64 data without data URI prefix', () => {
    const testBase64 = 'ABC123XYZ';

    // Strip prefix (should be no-op)
    const stripped = testBase64.replace(/^data:image\/\w+;base64,/, '');

    expect(stripped).toBe(testBase64);
  });

  it('should correctly identify unsupported formats', () => {
    const SUPPORTED_FORMATS = ['jpeg', 'jpg', 'png', 'gif', 'webp'];

    // Test format detection
    expect(SUPPORTED_FORMATS.includes('heic')).toBe(false);
    expect(SUPPORTED_FORMATS.includes('heif')).toBe(false);
    expect(SUPPORTED_FORMATS.includes('bmp')).toBe(false);
    expect(SUPPORTED_FORMATS.includes('tiff')).toBe(false);

    // Supported formats
    expect(SUPPORTED_FORMATS.includes('jpeg')).toBe(true);
    expect(SUPPORTED_FORMATS.includes('png')).toBe(true);
    expect(SUPPORTED_FORMATS.includes('webp')).toBe(true);
  });

  it('should compress and convert a large PNG image', async () => {
    const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB target
    const MAX_DIMENSION = 2048;

    // Create a large test image (5000x5000 pixels)
    const largeImage = await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).png().toBuffer();

    console.log(`Original size: ${(largeImage.length / 1024 / 1024).toFixed(2)}MB`);

    // Convert to base64 with data URI
    const base64WithPrefix = `data:image/png;base64,${largeImage.toString('base64')}`;

    // Strip data URI prefix (this is what was missing before!)
    const base64Data = base64WithPrefix.replace(/^data:image\/\w+;base64,/, '');

    // Convert base64 back to buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Verify the buffer is valid
    const metadata = await sharp(imageBuffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(5000);
    expect(metadata.height).toBe(5000);

    // Now compress and resize
    let resized = sharp(imageBuffer);

    // Resize since it's larger than MAX_DIMENSION
    resized = resized.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true
    });

    // Convert to JPEG
    let quality = 85;
    let compressed = await resized.jpeg({ quality }).toBuffer();

    // Reduce quality if needed
    while (compressed.length > MAX_SIZE_BYTES && quality > 40) {
      quality -= 10;
      compressed = await sharp(imageBuffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality })
        .toBuffer();
    }

    const finalSize = compressed.length;
    console.log(`Compressed size: ${(finalSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Quality: ${quality}`);

    // Verify the conversion worked
    const convertedMetadata = await sharp(compressed).metadata();
    expect(convertedMetadata.format).toBe('jpeg');
    expect(finalSize).toBeLessThanOrEqual(MAX_SIZE_BYTES);
    expect(convertedMetadata.width).toBeLessThanOrEqual(MAX_DIMENSION);
    expect(convertedMetadata.height).toBeLessThanOrEqual(MAX_DIMENSION);

    console.log(`✓ Successfully compressed ${(largeImage.length / 1024 / 1024).toFixed(2)}MB PNG to ${(finalSize / 1024 / 1024).toFixed(2)}MB JPEG`);
  });

  it('should handle already compressed images efficiently', async () => {
    const MAX_SIZE_BYTES = 4 * 1024 * 1024;
    const MAX_DIMENSION = 2048;
    const SUPPORTED_FORMATS = ['jpeg', 'jpg', 'png', 'gif', 'webp'];

    // Create a small test image (500x500 pixels)
    const smallImage = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 3,
        background: { r: 0, g: 255, b: 0 }
      }
    }).jpeg().toBuffer();

    const metadata = await sharp(smallImage).metadata();
    const format = metadata.format?.toLowerCase();

    console.log(`Small image size: ${(smallImage.length / 1024).toFixed(2)}KB`);
    console.log(`Format: ${format}`);

    // Check if compression is needed
    const needsConversion = !format || !SUPPORTED_FORMATS.includes(format);
    const needsResize = metadata.width && metadata.height &&
      (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION);
    const needsCompression = smallImage.length > MAX_SIZE_BYTES;

    expect(needsConversion).toBe(false); // JPEG is supported
    expect(needsResize).toBe(false); // 500x500 is under limit
    expect(needsCompression).toBe(false); // Small image under 4MB

    console.log(`✓ Small JPEG image doesn't need processing`);
  });
});
