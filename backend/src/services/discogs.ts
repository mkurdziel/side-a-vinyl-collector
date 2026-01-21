import axios, { AxiosInstance } from 'axios';
import redis from '../config/redis';
import { RateLimiter } from '../utils/rateLimit';
import { DiscogsAlbum, DiscogsSearchResponse } from '../types';

class DiscogsService {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private cachePrefix = 'discogs';
  private cacheTTL = 60 * 60 * 24 * 7; // 7 days in seconds

  constructor() {
    const token = process.env.DISCOGS_TOKEN;
    if (!token) {
      console.warn('⚠ DISCOGS_TOKEN not set - Discogs API will not work');
    }

    this.client = axios.create({
      baseURL: 'https://api.discogs.com',
      headers: {
        'User-Agent': 'VinylCollector/1.0',
        ...(token && { 'Authorization': `Discogs token=${token}` })
      },
      timeout: 10000,
    });

    // Rate limit: 60 requests per minute for authenticated requests
    this.rateLimiter = new RateLimiter(60);
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(`${this.cachePrefix}:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  private async setCache(key: string, value: any): Promise<void> {
    try {
      await redis.setex(
        `${this.cachePrefix}:${key}`,
        this.cacheTTL,
        JSON.stringify(value)
      );
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async searchByBarcode(barcode: string): Promise<DiscogsAlbum | null> {
    const cacheKey = `barcode:${barcode}`;
    const cached = await this.getCached<DiscogsAlbum>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get<DiscogsSearchResponse>('/database/search', {
          params: { barcode, type: 'release' }
        });
        return response.data;
      });

      if (result.results && result.results.length > 0) {
        const release = result.results[0];
        const album = this.parseDiscogsRelease(release);
        await this.setCache(cacheKey, album);
        return album;
      }

      return null;
    } catch (error) {
      console.error('Discogs barcode search error:', error);
      throw new Error('Failed to search Discogs by barcode');
    }
  }

  async searchByQuery(query: string, limit: number = 20): Promise<DiscogsAlbum[]> {
    const cacheKey = `search:${query}:${limit}`;
    const cached = await this.getCached<DiscogsAlbum[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get<DiscogsSearchResponse>('/database/search', {
          params: { q: query, type: 'release', per_page: limit }
        });
        return response.data;
      });

      const albums = result.results.map(release => this.parseDiscogsRelease(release));
      await this.setCache(cacheKey, albums);
      return albums;
    } catch (error) {
      console.error('Discogs query search error:', error);
      throw new Error('Failed to search Discogs');
    }
  }

  async getRelease(releaseId: number): Promise<DiscogsAlbum | null> {
    const cacheKey = `release:${releaseId}`;
    const cached = await this.getCached<DiscogsAlbum>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get(`/releases/${releaseId}`);
        return response.data;
      });

      const album = this.parseDiscogsRelease(result);
      await this.setCache(cacheKey, album);
      return album;
    } catch (error) {
      console.error(`Discogs get release ${releaseId} error:`, error);
      return null;
    }
  }

  private parseDiscogsRelease(release: any): DiscogsAlbum {
    // Extract artist and album from title
    // Discogs search results format: "Artist Name - Album Title"
    // Release details have separate artist and title fields
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';

    if (release.title) {
      // Check if title contains " - " separator (search results format)
      const separator = release.title.indexOf(' - ');
      if (separator > 0) {
        artist = release.title.substring(0, separator).trim();
        album = release.title.substring(separator + 3).trim();
      } else {
        album = release.title;
      }
    }

    // Override with explicit artist/artists field if available (release details)
    if (release.artist) {
      artist = release.artist;
    } else if (release.artists && release.artists[0]?.name) {
      artist = release.artists[0].name;
    }

    // Extract year
    const year = release.year || undefined;

    // Extract cover image URL
    const coverImageUrl = release.cover_image ||
                          (release.images && release.images[0]?.uri) ||
                          undefined;

    // Discogs ID
    const discogsId = release.id;

    return {
      id: discogsId,
      artist,
      album,
      year,
      coverImageUrl,
      discogsId,
    };
  }
}

export default new DiscogsService();
