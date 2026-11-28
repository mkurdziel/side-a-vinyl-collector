import type { Album, CatalogListing, DiscogsAlbum, SavedMatch, SavedTitleMatch } from './services/api';

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
  return `${album.title} by ${album.artist_name}, ${savedCopyContext(album)}`;
}

export function savedPressingLabel(album: SavedTitleMatch) {
  return savedCatalogSource(album)?.kind === 'pressing' ? 'Specific release' : 'Pressing unconfirmed';
}

export function savedCopyContext(album: SavedTitleMatch) {
  const shelf = album.status === 'wishlist' ? 'Wishlist' : 'Collection';
  const edition = album.discogs_id ? `Discogs release ${album.discogs_id}` : `saved record ${album.id}`;
  return [shelf, album.year, edition].filter(Boolean).join(', ');
}

export interface CatalogSource {
  label: string;
  type: string;
  kind: 'album' | 'pressing' | 'unknown';
  url?: string;
}

const validReleaseGroup = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

export function discogsReleaseSource(id?: number | null): CatalogSource | undefined {
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
    return { label: 'Discogs', type: 'Release', kind: 'pressing', url: `https://www.discogs.com/release/${id}` };
  }
}

export function catalogSaveReference(album: DiscogsAlbum): { discogsId?: number; catalogListing?: CatalogListing } {
  if (album.source === 'musicbrainz') {
    return album.mbid && validReleaseGroup(album.mbid)
      ? { catalogListing: { source: 'musicbrainz', kind: 'release-group', id: album.mbid } } : {};
  }
  if (album.discogsListing === 'master') {
    return Number.isSafeInteger(album.id) && album.id > 0
      ? { catalogListing: { source: 'discogs', kind: 'master', id: album.id } } : {};
  }
  return album.discogsListing === 'release' && discogsReleaseSource(album.discogsId) ? { discogsId: album.discogsId } : {};
}

export function catalogAlbumReference(album: DiscogsAlbum): ReturnType<typeof catalogSaveReference> {
  if (album.discogsListing !== 'release') return catalogSaveReference(album);
  return album.masterId && Number.isSafeInteger(album.masterId) && album.masterId > 0
    ? { catalogListing: { source: 'discogs', kind: 'master', id: album.masterId } } : {};
}

export function savedCatalogSource(album: Pick<Album, 'catalog_listing' | 'discogs_id'>): CatalogSource | undefined {
  const listing = album.catalog_listing;
  if (listing?.source === 'discogs' && listing.kind === 'master') {
    const url = Number.isSafeInteger(listing.id) && listing.id > 0 ? `https://www.discogs.com/master/${listing.id}` : undefined;
    return { label: 'Discogs', type: 'Album overview', kind: 'album', url };
  }
  if (listing?.source === 'musicbrainz' && listing.kind === 'release-group') {
    const url = typeof listing.id === 'string' && validReleaseGroup(listing.id)
      ? `https://musicbrainz.org/release-group/${listing.id}` : undefined;
    return { label: 'MusicBrainz', type: 'Release group', kind: 'album', url };
  }
  return discogsReleaseSource(album.discogs_id);
}

export function catalogSource(album: DiscogsAlbum): CatalogSource | undefined {
  const { discogsId, catalogListing } = catalogSaveReference(album);
  if (discogsId || catalogListing) return savedCatalogSource({ discogs_id: discogsId, catalog_listing: catalogListing });
  if (album.source === 'musicbrainz') return { label: 'MusicBrainz', type: 'Release group', kind: 'album' };
  if (album.source === 'discogs') return { label: 'Discogs', type: 'Catalog listing', kind: 'unknown' };
}

export function catalogRecordLabel(album: DiscogsAlbum, source = catalogSource(album)) {
  return [
    album.album + ' by ' + album.artist,
    album.year,
    source && `${source.label} ${source.type.toLowerCase()}${source.kind === 'pressing' ? ` ${album.discogsId}` : ''}`,
  ].filter(Boolean).join(', ');
}

export function listingEvidence(source?: CatalogSource): string {
  if (source?.kind === 'album') return 'Album overview';
  if (source?.kind === 'pressing') return 'Specific release';
  return 'Pressing unconfirmed';
}
