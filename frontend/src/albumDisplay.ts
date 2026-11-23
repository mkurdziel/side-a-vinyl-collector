import type { Album, DiscogsAlbum, SavedMatch, SavedTitleMatch } from './services/api';

type Shelf = Album['status'];
export type LookupShelfEdits = Partial<Record<number, Shelf | null>>;

export function applyLookupShelfEdits<T extends {
  existingStatus?: Shelf | null;
  existingAlbumId?: number | null;
  existingMatch?: SavedMatch | null;
  titleMatches?: SavedTitleMatch[];
}>(match: T, edits?: LookupShelfEdits): T {
  if (!edits) return match;
  if (match.titleMatches?.some(copy => edits[copy.id] !== undefined)) {
    const titleMatches = match.titleMatches.flatMap(copy => {
      const status = edits[copy.id];
      return status === null ? [] : [{ ...copy, status: status ?? copy.status }];
    });
    const first = titleMatches.find(copy => copy.status === 'collection') ?? titleMatches[0];
    return { ...match, titleMatches, existingStatus: first?.status, existingMatch: first ? 'title' : null, existingAlbumId: null };
  }
  const status = match.existingAlbumId == null ? undefined : edits[match.existingAlbumId];
  if (status === undefined) return match;
  return status === null
    ? { ...match, existingStatus: null, existingMatch: null, existingAlbumId: null }
    : { ...match, existingStatus: status };
}

export function savedCopyLabel(album: SavedTitleMatch) {
  const shelf = album.status === 'wishlist' ? 'Wishlist' : 'Collection';
  const edition = album.discogs_id ? `Discogs release ${album.discogs_id}` : `saved record ${album.id}`;
  return `${album.title} by ${album.artist_name}, ${shelf}${album.year ? `, ${album.year}` : ''}, ${edition}`;
}

export function catalogSource(album: DiscogsAlbum): { label: string; type?: string; url?: string } | undefined {
  if (album.source === 'musicbrainz') {
    const validId = album.mbid && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(album.mbid);
    return { label: 'MusicBrainz', type: 'Release group', url: validId ? `https://musicbrainz.org/release-group/${album.mbid}` : undefined };
  }
  if (album.source === 'discogs') {
    const listing = album.discogsListing;
    return {
      label: 'Discogs',
      type: listing === 'master' ? 'Master release' : listing === 'release' ? 'Release' : undefined,
      url: listing && Number.isSafeInteger(album.id) && album.id > 0
        ? `https://www.discogs.com/${listing}/${album.id}`
        : undefined,
    };
  }
}
