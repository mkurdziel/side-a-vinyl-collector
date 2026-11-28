import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { ApiError, type Album, type DiscogsAlbum, type SavedTitleMatch, type SearchResult, getCoverArtUrl, isExactSavedMatch } from './services/api';
import { applyLookupShelfEdits, catalogAlbumReference, catalogRecordLabel, catalogSaveReference, catalogSource, listingEvidence, savedCopyLabel, type LookupShelfEdits } from './albumDisplay';
import { PressingComparison, type LookupPressing, type OpenSavedAlbum, type SavePressing, type SavedAlbumOutcome, type UndoPressing } from './components/PressingComparison';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SaveDestinationActions, type DestinationAction } from './components/SaveDestinationActions';
import { ModalDialog } from './components/ModalDialog';
import { ManualAlbumDialog, type ManualAlbumDraft } from './components/ManualAlbumDialog';
import { CatalogPressingPicker } from './components/CatalogPressingPicker';

type Shelf = Album['status'];
type SortBy = 'title' | 'artist' | 'date';
type SearchScope = 'saved' | 'catalog' | 'catalog-number' | Shelf;
type ShelfRequest = { view: Shelf; revision: number };
type ShelfResult = { request: ShelfRequest } & (
  { status: 'ready'; albums: Album[] } | { status: 'error' }
);
type SearchState =
  | { status: 'idle' | 'pending' | 'error' }
  | { status: 'ready'; results: SearchResult };
type ResultKind = 'saved' | 'catalog';
type SearchRequest = { controller: AbortController; timer?: number };
type SaveAction = DestinationAction | 'remove';
type ShelfMove = { albumId: number; title: string; from: Shelf; to: Shelf };
type SaveIssue = { message: string; albumId?: number; stale?: boolean };
type LoadedPage = { target: string; message: string; trigger?: HTMLButtonElement };
type LookupMode = 'name' | 'catalog-number';
type LookupDraft = {
  query: string;
  scope: SearchScope;
  saved: SearchState;
  catalog: SearchState;
  destination: Shelf;
  detected?: ManualAlbumDraft;
  sort: SortBy;
  savedLoading: boolean;
  catalogLoading: boolean;
  pages: Partial<Record<ResultKind, 'pending' | 'error'>>;
  libraryVersion: number;
};
type AlbumReview = { album: Album; status: 'pending' | 'error' | 'ready'; choices: LookupPressing[]; removed?: boolean };

const lookupMode = (scope: SearchScope): LookupMode => scope === 'catalog-number' ? 'catalog-number' : 'name';
const catalogIdentity = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const shelves: Shelf[] = ['collection', 'wishlist'];
const resultKinds: ResultKind[] = ['saved', 'catalog'];
const sortLabels: Record<SortBy, string> = { title: 'Album title', artist: 'Artist name', date: 'Date added' };
const shelfLabel: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const albumGrid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4';
const secondaryButton = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50';
const searchesCatalog = (scope: SearchScope) => scope === 'catalog' || scope === 'catalog-number';
const searchShelf = (scope: SearchScope) => scope === 'collection' || scope === 'wishlist' ? scope : undefined;

function sortAlbums(albums: Album[], sort: SortBy) {
  return [...albums].sort((first, second) => {
    if (sort === 'artist') return first.artist_name.localeCompare(second.artist_name);
    if (sort === 'date') return new Date(second.added_at).getTime() - new Date(first.added_at).getTime();
    return first.title.localeCompare(second.title);
  });
}

function cancelSearch(request?: SearchRequest) {
  if (!request) return;
  window.clearTimeout(request.timer);
  request.controller.abort();
}

function catalogKey(album: DiscogsAlbum) {
  // Catalog providers supply different IDs. They are deduplicated by artist and title.
  return JSON.stringify([album.artist.toLowerCase(), album.album.toLowerCase()]);
}

function lookupPressing(album: DiscogsAlbum): LookupPressing {
  const source = catalogSource(album);
  return { artist: album.artist, year: album.year, source, pressing: album.pressing, catalogNumberMatch: album.catalogNumberMatch,
    releaseId: source?.kind === 'pressing' ? album.discogsId : undefined };
}

function savedPressingChoices(album: Album, matches: DiscogsAlbum[]) {
  const title = catalogIdentity(album.title);
  const artist = catalogIdentity(album.artist_name);
  const choices = new Map<number, LookupPressing>();
  for (const match of matches) {
    if (match.existingAlbumId !== album.id && !match.titleMatches?.some(copy => copy.id === album.id) &&
        (catalogIdentity(match.album) !== title || catalogIdentity(match.artist) !== artist)) continue;
    for (const candidate of [match, ...match.pressingChoices ?? []]) {
      const pressing = lookupPressing(candidate);
      if (pressing.releaseId && !choices.has(pressing.releaseId)) choices.set(pressing.releaseId, pressing);
    }
  }
  return [...choices.values()];
}

const savedAlbumKey = (id: number) => `saved:${id}`;
const savedResultTarget = (id: number) => `saved-result-${id}`;
const catalogResultTarget = (album: DiscogsAlbum) => `catalog-result-${encodeURIComponent(catalogKey(album))}`;

function draftForSearch(query: string, detected?: ManualAlbumDraft): ManualAlbumDraft {
  const text = query.trim();
  const explicit = /^(.*?)\s+[–—-]\s+(.+)$/.exec(text);
  if (explicit) return { artist: explicit[1].slice(0, 255), album: explicit[2].slice(0, 255) };
  const artist = detected?.artist?.trim();
  if (artist && text.toLowerCase() === artist.toLowerCase()) return { artist };
  if (artist && text.toLowerCase().startsWith(`${artist.toLowerCase()} `)) {
    return { artist, album: text.slice(artist.length).trim().slice(0, 255) };
  }
  return { searchText: text.slice(0, 255) };
}

function AlbumCover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  // This decorative cover is paired with the album title and artist on every card.
  return src && !failed ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <svg aria-hidden="true" className="size-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  );
}

function AlbumMeta({ title, artist, year, shelf, resultId, artworkUnverified }: {
  title: string; artist: string; year?: number; shelf?: Shelf; resultId?: string; artworkUnverified: boolean;
}) {
  return (
    <div className="rh-album-meta p-3">
      <h3 id={resultId} tabIndex={resultId ? -1 : undefined} className={`${shelf ? 'rh-result-heading' : 'line-clamp-2'} text-sm text-gray-900`} title={title}>{title}</h3>
      <p className={`mt-0.5 ${shelf ? '' : 'truncate'} text-xs`} title={artist}>{artist}</p>
      {(year || shelf) && <p className="rh-album-year text-xs">{[year, shelf && shelfLabel[shelf]].filter(Boolean).join(' · ')}</p>}
      {artworkUnverified && <p className="rh-artwork-status">Unverified artwork</p>}
    </div>
  );
}

function SortControl({ sort, onChange }: { sort: SortBy; onChange: (sort: SortBy) => void }) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <label htmlFor="sort-select" className="text-sm text-gray-600">Sort</label>
      <select id="sort-select" value={sort} onChange={event => onChange(event.target.value as SortBy)}
        className="min-h-11 rounded-lg border border-gray-300 bg-white px-2.5">
        {Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
  );
}

function SaveIssueNotice({ issue, issueKey, loadingAlbumId, onOpen }: {
  issue?: SaveIssue;
  issueKey: string;
  loadingAlbumId?: number;
  onOpen: (id: number, key: string) => void;
}) {
  if (!issue) return null;
  const id = issue.albumId;
  return (
    <div className="space-y-1">
      <p role="alert" className="text-sm text-red-600">{issue.message}</p>
      {id !== undefined && (
        <button type="button" autoFocus={!issue.stale} className={secondaryButton} disabled={loadingAlbumId !== undefined}
          onClick={() => onOpen(id, issueKey)}>
          {loadingAlbumId === id ? 'Opening album…' : issue.stale ? 'Open current album' : 'Open saved album'}
        </button>
      )}
    </div>
  );
}

function ShelfActions({ album, detailed = false, pending, issue, loadingAlbumId, onMove, onRemove, onOpenIssue }: {
  album: Album;
  detailed?: boolean;
  pending?: SaveAction;
  issue?: SaveIssue;
  loadingAlbumId?: number;
  onMove: (album: Album, button: HTMLButtonElement, detailed: boolean) => Promise<void>;
  onRemove: (album: Album) => void;
  onOpenIssue: (id: number, key: string) => void;
}) {
  const inWishlist = album.status === 'wishlist';
  const moveLabel = inWishlist ? 'Move to Collection' : 'Move to Wishlist';
  const blocked = !!pending || !!issue?.stale;
  const move = (
    <button type="button" className={secondaryButton} aria-label={`${moveLabel} — ${album.title}`}
      aria-disabled={blocked} aria-busy={!!pending && pending !== 'remove'}
      onClick={event => void onMove(album, event.currentTarget, detailed)}>
      {pending && pending !== 'remove' ? 'Moving…' : moveLabel}
    </button>
  );
  const remove = (
    <button type="button" className="min-h-11 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      aria-label={`Remove from ${shelfLabel[album.status]} — ${album.title}`} aria-haspopup="dialog"
      aria-disabled={blocked} onClick={() => onRemove(album)}>
      Remove from {shelfLabel[album.status]}
    </button>
  );
  return (
    <div className="grid gap-1.5">
      {detailed ? <>{move}{remove}</> : (
        <>
          {inWishlist && move}
          <details className="min-w-0">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-1 rounded-lg px-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
              aria-label={`Shelf actions for ${savedCopyLabel(album)}`}>
              Actions
              <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth="2" d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="grid gap-1.5">{!inWishlist && move}{remove}</div>
          </details>
        </>
      )}
      <SaveIssueNotice issue={issue} issueKey={savedAlbumKey(album.id)} loadingAlbumId={loadingAlbumId} onOpen={onOpenIssue} />
    </div>
  );
}

function App() {
  const [shelfRequest, setShelfRequest] = useState<ShelfRequest>({ view: 'collection', revision: 0 });
  const [shelfResult, setShelfResult] = useState<ShelfResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('saved');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [catalogState, setCatalogState] = useState<SearchState>({ status: 'idle' });
  const [savedLoading, setSavedLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [saveShelf, setSaveShelf] = useState<Shelf>('collection');
  const [loadingMore, setLoadingMore] = useState<Partial<Record<ResultKind, 'pending' | 'error'>>>({});
  const [loadedPage, setLoadedPage] = useState<LoadedPage>();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [manualEntry, setManualEntry] = useState<{ draft: ManualAlbumDraft; shelf: Shelf }>();
  const [detectedDraft, setDetectedDraft] = useState<ManualAlbumDraft>();
  const [pressingReview, setPressingReview] = useState<{ album: DiscogsAlbum; destination: Shelf; searchedNumber?: string }>();
  const [albumReview, setAlbumReview] = useState<AlbumReview>();
  const [recentCatalogSaves, setRecentCatalogSaves] = useState<Set<number>>(() => new Set());
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [showDiscogsImporter, setShowDiscogsImporter] = useState(false);
  const [discogsImporting, setDiscogsImporting] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [detailBackToMatches, setDetailBackToMatches] = useState(false);
  const [restoredDetailShelf, setRestoredDetailShelf] = useState<Shelf>();
  const restoredDetailNotice = useRef<HTMLParagraphElement>(null);
  const [lookupShelfEdits, setLookupShelfEdits] = useState<LookupShelfEdits>({});
  const [lookupPressingEdits, setLookupPressingEdits] = useState<Partial<Record<number, SavedTitleMatch>>>({});
  const albumDetailOpener = useRef<HTMLButtonElement | null>(null);
  const [albumToRemove, setAlbumToRemove] = useState<Album | null>(null);
  const [lastShelfMove, setLastShelfMove] = useState<ShelfMove | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [discogsConfigured, setDiscogsConfigured] = useState<boolean | null>(null);
  const [discogsCheckFailed, setDiscogsCheckFailed] = useState(false);
  const [pendingSaves, setPendingSaves] = useState<Partial<Record<string, SaveAction>>>({});
  const [saveErrors, setSaveErrors] = useState<Partial<Record<string, SaveIssue>>>({});
  const [loadingAlbumId, setLoadingAlbumId] = useState<number>();
  const [artworkRevisions, setArtworkRevisions] = useState<Partial<Record<number, string>>>({});
  const [libraryArtworkRevision, setLibraryArtworkRevision] = useState<number>();
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const saved = localStorage.getItem('albumSortBy');
    return saved === 'artist' || saved === 'date' ? saved : 'title';
  });
  const inFlightSaves = useRef(new Set<string>());
  const openingSavedAlbum = useRef(false);
  const searchRequests = useRef<Partial<Record<ResultKind, SearchRequest>>>({});
  const pageRequests = useRef<Partial<Record<ResultKind, AbortController>>>({});
  const albumReviewRequest = useRef<AbortController>(null);
  const albumReviewOpener = useRef<HTMLButtonElement>(null);
  const lookupDrafts = useRef<Partial<Record<LookupMode, LookupDraft>>>({});
  const libraryVersion = useRef(0);
  const latestQuery = useRef('');
  const latestScope = useRef<SearchScope>('saved');
  const searchSort = useRef(sortBy);
  const searchInput = useRef<HTMLInputElement>(null);
  const pressingReviewOpener = useRef<HTMLButtonElement>(null);
  const pressingReviewFallback = useRef<HTMLElement>(null);
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const activeShelfButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  const viewMode = shelfRequest.view;
  const currentShelf = shelfResult?.request.view === viewMode &&
    (shelfResult.status === 'ready' || shelfResult.request.revision === shelfRequest.revision)
    ? shelfResult
    : null;

  useEffect(() => {
    localStorage.setItem('albumSortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    api.getAlbums(shelfRequest.view, controller.signal)
      .then(({ albums }) => {
        if (!controller.signal.aborted) setShelfResult({ request: shelfRequest, status: 'ready', albums });
      })
      .catch(() => {
        if (!controller.signal.aborted) setShelfResult({ request: shelfRequest, status: 'error' });
      });
    return () => controller.abort();
  }, [shelfRequest]);

  useEffect(() => {
    let active = true;
    api.checkDiscogsConfig()
      .then(config => {
        if (active) setDiscogsConfigured(config.configured);
      })
      .catch(() => {
        if (active) setDiscogsCheckFailed(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    for (const request of Object.values(searchRequests.current)) cancelSearch(request);
    for (const request of Object.values(pageRequests.current)) request.abort();
    albumReviewRequest.current?.abort();
  }, []);

  useLayoutEffect(() => {
    if (!loadedPage?.trigger) return;
    const { target, trigger } = loadedPage;
    const doc = trigger.ownerDocument;
    if (doc.activeElement === trigger || (!trigger.isConnected && doc.activeElement === doc.body)) {
      doc.getElementById(target)?.focus();
    }
  }, [loadedPage]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.code !== 'KeyF' || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const source = event.target;
      if (source instanceof Element && source.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (!searchInput.current || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchInput.current.focus();
    };
    window.addEventListener?.('keydown', shortcut);
    return () => window.removeEventListener?.('keydown', shortcut);
  }, []);

  const refreshShelf = () => {
    libraryVersion.current += 1;
    setShelfRequest(request => ({ ...request, revision: request.revision + 1 }));
  };

  const searchResults = (query: string, signal: AbortSignal, kind: ResultKind, scope: SearchScope, offset: number, sort: SortBy) => (
    scope === 'catalog-number' && kind === 'catalog'
      ? api.searchCatalogNumber(query, signal, offset)
      : api.search(query, signal, kind, searchShelf(scope), offset, sort)
  );

  const runSearch = (value: string, { delay = 0, keepResults = false, only, retryFrom }: {
    delay?: number; keepResults?: boolean; only?: ResultKind; retryFrom?: HTMLButtonElement;
  } = {}) => {
    const query = value.trim();
    const scope = latestScope.current;
    const sort = searchSort.current;
    const kinds = only && query.length >= 2 ? [only] : resultKinds;
    for (const kind of kinds) {
      cancelSearch(searchRequests.current[kind]);
      delete searchRequests.current[kind];
      pageRequests.current[kind]?.abort();
      delete pageRequests.current[kind];
    }
    setLoadingMore(current => only && query.length >= 2 ? { ...current, [only]: undefined } : {});
    setLoadedPage(undefined);
    if (query.length < 2) {
      setSearchState({ status: 'idle' });
      setCatalogState({ status: 'idle' });
      setSavedLoading(false);
      setCatalogLoading(false);
      return;
    }

    for (const kind of kinds) {
      const setResult = kind === 'saved' ? setSearchState : setCatalogState;
      const setLoading = kind === 'saved' ? setSavedLoading : setCatalogLoading;
      if ((kind === 'catalog' && !searchesCatalog(scope)) || (kind === 'saved' && scope === 'catalog-number')) {
        setResult({ status: 'idle' });
        setLoading(false);
        continue;
      }

      const request: SearchRequest = { controller: new AbortController() };
      searchRequests.current[kind] = request;
      if (!keepResults) setResult({ status: 'pending' });
      setLoading(true);

      const fetchResults = async () => {
        try {
          const results = await searchResults(query, request.controller.signal, kind, scope, 0, sort);
          if (request.controller.signal.aborted) return;
          if (!results.errors?.length && retryFrom && retryFrom.ownerDocument.activeElement === retryFrom) {
            const heading = kind === 'catalog' ? catalogHeading : savedHeading;
            // The retry button is about to disappear. Use a stable destination only if it still has focus.
            (heading.current ?? searchInput.current)?.focus({ preventScroll: true });
          }
          setResult({ status: 'ready', results });
        } catch {
          if (!request.controller.signal.aborted) setResult({ status: 'error' });
        } finally {
          if (searchRequests.current[kind] === request) {
            delete searchRequests.current[kind];
            setLoading(false);
          }
        }
      };
      if (delay) request.timer = window.setTimeout(() => void fetchResults(), delay);
      else void fetchResults();
    }
  };

  const loadMore = async (kind: ResultKind, data: SearchResult, offset: number, trigger?: HTMLButtonElement) => {
    if (pageRequests.current[kind] || searchRequests.current[kind]) return;
    const request = new AbortController();
    pageRequests.current[kind] = request;
    setLoadingMore(current => ({ ...current, [kind]: 'pending' }));
    const scope = latestScope.current;
    const setResults = kind === 'saved' ? setSearchState : setCatalogState;
    try {
      const page = await searchResults(latestQuery.current.trim(), request.signal, kind, scope, offset, searchSort.current);
      if (request.signal.aborted) return;
      if (page.errors?.length) throw new Error('Search continuation unavailable');
      const localIds = new Set(data.local.map(album => album.id));
      const catalogKeys = new Set(data.discogs.map(catalogKey));
      const newSaved = page.local.filter(album => !localIds.has(album.id));
      const newCatalog = page.discogs.filter(album => !catalogKeys.has(catalogKey(album)));
      const count = kind === 'saved' ? newSaved.length : newCatalog.length;
      const target = kind === 'saved'
        ? (newSaved[0] ? savedResultTarget(newSaved[0].id) : 'saved-results-title')
        : (newCatalog[0] ? catalogResultTarget(newCatalog[0]) : 'catalog-results-title');
      const stillFocused = trigger?.ownerDocument.activeElement === trigger;
      setLoadedPage({ target, trigger: stillFocused ? trigger : undefined,
        message: count ? `Loaded ${count} more ${kind} ${count === 1 ? 'match' : 'matches'}.` : `No more ${kind} matches on this page.` });
      setResults(current => {
        if (current.status !== 'ready' || current.results.nextOffset !== offset) return current;
        return {
          status: 'ready',
          results: {
            ...page,
            local: [...current.results.local, ...newSaved],
            discogs: [...current.results.discogs, ...newCatalog],
          },
        };
      });
      setLoadingMore(current => ({ ...current, [kind]: undefined }));
    } catch {
      if (!request.signal.aborted) setLoadingMore(current => ({ ...current, [kind]: 'error' }));
    } finally {
      if (pageRequests.current[kind] === request) delete pageRequests.current[kind];
    }
  };

  const changeSearch = (value: string) => {
    latestQuery.current = value;
    setSearchQuery(value);
    if (!value.trim()) setDetectedDraft(undefined);
    setSaveErrors({});
    runSearch(value, { delay: 400 });
  };

  const showShelf = (view: Shelf) => {
    setShelfRequest(request => request.view === view ? request : { view, revision: request.revision + 1 });
  };

  const changeScope = (scope: SearchScope, destination?: Shelf) => {
    const previous = latestScope.current;
    if (searchesCatalog(scope) && (!searchesCatalog(previous) || destination)) setSaveShelf(destination ?? viewMode);
    if (previous === scope) return;
    latestScope.current = scope;
    setSearchScope(scope);
    const only = (previous === 'saved' && scope === 'catalog') || (previous === 'catalog' && scope === 'saved') ? 'catalog' : undefined;
    runSearch(latestQuery.current, { only });
  };

  const focusSearch = () => {
    window.requestAnimationFrame(() => searchInput.current?.focus());
  };

  const changeLookupMethod = (method: LookupMode, nameScope?: SearchScope) => {
    const previous = lookupMode(latestScope.current);
    if (method === previous) {
      if (nameScope) changeScope(nameScope);
      focusSearch();
      return;
    }
    lookupDrafts.current[previous] = {
      scope: latestScope.current, query: latestQuery.current, saved: searchState, catalog: catalogState,
      destination: saveShelf, detected: detectedDraft, sort: searchSort.current, savedLoading, catalogLoading,
      pages: loadingMore, libraryVersion: libraryVersion.current,
    };
    runSearch(''); // Cancel requests for the method being parked, including pagination.
    const draft = lookupDrafts.current[method];
    const scope = nameScope ?? draft?.scope ?? (method === 'name' ? 'saved' : 'catalog-number');
    const query = draft?.query ?? '';
    latestScope.current = scope;
    latestQuery.current = query;
    setSearchScope(scope);
    setSearchQuery(query);
    setSaveShelf(draft?.destination ?? viewMode);
    setDetectedDraft(draft?.detected);
    setSaveErrors({});
    if (draft && draft.libraryVersion === libraryVersion.current && draft.scope === scope && draft.sort === searchSort.current) {
      setSearchState(draft.saved);
      setCatalogState(draft.catalog);
      for (const kind of resultKinds) {
        const wasLoading = kind === 'saved' ? draft.savedLoading : draft.catalogLoading;
        const previousState = kind === 'saved' ? draft.saved : draft.catalog;
        if (wasLoading) runSearch(query, { only: kind, keepResults: previousState.status === 'ready' });
        else if (draft.pages[kind] === 'error') setLoadingMore(current => ({ ...current, [kind]: 'error' }));
      }
    } else if (query.trim().length >= 2) {
      runSearch(query);
    }
    focusSearch();
  };

  const openNameSearch = (query?: string, draft?: ManualAlbumDraft, destination?: Shelf) => {
    if (latestScope.current === 'catalog-number') changeLookupMethod('name', 'catalog');
    if (query) {
      if (!searchesCatalog(latestScope.current) || destination) setSaveShelf(destination ?? viewMode);
      latestScope.current = 'catalog';
      setSearchScope('catalog');
      changeSearch(query);
      setDetectedDraft(draft);
    } else {
      changeScope('catalog', destination);
      setDetectedDraft(undefined);
    }
    focusSearch();
  };

  const refreshLibrary = (updatedArtwork?: Album) => {
    if (updatedArtwork?.local_cover_path) {
      const revision = updatedArtwork.local_cover_path;
      setArtworkRevisions(prev => ({ ...prev, [updatedArtwork.id]: revision }));
    }
    refreshShelf();
    if (latestQuery.current.trim().length >= 2) runSearch(latestQuery.current, { keepResults: true });
  };

  const updateSearchMembership = (albumId: number, status: Shelf, addition?: { key: string; album: Album }) => {
    setSearchState(current => {
      if (current.status !== 'ready') return current;
      const shelf = searchShelf(latestScope.current);
      const local = current.results.local.map(album => album.id === albumId ? { ...album, status } : album);
      const withAddition = addition && !local.some(album => album.id === albumId)
        ? sortAlbums([...local, addition.album], searchSort.current) : local;
      return {
        status: 'ready',
        results: { ...current.results, local: shelf ? withAddition.filter(album => album.status === shelf) : withAddition },
      };
    });
    setCatalogState(current => {
      if (current.status !== 'ready') return current;
      return {
        status: 'ready',
        results: {
          ...current.results,
          discogs: current.results.discogs.map(match => {
            if (addition && catalogKey(match) === addition.key) {
              const exact = match.discogsListing === 'release' && match.discogsId > 0 && match.discogsId === addition.album.discogs_id;
              return { ...match, existingAlbumId: albumId, existingMatch: exact ? 'release' : 'title',
                inCollection: status === 'collection', inWishlist: status === 'wishlist',
                titleMatches: exact ? undefined : [addition.album] };
            }
            if (match.titleMatches?.some(album => album.id === albumId)) {
              const titleMatches = match.titleMatches.map(album => album.id === albumId ? { ...album, status } : album);
              return { ...match, titleMatches, inCollection: titleMatches.some(album => album.status === 'collection'),
                inWishlist: titleMatches.some(album => album.status === 'wishlist') };
            }
            if (match.existingAlbumId === albumId) {
              return { ...match, inCollection: status === 'collection', inWishlist: status === 'wishlist' };
            }
            return match;
          }),
        },
      };
    });
  };

  const reflectSavedPressing = (album: Album) => {
    libraryVersion.current += 1;
    if (showBarcodeScanner || showImageUploader) setLookupPressingEdits(current => ({ ...current, [album.id]: album }));
    const replace = (current: Album) => current.id === album.id ? { ...current, discogs_id: album.discogs_id, catalog_listing: album.catalog_listing } : current;
    setShelfResult(current => current?.status === 'ready' ? { ...current, albums: current.albums.map(replace) } : current);
    setSelectedAlbum(current => current && replace(current));
    setAlbumReview(current => current?.album.id === album.id ? { ...current, album: replace(current.album) } : current);
    setSearchState(current => current.status === 'ready' ? {
      ...current, results: { ...current.results, local: current.results.local.map(replace) },
    } : current);
    setCatalogState(current => current.status === 'ready' ? {
      ...current,
      results: { ...current.results, discogs: current.results.discogs.map(match => {
        const copies = match.titleMatches ?? [];
        if (match.existingAlbumId !== album.id && !copies.some(copy => copy.id === album.id)) return match;
        const titleMatches = copies.length ? copies.map(copy => copy.id === album.id ? album : copy) : [album];
        const exactCopy = match.discogsListing === 'release' && titleMatches.find(copy => copy.discogs_id === match.discogsId);
        return {
          ...match,
          existingAlbumId: exactCopy ? exactCopy.id : titleMatches.length === 1 ? titleMatches[0].id : null,
          existingMatch: exactCopy ? 'release' : 'title',
          inCollection: exactCopy ? exactCopy.status === 'collection' : titleMatches.some(copy => copy.status === 'collection'),
          inWishlist: exactCopy ? exactCopy.status === 'wishlist' : titleMatches.some(copy => copy.status === 'wishlist'),
          titleMatches,
        };
      }) },
    } : current);
  };

  const updateSavedPressing = async <T extends { album: Album }>(id: number, request: () => Promise<T>): Promise<T> => {
    try {
      const result = await request();
      reflectSavedPressing(result.album);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const latest = await api.getAlbum(id).catch(() => undefined);
        if (latest) reflectSavedPressing(latest.album);
      }
      throw error;
    }
  };

  const confirmSavedPressing: SavePressing = (copy, releaseId) =>
    updateSavedPressing(copy.id, () => api.updatePressing(copy.id, releaseId, copy.discogs_id ?? null));

  const undoSavedPressing: UndoPressing = async (copy, undoToken) =>
    (await updateSavedPressing(copy.id, () => api.undoPressing(copy.id, undoToken))).album;

  const closeAlbumReview = () => {
    albumReviewRequest.current?.abort();
    if (albumReview?.removed && selectedAlbum?.id === albumReview.album.id) setSelectedAlbum(null);
    setAlbumReview(undefined);
  };

  const reviewSavedAlbum = async (album: Album, opener?: HTMLButtonElement) => {
    if (opener) albumReviewOpener.current = opener;
    albumReviewRequest.current?.abort();
    const controller = new AbortController();
    albumReviewRequest.current = controller;
    setAlbumReview({ album, status: 'pending', choices: [] });
    try {
      const result = await api.search(`${album.artist_name} ${album.title}`, controller.signal, 'catalog', undefined, 0);
      if (controller.signal.aborted) return;
      const choices = savedPressingChoices(album, result.discogs);
      setAlbumReview({ album, status: choices.length || !result.errors?.length ? 'ready' : 'error', choices });
    } catch {
      if (!controller.signal.aborted) setAlbumReview({ album, status: 'error', choices: [] });
    }
  };

  const saveRecord = async (key: string, action: SaveAction, save: () => Promise<void>, savedId?: number) => {
    if (inFlightSaves.current.has(key) || saveErrors[key]?.stale) return false;
    inFlightSaves.current.add(key);
    setPendingSaves(prev => ({ ...prev, [key]: action }));
    setSaveErrors(prev => ({ ...prev, [key]: undefined }));
    try {
      await save();
      refreshShelf();
      // A search that started before this save can carry the old membership. Deletion always needs a
      // refresh because there may be other saved records matching the same catalog result.
      if (Object.keys(searchRequests.current).length || Object.keys(pageRequests.current).length || action === 'remove' || searchShelf(latestScope.current)) {
        runSearch(latestQuery.current, { keepResults: true });
      }
      return true;
    } catch (error) {
      const conflict = error instanceof Error && 'status' in error && error.status === 409;
      const duplicateId = conflict && 'existingAlbumId' in error && typeof error.existingAlbumId === 'number'
        ? error.existingAlbumId : undefined;
      const issue: SaveIssue = conflict
        ? savedId !== undefined
          ? { message: 'This album’s shelf changed. Open the current record before trying again.', albumId: savedId, stale: true }
          : { message: 'This album is already saved.', albumId: duplicateId }
        : { message: error instanceof Error ? error.message : 'Could not save this change. Try again.' };
      setSaveErrors(prev => ({ ...prev, [key]: issue }));
      return false;
    } finally {
      inFlightSaves.current.delete(key);
      setPendingSaves(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleCatalogAdd = async (album: DiscogsAlbum, destination: Shelf, confirmed?: DiscogsAlbum) => {
    const key = catalogKey(album);
    const query = latestQuery.current.trim();
    const saved = await saveRecord(key, destination, async () => {
      const { album: saved } = await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: catalogSource(album)?.kind === 'album' ? album.year : undefined,
        coverImageUrl: confirmed?.coverImageUrl ?? album.coverImageUrl,
        ...(confirmed ? catalogSaveReference(confirmed) : catalogAlbumReference(album)),
        applyCatalogReference: true,
        status: destination,
      });
      setRecentCatalogSaves(current => new Set(current).add(saved.id));
      updateSearchMembership(saved.id, saved.status, latestQuery.current.trim() === query ? { key, album: saved } : undefined);
    });
    if (saved) toast.success(`“${album.album}” added to ${shelfLabel[destination]}.`);
    return saved;
  };

  const openPressingReview = (album: DiscogsAlbum, opener: HTMLButtonElement) => {
    const key = catalogKey(album);
    setSaveErrors(current => ({ ...current, [key]: undefined }));
    pressingReviewOpener.current = opener;
    pressingReviewFallback.current = opener.closest('article')?.querySelector('[data-catalog-primary]') ?? searchInput.current;
    setPressingReview({ album, destination: saveShelf,
      searchedNumber: latestScope.current === 'catalog-number' || album.catalogNumberMatch === 'exact' ? latestQuery.current.trim() : undefined });
  };

  const saveReviewedAlbum = async (release?: DiscogsAlbum) => {
    if (!pressingReview || !await handleCatalogAdd(pressingReview.album, pressingReview.destination, release)) return false;
    window.requestAnimationFrame(() => {
      const target = pressingReviewFallback.current;
      (target?.isConnected ? target : searchInput.current)?.focus();
    });
    return true;
  };

  const excludeFromShelf = (albumId: number, keepOn?: Shelf) => {
    setShelfResult(current => current?.status === 'ready' && current.request.view !== keepOn
      ? { ...current, albums: current.albums.filter(album => album.id !== albumId) }
      : current);
  };

  const moveRecord = async ({ albumId, title, from, to }: ShelfMove, undoOf?: ShelfMove) => {
    const saved = await saveRecord(savedAlbumKey(albumId), to === 'collection' ? 'move' : 'wishlist', async () => {
      await api.updateStatus(albumId, to, from);
      excludeFromShelf(albumId, to);
      updateSearchMembership(albumId, to);
      if (showBarcodeScanner || showImageUploader) {
        setLookupShelfEdits(current => ({ ...current, [albumId]: to }));
      }
    }, albumId);
    if (!saved) return false;

    if (undoOf) {
      setLastShelfMove(current => current === undoOf ? null : current);
      toast.success(`“${title}” moved back to ${shelfLabel[to]}.`);
      if (undoButton.current?.ownerDocument.activeElement === undoButton.current && undoButton.current) focusSearch();
    } else {
      setLastShelfMove({ albumId, title, from, to });
    }
    return true;
  };

  const moveWishlistAlbum = (albumId: number, title: string) =>
    moveRecord({ albumId, title, from: 'wishlist', to: 'collection' });

  const moveLookupAlbum = async (albumId: number, title: string) => {
    const moved = await moveWishlistAlbum(albumId, title);
    if (!moved) toast.error('Could not move the album. Check its current shelf and try again.');
    return moved;
  };

  const moveScannedAlbum = async (albumId: number, title: string) => {
    const moved = await moveLookupAlbum(albumId, title);
    if (moved) window.requestAnimationFrame(() => undoButton.current?.focus());
    return moved;
  };

  const undoShelfMove = (albumId: number) => {
    if (lastShelfMove?.albumId !== albumId) return Promise.resolve(false);
    return moveRecord({ ...lastShelfMove, from: lastShelfMove.to, to: lastShelfMove.from }, lastShelfMove);
  };

  const openManualEntry = () => setManualEntry({
    draft: searchActive && searchScope !== 'catalog-number' ? draftForSearch(searchQuery, detectedDraft) : {},
    shelf: searchActive ? (searchesCatalog(searchScope) ? saveShelf : searchShelf(searchScope) ?? viewMode) : viewMode,
  });

  const showAlbumDetails = (album: Album, opener?: HTMLButtonElement, backToMatches = false) => {
    albumDetailOpener.current = opener ?? null;
    setDetailBackToMatches(backToMatches);
    setRestoredDetailShelf(undefined);
    setSelectedAlbum(album);
  };

  const forgetSavedCopy = (albumId: number) => {
    if (showBarcodeScanner || showImageUploader) {
      setLookupShelfEdits(current => ({ ...current, [albumId]: null }));
    }
    excludeFromShelf(albumId);
    setSearchState(current => current.status === 'ready'
      ? { ...current, results: { ...current.results, local: current.results.local.filter(album => album.id !== albumId) } }
      : current);
    setCatalogState(current => current.status === 'ready' ? {
      ...current,
      results: { ...current.results, discogs: current.results.discogs.map(match => {
        if (match.existingAlbumId !== albumId && !match.titleMatches?.some(copy => copy.id === albumId)) return match;
        const updated = applyLookupShelfEdits({
          ...match, existingStatus: match.inCollection ? 'collection' as const : match.inWishlist ? 'wishlist' as const : undefined,
        }, { [albumId]: null });
        return {
          ...match, existingMatch: updated.existingMatch, existingAlbumId: updated.existingAlbumId, titleMatches: updated.titleMatches,
          inCollection: updated.existingStatus === 'collection' || updated.titleMatches?.some(copy => copy.status === 'collection'),
          inWishlist: updated.existingStatus === 'wishlist' || updated.titleMatches?.some(copy => copy.status === 'wishlist'),
        };
      }) },
    } : current);
  };

  const pressingCopyRemoved = (albumId: number) => {
    forgetSavedCopy(albumId);
    setAlbumReview(current => current?.album.id === albumId ? { ...current, removed: true } : current);
    setLastShelfMove(current => current?.albumId === albumId ? null : current);
    refreshShelf();
  };

  const openSavedAlbum = async (albumId: number, {
    closeLookup, issueKey, opener, fromLookup, inlineError,
  }: {
    closeLookup?: () => void;
    issueKey?: string;
    opener?: HTMLButtonElement;
    fromLookup?: boolean;
    inlineError?: boolean;
  } = {}): Promise<SavedAlbumOutcome> => {
    if (openingSavedAlbum.current) return 'unavailable';
    openingSavedAlbum.current = true;
    setLoadingAlbumId(albumId);
    try {
      const { album } = await api.getAlbum(albumId);
      if (opener && !opener.isConnected) return 'unavailable';
      closeLookup?.();
      if (issueKey && selectedAlbum?.id === albumId) setSelectedAlbum(album);
      else showAlbumDetails(album, opener, fromLookup);
      if (issueKey || saveErrors[savedAlbumKey(albumId)]?.stale) {
        setAlbumToRemove(current => current?.id === albumId ? null : current);
        setLastShelfMove(current => current?.albumId === albumId ? null : current);
        setSaveErrors(current => ({ ...current, [issueKey ?? savedAlbumKey(albumId)]: undefined }));
        refreshLibrary();
      }
      return 'opened';
    } catch (error) {
      const missing = error instanceof Error && 'status' in error && error.status === 404;
      if (fromLookup && missing) {
        forgetSavedCopy(albumId);
        setLastShelfMove(current => current?.albumId === albumId ? null : current);
        refreshShelf();
        if (!inlineError) toast.error('This album is no longer saved.');
        return 'removed';
      }
      if (issueKey && missing) {
        setAlbumToRemove(current => current?.id === albumId ? null : current);
        setSelectedAlbum(current => current?.id === albumId ? null : current);
        setLastShelfMove(current => current?.albumId === albumId ? null : current);
        setSaveErrors(current => ({ ...current, [issueKey]: undefined }));
        refreshLibrary();
        toast.error('This album is no longer saved.');
        focusSearch();
      } else if (!inlineError) {
        toast.error('Could not open this saved album. Try again.');
      }
      return 'unavailable';
    } finally {
      openingSavedAlbum.current = false;
      setLoadingAlbumId(undefined);
    }
  };

  const inspectSavedAlbum: OpenSavedAlbum = (id, opener, inlineError) =>
    openSavedAlbum(id, { opener, inlineError, fromLookup: true });

  const moveAlbum = async (album: Album, button: HTMLButtonElement, fromDetails: boolean) => {
    const hadFocus = button.ownerDocument.activeElement === button;
    const to = album.status === 'collection' ? 'wishlist' : 'collection';
    const saved = await moveRecord({ albumId: album.id, title: album.title, from: album.status, to });
    if (!saved) return;

    if (fromDetails && detailBackToMatches) {
      setRestoredDetailShelf(undefined);
      setSelectedAlbum(current => current?.id === album.id ? { ...current, status: to } : current);
      return;
    }
    if (fromDetails) setSelectedAlbum(current => current?.id === album.id ? null : current);
    if (hadFocus || fromDetails) {
      window.requestAnimationFrame(() => {
        undoButton.current?.focus();
      });
    }
  };

  const undoDetailMove = async (move: ShelfMove) => {
    if (!await undoShelfMove(move.albumId)) return;
    setSelectedAlbum(current => current?.id === move.albumId ? { ...current, status: move.from } : current);
    setRestoredDetailShelf(move.from);
    window.requestAnimationFrame(() => restoredDetailNotice.current?.focus({ preventScroll: true }));
  };

  const closeRemoval = () => {
    if (!albumToRemove || loadingAlbumId === albumToRemove.id || inFlightSaves.current.has(savedAlbumKey(albumToRemove.id))) return;
    setAlbumToRemove(null);
  };

  const removeAlbum = async (album: Album) => {
    const key = savedAlbumKey(album.id);
    const removed = await saveRecord(key, 'remove', async () => {
      await api.deleteAlbum(album.id, album.status);
      forgetSavedCopy(album.id);
    }, album.id);
    if (!removed) return;

    setAlbumToRemove(null);
    setSelectedAlbum(current => current?.id === album.id ? null : current);
    setLastShelfMove(current => current?.albumId === album.id ? null : current);
    toast.success(`“${album.title}” removed from ${shelfLabel[album.status]}.`);
    window.requestAnimationFrame(() => {
      const target = latestQuery.current.trim().length >= 2 ? searchInput.current : activeShelfButton.current;
      target?.focus();
    });
  };

  const results = searchState.status === 'ready' ? searchState.results : null;
  const catalogResults = catalogState.status === 'ready' ? catalogState.results : null;
  const savedCount = results?.local.length ?? 0;
  const catalogCount = catalogResults?.discogs.length ?? 0;
  const hasNewCatalogMatches = catalogResults?.discogs.some(album => !album.inCollection && !album.inWishlist);
  const queryLength = searchQuery.trim().length;
  const searchActive = queryLength >= 2;
  const catalogActive = searchesCatalog(searchScope);
  const numberSearch = searchScope === 'catalog-number';
  const catalogUnavailable = catalogState.status === 'error' || !!catalogResults?.errors?.length;
  const pressingReviewIssue = pressingReview && saveErrors[catalogKey(pressingReview.album)];
  const pressingReviewDuplicate = pressingReviewIssue?.albumId;
  const shelfAlbums = currentShelf?.status === 'ready' ? currentShelf.albums : [];
  const sortedAlbums = results?.local ?? sortAlbums(shelfAlbums, sortBy);

  const changeSort = (next: SortBy) => {
    searchSort.current = next;
    setSortBy(next);
    if (searchActive) runSearch(latestQuery.current, { keepResults: true, only: 'saved' });
  };

  const startRemoval = (album: Album) => {
    const key = savedAlbumKey(album.id);
    if (inFlightSaves.current.has(key) || saveErrors[key]?.stale) return;
    setSaveErrors(prev => ({ ...prev, [key]: undefined }));
    setAlbumToRemove(album);
  };

  const openSaveIssue = (id: number, key: string) => void openSavedAlbum(id, { issueKey: key });

  const savedGrid = (savedCount > 0 || (!searchActive && currentShelf?.status === 'ready')) && (
    <div className={searchActive ? 'rh-saved-results' : albumGrid}>
      {sortedAlbums.map(album => {
        const revision = artworkRevisions[album.id] ?? album.local_cover_path ?? libraryArtworkRevision;
        const src = `${getCoverArtUrl(album.id)}${revision ? `?v=${encodeURIComponent(revision)}` : ''}`;
        const key = savedAlbumKey(album.id);
        const pending = pendingSaves[key];
        const availablePressings = catalogResults?.discogs.length ? savedPressingChoices(album, catalogResults.discogs) : [];
        const canCompare = availablePressings.some(pressing => pressing.releaseId !== album.discogs_id);
        return (
          <article key={album.id} className={searchActive ? 'rh-saved-result' : 'rh-album-card relative flex flex-col rounded-xl border border-gray-200'}>
            <div className="rh-album-cover relative flex aspect-square items-center justify-center overflow-hidden">
              <AlbumCover key={src} src={src} />
            </div>
            <AlbumMeta title={album.title} artist={album.artist_name} year={album.year} shelf={searchActive ? album.status : undefined}
              resultId={searchActive ? savedResultTarget(album.id) : undefined} artworkUnverified={!album.cover_art_fetched} />
            <button
              type="button"
              className={searchActive ? 'rh-lookup-link rh-saved-open' : 'absolute inset-0 z-10 cursor-pointer rounded-[inherit]'}
              aria-label={`Open ${savedCopyLabel(album)}`}
              aria-haspopup="dialog"
              aria-disabled={!!pending}
              onClick={event => {
                if (!pending) showAlbumDetails(album, event.currentTarget);
              }}
            >{searchActive && 'Open album'}</button>
            <div className={searchActive ? 'rh-saved-actions' : 'relative z-20 mt-auto grid gap-1.5 p-2 pt-0'}>
              <ShelfActions album={album} pending={pending} issue={saveErrors[key]}
                loadingAlbumId={loadingAlbumId}
                onMove={moveAlbum} onRemove={startRemoval} onOpenIssue={openSaveIssue} />
            </div>
            {searchActive && canCompare && <button type="button" className="rh-lookup-link rh-saved-compare"
              aria-label={`Review pressings for your saved ${album.title}`} aria-haspopup="dialog" disabled={!!pending}
              onClick={event => {
                albumReviewOpener.current = event.currentTarget;
                setAlbumReview({ album, status: 'ready', choices: availablePressings });
              }}>Review pressings</button>}
          </article>
        );
      })}
    </div>
  );

  const renderContinuation = (kind: ResultKind, data: SearchResult) => {
    const count = kind === 'saved' ? data.local.length : data.discogs.length;
    const more = data.nextOffset;
    const state = loadingMore[kind];
    const label = kind === 'saved' ? 'saved albums' : 'catalog albums';
    if (kind === 'saved' && more === undefined && state !== 'error') return null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        {kind === 'catalog' && (
          <p role="status">{more !== undefined ? `Showing the first ${count} catalog matches. More are available.` : `Showing ${count} catalog ${count === 1 ? 'match' : 'matches'}.`}
            {data.catalogSampled && more === undefined && ' Refine your search for more catalog matches.'}
          </p>
        )}
        {more !== undefined && (
          <button type="button" className={secondaryButton} aria-disabled={state === 'pending' || (kind === 'saved' ? savedLoading : catalogLoading)}
            onClick={event => void loadMore(kind, data, more, event?.currentTarget)}>
            {state === 'pending' ? 'Loading…' : state === 'error' ? `Retry loading ${label}` : `Load more ${label}`}
          </button>
        )}
        {state === 'error' && <p role="alert">Could not load the next results. Try again.</p>}
      </div>
    );
  };

  return (
    <div className="rh-app min-h-screen">
      <div className="rh-page-toaster">
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'var(--rh-surface-2)',
              color: 'var(--rh-ink)',
              border: '1px solid var(--rh-edge)',
              boxShadow: 'var(--rh-shadow-panel)',
            },
          }}
        />
      </div>

      <header className="rh-header border-b">
        <div className="rh-shell mx-auto px-6 py-6">
          <div className="mb-2 flex items-center justify-between gap-3 sm:mb-4">
            <h1>Vinyl Collector</h1>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rh-icon-button rounded-lg border p-2.5 text-gray-500 transition-colors"
              title="Settings"
              aria-label="Open settings"
              aria-haspopup="dialog"
            >
              <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {!searchActive && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div className="rh-shelf-controls flex items-center gap-2">
              <div className="rh-view-switcher flex" role="group" aria-label="Browse shelf">
                {shelves.map(shelf => (
                  <button
                    key={shelf}
                    ref={viewMode === shelf ? activeShelfButton : undefined}
                    type="button"
                    className="rh-view-tab text-sm font-medium text-gray-500 transition-colors"
                    onClick={() => showShelf(shelf)}
                    aria-pressed={viewMode === shelf}
                  >
                    {shelfLabel[shelf]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-1">
              <div className="rh-library-count text-sm" role="status" aria-atomic="true">
                {currentShelf?.status === 'ready' && (
                  <span>{shelfAlbums.length} {shelfAlbums.length === 1 ? 'album' : 'albums'} in {shelfLabel[viewMode]}</span>
                )}
              </div>
              <SortControl sort={sortBy} onChange={changeSort} />
            </div>
          </div>}
        </div>
      </header>

      <main className="rh-main rh-shell mx-auto px-6 py-3 sm:py-6">
        <div className="rh-command-bar" id="search-controls">
          <form
            role="search"
            className="rh-search-form min-w-0 flex-1"
            onSubmit={event => {
              event.preventDefault();
              runSearch(searchQuery);
            }}
          >
            <div className="rh-search-options">
              <div className="rh-search-modes" role="group" aria-label="Search by">
                <button type="button" aria-pressed={!numberSearch} onClick={() => changeLookupMethod('name')}>Album or artist</button>
                <button type="button" aria-pressed={numberSearch} onClick={() => changeLookupMethod('catalog-number')}>Catalog number</button>
              </div>
            </div>
            <label htmlFor="album-search" className="sr-only">{numberSearch ? 'Search catalog number' : 'Search by album or artist'}</label>
            <div className="rh-query-controls flex min-w-0 gap-1.5 sm:gap-2">
              <div className="rh-search relative min-w-0 flex-1">
                <input
                  ref={searchInput}
                  id="album-search"
                  type="text"
                  enterKeyHint="search"
                  aria-keyshortcuts="Alt+Shift+F"
                  className={`w-full border px-2 py-2 sm:px-3 ${searchQuery ? 'pr-11 sm:pr-12' : ''}`}
                  placeholder={numberSearch ? 'Number on the sleeve or label' : 'Album title or artist name'}
                  value={searchQuery}
                  onChange={event => changeSearch(event.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 sm:right-1"
                    aria-label="Clear search"
                    title="Clear search"
                    onClick={() => {
                      changeSearch('');
                      searchInput.current?.focus();
                    }}
                  >
                    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button type="submit" className={`${secondaryButton} min-w-11 disabled:opacity-60`} aria-label="Search" disabled={!searchActive}>
                <svg aria-hidden="true" className="mx-auto size-4.5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={2} d="m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
                </svg>
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>
            {!numberSearch && <div className="rh-search-scope flex items-center gap-2">
              <label htmlFor="search-scope" className="text-xs text-gray-600 sm:text-sm">Search in</label>
              <select
                id="search-scope"
                value={searchScope}
                onChange={event => changeScope(event.target.value as SearchScope)}
                className="max-w-full rounded-lg border border-gray-300 px-2 text-sm"
              >
                <option value="saved">Collection and Wishlist</option>
                <option value="collection">Collection only</option>
                <option value="wishlist">Wishlist only</option>
                <option value="catalog">Shelves and online catalogs</option>
              </select>
            </div>}
              <button
                type="button"
                className="rh-primary-action rh-add-trigger flex shrink-0 items-center justify-center gap-1 px-2.5 py-2 text-sm font-semibold sm:gap-2 sm:px-4"
                aria-label="Add Album"
                aria-haspopup="dialog"
                onClick={() => setShowAddMenu(true)}
              >
                <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add<span className="hidden sm:inline"> Album</span>
              </button>
          </form>
        </div>

        <DiscogsImporter
          open={showDiscogsImporter}
          onOpen={() => setShowDiscogsImporter(true)}
          onClose={() => setShowDiscogsImporter(false)}
          onSuccess={refreshLibrary}
          onImportingChange={setDiscogsImporting}
          viewMode={viewMode}
        />

        {lastShelfMove && (
          <aside className="mb-4 rounded-xl border border-gray-300 bg-white p-3" aria-label="Latest shelf move">
            <p role="status" className="text-sm font-medium [overflow-wrap:anywhere]">
              “{lastShelfMove.title}” moved to {shelfLabel[lastShelfMove.to]}.
            </p>
            <SaveIssueNotice issue={saveErrors[savedAlbumKey(lastShelfMove.albumId)]} issueKey={savedAlbumKey(lastShelfMove.albumId)} loadingAlbumId={loadingAlbumId} onOpen={openSaveIssue} />
            <div className="mt-2 flex items-center gap-2">
              <button
                ref={undoButton}
                type="button"
                className={secondaryButton}
                aria-disabled={!!pendingSaves[savedAlbumKey(lastShelfMove.albumId)] || !!saveErrors[savedAlbumKey(lastShelfMove.albumId)]?.stale}
                aria-busy={!!pendingSaves[savedAlbumKey(lastShelfMove.albumId)]}
                onClick={() => void undoShelfMove(lastShelfMove.albumId)}
              >
                {pendingSaves[savedAlbumKey(lastShelfMove.albumId)] ? 'Undoing…' : 'Undo'}
              </button>
              <button
                type="button"
                aria-label="Dismiss shelf move"
                className="min-h-11 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => {
                  setLastShelfMove(null);
                  focusSearch();
                }}
              >
                Dismiss
              </button>
            </div>
          </aside>
        )}

        <div role="status" className="text-sm text-gray-600" aria-atomic="true">
          {queryLength === 1 && <p className="mb-4">Enter at least two characters to search.</p>}
          {!searchActive && !currentShelf && <p className="py-8">Loading {shelfLabel[viewMode]}…</p>}
        </div>

        <div role="status" className="sr-only">{loadedPage?.message}</div>
        {(searchActive || !queryLength) && (
          <div className="rh-result-tools">
            {searchActive && <nav className="rh-result-nav" aria-label="Search results">
              <button type="button" onClick={() => {
                changeSearch('');
                if (numberSearch) changeScope('saved');
                window.requestAnimationFrame(() => activeShelfButton.current?.focus());
              }}>Back to {shelfLabel[viewMode]}</button>
              {searchScope === 'catalog' && <a href="#saved-results-title">Saved</a>}
              {catalogActive && <a href="#catalog-results-title">Catalogs</a>}
            </nav>}
            <details className="rh-search-tips">
              <summary aria-label="Search tips"><span className="hidden sm:inline">Search </span>Tips</summary>
              <div>
                <p>Use Search in to choose a shelf or include online catalogs. Name searches keep that choice when you open them from Add.</p>
                <p>Look up a catalog number printed on the sleeve or label. Check the format and year before saving a pressing.</p>
                <p className="rh-keyboard-tip">Focus search with <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>.</p>
              </div>
            </details>
          </div>
        )}

        {searchActive && !numberSearch && (
            <section className="rh-saved-section" aria-labelledby="saved-results-title">
              <div className="rh-saved-heading-row mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 ref={savedHeading} id="saved-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">Saved albums</h2>
                {savedCount > 0 && searchScope !== 'catalog' && <button type="button" className="rh-lookup-link" onClick={() => openNameSearch()}>Search catalogs too</button>}
                {(savedCount > 1 || results?.nextOffset !== undefined) && <SortControl sort={sortBy} onChange={changeSort} />}
              </div>
              {searchState.status === 'error' && (
                <div className="rh-search-recovery">
                  <p role="status" className="text-sm">{savedLoading ? 'Retrying saved albums…' : 'Saved album search couldn’t finish.'}</p>
                  <button type="button" className={secondaryButton} aria-disabled={savedLoading}
                    onClick={event => {
                      if (!savedLoading) runSearch(searchQuery, { keepResults: true, only: 'saved', retryFrom: event.currentTarget });
                    }}>Retry saved search</button>
                </div>
              )}
              {!results && searchState.status !== 'error' && <p role="status" className="text-sm text-gray-600">Searching saved albums…</p>}
              {results && savedCount > 0 && <>
                <p role="status" aria-atomic="true" className="mb-2 text-sm text-gray-600">
                  {savedLoading ? `Updating saved results by ${sortLabels[sortBy].toLowerCase()}…`
                    : savedCount === 1 && results.nextOffset === undefined ? '1 saved match.'
                      : `Showing ${results.nextOffset !== undefined ? 'the first ' : ''}${savedCount} saved ${savedCount === 1 ? 'match' : 'matches'}, sorted by ${sortLabels[sortBy].toLowerCase()}.`}
                </p>
                <div aria-busy={savedLoading}>{savedGrid}</div>
                {renderContinuation('saved', results)}
              </>}
              {results && savedCount === 0 && <>
                <p role="status" className="text-sm text-gray-600 [overflow-wrap:anywhere]">No saved albums match “{searchQuery.trim()}”.</p>
                {searchScope !== 'catalog' && <button type="button" className="rh-lookup-link" onClick={() => openNameSearch()}>Search catalogs too</button>}
                {searchScope !== 'catalog' && <button type="button" className="rh-lookup-link" onClick={() => changeLookupMethod('catalog-number')}>Search by catalog number</button>}
              </>}
            </section>
        )}

        {searchActive && catalogActive && (
          <section aria-labelledby="catalog-results-title">
            <div className={`rh-catalog-bar${catalogCount > 0 ? ' rh-catalog-bar-sticky' : ''}`}>
              <h2 ref={catalogHeading} id="catalog-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">{numberSearch ? 'Discogs results' : 'Catalog albums'}</h2>
              {hasNewCatalogMatches && <label className="rh-catalog-destination text-sm text-gray-600">
                Default shelf for new albums
                <select id="catalog-save-shelf" value={saveShelf}
                  onChange={event => setSaveShelf(event.target.value as Shelf)}
                  className="min-h-11 max-w-full rounded-lg border border-gray-300 px-2.5">
                  {shelves.map(shelf => <option key={shelf} value={shelf}>{shelfLabel[shelf]}</option>)}
                </select>
              </label>}
            </div>
            {catalogLoading && !catalogUnavailable && <p role="status" className="mb-3 text-sm text-gray-600">Searching catalogs…</p>}
            {catalogUnavailable && (
              <div className="rh-search-recovery mb-3">
                <p role="status" className="text-sm">{catalogLoading ? 'Retrying catalogs…' : catalogCount > 0
                  ? 'Some catalogs couldn’t respond. These matches are still available.' : 'Catalog search couldn’t finish.'}</p>
                <button type="button" className={secondaryButton} aria-disabled={catalogLoading} onClick={event => {
                  if (!catalogLoading) runSearch(searchQuery, { keepResults: true, only: 'catalog', retryFrom: event.currentTarget });
                }}>Retry catalogs</button>
              </div>
            )}
            {!catalogLoading && !catalogCount && (catalogResults || catalogState.status === 'error') && (
              <div className="rounded-xl border border-gray-300 px-4 py-5">
                {catalogResults && !catalogResults.errors?.length && (
                  <p role="status" className="mb-2 text-sm text-gray-600 [overflow-wrap:anywhere]">
                    {numberSearch ? `Discogs found no catalog number matching “${searchQuery.trim()}”. Check the number on the sleeve or try an album title.`
                      : `No catalog albums match “${searchQuery.trim()}”. Try the album title, artist name, or number on the sleeve.`}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rh-lookup-link" onClick={() => searchInput.current?.focus()}>{numberSearch ? 'Edit catalog number' : 'Refine search'}</button>
                  <button type="button" className="rh-lookup-link" onClick={() => changeLookupMethod(numberSearch ? 'name' : 'catalog-number')}>
                    {numberSearch ? 'Search by album or artist' : 'Search by catalog number'}
                  </button>
                  <button type="button" className={secondaryButton} onClick={openManualEntry}>Add album manually</button>
                </div>
              </div>
            )}
            {!!catalogCount && catalogResults && (
                <div className="rh-catalog-grid">
                  {catalogResults.discogs.map(album => {
                    const key = catalogKey(album);
                    const savedShelf = album.inCollection ? 'collection' : album.inWishlist ? 'wishlist' : undefined;
                    const albumId = album.existingAlbumId;
                    const saveKey = albumId == null ? key : savedAlbumKey(albumId);
                    const pending = pendingSaves[saveKey];
                    const source = catalogSource(album);
                    const catalogLabel = catalogRecordLabel(album, source);
                    const hasPressings = source?.kind === 'pressing' || !!album.pressingChoices?.length;
                    const pressingLabel = [album.pressing?.catalogNumber, album.pressing?.format, album.pressing?.country].filter(Boolean).join(' · ');
                    return (
                      <article key={key} className="rh-album-card rh-catalog-card rounded-xl border border-gray-200">
                        <div className="rh-album-cover rh-catalog-cover flex aspect-square items-center justify-center overflow-hidden">
                          <AlbumCover key={album.coverImageUrl} src={album.coverImageUrl} />
                        </div>
                        <div className="rh-catalog-identity">
                          <h3 id={catalogResultTarget(album)} tabIndex={-1} className="rh-result-heading text-sm font-semibold">{album.album}</h3>
                          <p className="mt-0.5 text-xs text-gray-600">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
                          <p className="rh-catalog-edition">{source?.kind === 'pressing' ? pressingLabel || `Discogs release ${album.discogsId}` : listingEvidence(source)}</p>
                          {album.catalogNumberMatch === 'exact' && <p className="text-xs text-gray-600">Catalog number matches</p>}
                          {album.catalogNumberMatch === 'unverified' && <p className="text-xs text-gray-600">Check the catalog number on the listing</p>}
                        </div>
                        <div className="rh-catalog-actions grid gap-1.5">
                          {(saveErrors[saveKey]?.albumId === undefined || savedShelf) && <SaveDestinationActions
                            albumTitle={album.album}
                            catalogLabel={catalogLabel}
                            preferred={saveShelf}
                            existingStatus={savedShelf}
                            existingMatch={album.existingMatch}
                            existingAlbumId={albumId}
                            savedHere={albumId != null && recentCatalogSaves.has(albumId)}
                            titleMatches={album.titleMatches}
                            lookup={lookupPressing(album)}
                            lookupChoices={album.pressingChoices?.map(lookupPressing)}
                            searchedNumber={numberSearch || album.catalogNumberMatch === 'exact' ? searchQuery.trim() : undefined}
                            onSavePressing={confirmSavedPressing}
                            onUndoPressing={undoSavedPressing}
                            onSavedCopyRemoved={pressingCopyRemoved}
                            onReviewPressings={hasPressings ? opener => openPressingReview(album, opener) : undefined}
                            reviewFirst={numberSearch || album.catalogNumberMatch === 'exact'}
                            onSearch={focusSearch}
                            searchLabel={numberSearch ? 'Edit catalog number' : 'Edit album search'}
                            pending={pending === 'remove' ? undefined : pending}
                            disabled={pending === 'remove' || !!saveErrors[saveKey]?.stale}
                            openingSaved={loadingAlbumId !== undefined && (loadingAlbumId === albumId ||
                              album.titleMatches?.some(match => match.id === loadingAlbumId))}
                            onOpenSaved={inspectSavedAlbum}
                            onSelect={action => {
                              if (action === 'move') {
                                if (albumId != null && isExactSavedMatch(album.existingMatch)) void moveWishlistAlbum(albumId, album.album);
                              } else {
                                void handleCatalogAdd(album, action);
                              }
                            }}
                          />}
                          <SaveIssueNotice issue={saveErrors[saveKey]} issueKey={saveKey} loadingAlbumId={loadingAlbumId} onOpen={openSaveIssue} />
                        </div>
                        {source?.url && <a href={source.url} target="_blank" rel="noreferrer" className="rh-catalog-source">
                          View on {source.label}<span className="sr-only"> · {catalogLabel} (opens in a new tab)</span>
                        </a>}
                      </article>
                    );
                  })}
                </div>
            )}
            {!!catalogCount && catalogResults && (
              <>
                {renderContinuation('catalog', catalogResults)}
                <button type="button" className="rh-lookup-link mt-2" onClick={openManualEntry}>Add album manually</button>
              </>
            )}
          </section>
        )}

        {!searchActive && currentShelf?.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3 py-5">
            <p role="alert" className="text-sm">Couldn’t load {shelfLabel[viewMode]}.</p>
            <button type="button" className={secondaryButton} onClick={refreshShelf}>Retry</button>
          </div>
        )}
        {!searchActive && currentShelf?.status === 'ready' && (
          sortedAlbums.length ? savedGrid : (
            <div className="py-10 text-center">
              <h2 className="text-lg font-semibold">Your {shelfLabel[viewMode].toLowerCase()} is empty</h2>
              <button type="button" className="rh-primary-action mt-3 px-4 text-sm font-semibold"
                onClick={() => openNameSearch()}>Find a record to add</button>
            </div>
          )
        )}
      </main>

      <footer className="rh-shell mx-auto px-6 py-4 text-center">
        <p className="text-xs text-gray-400">{__APP_VERSION__}</p>
      </footer>

      {showAddMenu && (
        <AddMenu
          onBarcodeClick={() => {
            setShowAddMenu(false);
            setLookupShelfEdits({});
            setLookupPressingEdits({});
            setShowBarcodeScanner(true);
          }}
          onImageClick={() => {
            setShowAddMenu(false);
            setLookupShelfEdits({});
            setLookupPressingEdits({});
            setShowImageUploader(true);
          }}
          onSearchClick={() => {
            setShowAddMenu(false);
            changeLookupMethod('name');
          }}
          onCatalogNumberClick={() => {
            setShowAddMenu(false);
            changeLookupMethod('catalog-number');
          }}
          onManualClick={() => {
            setShowAddMenu(false);
            openManualEntry();
          }}
          onImportClick={() => {
            setShowAddMenu(false);
            setShowDiscogsImporter(true);
          }}
          onClose={() => setShowAddMenu(false)}
          discogsConfigured={discogsConfigured}
          discogsCheckFailed={discogsCheckFailed}
          viewMode={viewMode}
        />
      )}

      {manualEntry && (
        <ManualAlbumDialog draft={manualEntry.draft} initialShelf={manualEntry.shelf}
          onClose={() => setManualEntry(undefined)}
          onSaved={() => {
            setManualEntry(undefined);
            refreshLibrary();
          }}
          onOpenSaved={async id => { await openSavedAlbum(id, { closeLookup: () => setManualEntry(undefined) }); }}
        />
      )}

      {pressingReview && (
        <CatalogPressingPicker album={pressingReview.album} destination={pressingReview.destination}
          searchedNumber={pressingReview.searchedNumber}
          opener={pressingReviewOpener} fallback={pressingReviewFallback} issue={pressingReviewIssue?.message} duplicate={pressingReviewDuplicate !== undefined}
          onOpenDuplicate={pressingReviewDuplicate === undefined ? undefined : () => void openSavedAlbum(pressingReviewDuplicate, {
            closeLookup: () => setPressingReview(undefined), issueKey: catalogKey(pressingReview.album),
          })}
          onClose={() => setPressingReview(undefined)}
          onSave={saveReviewedAlbum} onSaveWithoutPressing={() => saveReviewedAlbum()} />
      )}

      {showSettings && <SettingsModal restoreBlocked={discogsImporting} onClose={() => setShowSettings(false)} onRestore={() => {
        setLastShelfMove(null);
        setArtworkRevisions({});
        setLibraryArtworkRevision(Date.now());
        setShelfResult(null);
        setSaveErrors({});
        refreshLibrary();
      }} />}

      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => setShowBarcodeScanner(false)}
          onBack={() => {
            setShowBarcodeScanner(false);
            setShowAddMenu(true);
          }}
          onSearchByName={(query, draft) => {
            setShowBarcodeScanner(false);
            openNameSearch(query, draft, viewMode);
          }}
          onManual={draft => {
            setShowBarcodeScanner(false);
            setManualEntry({ draft: draft ?? {}, shelf: viewMode });
          }}
          onMoveSaved={moveLookupAlbum}
          onUndoMove={undoShelfMove}
          onOpenSaved={inspectSavedAlbum}
          onSavePressing={confirmSavedPressing}
          onUndoPressing={undoSavedPressing}
          onSavedCopyRemoved={pressingCopyRemoved}
          lookupShelfEdits={lookupShelfEdits}
          lookupPressingEdits={lookupPressingEdits}
          onSuccess={refreshLibrary}
          viewMode={viewMode}
        />
      )}

      {showImageUploader && (
        <ImageUploader
          onClose={() => setShowImageUploader(false)}
          onBack={() => {
            setShowImageUploader(false);
            setShowAddMenu(true);
          }}
          onSearchByName={(query, draft) => {
            setShowImageUploader(false);
            openNameSearch(query, draft, viewMode);
          }}
          onManual={draft => {
            setShowImageUploader(false);
            setManualEntry({ draft: draft ?? {}, shelf: viewMode });
          }}
          onMoveSaved={moveScannedAlbum}
          onOpenSaved={inspectSavedAlbum}
          onSavePressing={confirmSavedPressing}
          onUndoPressing={undoSavedPressing}
          onSavedCopyRemoved={pressingCopyRemoved}
          lookupShelfEdits={lookupShelfEdits}
          lookupPressingEdits={lookupPressingEdits}
          onSuccess={refreshLibrary}
          viewMode={viewMode}
        />
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          returnFocusTo={albumDetailOpener}
          backToMatches={detailBackToMatches}
          onFindPressing={(album, opener) => void reviewSavedAlbum(album, opener)}
          onClose={() => {
            if (!inFlightSaves.current.has(savedAlbumKey(selectedAlbum.id))) setSelectedAlbum(null);
          }}
          onRefresh={refreshLibrary}
          shelfActions={<div className="grid gap-3">
            {detailBackToMatches && lastShelfMove?.albumId === selectedAlbum.id && (
              <div className="rh-detail-move-feedback">
                <p role="status" className="text-sm font-medium">Moved to {shelfLabel[lastShelfMove.to]}.</p>
                <button type="button" className="rh-lookup-link"
                  aria-disabled={!!pendingSaves[savedAlbumKey(selectedAlbum.id)] || !!saveErrors[savedAlbumKey(selectedAlbum.id)]?.stale}
                  aria-busy={!!pendingSaves[savedAlbumKey(selectedAlbum.id)]}
                  onClick={() => void undoDetailMove(lastShelfMove)}>
                  {pendingSaves[savedAlbumKey(selectedAlbum.id)] ? 'Undoing…' : 'Undo move'}
                </button>
              </div>
            )}
            {restoredDetailShelf && (
              <p ref={restoredDetailNotice} role="status" tabIndex={-1} className="rh-detail-move-feedback text-sm">
                Moved back to {shelfLabel[restoredDetailShelf]}.
              </p>
            )}
            <ShelfActions album={selectedAlbum} detailed
              pending={pendingSaves[savedAlbumKey(selectedAlbum.id)]} issue={saveErrors[savedAlbumKey(selectedAlbum.id)]}
              loadingAlbumId={loadingAlbumId} onMove={moveAlbum} onRemove={startRemoval} onOpenIssue={openSaveIssue} />
          </div>}
        />
      )}

      {albumReview && <PressingComparison
        title={albumReview.album.title}
        matches={albumReview.removed ? [] : [selectedAlbum?.id === albumReview.album.id ? selectedAlbum : albumReview.album]}
        lookup={albumReview.choices.find(choice => choice.releaseId !== albumReview.album.discogs_id) ?? albumReview.choices[0]}
        lookupChoices={albumReview.choices}
        lookupStatus={albumReview.status}
        onRetryLookup={() => void reviewSavedAlbum(albumReview.album)}
        onSavePressing={confirmSavedPressing}
        onUndoPressing={undoSavedPressing}
        onSavedCopyRemoved={pressingCopyRemoved}
        onOpenSaved={selectedAlbum ? undefined : inspectSavedAlbum}
        returnFocusTo={albumReviewOpener}
        fallbackFocusTo={searchInput}
        backLabel={selectedAlbum && !albumReview.removed ? 'Back to album' : 'Back to results'}
        onClose={closeAlbumReview}
        searchLabel="Search catalogs by name"
        onSearch={() => {
          closeAlbumReview();
          setSelectedAlbum(null);
          const album = albumReview.album;
          openNameSearch(`${album.artist_name} ${album.title}`, { artist: album.artist_name, album: album.title }, album.status);
        }}
      />}

      {albumToRemove && (
        <ModalDialog labelledBy="album-removal-title" onClose={closeRemoval}>
          <div className="rh-dialog-panel max-w-md p-4 sm:p-6">
            <h2 id="album-removal-title" className="text-lg font-semibold">Remove from {shelfLabel[albumToRemove.status]}?</h2>
            <p className="mt-2 text-sm text-gray-600 [overflow-wrap:anywhere]">
              “{albumToRemove.title}” and any notes saved with it will be removed from your {shelfLabel[albumToRemove.status]}.
            </p>
            <div className="mt-3"><SaveIssueNotice issue={saveErrors[savedAlbumKey(albumToRemove.id)]} issueKey={savedAlbumKey(albumToRemove.id)} loadingAlbumId={loadingAlbumId} onOpen={openSaveIssue} /></div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={secondaryButton}
                aria-disabled={!!pendingSaves[savedAlbumKey(albumToRemove.id)] || loadingAlbumId === albumToRemove.id}
                onClick={closeRemoval}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-semibold rh-filled-action"
                aria-disabled={!!pendingSaves[savedAlbumKey(albumToRemove.id)] || !!saveErrors[savedAlbumKey(albumToRemove.id)]?.stale}
                aria-busy={!!pendingSaves[savedAlbumKey(albumToRemove.id)]}
                onClick={() => void removeAlbum(albumToRemove)}
              >
                {pendingSaves[savedAlbumKey(albumToRemove.id)] ? 'Removing…' : 'Remove album'}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

    </div>
  );
}

export default App;
