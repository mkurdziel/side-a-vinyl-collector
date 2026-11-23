import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { type Album, type DiscogsAlbum, type SearchResult, getCoverArtUrl } from './services/api';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SaveDestinationActions, type DestinationAction } from './components/SaveDestinationActions';
import { ModalDialog } from './components/ModalDialog';

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
type SearchRequest = { controller: AbortController; pending: Set<ResultKind>; timer?: number };
type SaveAction = DestinationAction | 'remove';
type ShelfMove = { albumId: number; title: string; from: Shelf; to: Shelf };

const shelves: Shelf[] = ['collection', 'wishlist'];
const shelfLabel: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const albumGrid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4';
const secondaryButton = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50';

function cancelSearch(request: SearchRequest | null) {
  if (!request) return;
  window.clearTimeout(request.timer);
  request.controller.abort();
}

function catalogKey(album: DiscogsAlbum) {
  // Catalog providers supply different IDs. They are deduplicated by artist and title.
  return JSON.stringify([album.artist.toLowerCase(), album.album.toLowerCase()]);
}

const savedAlbumKey = (id: number) => `saved:${id}`;

function catalogSource(album: DiscogsAlbum): { label: string; url?: string } | undefined {
  if (album.source === 'musicbrainz') {
    const validId = album.mbid && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(album.mbid);
    return { label: 'MusicBrainz', url: validId ? `https://musicbrainz.org/release-group/${album.mbid}` : undefined };
  }
  if (album.source === 'discogs') {
    const listing = album.discogsListing;
    return {
      label: 'Discogs',
      url: listing && Number.isSafeInteger(album.id) && album.id > 0
        ? `https://www.discogs.com/${listing}/${album.id}`
        : undefined,
    };
  }
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

function AlbumMeta({ title, artist, year }: { title: string; artist: string; year?: number }) {
  return (
    <div className="rh-album-meta p-3">
      <h3 className="line-clamp-2 text-sm text-gray-900" title={title}>{title}</h3>
      <p className="mt-0.5 truncate text-xs" title={artist}>{artist}</p>
      {year ? <p className="rh-album-year text-xs">{year}</p> : null}
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
  const [saveShelfOverride, setSaveShelfOverride] = useState<Shelf>();
  const [loadingMore, setLoadingMore] = useState<Partial<Record<ResultKind, 'pending' | 'error'>>>({});
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [showDiscogsImporter, setShowDiscogsImporter] = useState(false);
  const [discogsImporting, setDiscogsImporting] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumToRemove, setAlbumToRemove] = useState<Album | null>(null);
  const [lastShelfMove, setLastShelfMove] = useState<ShelfMove | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [discogsConfigured, setDiscogsConfigured] = useState<boolean | null>(null);
  const [discogsCheckFailed, setDiscogsCheckFailed] = useState(false);
  const [pendingSaves, setPendingSaves] = useState<Partial<Record<string, SaveAction>>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [artworkRevisions, setArtworkRevisions] = useState<Record<number, number>>({});
  const [libraryArtworkRevision, setLibraryArtworkRevision] = useState<number>();
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const saved = localStorage.getItem('albumSortBy');
    return saved === 'artist' || saved === 'date' ? saved : 'title';
  });
  const inFlightSaves = useRef(new Set<string>());
  const openingSavedAlbum = useRef(false);
  const searchRequest = useRef<SearchRequest | null>(null);
  const pageRequests = useRef<Partial<Record<ResultKind, AbortController>>>({});
  const latestQuery = useRef('');
  const searchSettings = useRef<{ scope: SearchScope; shelf: Shelf }>({ scope: 'saved', shelf: 'collection' });
  const searchSort = useRef(sortBy);
  const searchInput = useRef<HTMLInputElement>(null);
  const activeShelfButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  const viewMode = shelfRequest.view;
  const saveShelf = saveShelfOverride ?? viewMode;
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
    cancelSearch(searchRequest.current);
    for (const request of Object.values(pageRequests.current)) request.abort();
  }, []);

  const refreshShelf = () => setShelfRequest(request => ({ ...request, revision: request.revision + 1 }));

  const runSearch = (value: string, { delay = 0, keepResults = false } = {}) => {
    cancelSearch(searchRequest.current);
    for (const request of Object.values(pageRequests.current)) request.abort();
    pageRequests.current = {};
    setLoadingMore({});
    searchRequest.current = null;
    const query = value.trim();
    const { scope, shelf } = searchSettings.current;
    if (query.length < 2) {
      setSearchState({ status: 'idle' });
      setCatalogState({ status: 'idle' });
      setSavedLoading(false);
      setCatalogLoading(false);
      return;
    }

    const request: SearchRequest = {
      controller: new AbortController(),
      pending: new Set(scope === 'catalog' ? ['saved', 'catalog'] : ['saved']),
    };
    searchRequest.current = request;
    if (!keepResults) setSearchState({ status: 'pending' });
    setSavedLoading(true);
    if (scope !== 'catalog') setCatalogState({ status: 'idle' });
    else if (!keepResults) setCatalogState({ status: 'pending' });
    setCatalogLoading(scope === 'catalog');

    const fetchResults = async (kind: ResultKind) => {
      const setResult = kind === 'saved' ? setSearchState : setCatalogState;
      try {
        const results = await api.search(query, request.controller.signal, kind, scope === 'shelf' ? shelf : undefined, 0, searchSort.current);
        if (!request.controller.signal.aborted) setResult({ status: 'ready', results });
      } catch {
        if (!request.controller.signal.aborted) setResult({ status: 'error' });
      } finally {
        if (searchRequest.current === request) {
          if (kind === 'catalog') setCatalogLoading(false);
          else setSavedLoading(false);
          request.pending.delete(kind);
          if (!request.pending.size) searchRequest.current = null;
        }
      }
    };
    const start = () => {
      void fetchResults('saved');
      if (scope === 'catalog') void fetchResults('catalog');
    };
    if (delay) request.timer = window.setTimeout(start, delay);
    else start();
  };

  const loadMore = async (kind: ResultKind, offset: number) => {
    if (pageRequests.current[kind] || searchRequest.current?.pending.has(kind)) return;
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
    setSaveErrors({});
    runSearch(value, { delay: 400 });
  };

  const showShelf = (view: Shelf) => {
    const previous = searchSettings.current.shelf;
    searchSettings.current.shelf = view;
    setShelfRequest(request => request.view === view ? request : { view, revision: request.revision + 1 });
    if (previous !== view && searchSettings.current.scope === 'shelf') runSearch(latestQuery.current);
  };

  const changeScope = (scope: SearchScope) => {
    if (searchSettings.current.scope === scope) return;
    searchSettings.current.scope = scope;
    setSearchScope(scope);
    if (scope !== 'catalog') setSaveShelfOverride(undefined);
    runSearch(latestQuery.current);
  };

  const focusSearch = () => {
    window.requestAnimationFrame(() => searchInput.current?.focus());
  };

  const openNameSearch = (query?: string) => {
    if (query) {
      searchSettings.current.scope = 'catalog';
      setSearchScope('catalog');
      changeSearch(query);
    } else {
      changeScope('catalog');
    }
    focusSearch();
  };

  const refreshLibrary = (updatedArtwork?: Album) => {
    if (updatedArtwork) {
      const revision = Date.now();
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
      if (addition && !local.some(album => album.id === albumId)) local.push(addition.album);
      return {
        status: 'ready',
        results: { ...current.results, local: scope === 'shelf' ? local.filter(album => album.status === shelf) : local },
      };
    });
    setCatalogState(current => {
      if (current.status !== 'ready') return current;
      return {
        status: 'ready',
        results: {
          ...current.results,
          discogs: current.results.discogs.map(match =>
            match.existingAlbumId === albumId || (addition && catalogKey(match) === addition.key)
              ? {
                  ...match,
                  existingAlbumId: albumId,
                  inCollection: status === 'collection',
                  inWishlist: status === 'wishlist',
                }
              : match),
        },
      };
    });
  };

  const saveRecord = async (key: string, action: SaveAction, save: () => Promise<void>) => {
    if (inFlightSaves.current.has(key)) return false;
    inFlightSaves.current.add(key);
    setPendingSaves(prev => ({ ...prev, [key]: action }));
    setSaveErrors(prev => ({ ...prev, [key]: '' }));
    try {
      await save();
      refreshShelf();
      // A search that started before this save can carry the old membership. Deletion always needs a
      // refresh because there may be other saved records matching the same catalog result.
      if (searchRequest.current || Object.keys(pageRequests.current).length || action === 'remove' || searchSettings.current.scope === 'shelf') {
        runSearch(latestQuery.current, { keepResults: true });
      }
      return true;
    } catch (error) {
      const stale = error instanceof Error && 'status' in error && error.status === 409;
      setSaveErrors(prev => ({
        ...prev,
        [key]: stale
          ? 'This album changed since you opened it. Check its current shelf and try again.'
          : error instanceof Error ? error.message : 'Could not save this change. Try again.',
      }));
      if (stale) {
        setLastShelfMove(current => current && savedAlbumKey(current.albumId) === key ? null : current);
        toast.error('This album changed since you opened it. Check its current shelf.');
        refreshLibrary();
      }
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
        discogsId: album.discogsId,
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
    });
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

  const moveScannedAlbum = async (albumId: number, title: string) => {
    const moved = await moveWishlistAlbum(albumId, title);
    if (moved) window.requestAnimationFrame(() => undoButton.current?.focus());
    else toast.error('Could not move the album. Check its current shelf and try again.');
    return moved;
  };

  const openSavedAlbum = async (albumId: number, closeLookup?: () => void) => {
    if (openingSavedAlbum.current) return;
    openingSavedAlbum.current = true;
    try {
      const { album } = await api.getAlbum(albumId);
      closeLookup?.();
      setSelectedAlbum(album);
    } catch {
      toast.error('Could not open this saved album. Check its shelf and try again.');
    } finally {
      openingSavedAlbum.current = false;
    }
  };

  const moveAlbum = async (album: Album, button: HTMLButtonElement, fromDetails: boolean) => {
    const hadFocus = button.ownerDocument.activeElement === button;
    const to = album.status === 'collection' ? 'wishlist' : 'collection';
    const saved = await moveRecord({ albumId: album.id, title: album.title, from: album.status, to });
    if (!saved) return;

    if (fromDetails) setSelectedAlbum(current => current?.id === album.id ? null : current);
    if (hadFocus || fromDetails) {
      window.requestAnimationFrame(() => {
        undoButton.current?.focus();
      });
    }
  };

  const closeRemoval = () => {
    if (!albumToRemove || inFlightSaves.current.has(savedAlbumKey(albumToRemove.id))) return;
    setAlbumToRemove(null);
  };

  const removeAlbum = async (album: Album) => {
    const key = savedAlbumKey(album.id);
    const removed = await saveRecord(key, 'remove', async () => {
      await api.deleteAlbum(album.id, album.status);
      excludeFromShelf(album.id);
      setSearchState(current => current.status === 'ready'
        ? { ...current, results: { ...current.results, local: current.results.local.filter(result => result.id !== album.id) } }
        : current);
    });
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
  const shelfAlbums = currentShelf?.status === 'ready' ? currentShelf.albums : [];
  const sortedAlbums = [...(results?.local ?? shelfAlbums)].sort((first, second) => {
    if (sortBy === 'artist') return first.artist_name.localeCompare(second.artist_name);
    if (sortBy === 'date') return new Date(second.added_at).getTime() - new Date(first.added_at).getTime();
    return first.title.localeCompare(second.title);
  });

  const renderSort = (label: string) => (
    <div className="ml-auto flex items-center gap-2">
      <label htmlFor="sort-select" className="text-sm text-gray-600">{label}</label>
      <select
        id="sort-select"
        value={sortBy}
        onChange={event => {
          const next = event.target.value as SortBy;
          searchSort.current = next;
          setSortBy(next);
          if (searchActive) runSearch(latestQuery.current, { keepResults: true });
        }}
        className="min-h-11 rounded-lg border border-gray-300 bg-white px-2.5"
      >
        <option value="title">Album title</option>
        <option value="artist">Artist name</option>
        <option value="date">Date added</option>
      </select>
    </div>
  );

  const renderShelfActions = (album: Album, fromDetails = false) => {
    const key = savedAlbumKey(album.id);
    const pending = pendingSaves[key];
    const inWishlist = album.status === 'wishlist';
    const moveLabel = inWishlist ? 'Move to Collection' : 'Move to Wishlist';
    const move = (
      <button
          type="button"
          className={inWishlist && !fromDetails ? 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100' : secondaryButton}
          aria-label={`${moveLabel} — ${album.title}`}
          aria-disabled={!!pending}
          aria-busy={!!pending && pending !== 'remove'}
          onClick={event => void moveAlbum(album, event.currentTarget, fromDetails)}
        >
          {pending && pending !== 'remove' ? 'Moving…' : moveLabel}
      </button>
    );
    const remove = (
      <button
            type="button"
            className="min-h-11 rounded-lg px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            aria-label={`Remove from ${shelfLabel[album.status]} — ${album.title}`}
            aria-haspopup="dialog"
            aria-disabled={!!pending}
            onClick={() => {
              if (inFlightSaves.current.has(key)) return;
              setSaveErrors(prev => ({ ...prev, [key]: '' }));
              setAlbumToRemove(album);
            }}
          >
            Remove from {shelfLabel[album.status]}
      </button>
    );
    return (
      <div className="grid gap-1.5">
        {fromDetails ? <>{move}{remove}</> : (
          <>
            <p className="px-1 text-xs text-gray-600" aria-label={`${album.title} is in ${shelfLabel[album.status]}`}>{shelfLabel[album.status]}</p>
            {inWishlist && move}
            <details className="min-w-0">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-1 rounded-lg px-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
                aria-label={`Shelf actions for ${album.title}`}>
                Actions
                <svg aria-hidden="true" className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth="2" d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="grid gap-1.5">
                {!inWishlist && move}
                {remove}
              </div>
            </details>
          </>
        )}
        {saveErrors[key] && <p role="alert" className="px-1 text-xs text-red-600">{saveErrors[key]}</p>}
      </div>
    );
  };

  const renderSavedAlbums = () => (
    <div className={albumGrid}>
      {sortedAlbums.map(album => {
        const revision = artworkRevisions[album.id] ?? libraryArtworkRevision;
        const src = `${getCoverArtUrl(album.id)}${revision ? `?v=${revision}` : ''}`;
        const key = savedAlbumKey(album.id);
        const pending = pendingSaves[key];
        return (
          <article key={album.id} className="rh-album-card relative flex flex-col rounded-xl border border-gray-200">
            <div className="rh-album-cover flex aspect-square items-center justify-center overflow-hidden">
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
            <AlbumMeta title={album.title} artist={album.artist_name} year={album.year} />
            <button
              type="button"
              className="absolute inset-0 z-10 cursor-pointer rounded-[inherit]"
              aria-label={`Open ${album.title} by ${album.artist_name}`}
              aria-haspopup="dialog"
              aria-disabled={!!pending}
              onClick={() => {
                if (!inFlightSaves.current.has(key)) setSelectedAlbum(album);
              }}
            />
            <div className="relative z-20 mt-auto grid gap-1.5 p-2 pt-0">
              {renderShelfActions(album)}
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
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <p role="status">{more !== undefined ? `Showing the first ${count} matches. More are available.` : `Showing ${count} ${count === 1 ? 'match' : 'matches'}.`}
          {kind === 'catalog' && data.catalogSampled && more === undefined && ' Refine your search for more catalog matches.'}
        </p>
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div className="rh-shelf-controls flex items-center gap-2">
              <div className="rh-view-switcher flex" role="group" aria-label="Library view">
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
                {searchActive ? (
                  <>
                    {searchState.status === 'pending' && 'Searching saved albums…'}
                    {searchState.status === 'error' && 'Saved search unavailable'}
                    {results && <span>{savedCount}{results.nextOffset !== undefined ? '+' : ''} saved {savedCount === 1 ? 'match' : 'matches'}</span>}
                  </>
                ) : currentShelf?.status === 'ready' && (
                  <span>{shelfAlbums.length} {shelfAlbums.length === 1 ? 'album' : 'albums'} in {shelfLabel[viewMode]}</span>
                )}
              </div>
              {searchActive ? (
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg px-1 text-sm font-medium text-purple-600 hover:bg-gray-100"
                  onClick={() => {
                    changeSearch('');
                    activeShelfButton.current?.focus();
                  }}
                >
                  Back to {shelfLabel[viewMode]}
                </button>
              ) : renderSort('Sort')}
            </div>
          </div>
        </div>
      </header>

      <main className="rh-main rh-shell mx-auto px-6 py-3 sm:py-6">
        <div className="rh-command-bar" id="search-controls">
          <form
            role="search"
            className="min-w-0 flex-1"
            onSubmit={event => {
              event.preventDefault();
              runSearch(searchQuery);
            }}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor="search-scope" className="text-xs text-gray-600 sm:text-sm">Search in</label>
              <select
                id="search-scope"
                value={searchScope}
                onChange={event => changeScope(event.target.value as SearchScope)}
                className="max-w-full rounded-lg border border-gray-300 px-2 text-sm"
              >
                <option value="saved">All saved albums</option>
                <option value="shelf">This shelf · {shelfLabel[viewMode]}</option>
                <option value="catalog">Saved albums and catalogs</option>
              </select>
            </div>
            <label htmlFor="album-search" className="sr-only">Search albums</label>
            <div className="flex gap-1.5 sm:gap-2">
              <div className="rh-search relative min-w-0 flex-1">
                <input
                  ref={searchInput}
                  id="album-search"
                  type="text"
                  enterKeyHint="search"
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
            {saveErrors[savedAlbumKey(lastShelfMove.albumId)] && (
              <p role="alert" className="mt-1 text-xs text-red-600">{saveErrors[savedAlbumKey(lastShelfMove.albumId)]}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                ref={undoButton}
                type="button"
                className={secondaryButton}
                aria-disabled={!!pendingSaves[savedAlbumKey(lastShelfMove.albumId)]}
                aria-busy={!!pendingSaves[savedAlbumKey(lastShelfMove.albumId)]}
                onClick={() => void moveRecord({
                  ...lastShelfMove,
                  from: lastShelfMove.to,
                  to: lastShelfMove.from,
                }, lastShelfMove)}
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
          <nav className="rh-result-nav" aria-label="Search shortcuts">
            <button type="button" onClick={focusSearch}>Back to search</button>
            {!!savedCount && <a href="#saved-results-title">Saved matches</a>}
            {searchScope === 'catalog' && <a href="#catalog-results-title">Catalogs</a>}
          </nav>
        )}

        {searchState.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3 py-5">
            <p role="alert" className="text-sm">Saved album search couldn’t finish.</p>
            <button type="button" className={secondaryButton} onClick={() => {
              focusSearch();
              runSearch(searchQuery, { keepResults: true });
            }}>Retry saved search</button>
          </div>
        )}

        {results && (
          savedCount ? (
            <section className="mb-8" aria-labelledby="saved-results-title">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 id="saved-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">Saved albums</h2>
                <p className="text-sm text-gray-600">{searchScope === 'shelf' ? shelfLabel[viewMode] : 'Both shelves'}</p>
                {renderSort('Sort')}
              </div>
              {renderSavedAlbums()}
              {renderContinuation('saved', results)}
            </section>
          ) : (
            <div className="py-6" role="status">
              <p className="text-sm text-gray-600">No saved albums match “{searchQuery.trim()}”.</p>
              {searchScope !== 'catalog' && (
                <button type="button" className="mt-2 min-h-11 rounded-lg px-2 text-sm font-medium text-purple-600 hover:bg-gray-100" onClick={() => {
                  changeScope('catalog');
                  focusSearch();
                }}>
                  Search catalogs too
                </button>
              )}
            </div>
          )
        )}

        {searchActive && searchScope === 'catalog' && (
          <section aria-labelledby="catalog-results-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 id="catalog-results-title" tabIndex={-1} className="rh-result-heading text-lg font-semibold">Catalog albums</h2>
                <p className="text-sm text-gray-600">Save an album to your library. Open its source listing for pressing details.</p>
              </div>
              <label className="flex max-w-full flex-wrap items-center gap-2 text-sm text-gray-600">
                Default save shelf
                <select
                  value={saveShelfOverride ?? 'shelf'}
                  onChange={event => {
                    const value = event.target.value;
                    setSaveShelfOverride(value === 'collection' || value === 'wishlist' ? value : undefined);
                  }}
                  className="min-h-11 rounded-lg border border-gray-300 px-2.5"
                >
                  <option value="shelf">Current shelf · {shelfLabel[viewMode]}</option>
                  {shelves.map(shelf => <option key={shelf} value={shelf}>{shelfLabel[shelf]}</option>)}
                </select>
              </label>
            </div>
            {catalogLoading && <p role="status" className="mb-3 text-sm text-gray-600">Searching catalogs…</p>}
            {(catalogState.status === 'error' || !!catalogResults?.errors?.length) && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 p-3">
                <p role="status" className="text-sm">Some catalog results are temporarily unavailable.</p>
                <button type="button" className={secondaryButton} disabled={catalogLoading} onClick={() => {
                  focusSearch();
                  runSearch(searchQuery, { keepResults: true });
                }}>Retry catalogs</button>
              </div>
            )}
            {catalogResults && !catalogCount && !catalogResults.errors?.length && (
              <p role="status" className="mb-3 text-sm text-gray-600">No catalog albums match “{searchQuery.trim()}”.</p>
            )}
            {!!catalogCount && catalogResults && (
                <div className={`rh-catalog-grid ${albumGrid}`}>
                  {catalogResults.discogs.map(album => {
                    const key = catalogKey(album);
                    const savedShelf = album.inCollection ? 'collection' : album.inWishlist ? 'wishlist' : undefined;
                    const albumId = album.existingAlbumId;
                    const saveKey = albumId == null ? key : savedAlbumKey(albumId);
                    const pending = pendingSaves[saveKey];
                    const source = catalogSource(album);
                    return (
                      <article key={key} className="rh-album-card rh-catalog-card rounded-xl border border-gray-200">
                        <div className="rh-album-cover rh-catalog-cover flex aspect-square items-center justify-center overflow-hidden">
                          <AlbumCover key={album.coverImageUrl} src={album.coverImageUrl} />
                        </div>
                        <details className="rh-catalog-details">
                          <summary aria-label={`Album information for ${album.album} by ${album.artist}`}>
                            <span className="min-w-0">
                              <span className="rh-catalog-title line-clamp-2 text-sm font-semibold">{album.album}</span>
                              <span className="rh-catalog-artist mt-0.5 block truncate text-xs text-gray-600">{album.artist}</span>
                              {album.year ? <span className="mt-0.5 block text-xs text-gray-400">{album.year}</span> : null}
                            </span>
                            <svg aria-hidden="true" className="rh-catalog-chevron size-4 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                            </svg>
                          </summary>
                          {source?.url ? (
                            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-3 text-sm text-purple-600 underline underline-offset-4">
                              View on {source.label}
                            </a>
                          ) : source && (
                            <p className="px-3 pb-2 text-xs text-gray-600">Album information from {source.label}</p>
                          )}
                          {!savedShelf && (
                            <button type="button" className="block min-h-11 w-full px-3 text-left text-xs font-semibold text-gray-600 hover:bg-gray-100"
                              disabled={!!pending}
                              aria-label={`Add ${album.album} to ${shelfLabel[saveShelf === 'collection' ? 'wishlist' : 'collection']}`}
                              onClick={() => void handleCatalogAdd(album, saveShelf === 'collection' ? 'wishlist' : 'collection')}>
                              Add to {shelfLabel[saveShelf === 'collection' ? 'wishlist' : 'collection']}
                            </button>
                          )}
                        </details>
                        <div className="rh-catalog-actions grid gap-1.5 p-2 pt-0">
                          <SaveDestinationActions
                            albumTitle={album.album}
                            preferred={saveShelf}
                            existingStatus={savedShelf}
                            canMove={savedShelf === 'wishlist' && albumId != null}
                            primaryOnly
                            pending={pending === 'remove' ? undefined : pending}
                            disabled={pending === 'remove'}
                            onOpenSaved={albumId != null ? () => void openSavedAlbum(albumId) : undefined}
                            onSelect={action => {
                              if (action === 'move') {
                                if (albumId != null) void moveWishlistAlbum(albumId, album.album);
                              } else {
                                void handleCatalogAdd(album, action);
                              }
                            }}
                          />
                          {saveErrors[saveKey] && (
                            <p role="alert" className="px-1 text-xs text-red-600">{saveErrors[saveKey]}</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
            )}
            {!!catalogCount && catalogResults && renderContinuation('catalog', catalogResults)}
          </section>
        )}

        {!searchActive && currentShelf?.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3 py-5">
            <p role="alert" className="text-sm">Couldn’t load {shelfLabel[viewMode]}.</p>
            <button type="button" className={secondaryButton} onClick={refreshShelf}>Retry</button>
          </div>
        )}
        {!searchActive && currentShelf?.status === 'ready' && (
          sortedAlbums.length ? renderSavedAlbums() : (
            <div className="py-10 text-center">
              <h2 className="text-lg font-semibold">Your {shelfLabel[viewMode].toLowerCase()} is empty</h2>
              <p className="mt-1 text-sm text-gray-600">Search for a record or choose Add Album to get started.</p>
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
            setShowBarcodeScanner(true);
          }}
          onImageClick={() => {
            setShowAddMenu(false);
            setShowImageUploader(true);
          }}
          onSearchClick={() => {
            setShowAddMenu(false);
            openNameSearch();
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
          onSearchByName={() => {
            setShowBarcodeScanner(false);
            openNameSearch();
          }}
          onMoveSaved={moveScannedAlbum}
          onOpenSaved={id => openSavedAlbum(id, () => setShowBarcodeScanner(false))}
          onSuccess={() => {
            refreshLibrary();
            setShowBarcodeScanner(false);
          }}
          viewMode={viewMode}
        />
      )}

      {showImageUploader && (
        <ImageUploader
          onClose={() => setShowImageUploader(false)}
          onSearchByName={query => {
            setShowImageUploader(false);
            openNameSearch(query);
          }}
          onMoveSaved={moveScannedAlbum}
          onOpenSaved={id => openSavedAlbum(id, () => setShowImageUploader(false))}
          onSuccess={() => {
            refreshLibrary();
            setShowImageUploader(false);
          }}
          viewMode={viewMode}
        />
      )}

      {albumToRemove && (
        <ModalDialog labelledBy="album-removal-title" onClose={closeRemoval}>
          <div className="rh-dialog-panel max-w-md p-4 sm:p-6">
            <h2 id="album-removal-title" className="text-lg font-semibold">Remove from {shelfLabel[albumToRemove.status]}?</h2>
            <p className="mt-2 text-sm text-gray-600 [overflow-wrap:anywhere]">
              “{albumToRemove.title}” and any notes saved with it will be removed from your {shelfLabel[albumToRemove.status]}.
            </p>
            {saveErrors[savedAlbumKey(albumToRemove.id)] && (
              <p className="mt-3 text-sm text-red-600" role="alert">{saveErrors[savedAlbumKey(albumToRemove.id)]}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={secondaryButton}
                aria-disabled={!!pendingSaves[savedAlbumKey(albumToRemove.id)]}
                onClick={closeRemoval}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-semibold rh-filled-action"
                aria-disabled={!!pendingSaves[savedAlbumKey(albumToRemove.id)]}
                aria-busy={!!pendingSaves[savedAlbumKey(albumToRemove.id)]}
                onClick={() => void removeAlbum(albumToRemove)}
              >
                {pendingSaves[savedAlbumKey(albumToRemove.id)] ? 'Removing…' : 'Remove album'}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          onClose={() => {
            if (!inFlightSaves.current.has(savedAlbumKey(selectedAlbum.id))) setSelectedAlbum(null);
          }}
          onRefresh={refreshLibrary}
          shelfActions={renderShelfActions(selectedAlbum, true)}
        />
      )}
    </div>
  );
}

export default App;
