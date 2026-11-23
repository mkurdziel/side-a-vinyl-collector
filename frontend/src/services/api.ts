// API URL configuration
// - Production (single-container): Use empty string for same-origin requests
// - Development (multi-container): Use VITE_API_URL or default to localhost:5001
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5001' : '');

export type SavedMatch = 'title' | 'release' | 'barcode';
export type CatalogListing =
  | { source: 'discogs'; kind: 'master'; id: number }
  | { source: 'musicbrainz'; kind: 'release-group'; id: string };

export interface PressingDetails {
  format?: string;
  label?: string;
  catalogNumber?: string;
  country?: string;
}

export function isExactSavedMatch(match?: SavedMatch | null): boolean {
  return match === 'release' || match === 'barcode';
}

/**
 * Get cover art URL for an album
 * This uses the backend endpoint which serves either:
 * 1. Locally cached official MusicBrainz cover art
 * 2. Redirect to MusicBrainz Cover Art Archive
 * 3. Redirect to Discogs or other source
 */
export function getCoverArtUrl(albumId: number): string {
  return `${API_URL}/api/cover-art/${albumId}`;
}

export interface Album {
  id: number;
  title: string;
  artist_name: string;
  year?: number;
  cover_image_url?: string;
  musicbrainz_id?: string;
  discogs_id?: number | null;
  catalog_listing?: CatalogListing | null;
  local_cover_path?: string;
  cover_art_fetched?: boolean;
  notes?: string;
  added_at: string;
  status: 'collection' | 'wishlist';
}

export interface SearchResult {
  local: Album[];
  discogs: DiscogsAlbum[];
  errors?: string[];
  nextOffset?: number;
  catalogSampled?: boolean;
}

export type SavedTitleMatch = Pick<Album, 'id' | 'title' | 'artist_name' | 'status' | 'year' | 'discogs_id' | 'catalog_listing'>;

export interface BackupManifest {
  timestamp: string | null;
  albums: number;
  collection: number;
  wishlist: number;
  artwork: number;
  barcodes: number;
  warnings: string[];
}

export interface BackupOutcome {
  message: string;
  stats: { albums: number; artwork: number; barcodes: number };
  warnings: string[];
  skippedArtwork: { album: string; reason: string }[];
}

export interface DiscogsAlbum {
  id: number;
  artist: string;
  album: string;
  year?: number;
  coverImageUrl?: string;
  discogsId: number;
  discogsListing?: 'release' | 'master';
  source?: 'musicbrainz' | 'discogs';
  mbid?: string;
  inCollection?: boolean;
  inWishlist?: boolean;
  existingAlbumId?: number | null;
  existingMatch?: SavedMatch | null;
  titleMatches?: SavedTitleMatch[];
  fromProvider?: string;
}

export interface SearchCoverArtResult {
  source: 'MusicBrainz' | 'Discogs';
  url: string;
  title: string;
  year?: number;
  id: string | number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly existingAlbumId?: number;

  constructor(message: string, status: number, existingAlbumId?: number) {
    super(message);
    this.status = status;
    this.existingAlbumId = existingAlbumId;
  }
}

class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: options?.body instanceof FormData ? options.headers : {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = typeof body?.error === 'string' && body.error ? body.error : 'Request failed';
      const existingAlbumId = typeof body?.existingAlbumId === 'number' && Number.isSafeInteger(body.existingAlbumId)
        ? body.existingAlbumId : undefined;
      throw new ApiError(message, response.status, existingAlbumId);
    }

    return response.json();
  }

  async getAlbums(status: 'collection' | 'wishlist' = 'collection', signal?: AbortSignal): Promise<{ albums: Album[] }> {
    return this.request(`/api/albums?status=${status}`, { signal });
  }

  async getAlbum(id: number): Promise<{ album: Album }> {
    return this.request(`/api/albums/${id}`);
  }

  async getPressingDetails(releaseId: number, signal: AbortSignal): Promise<{ pressing: PressingDetails | null }> {
    return this.request(`/api/discogs/releases/${releaseId}/pressing`, { signal });
  }

  async addAlbum(data: {
    artist: string;
    album: string;
    year?: number;
    coverImageUrl?: string;
    discogsId?: number;
    catalogListing?: CatalogListing;
    barcode?: string;
    status?: 'collection' | 'wishlist';
  }): Promise<{ album: Album }> {
    return this.request('/api/albums', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteAlbum(id: number, expectedStatus?: Album['status']): Promise<void> {
    const expected = expectedStatus ? `?expectedStatus=${expectedStatus}` : '';
    return this.request(`/api/albums/${id}${expected}`, { method: 'DELETE' });
  }

  async updateNotes(id: number, notes: string): Promise<void> {
    return this.request(`/api/albums/${id}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  }

  async updateStatus(id: number, status: Album['status'], expectedStatus?: Album['status']): Promise<void> {
    return this.request(`/api/albums/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, expectedStatus }),
    });
  }

  async search(query: string, signal?: AbortSignal, scope?: 'saved' | 'catalog', shelf?: Album['status'], offset?: number, sort?: 'title' | 'artist' | 'date'): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query });
    if (scope) params.set('scope', scope);
    if (shelf) params.set('shelf', shelf);
    if (offset !== undefined) params.set('offset', String(offset));
    if (sort && scope === 'saved') params.set('sort', sort);
    return this.request(`/api/search?${params}`, { signal });
  }

  private uploadBackup<T>(action: 'preview' | 'import', file: File): Promise<T> {
    const body = new FormData();
    body.append('backup', file);
    return this.request(`/api/backup/${action}`, { method: 'POST', body });
  }

  previewBackup(file: File): Promise<BackupManifest> {
    return this.uploadBackup('preview', file);
  }

  restoreBackup(file: File): Promise<BackupOutcome> {
    return this.uploadBackup('import', file);
  }

  async exportBackup(): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`${API_URL}/api/backup/export`);
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/zip')) {
      throw new Error('Could not download the backup. Try again.');
    }
    const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'vinyl-backup.zip';
    return { blob: await response.blob(), filename };
  }

  async scanBarcode(barcode: string): Promise<{
    artist: string;
    album: string;
    year?: number;
    coverImageUrl?: string;
    discogsId: number;
    existingStatus?: 'collection' | 'wishlist' | null;
    existingAlbumId?: number | null;
    existingMatch?: SavedMatch | null;
    titleMatches?: SavedTitleMatch[];
  }> {
    return this.request('/api/barcode/scan', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    });
  }

  async analyzeImage(image: string): Promise<{
    extractedText: {
      artist?: string;
      album?: string;
      year?: number;
      confidence?: number;
      provider?: string;
      usedFallback?: boolean;
      primaryResult?: {
        artist?: string;
        album?: string;
        year?: number;
        confidence?: number;
        provider?: string;
      };
    };
    discogsMatches: DiscogsAlbum[];
  }> {
    return this.request('/api/image/analyze', {
      method: 'POST',
      body: JSON.stringify({ image }),
    });
  }

  async checkDiscogsConfig(): Promise<{
    configured: boolean;
    username?: string;
  }> {
    return this.request('/api/discogs/config');
  }

  async importDiscogsCollection(): Promise<{
    albums: DiscogsAlbum[];
    count: number;
  }> {
    return this.request('/api/discogs/import');
  }

  async searchCoverArt(id: number): Promise<{ results: SearchCoverArtResult[] }> {
    return this.request(`/api/cover-art/${id}/search`);
  }

  async updateCoverArt(id: number, url: string, source: string): Promise<{ message: string; album: Album }> {
    return this.request(`/api/cover-art/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ url, source }),
    });
  }
}

export default new ApiService();
