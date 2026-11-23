import pool from '../config/database';
import type { AlbumWithArtist } from '../types';

type SavedAlbum = Pick<AlbumWithArtist, 'id' | 'discogs_id' | 'title' | 'artist_name' | 'status'>;
type CatalogMatch = { artist: string; album: string; discogsId?: number };

function nameKey(artist: string, title: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const artistKey = normalize(artist);
  const titleKey = normalize(title);
  return artistKey && titleKey ? `${artistKey}:${titleKey}` : undefined;
}

export async function annotateCatalogMembership<T extends CatalogMatch>(matches: T[]) {
  if (!matches.length) return [];

  // Check membership independently of the display page so a name match is unique across both shelves.
  const { rows } = await pool.query<SavedAlbum>(`
    SELECT albums.id, albums.discogs_id, albums.title, artists.name AS artist_name, collections.status
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
  `);

  const savedByDiscogsId = new Map<number, SavedAlbum>();
  const savedByName = new Map<string, SavedAlbum[]>();
  for (const album of rows) {
    if (album.discogs_id != null) savedByDiscogsId.set(album.discogs_id, album);
    const key = nameKey(album.artist_name, album.title);
    if (key) savedByName.set(key, [...(savedByName.get(key) ?? []), album]);
  }

  return matches.map(match => {
    const exact = match.discogsId == null ? undefined : savedByDiscogsId.get(match.discogsId);
    const key = nameKey(match.artist, match.album);
    const byName = key ? savedByName.get(key) : undefined;
    const candidates = exact ? [exact] : byName ?? [];
    // A transfer requires one specific database album even if several names match.
    const linked = candidates.length === 1 ? candidates[0] : undefined;

    return {
      ...match,
      inCollection: candidates.some(album => album.status === 'collection'),
      inWishlist: candidates.some(album => album.status === 'wishlist'),
      existingAlbumId: linked?.id ?? null,
    };
  });
}
