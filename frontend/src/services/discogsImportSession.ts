import api, { type Album, type DiscogsAlbum } from './api';

type Shelf = Album['status'];
type ImportAlbum = Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album' | 'year' | 'coverImageUrl' | 'pressing'>;
type ImportStatus = 'pending' | 'sending' | 'imported' | 'found' | 'skipped' | 'failed';

export type ImportEntry = {
  album: ImportAlbum;
  destination: Shelf;
  status: ImportStatus;
  savedShelf?: Shelf;
};

export const entryFor = ({ discogsId, artist, album, year, coverImageUrl, pressing }: ImportAlbum, destination: Shelf): ImportEntry => ({
  album: { discogsId, artist, album, year, coverImageUrl, pressing }, destination, status: 'pending',
});

const sessionKey = 'side-a:discogs-import:v1';
const statuses = new Set<ImportStatus>(['pending', 'sending', 'imported', 'found', 'skipped', 'failed']);
const isShelf = (value: unknown): value is Shelf => value === 'collection' || value === 'wishlist';

export const importTitleKey = (artist: string, album: string) =>
  JSON.stringify([artist.trim().toLowerCase(), album.trim().toLowerCase()]);

export const needsImportCheck = ({ status }: ImportEntry) =>
  status === 'pending' || status === 'sending' || status === 'failed';

function isImportEntry(value: unknown): value is ImportEntry {
  if (!value || typeof value !== 'object') return false;
  const { album, status, destination, savedShelf } = value as Partial<ImportEntry>;
  return !!album && Number.isSafeInteger(album.discogsId) && album.discogsId > 0 &&
    typeof album.artist === 'string' && typeof album.album === 'string' &&
    (album.year === undefined || typeof album.year === 'number') &&
    (album.coverImageUrl === undefined || typeof album.coverImageUrl === 'string') &&
    (album.pressing === undefined || (!!album.pressing && typeof album.pressing === 'object' &&
      [album.pressing.format, album.pressing.label, album.pressing.catalogNumber, album.pressing.country]
        .every(fact => fact === undefined || typeof fact === 'string'))) &&
    !!status && statuses.has(status) && isShelf(destination) && (savedShelf === undefined || isShelf(savedShelf));
}

export function readDiscogsImport(): ImportEntry[] {
  try {
    const raw = globalThis.sessionStorage.getItem(sessionKey);
    const entries: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries)
      ? [...new Map(entries.filter(isImportEntry).map(entry => [entry.album.discogsId, entry])).values()]
      : [];
  } catch {
    return [];
  }
}

export function writeDiscogsImport(entries: ImportEntry[]) {
  try {
    globalThis.sessionStorage.setItem(sessionKey, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export async function getImportLibrary(signal: AbortSignal) {
  const results = await Promise.all([
    api.getAlbums('collection', signal, 'no-store'),
    api.getAlbums('wishlist', signal, 'no-store'),
  ]);
  return results.flatMap(result => result.albums);
}

export function reconcileImport(entry: ImportEntry, library: Album[]): ImportEntry {
  if (!needsImportCheck(entry)) return entry;
  const exact = library.find(album => album.discogs_id === entry.album.discogsId);
  const title = importTitleKey(entry.album.artist, entry.album.album);
  const saved = exact ?? library.find(album => importTitleKey(album.artist_name, album.title) === title);
  if (!saved) {
    return entry.status === 'sending' ? { ...entry, status: 'pending' } : entry;
  }
  const found = exact && saved.status === entry.destination && entry.status !== 'pending';
  return { ...entry, status: found ? 'found' : 'skipped', savedShelf: saved.status };
}
