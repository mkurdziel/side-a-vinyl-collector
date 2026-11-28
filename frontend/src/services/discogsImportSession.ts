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

export type ImportReviewChoice = Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'> & {
  source: 'chosen' | 'bulk';
};

export type ImportReviewNotice = { choice: ImportReviewChoice } & (
  { cause: 'competing' | 'unavailable' } | { cause: 'saved'; shelf: Shelf }
);

export type ImportReviewWorkingContext = {
  searchText: string;
  needsChoiceOnly: boolean;
  releaseId?: number;
};

export type ImportClearReceipt = {
  choices: ImportReviewChoice[];
  destination: Shelf;
};

export type ImportReviewDraft = {
  choices: ImportReviewChoice[];
  notices: ImportReviewNotice[];
  destination: Shelf;
  lastPage: number;
  working?: ImportReviewWorkingContext;
  cleared?: ImportClearReceipt;
};

export const entryFor = ({ discogsId, artist, album, year, coverImageUrl, pressing }: ImportAlbum, destination: Shelf): ImportEntry => ({
  album: { discogsId, artist, album, year, coverImageUrl, pressing }, destination, status: 'pending',
});

const sessionKey = 'side-a:discogs-import:v1';
const reviewKey = 'side-a:discogs-import-review:v1';
const statuses = new Set<ImportStatus>(['pending', 'sending', 'imported', 'found', 'skipped', 'failed']);
const isShelf = (value: unknown): value is Shelf => value === 'collection' || value === 'wishlist';

export const importTitleKey = (artist: string, album: string) =>
  JSON.stringify([artist.trim().toLowerCase(), album.trim().toLowerCase()]);

export function reviewChoiceFor({ discogsId, artist, album }: Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'>, source: ImportReviewChoice['source']): ImportReviewChoice {
  return { discogsId, artist, album, source };
}

function isReviewChoice(value: unknown): value is ImportReviewChoice {
  if (!value || typeof value !== 'object') return false;
  const { discogsId, artist, album, source } = value as ImportReviewChoice;
  return Number.isSafeInteger(discogsId) && discogsId > 0 && typeof artist === 'string' && typeof album === 'string' &&
    (source === 'chosen' || source === 'bulk');
}

function readReviewChoices(value: unknown): Map<string, ImportReviewChoice> {
  const choices = Array.isArray(value) ? value.filter(isReviewChoice) : [];
  return new Map(choices.map(choice => [importTitleKey(choice.artist, choice.album), choice]));
}

function readClearReceipt(value: unknown): ImportClearReceipt | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { choices, destination } = value as Partial<ImportClearReceipt>;
  const validated = [...readReviewChoices(choices).values()];
  if (!isShelf(destination) || !validated.length) return undefined;
  return { choices: validated, destination };
}

function isReviewNotice(value: unknown): value is ImportReviewNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as ImportReviewNotice;
  return isReviewChoice(notice.choice) && (notice.cause === 'competing' || notice.cause === 'unavailable' ||
    (notice.cause === 'saved' && isShelf(notice.shelf)));
}

function readWorkingContext(value: unknown): ImportReviewWorkingContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { searchText, needsChoiceOnly, releaseId } = value as Partial<ImportReviewWorkingContext>;
  if (typeof searchText !== 'string' || typeof needsChoiceOnly !== 'boolean') return undefined;
  return { searchText, needsChoiceOnly,
    releaseId: typeof releaseId === 'number' && Number.isSafeInteger(releaseId) && releaseId > 0 ? releaseId : undefined };
}

export function readImportReview(): ImportReviewDraft | null {
  try {
    const raw = globalThis.sessionStorage.getItem(reviewKey);
    if (!raw) return null;
    const { choices, notices, destination, lastPage, working, cleared } = JSON.parse(raw) as ImportReviewDraft;
    if (!isShelf(destination) || !Number.isSafeInteger(lastPage) || lastPage < 1 || !Array.isArray(choices)) return null;
    const unique = readReviewChoices(choices);
    const pending = new Map<string, ImportReviewNotice>();
    for (const notice of Array.isArray(notices) ? notices.filter(isReviewNotice) : []) {
      const title = importTitleKey(notice.choice.artist, notice.choice.album);
      if (!unique.has(title)) pending.set(title, notice);
    }
    return { choices: [...unique.values()], notices: [...pending.values()], destination, lastPage, working: readWorkingContext(working),
      cleared: unique.size ? undefined : readClearReceipt(cleared) };
  } catch {
    return null;
  }
}

export function writeImportReview(draft: ImportReviewDraft | null) {
  try {
    if (draft) globalThis.sessionStorage.setItem(reviewKey, JSON.stringify(draft));
    else globalThis.sessionStorage.removeItem(reviewKey);
    return true;
  } catch {
    return false;
  }
}

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
