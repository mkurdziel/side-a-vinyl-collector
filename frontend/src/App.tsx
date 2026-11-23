import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { type Album, type DiscogsAlbum, type SearchResult, getCoverArtUrl } from './services/api';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';
import { SettingsModal } from './components/SettingsModal';

type Shelf = Album['status'];
type SortBy = 'title' | 'artist' | 'date';
type ShelfRequest = { view: Shelf; revision: number };
type ShelfResult = { request: ShelfRequest } & (
  { status: 'ready'; albums: Album[] } | { status: 'error' }
);
type SearchState =
  | { status: 'idle' | 'pending' | 'error' }
  | { status: 'ready'; results: SearchResult };
type SearchRequest = { controller: AbortController; timer?: number };

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
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [showDiscogsImporter, setShowDiscogsImporter] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [discogsConfigured, setDiscogsConfigured] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<Record<string, Shelf>>({});
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [artworkRevisions, setArtworkRevisions] = useState<Record<number, number>>({});
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const saved = localStorage.getItem('albumSortBy');
    return saved === 'artist' || saved === 'date' ? saved : 'title';
  });
  const inFlightAdds = useRef(new Set<string>());
  const searchRequest = useRef<SearchRequest | null>(null);
  const latestQuery = useRef('');
  const searchInput = useRef<HTMLInputElement>(null);

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
      .catch(error => console.error('Failed to check Discogs config:', error));
    return () => { active = false; };
  }, []);

  useEffect(() => () => cancelSearch(searchRequest.current), []);

  const refreshShelf = () => setShelfRequest(request => ({ ...request, revision: request.revision + 1 }));

  const runSearch = (value: string, { delay = 0, keepResults = false } = {}) => {
    cancelSearch(searchRequest.current);
    searchRequest.current = null;
    const query = value.trim();
    if (query.length < 2) {
      setSearchState({ status: 'idle' });
      return;
    }

    const request: SearchRequest = { controller: new AbortController() };
    searchRequest.current = request;
    if (!keepResults) setSearchState({ status: 'pending' });

    const fetchResults = async () => {
      try {
        const results = await api.search(query, request.controller.signal);
        if (!request.controller.signal.aborted) setSearchState({ status: 'ready', results });
      } catch {
        if (!request.controller.signal.aborted) setSearchState({ status: 'error' });
      } finally {
        if (searchRequest.current === request) searchRequest.current = null;
      }
    };
    if (delay) request.timer = window.setTimeout(fetchResults, delay);
    else void fetchResults();
  };

  const changeSearch = (value: string) => {
    latestQuery.current = value;
    setSearchQuery(value);
    setAddErrors({});
    runSearch(value, { delay: 400 });
  };

  const showShelf = (view: Shelf) => {
    if (view === viewMode && !searchQuery) return;
    changeSearch('');
    if (view !== viewMode) setShelfRequest({ view, revision: shelfRequest.revision + 1 });
  };

  const refreshLibrary = (updatedArtwork?: Album) => {
    if (updatedArtwork) {
      const revision = Date.now();
      setArtworkRevisions(prev => ({ ...prev, [updatedArtwork.id]: revision }));
    }
    refreshShelf();
    if (latestQuery.current.trim().length >= 2) runSearch(latestQuery.current, { keepResults: true });
  };

  const handleCatalogAdd = async (album: DiscogsAlbum, destination: Shelf) => {
    const key = catalogKey(album);
    if (inFlightAdds.current.has(key)) return;
    inFlightAdds.current.add(key);
    setPendingAdds(prev => ({ ...prev, [key]: destination }));
    setAddErrors(prev => ({ ...prev, [key]: '' }));
    try {
      const { album: saved } = await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        discogsId: album.discogsId,
        status: destination,
      });
      setSearchState(current => {
        if (current.status !== 'ready' || !current.results.discogs.some(match => catalogKey(match) === key)) {
          return current;
        }
        const { local, discogs } = current.results;
        return {
          status: 'ready',
          results: {
            ...current.results,
            local: local.some(match => match.id === saved.id) ? local : [...local, saved],
            discogs: discogs.map(match => catalogKey(match) !== key ? match : {
              ...match,
              inCollection: destination === 'collection',
              inWishlist: destination === 'wishlist',
            }),
          },
        };
      });
      toast.success(`“${album.album}” added to ${shelfLabel[destination]}.`);
      refreshShelf();
      // A search that started before this save can carry the old membership.
      if (searchRequest.current) runSearch(latestQuery.current, { keepResults: true });
    } catch (error) {
      setAddErrors(prev => ({
        ...prev,
        [key]: error instanceof Error ? error.message : 'Could not add this album. Try again.',
      }));
    } finally {
      inFlightAdds.current.delete(key);
      setPendingAdds(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleRemove = async (album: Album) => {
    const moveToWishlist = album.status === 'collection';
    const message = moveToWishlist
      ? `Move “${album.title}” from Collection to Wishlist?`
      : `Remove “${album.title}” from Wishlist?`;
    if (!confirm(message)) return;

    try {
      if (moveToWishlist) await api.updateStatus(album.id, 'wishlist');
      else await api.deleteAlbum(album.id);
      toast.success(moveToWishlist
        ? `“${album.title}” moved to Wishlist.`
        : `“${album.title}” removed from Wishlist.`);
      refreshLibrary();
    } catch {
      toast.error(moveToWishlist ? 'Could not move this album.' : 'Could not remove this album.');
    }
  };

  const results = searchState.status === 'ready' ? searchState.results : null;
  const queryLength = searchQuery.trim().length;
  const shelfAlbums = currentShelf?.status === 'ready' ? currentShelf.albums : [];
  const sortedAlbums = [...(results?.local ?? shelfAlbums)].sort((first, second) => {
    if (sortBy === 'artist') return first.artist_name.localeCompare(second.artist_name);
    if (sortBy === 'date') return new Date(second.added_at).getTime() - new Date(first.added_at).getTime();
    return first.title.localeCompare(second.title);
  });

  const renderSavedAlbums = () => (
    <div className={albumGrid}>
      {sortedAlbums.map(album => {
        const revision = artworkRevisions[album.id];
        const src = `${getCoverArtUrl(album.id)}${revision ? `?v=${revision}` : ''}`;
        const quickAction = album.status === 'collection' ? 'Move to Wishlist' : 'Remove from Wishlist';
        return (
          <article key={album.id} className="rh-album-card relative rounded-xl border border-gray-200">
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
            {results && (
              <span className="mb-3 ml-3 inline-block rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-900">
                In {shelfLabel[album.status]}
              </span>
            )}
            <button
              type="button"
              className="absolute inset-0 z-10 cursor-pointer rounded-[inherit]"
              aria-label={`Open ${album.title} by ${album.artist_name}`}
              aria-haspopup="dialog"
              onClick={() => setSelectedAlbum(album)}
            />
            <button
              type="button"
              className="rh-album-quick-action absolute right-1 top-1 z-20 grid size-11 place-items-center rounded-lg border border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-50"
              aria-label={`${quickAction} — ${album.title}`}
              title={quickAction}
              onClick={() => void handleRemove(album)}
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {album.status === 'collection' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                )}
              </svg>
            </button>
          </article>
        );
      })}
    </div>
  );

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
          <div className="mb-4 flex items-center justify-between gap-4">
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

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="rh-view-switcher flex" role="group" aria-label="Library view">
              {shelves.map(shelf => (
                <button
                  key={shelf}
                  type="button"
                  className="rh-view-tab text-sm font-medium text-gray-500 transition-colors"
                  onClick={() => showShelf(shelf)}
                  aria-pressed={viewMode === shelf}
                >
                  {shelfLabel[shelf]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-1">
              <div className="rh-library-count text-sm" aria-live="polite">
                {currentShelf?.status === 'ready' && (
                  <span>{shelfAlbums.length} {shelfAlbums.length === 1 ? 'album' : 'albums'} in {shelfLabel[viewMode]}</span>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label htmlFor="sort-select" className="text-sm text-gray-600">Sort</label>
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={event => setSortBy(event.target.value as SortBy)}
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-2.5"
                >
                  <option value="title">Album title</option>
                  <option value="artist">Artist name</option>
                  <option value="date">Date added</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="rh-main rh-shell mx-auto px-6 py-5 sm:py-6">
        <div className="rh-command-bar flex flex-col gap-2 sm:flex-row">
          <form
            role="search"
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={event => {
              event.preventDefault();
              runSearch(searchQuery);
            }}
          >
            <div className="rh-search relative min-w-0 flex-1">
              <label htmlFor="album-search" className="sr-only">Search saved albums and catalogs</label>
              <input
                ref={searchInput}
                id="album-search"
                type="text"
                enterKeyHint="search"
                className={`w-full border px-3 py-2 ${searchQuery ? 'pr-12' : ''}`}
                placeholder="Album or artist"
                value={searchQuery}
                onChange={event => changeSearch(event.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
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
            <button type="submit" className={`${secondaryButton} disabled:opacity-60`} disabled={queryLength < 2}>
              Search
            </button>
          </form>
          <button
            type="button"
            className="rh-primary-action flex shrink-0 items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
            aria-haspopup="dialog"
            onClick={() => setShowAddMenu(true)}
          >
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Album
          </button>
        </div>

        <div role="status" className="text-sm text-gray-600" aria-atomic="true">
          {queryLength === 1 && <p className="mb-4">Enter at least two characters to search.</p>}
          {searchState.status === 'pending' && <p className="py-8">Searching your library and catalogs…</p>}
          {results && (results.local.length || results.discogs.length) ? (
            <p className="mb-4">
              {results.local.length} saved {results.local.length === 1 ? 'album' : 'albums'} · {results.discogs.length} catalog {results.discogs.length === 1 ? 'match' : 'matches'}
            </p>
          ) : null}
          {queryLength < 2 && !currentShelf && <p className="py-8">Loading {shelfLabel[viewMode]}…</p>}
        </div>

        {searchState.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3 py-5">
            <p role="alert" className="text-sm">Search couldn’t finish.</p>
            <button type="button" className={secondaryButton} onClick={() => runSearch(searchQuery)}>Retry search</button>
          </div>
        )}

        {results && (
          <div className="space-y-8">
            {results.errors?.length ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 p-3">
                <p role="status" className="text-sm">Some catalog results are temporarily unavailable.</p>
                <button type="button" className={secondaryButton} onClick={() => runSearch(searchQuery)}>Retry search</button>
              </div>
            ) : null}
            {!results.local.length && !results.discogs.length && !results.errors?.length && (
              <div className="py-10 text-center" role="status">
                <h2 className="text-lg font-semibold">No matches for “{searchQuery.trim()}”</h2>
                <p className="mt-1 text-sm text-gray-600">Check the spelling or try a different album or artist.</p>
              </div>
            )}
            {!!results.local.length && (
              <section aria-labelledby="saved-results-title">
                <h2 id="saved-results-title" className="mb-3 text-lg font-semibold">Saved albums</h2>
                {renderSavedAlbums()}
              </section>
            )}
            {!!results.discogs.length && (
              <section aria-labelledby="catalog-results-title">
                <h2 id="catalog-results-title" className="mb-3 text-lg font-semibold">Catalog matches</h2>
                <div className={albumGrid}>
                  {results.discogs.map(album => {
                    const key = catalogKey(album);
                    const savedShelf = album.inCollection ? 'collection' : album.inWishlist ? 'wishlist' : null;
                    const pending = pendingAdds[key];
                    return (
                      <article key={key} className="rh-album-card flex flex-col rounded-xl border border-gray-200">
                        <div className="rh-album-cover flex aspect-square items-center justify-center overflow-hidden">
                          <AlbumCover key={album.coverImageUrl} src={album.coverImageUrl} />
                        </div>
                        <AlbumMeta title={album.album} artist={album.artist} year={album.year} />
                        <div className="mt-auto grid gap-1.5 p-2 pt-0">
                          {shelves.map(destination => {
                            if (savedShelf && savedShelf !== destination) return null;
                            const label = shelfLabel[destination];
                            return (
                              <button
                                key={destination}
                                type="button"
                                aria-disabled={!!pending || !!savedShelf}
                                aria-busy={pending === destination}
                                tabIndex={savedShelf ? -1 : undefined}
                                aria-label={savedShelf ? `${album.album} is in ${label}` : `Add ${album.album} to ${label}`}
                                className={`min-h-11 rounded-lg border px-1 text-xs font-semibold transition-colors ${savedShelf
                                  ? 'border-gray-300 text-gray-600'
                                  : destination === viewMode
                                    ? 'border-transparent bg-purple-600 text-[var(--rh-ink-inverse)] hover:bg-purple-700'
                                    : 'border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-50'}`}
                                onClick={() => {
                                  if (!savedShelf) void handleCatalogAdd(album, destination);
                                }}
                              >
                                {savedShelf ? `In ${label}` : pending === destination ? 'Adding…' : `Add to ${label}`}
                              </button>
                            );
                          })}
                          {addErrors[key] && (
                            <p role="alert" className="px-1 text-xs text-red-600">{addErrors[key]}</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {queryLength < 2 && currentShelf?.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3 py-5">
            <p role="alert" className="text-sm">Couldn’t load {shelfLabel[viewMode]}.</p>
            <button type="button" className={secondaryButton} onClick={refreshShelf}>Retry</button>
          </div>
        )}
        {queryLength < 2 && currentShelf?.status === 'ready' && (
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
            window.requestAnimationFrame(() => searchInput.current?.focus());
          }}
          onImportClick={() => {
            setShowAddMenu(false);
            setShowDiscogsImporter(true);
          }}
          onClose={() => setShowAddMenu(false)}
          discogsConfigured={discogsConfigured}
          viewMode={viewMode}
        />
      )}

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => setShowBarcodeScanner(false)}
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
          onSuccess={() => {
            refreshLibrary();
            setShowImageUploader(false);
          }}
          viewMode={viewMode}
        />
      )}

      {showDiscogsImporter && (
        <DiscogsImporter
          onClose={() => setShowDiscogsImporter(false)}
          onSuccess={refreshLibrary}
          viewMode={viewMode}
        />
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onRefresh={refreshLibrary}
        />
      )}
    </div>
  );
}

export default App;
