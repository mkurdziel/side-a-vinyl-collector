import axios, { type AxiosInstance } from 'axios';
import redis from '../config/redis';
import { RateLimiter } from '../utils/rateLimit';
import type { DiscogsAlbum, DiscogsSearchResponse } from '../types';
import { AppError } from '../middleware/errorHandler';

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

  private logError(operation: string, error: unknown): void {
    // Axios errors retain request headers, including the Discogs token.
    console.error(operation, axios.isAxiosError(error)
      ? { code: error.code, status: error.response?.status }
      : { name: error instanceof Error ? error.name : 'UnknownError' });
  }

  private throwSearchError(error: unknown, message: string): never {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new AppError('Discogs took too long to respond. Please try again.', 503);
      }
      if (error.response?.status === 429) {
        throw new AppError('Discogs is busy. Please wait a moment and try again.', 503);
      }
      const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK'];
      if (networkCodes.includes(error.code || '') || (error.response && error.response.status >= 500)) {
        throw new AppError('Discogs is temporarily unavailable. Please try again.', 503);
      }
    }
    throw new Error(message);
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(`${this.cachePrefix}:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logError('Discogs cache get error:', error);
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
      this.logError('Discogs cache set error:', error);
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
      this.logError('Discogs barcode search error:', error);
      this.throwSearchError(error, 'Failed to search Discogs by barcode');
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
      this.logError('Discogs query search error:', error);
      this.throwSearchError(error, 'Failed to search Discogs');
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
      this.logError(`Discogs get release ${releaseId} error:`, error);
      return null;
    }
  }

  isConfigured(): boolean {
    return !!process.env.DISCOGS_TOKEN;
  }

  isEnabled(): boolean {
    return this.isConfigured() && process.env.DISCOGS_ENABLED !== 'false';
  }

  async getUserIdentity(): Promise<{ username: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get('/oauth/identity');
        return response.data;
      });
      return { username: result.username };
    } catch (error) {
      this.logError('Failed to get Discogs user identity:', error);
      return null;
    }
  }

  async searchArtist(query: string): Promise<{ id: number; title: string } | null> {
    const cacheKey = `artist_search:${query}`;
    const cached = await this.getCached<{ id: number; title: string }>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get<DiscogsSearchResponse>('/database/search', {
          params: { q: query, type: 'artist', per_page: 1 }
        });
        return response.data;
      });

      if (result.results && result.results.length > 0) {
        const artist = {
          id: result.results[0].id,
          title: result.results[0].title
        };
        await this.setCache(cacheKey, artist);
        return artist;
      }
      return null;
    } catch (error) {
      this.logError('Discogs artist search error:', error);
      return null;
    }
  }

  async getArtistReleases(artistId: number, limit: number = 20): Promise<DiscogsAlbum[]> {
    const cacheKey = `artist_releases:${artistId}:${limit}`;
    const cached = await this.getCached<DiscogsAlbum[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        // Fetch releases sorted by year or popularity (Discogs API defaults)
        const response = await this.client.get(`/artists/${artistId}/releases`, {
          params: { sort: 'year', sort_order: 'desc', per_page: limit * 2 } // Fetch more to filter
        });
        return response.data;
      });

      // Filter main releases (masters or main releases)
      const albums: DiscogsAlbum[] = [];
      const seen = new Set<string>();

      for (const release of result.releases) {
        // Simple deduplication by title
        const titleKey = release.title.toLowerCase().trim();
        if (seen.has(titleKey)) continue;
        
        // Skip singles/EPs if possible, though Discogs structure varies. 
        // We'll trust Discogs 'Main' releases or similar if available, otherwise take all.
        // For 'releases' endpoint, it lists everything.
        // Let's filter slightly by type if available, but Discogs API is loose here without deeper calls.
        // We will just map them.
        
        seen.add(titleKey);

        const year = release.year || undefined;
        // Use thumb as cover image - it's usually available in list view
        const coverImageUrl = release.thumb || undefined;

        albums.push({
          id: release.id,
          artist: release.artist, // 'artist' field might not be present in list, logic below
          album: release.title,
          year,
          coverImageUrl,
          discogsId: release.id // This might be a master ID or release ID depending on type
        });
        
        if (albums.length >= limit) break;
      }

      await this.setCache(cacheKey, albums);
      return albums;
    } catch (error) {
      this.logError(`Discogs artist releases error for ${artistId}:`, error);
      return [];
    }
  }

  async getUserCollection(username: string, page: number = 1, perPage: number = 100): Promise<DiscogsAlbum[]> {
    if (!this.isConfigured()) {
      throw new Error('Discogs token not configured');
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.client.get(`/users/${username}/collection/folders/0/releases`, {
          params: { page, per_page: perPage }
        });
        return response.data;
      });

      const albums = result.releases.map((item: any) => this.parseDiscogsRelease(item.basic_information));

      // Deduplicate based on artist + album (case-insensitive)
      const seen = new Map<string, DiscogsAlbum>();
      for (const album of albums) {
        const key = `${album.artist.toLowerCase()}||${album.album.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.set(key, album);
        }
      }

      return Array.from(seen.values());
    } catch (error) {
      this.logError('Failed to get Discogs collection:', error);
      throw new Error('Failed to fetch Discogs collection');
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
