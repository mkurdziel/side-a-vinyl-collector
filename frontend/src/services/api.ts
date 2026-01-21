const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
  local_cover_path?: string;
  cover_art_fetched?: boolean;
  notes?: string;
  added_at: string;
}

export interface SearchResult {
  local: Album[];
  discogs: DiscogsAlbum[];
}

export interface DiscogsAlbum {
  id: number;
  artist: string;
  album: string;
  year?: number;
  coverImageUrl?: string;
  discogsId: number;
  fromProvider?: string;
  confidence?: number;
}

class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async getAlbums(): Promise<{ albums: Album[] }> {
    return this.request('/api/albums');
  }

  async addAlbum(data: {
    artist: string;
    album: string;
    year?: number;
    coverImageUrl?: string;
    discogsId?: number;
    barcode?: string;
  }): Promise<{ album: Album }> {
    return this.request('/api/albums', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteAlbum(id: number): Promise<void> {
    return this.request(`/api/albums/${id}`, { method: 'DELETE' });
  }

  async updateNotes(id: number, notes: string): Promise<void> {
    return this.request(`/api/albums/${id}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  }

  async search(query: string): Promise<SearchResult> {
    return this.request(`/api/search?q=${encodeURIComponent(query)}`);
  }

  async scanBarcode(barcode: string): Promise<{
    artist: string;
    album: string;
    year?: number;
    coverImageUrl?: string;
    discogsId: number;
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
}

export default new ApiService();
