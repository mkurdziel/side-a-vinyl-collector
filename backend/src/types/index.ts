export interface Artist {
  id: number;
  name: string;
  discogs_id?: number;
  created_at: Date;
  updated_at: Date;
}

export interface Album {
  id: number;
  artist_id: number;
  title: string;
  year?: number;
  cover_image_url?: string;
  discogs_id?: number;
  musicbrainz_id?: string;
  local_cover_path?: string;
  cover_art_fetched?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Collection {
  id: number;
  album_id: number;
  added_at: Date;
  notes?: string;
}

export interface Barcode {
  id: number;
  barcode: string;
  album_id: number;
  created_at: Date;
}

export interface AlbumWithArtist extends Album {
  artist_name: string;
  notes?: string;
  status: 'collection' | 'wishlist';
  added_at?: Date;
}

export interface SearchResult {
  local: AlbumWithArtist[];
  discogs: DiscogsAlbum[];
}

export interface DiscogsAlbum {
  id: number;
  artist: string;
  album: string;
  year?: number;
  coverImageUrl?: string;
  discogsId: number;
}

export interface DiscogsSearchResponse {
  results: any[];
  pagination: {
    page: number;
    pages: number;
    per_page: number;
    items: number;
  };
}

export interface VisionExtractionResult {
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
}
