import axios, { AxiosInstance } from 'axios';
import redis from '../config/redis';
import { RateLimiter } from '../utils/rateLimit';

interface MusicBrainzRelease {
  id: string;
  title: string;
  date?: string;
  'artist-credit'?: Array<{
    artist: {
      name: string;
      id: string;
    };
  }>;
}

interface MusicBrainzSearchResult {
  releases: MusicBrainzRelease[];
  count: number;
}

interface CoverArtArchiveResponse {
  images: Array<{
    image: string;
    thumbnails: {
      small: string;
      large: string;
      '250'?: string;
      '500'?: string;
      '1200'?: string;
    };
    front: boolean;
    types: string[];
  }>;
  release: string;
}

export interface MusicBrainzAlbum {
  mbid: string; // MusicBrainz ID
  artist: string;
  album: string;
  year?: number;
  coverArtUrl?: string;
  hasCoverArt: boolean;
}

class MusicBrainzService {
  private mbClient: AxiosInstance;
  private caaClient: AxiosInstance;
  private rateLimiter: RateLimiter;
  private cachePrefix = 'musicbrainz';
  private cacheTTL = 60 * 60 * 24 * 30; // 30 days in seconds

  constructor() {
    // MusicBrainz API client
    this.mbClient = axios.create({
      baseURL: 'https://musicbrainz.org/ws/2',
      headers: {
        'User-Agent': 'VinylCollector/1.0 ( https://github.com/mkurdziel/side-a-vinyl-collector )',
        'Accept': 'application/json'
      },
      timeout: 10000,
    });

    // Cover Art Archive client
    this.caaClient = axios.create({
      baseURL: 'https://coverartarchive.org',
      headers: {
        'User-Agent': 'VinylCollector/1.0 ( https://github.com/mkurdziel/side-a-vinyl-collector )',
      },
      timeout: 15000,
    });

    // MusicBrainz rate limit: 1 request per second
    this.rateLimiter = new RateLimiter(1, 1000);

    console.log('✓ MusicBrainz service initialized');
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(`${this.cachePrefix}:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('MusicBrainz cache get error:', error);
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
      console.error('MusicBrainz cache set error:', error);
    }
  }

  /**
   * Search for a release by artist and album name
   */
  async searchRelease(artist: string, album: string): Promise<MusicBrainzAlbum | null> {
    const cacheKey = `search:${artist}:${album}`;
    const cached = await this.getCached<MusicBrainzAlbum>(cacheKey);
    if (cached) return cached;

    try {
      const query = `artist:"${artist}" AND release:"${album}"`;

      const result = await this.rateLimiter.execute(async () => {
        const response = await this.mbClient.get<MusicBrainzSearchResult>('/release', {
          params: {
            query,
            limit: 1,
            fmt: 'json'
          }
        });
        return response.data;
      });

      if (result.releases && result.releases.length > 0) {
        const release = result.releases[0];
        const mbAlbum = await this.parseRelease(release);
        await this.setCache(cacheKey, mbAlbum);
        return mbAlbum;
      }

      return null;
    } catch (error) {
      console.error('MusicBrainz search error:', error);
      return null;
    }
  }

  /**
   * Get cover art for a MusicBrainz release ID
   */
  async getCoverArt(mbid: string): Promise<string | null> {
    const cacheKey = `coverart:${mbid}`;
    const cached = await this.getCached<string>(cacheKey);
    if (cached) return cached;

    try {
      // Cover Art Archive doesn't require rate limiting (separate service)
      const response = await this.caaClient.get<CoverArtArchiveResponse>(`/release/${mbid}`);

      // Find front cover
      const frontCover = response.data.images.find(img => img.front);
      const coverUrl = frontCover?.image || response.data.images[0]?.image;

      if (coverUrl) {
        await this.setCache(cacheKey, coverUrl);
        return coverUrl;
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        // No cover art available for this release
        console.log(`No cover art found for MBID ${mbid}`);
        return null;
      }
      console.error('Cover Art Archive error:', error);
      return null;
    }
  }

  /**
   * Search for release and get cover art in one call
   */
  async searchAndGetCoverArt(artist: string, album: string): Promise<MusicBrainzAlbum | null> {
    const release = await this.searchRelease(artist, album);

    if (!release) {
      return null;
    }

    // Try to get cover art
    const coverArt = await this.getCoverArt(release.mbid);

    return {
      ...release,
      coverArtUrl: coverArt || undefined,
      hasCoverArt: !!coverArt
    };
  }

  private async parseRelease(release: MusicBrainzRelease): Promise<MusicBrainzAlbum> {
    const artist = release['artist-credit']?.[0]?.artist?.name || 'Unknown Artist';
    const album = release.title || 'Unknown Album';
    const year = release.date ? parseInt(release.date.substring(0, 4)) : undefined;

    return {
      mbid: release.id,
      artist,
      album,
      year,
      hasCoverArt: false, // Will be set when getCoverArt is called
    };
  }

  /**
   * Download cover art image as buffer for local storage
   */
  async downloadCoverArt(url: string): Promise<Buffer> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'VinylCollector/1.0 ( https://github.com/mkurdziel/side-a-vinyl-collector )',
        }
      });
      return Buffer.from(response.data);
    } catch (error) {
      console.error('Failed to download cover art:', error);
      throw new Error('Failed to download cover art image');
    }
  }
}

export default new MusicBrainzService();
