import axios, { type AxiosInstance } from 'axios';
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
  coverImageUrl?: string;
  hasCoverArt: boolean;
}

class MusicBrainzService {
  private mbClient: AxiosInstance;
  private caaClient: AxiosInstance;
  private rateLimiter: RateLimiter;
  private cachePrefix = 'musicbrainz';
  private cacheTTL = 60 * 60 * 24 * 30; // 30 days in seconds
  private enabled: boolean;

  constructor() {
    // Check if MusicBrainz is enabled (default: true)
    this.enabled = process.env.MUSICBRAINZ_ENABLED !== 'false';

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

    // MusicBrainz rate limit: 1 request per second (~60/min)
    this.rateLimiter = new RateLimiter(60);

    if (this.enabled) {
      console.log('✓ MusicBrainz service initialized');
    } else {
      console.log('✓ MusicBrainz service disabled (MUSICBRAINZ_ENABLED=false)');
    }
  }

  /**
   * Check if MusicBrainz lookups are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
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
    if (!this.enabled) {
      return null;
    }

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
        const release = result.releases[0]; // Logic check: releases is array, length > 0 checked. 
        if (!release) return null; // Logic safety
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
    if (!this.enabled) {
      return null;
    }

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
    if (!this.enabled) {
      console.log('MusicBrainz disabled, skipping lookup');
      return null;
    }

    const release = await this.searchRelease(artist, album);

    if (!release) {
      return null;
    }

    // Try to get cover art
    const coverArt = await this.getCoverArt(release.mbid);

    return {
      ...release,
      coverImageUrl: coverArt || undefined,
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
  /**
   * Search for multiple releases and check for cover art
   */
  async searchReleasesWithCoverArt(artist: string, album: string, limit: number = 5): Promise<MusicBrainzAlbum[]> {
    if (!this.enabled) {
      return [];
    }

    try {
      const query = `artist:"${artist}" AND release:"${album}"`;

      // 1. Search for releases
      const searchResult = await this.rateLimiter.execute(async () => {
        const response = await this.mbClient.get<MusicBrainzSearchResult>('/release', {
          params: {
            query,
            limit: limit * 2, // Fetch more to filter
            fmt: 'json'
          }
        });
        return response.data;
      });

      if (!searchResult.releases || searchResult.releases.length === 0) {
        return [];
      }

      // 2. Parse releases
      const candidates = await Promise.all(
        searchResult.releases.slice(0, limit * 2).map(r => this.parseRelease(r))
      );

      // 3. Check for cover art in parallel (with some concurrency limit ideally, but simple parallel for now)
      // Note: We're not using rate limiter for Cover Art Archive as it's separate and high capacity
      const updates = await Promise.all(
        candidates.map(async (candidate) => {
          const coverUrl = await this.getCoverArt(candidate.mbid);
          if (coverUrl) {
            return { ...candidate, coverImageUrl: coverUrl, hasCoverArt: true };
          }
          return null;
        })
      );

      // Filter out those without cover art and limit results
      return updates
        .filter((c): c is MusicBrainzAlbum & { coverImageUrl: string } => c !== null)
        .slice(0, limit);

    } catch (error) {
      console.error('MusicBrainz multi-search error:', error);
      return [];
    }
  }

  /**
   * Search for an artist by name
   */
  async searchArtist(query: string): Promise<{ id: string; name: string } | null> {
    if (!this.enabled) return null;

    const cacheKey = `artist_search:${query}`;
    const cached = await this.getCached<{ id: string; name: string }>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.mbClient.get('/artist', {
          params: { query: `artist:${query}`, limit: 1, fmt: 'json' }
        });
        return response.data;
      });

      if (result.artists && result.artists.length > 0) {
        // Simple confidence check could go here, but taking top result for now
        const artist = {
          id: result.artists[0].id,
          name: result.artists[0].name
        };
        await this.setCache(cacheKey, artist);
        return artist;
      }
      return null;
    } catch (error) {
      console.error('MusicBrainz artist search error:', error);
      return null;
    }
  }

  /**
   * Get release groups for an artist
   * Release groups are abstract "albums" that group all versions (releases) together
   */
  async getArtistReleaseGroups(artistId: string, artistName: string, limit: number = 20): Promise<MusicBrainzAlbum[]> {
    if (!this.enabled) return [];

    const cacheKey = `artist_release_groups:${artistId}:${limit}`;
    const cached = await this.getCached<MusicBrainzAlbum[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.rateLimiter.execute(async () => {
        const response = await this.mbClient.get('/release-group', {
          params: {
            artist: artistId,
            type: 'album', // Prioritize albums over EPs/Singles
            limit: 100, // Fetch more to filter/sort
            fmt: 'json'
          }
        });
        return response.data;
      });

      if (!result['release-groups']) return [];

      let releaseGroups = result['release-groups'];

      // Filter: primary type must be Album
      // Optional: secondary types should be null (avoids Live, Compilation etc if desired, but user might want them)
      // For now, let's stick to main Albums.
      releaseGroups = releaseGroups.filter((rg: any) =>
        rg['primary-type'] === 'Album' &&
        (!rg['secondary-types'] || rg['secondary-types'].length === 0) // Strict "Studio Album" filter
      );

      // Sort by first-release-date
      releaseGroups.sort((a: any, b: any) => {
        const dateA = a['first-release-date'] || '0000';
        const dateB = b['first-release-date'] || '0000';
        return dateB.localeCompare(dateA); // Newest first
      });

      // Slice to limit
      releaseGroups = releaseGroups.slice(0, limit);

      // Convert to our format
      // Note: Release Groups don't have cover art directly. We need to fetch a "representative release" or just use the RG ID for lookups.
      // The Cover Art Archive supports Release Group IDs!
      
      const albums: MusicBrainzAlbum[] = await Promise.all(releaseGroups.map(async (rg: any) => {
        const mbid = rg.id;
        const year = rg['first-release-date'] ? parseInt(rg['first-release-date'].substring(0, 4)) : undefined;
        
        // Try to get cover art for the Release Group
        // We'll do this optimistically; if it fails, the frontend shows placeholder
        let coverImageUrl: string | undefined;
        try {
           const url = await this.getReleaseGroupCoverArt(mbid);
           coverImageUrl = url || undefined;
        } catch (e) {
           // ignore
        }

        return {
          mbid,
          artist: artistName || rg['artist-credit']?.[0]?.artist?.name || 'Unknown',
          album: rg.title,
          year,
          coverImageUrl: coverImageUrl || undefined,
          hasCoverArt: !!coverImageUrl
        };
      }));

      await this.setCache(cacheKey, albums);
      return albums;

    } catch (error) {
      console.error(`MusicBrainz release groups error for ${artistId}:`, error);
      return [];
    }
  }

  /**
   * Get cover art for a Release Group
   */
  async getReleaseGroupCoverArt(rgid: string): Promise<string | null> {
     const cacheKey = `rg_cover:${rgid}`;
     const cached = await this.getCached<string>(cacheKey);
     if (cached) return cached;

     try {
       const response = await this.caaClient.get<CoverArtArchiveResponse>(`/release-group/${rgid}`);
       const front = response.data.images.find(i => i.front);
       const url = front?.image || response.data.images[0]?.image;
       
       if (url) {
         await this.setCache(cacheKey, url);
         return url;
       }
       return null;
     } catch (error) {
       return null; 
     }
  }
}

export default new MusicBrainzService();
