import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

class StorageService {
  private storageDir: string;

  constructor() {
    // Store cover art in a persistent volume
    this.storageDir = process.env.COVER_ART_STORAGE_PATH || '/app/data/cover-art';
    this.ensureStorageDir();
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.access(this.storageDir);
    } catch {
      await fs.mkdir(this.storageDir, { recursive: true });
      console.log(`✓ Created cover art storage directory: ${this.storageDir}`);
    }
  }

  /**
   * Save cover art image to local storage
   * @param imageBuffer Image data as Buffer
   * @param albumId Album database ID
   * @param sourceUrl Optional source URL for logging
   * @returns Local file path
   */
  async saveCoverArt(imageBuffer: Buffer, albumId: number, sourceUrl?: string): Promise<string> {
    await this.ensureStorageDir();

    // Detect image format from buffer
    const ext = this.detectImageFormat(imageBuffer);

    // Generate filename: {albumId}_{hash}.{ext}
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
    const filename = `${albumId}_${hash}.${ext}`;
    const filepath = path.join(this.storageDir, filename);

    // Write file
    await fs.writeFile(filepath, imageBuffer);

    console.log(`✓ Saved cover art: ${filename}${sourceUrl ? ` from ${sourceUrl}` : ''}`);

    // Return relative path for database storage
    return filename;
  }

  /**
   * Get full path to cover art file
   */
  getFullPath(filename: string): string {
    return path.join(this.storageDir, filename);
  }

  /**
   * Check if cover art file exists
   */
  async exists(filename: string): Promise<boolean> {
    try {
      await fs.access(this.getFullPath(filename));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read cover art file
   */
  async readCoverArt(filename: string): Promise<Buffer> {
    return fs.readFile(this.getFullPath(filename));
  }

  /**
   * Delete cover art file
   */
  async deleteCoverArt(filename: string): Promise<void> {
    try {
      await fs.unlink(this.getFullPath(filename));
      console.log(`✓ Deleted cover art: ${filename}`);
    } catch (error) {
      console.error(`Failed to delete cover art ${filename}:`, error);
    }
  }

  /**
   * Detect image format from buffer
   */
  private detectImageFormat(buffer: Buffer): string {
    // Check magic numbers
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'jpg';
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'png';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'gif';
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return 'webp';
    }

    // Default to jpg
    return 'jpg';
  }

  /**
   * Get MIME type for cover art file
   */
  getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

export default new StorageService();
