import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { type Album, type DiscogsAlbum, type SearchResult, getCoverArtUrl, isExactSavedMatch } from './services/api';
import { applyLookupShelfEdits, catalogRecordLabel, catalogSaveReference, catalogSource, listingEvidence, savedCopyLabel, type LookupShelfEdits } from './albumDisplay';
import type { OpenSavedAlbum, SavedAlbumOutcome } from './components/PressingComparison';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SaveDestinationActions, type DestinationAction } from './components/SaveDestinationActions';
import { ModalDialog } from './components/ModalDialog';
import { ManualAlbumDialog, type ManualAlbumDraft } from './components/ManualAlbumDialog';

type Shelf = Album['status'];
type SortBy = 'title' | 'artist' | 'date';
type SearchScope = 'saved' | 'shelf' | 'catalog';
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

const shelves: Shelf[] = ['collection', 'wishlist'];
const resultKinds: ResultKind[] = ['saved', 'catalog'];
const sortLabels: Record<SortBy, string> = { title: 'Album title', artist: 'Artist name', date: 'Date added' };
const shelfLabel: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const albumGrid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4';
const secondaryButton = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50';

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

const savedAlbumKey = (id: number) => `saved:${id}`;

function draftForSearch(query: string, detected?: ManualAlbumDraft): ManualAlbumDraft {
  const text = query.trim();
  const artist = detected?.artist?.trim();
  if (artist && text.toLowerCase() === artist.toLowerCase()) return { artist };
  if (artist && text.toLowerCase().startsWith(`${artist.toLowerCase()} `)) {
    return { artist, album: text.slice(artist.length).trim().slice(0, 255) };
  }
  return { album: text.slice(0, 255) };
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

function AlbumMeta({ title, artist, year, shelf }: { title: string; artist: string; year?: number; shelf?: Shelf }) {
  return (
    <div className="rh-album-meta p-3">
      <h3 className={`${shelf ? '' : 'line-clamp-2'} text-sm text-gray-900`} title={title}>{title}</h3>
      <p className={`mt-0.5 ${shelf ? '' : 'truncate'} text-xs`} title={artist}>{artist}</p>
      {(year || shelf) && <p className="rh-album-year text-xs">{[year, shelf && shelfLabel[shelf]].filter(Boolean).join(' · ')}</p>}
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
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [manualEntry, setManualEntry] = useState<{ draft: ManualAlbumDraft; shelf: Shelf }>();
  const [detectedDraft, setDetectedDraft] = useState<ManualAlbumDraft>();
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [showDiscogsImporter, setShowDiscogsImporter] = useState(false);
  const [discogsImporting, setDiscogsImporting] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [detailBackToMatches, setDetailBackToMatches] = useState(false);
  const [restoredDetailShelf, setRestoredDetailShelf] = useState<Shelf>();
  const restoredDetailNotice = useRef<HTMLParagraphElement>(null);
  const [lookupShelfEdits, setLookupShelfEdits] = useState<LookupShelfEdits>({});
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
  const latestQuery = useRef('');
  const searchSettings = useRef<{ scope: SearchScope; shelf: Shelf }>({ scope: 'saved', shelf: 'collection' });
  const searchSort = useRef(sortBy);
  const searchInput = useRef<HTMLInputElement>(null);
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
  }, []);

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

  const refreshShelf = () => setShelfRequest(request => ({ ...request, revision: request.revision + 1 }));

  const runSearch = (value: string, { delay = 0, keepResults = false, only, retryFrom }: {
    delay?: number; keepResults?: boolean; only?: ResultKind; retryFrom?: HTMLButtonElement;
  } = {}) => {
    const query = value.trim();
    const { scope, shelf } = searchSettings.current;
    const sort = searchSort.current;
    const kinds = only && query.length >= 2 ? [only] : resultKinds;
    for (const kind of kinds) {
      cancelSearch(searchRequests.current[kind]);
      delete searchRequests.current[kind];
      pageRequests.current[kind]?.abort();
      delete pageRequests.current[kind];
    }
    setLoadingMore(current => only && query.length >= 2 ? { ...current, [only]: undefined } : {});
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
      if (kind === 'catalog' && scope !== 'catalog') {
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
          const results = await api.search(query, request.controller.signal, kind, scope === 'shelf' ? shelf : undefined, 0, sort);
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

  const loadMore = async (kind: ResultKind, offset: number) => {
    if (pageRequests.current[kind] || searchRequests.current[kind]) return;
    const request = new AbortController();
    pageRequests.current[kind] = request;
    setLoadingMore(current => ({ ...current, [kind]: 'pending' }));
    const { scope, shelf } = searchSettings.current;
    const setResults = kind === 'saved' ? setSearchState : setCatalogState;
    try {
      const page = await api.search(latestQuery.current.trim(), request.signal, kind, scope === 'shelf' ? shelf : undefined, offset, searchSort.current);
      if (request.signal.aborted) return;
      if (page.errors?.length) throw new Error('Search continuation unavailable');
      setResults(current => {
        if (current.status !== 'ready' || current.results.nextOffset !== offset) return current;
        const localIds = new Set(current.results.local.map(album => album.id));
        const catalogKeys = new Set(current.results.discogs.map(catalogKey));
        return {
          status: 'ready',
          results: {
            ...page,
            local: [...current.results.local, ...page.local.filter(album => !localIds.has(album.id))],
            discogs: [...current.results.discogs, ...page.discogs.filter(album => !catalogKeys.has(catalogKey(album)))],
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
    const previous = searchSettings.current.shelf;
    searchSettings.current.shelf = view;
    setShelfRequest(request => request.view === view ? request : { view, revision: request.revision + 1 });
    if (previous !== view && searchSettings.current.scope === 'shelf') runSearch(latestQuery.current);
  };

  const changeScope = (scope: SearchScope, destination?: Shelf) => {
    const previous = searchSettings.current.scope;
    if (scope === 'catalog' && (previous !== scope || destination)) setSaveShelf(destination ?? viewMode);
    if (previous === scope) return;
    searchSettings.current.scope = scope;
    setSearchScope(scope);
    runSearch(latestQuery.current);
  };

  const focusSearch = () => {
    window.requestAnimationFrame(() => searchInput.current?.focus());
  };

  const openNameSearch = (query?: string, draft?: ManualAlbumDraft, destination?: Shelf) => {
    if (query) {
      if (searchSettings.current.scope !== 'catalog' || destination) setSaveShelf(destination ?? viewMode);
      searchSettings.current.scope = 'catalog';
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
      const { scope, shelf } = searchSettings.current;
      const local = current.results.local.map(album => album.id === albumId ? { ...album, status } : album);
      const withAddition = addition && !local.some(album => album.id === albumId)
        ? sortAlbums([...local, addition.album], searchSort.current) : local;
      return {
        status: 'ready',
        results: { ...current.results, local: scope === 'shelf' ? withAddition.filter(album => album.status === shelf) : withAddition },
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
      if (Object.keys(searchRequests.current).length || Object.keys(pageRequests.current).length || action === 'remove' || searchSettings.current.scope === 'shelf') {
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

  const handleCatalogAdd = async (album: DiscogsAlbum, destination: Shelf) => {
    const key = catalogKey(album);
    const query = latestQuery.current.trim();
    const saved = await saveRecord(key, destination, async () => {
      const { album: saved } = await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        ...catalogSaveReference(album),
        status: destination,
      });
      updateSearchMembership(saved.id, saved.status, latestQuery.current.trim() === query ? { key, album: saved } : undefined);
    });
    if (saved) toast.success(`“${album.album}” added to ${shelfLabel[destination]}.`);
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
    draft: searchActive ? draftForSearch(searchQuery, detectedDraft) : {},
    shelf: searchActive && searchScope === 'catalog' ? saveShelf : viewMode,
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
  const queryLength = searchQuery.trim().length;
  const searchActive = queryLength >= 2;
  const catalogUnavailable = catalogState.status === 'error' || !!catalogResults?.errors?.length;
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
        return (
          <article key={album.id} className={searchActive ? 'rh-saved-result' : 'rh-album-card relative flex flex-col rounded-xl border border-gray-200'}>
            <div className="rh-album-cover relative flex aspect-square items-center justify-center overflow-hidden">
              <AlbumCover key={src} src={src} />
              {!album.cover_art_fetched && (
                <span className="absolute left-2 top-2 z-10 rounded-full bg-yellow-400 p-1 text-yellow-900" title="Unverified artwork">
                  <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="sr-only">Unverified artwork</span>
                </span>
              )}
            </div>
            <AlbumMeta title={album.title} artist={album.artist_name} year={album.year} shelf={searchActive ? album.status : undefined} />
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
          <button type="button" className={secondaryButton} disabled={state === 'pending' || (kind === 'saved' ? savedLoading : catalogLoading)}
            onClick={() => void loadMore(kind, more)}>
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
            <div className="rh-search-scope flex flex-wrap items-center gap-2">
              <label htmlFor="search-scope" className="text-xs text-gray-600 sm:text-sm">Search in</label>
              <select
                id="search-scope"
                value={searchScope}
                onChange={event => changeScope(event.target.value as SearchScope)}
                className="max-w-full rounded-lg border border-gray-300 px-2 text-sm"
              >
                <option value="saved">Collection and Wishlist</option>
                <option value="shelf">{shelfLabel[viewMode]} only</option>
                <option value="catalog">Saved albums and catalogs</option>
              </select>
            </div>
            <label htmlFor="album-search" className="sr-only">Search albums</label>
            <div className="flex min-w-0 gap-1.5 sm:gap-2">
              <div className="rh-search relative min-w-0 flex-1">
                <input
                  ref={searchInput}
                  id="album-search"
                  type="text"
                  enterKeyHint="search"
                  aria-keyshortcuts="Alt+Shift+F"
                  className={`w-full border px-2 py-2 sm:px-3 ${searchQuery ? 'pr-11 sm:pr-12' : ''}`}
                  placeholder="Album or artist"
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
              <button
                type="button"
                className="rh-primary-action flex shrink-0 items-center justify-center gap-1 px-2.5 py-2 text-sm font-semibold sm:gap-2 sm:px-4"
                aria-label="Add Album"
                aria-haspopup="dialog"
                onClick={() => setShowAddMenu(true)}
              >
                <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add<span className="hidden sm:inline"> Album</span>
              </button>
            </div>
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

        {searchActive && (
          <div className="rh-result-tools">
            <nav className="rh-result-nav" aria-label="Search results">
              <button type="button" onClick={() => {
                changeSearch('');
                window.requestAnimationFrame(() => activeShelfButton.current?.focus());
              }}>Back to {shelfLabel[viewMode]}</button>
              {searchScope === 'catalog' && <a href="#saved-results-title">Saved</a>}
              {searchScope === 'catalog' && <a href="#catalog-results-title">Catalogs</a>}
            </nav>
            <details className="rh-search-tips">
              <summary>Search tips</summary>
              <div>
                <p>Use the album title and artist together to narrow a search. Catalogs can find records that aren’t on either shelf.</p>
                <p>Use the catalog number on the sleeve or label to identify a particular pressing.</p>
                <p className="rh-keyboard-tip">Focus search with <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>.</p>
              </div>
            </details>
          </div>
        )}

        {searchActive && (
            <section className="mb-6" aria-labelledby="saved-results-title">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 ref={savedHeading} id="saved-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">Saved albums</h2>
                {savedCount > 0 && searchScope !== 'catalog' && <button type="button" className="rh-lookup-link" onClick={() => openNameSearch()}>Search catalogs too</button>}
                {savedCount > 0 && <SortControl sort={sortBy} onChange={changeSort} />}
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
                  {savedLoading ? `Updating saved results by ${sortLabels[sortBy].toLowerCase()}…` :
                    `Showing ${results.nextOffset !== undefined ? 'the first ' : ''}${savedCount} saved ${savedCount === 1 ? 'match' : 'matches'}, sorted by ${sortLabels[sortBy].toLowerCase()}.`}
                </p>
                <div aria-busy={savedLoading}>{savedGrid}</div>
                {renderContinuation('saved', results)}
              </>}
              {results && savedCount === 0 && <>
                <p role="status" className="text-sm text-gray-600 [overflow-wrap:anywhere]">No saved albums match “{searchQuery.trim()}”.</p>
                {searchScope !== 'catalog' && <button type="button" className="rh-lookup-link" onClick={() => openNameSearch()}>Search catalogs too</button>}
              </>}
            </section>
        )}

        {searchActive && searchScope === 'catalog' && (
          <section aria-labelledby="catalog-results-title">
            <div className={`rh-catalog-bar${catalogCount > 0 ? ' rh-catalog-bar-sticky' : ''}`}>
              <h2 ref={catalogHeading} id="catalog-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">Catalog albums</h2>
              <label className="rh-catalog-destination text-sm text-gray-600">
                Save new matches to
                <select id="catalog-save-shelf" value={saveShelf}
                  onChange={event => setSaveShelf(event.target.value as Shelf)}
                  className="min-h-11 max-w-full rounded-lg border border-gray-300 px-2.5">
                  {shelves.map(shelf => <option key={shelf} value={shelf}>{shelfLabel[shelf]}</option>)}
                </select>
              </label>
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
                  <p role="status" className="mb-2 text-sm text-gray-600 [overflow-wrap:anywhere]">No catalog albums match “{searchQuery.trim()}”. Try an album title or artist name.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rh-lookup-link" onClick={() => searchInput.current?.focus()}>Refine search</button>
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
                    return (
                      <article key={key} className="rh-album-card rh-catalog-card rounded-xl border border-gray-200">
                        <div className="rh-album-cover rh-catalog-cover flex aspect-square items-center justify-center overflow-hidden">
                          <AlbumCover key={album.coverImageUrl} src={album.coverImageUrl} />
                        </div>
                        <div className="rh-catalog-identity">
                          <h3 className="text-sm font-semibold">{album.album}</h3>
                          <p className="mt-0.5 text-xs text-gray-600">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
                          <p className="rh-catalog-edition">{listingEvidence(source)}{source?.kind === 'pressing' && ` · ${album.discogsId}`}</p>
                          {source?.url ? (
                            <a href={source.url} target="_blank" rel="noreferrer" className="rh-catalog-source">
                              View on {source.label}<span className="sr-only"> · {catalogLabel} (opens in a new tab)</span>
                            </a>
                          ) : null}
                        </div>
                        <div className="rh-catalog-actions grid gap-1.5">
                          {(saveErrors[saveKey]?.albumId === undefined || savedShelf) && <SaveDestinationActions
                            albumTitle={album.album}
                            catalogLabel={catalogLabel}
                            preferred={saveShelf}
                            existingStatus={savedShelf}
                            existingMatch={album.existingMatch}
                            existingAlbumId={albumId}
                            titleMatches={album.titleMatches}
                            lookup={{ artist: album.artist, year: album.year, source,
                              releaseId: source?.kind === 'pressing' ? album.discogsId : undefined }}
                            onSearch={focusSearch}
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
            setShowBarcodeScanner(true);
          }}
          onImageClick={() => {
            setShowAddMenu(false);
            setLookupShelfEdits({});
            setShowImageUploader(true);
          }}
          onSearchClick={() => {
            setShowAddMenu(false);
            openNameSearch();
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
          lookupShelfEdits={lookupShelfEdits}
          onSuccess={refreshLibrary}
          viewMode={viewMode}
        />
      )}

      {showImageUploader && (
        <ImageUploader
          onClose={() => setShowImageUploader(false)}
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
          lookupShelfEdits={lookupShelfEdits}
          onSuccess={() => {
            refreshLibrary();
            setShowImageUploader(false);
          }}
          viewMode={viewMode}
        />
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          returnFocusTo={albumDetailOpener}
          backToMatches={detailBackToMatches}
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
