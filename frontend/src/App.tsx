import { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { type Album, type DiscogsAlbum, getCoverArtUrl } from './services/api';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';
import { SettingsModal } from './components/SettingsModal';


function App() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ local: Album[]; discogs: DiscogsAlbum[] } | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [showDiscogsImporter, setShowDiscogsImporter] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [discogsConfigured, setDiscogsConfigured] = useState(false);
  const [viewMode, setViewMode] = useState<'collection' | 'wishlist'>('collection');
  const [addedAlbums, setAddedAlbums] = useState<Set<string | number>>(new Set());
  const searchTimeoutRef = useRef<number | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'artist' | 'date'>(() => {
    const saved = localStorage.getItem('albumSortBy');
    return (saved as 'title' | 'artist' | 'date') || 'title';
  });

  // Save sort preference to localStorage
  useEffect(() => {
    localStorage.setItem('albumSortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    loadAlbums();
    checkDiscogsConfig();
  }, [viewMode]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const checkDiscogsConfig = async () => {
    try {
      const config = await api.checkDiscogsConfig();
      setDiscogsConfigured(config.configured);
    } catch (error) {
      console.error('Failed to check Discogs config:', error);
    }
  };

  const loadAlbums = async () => {
    try {
      const data = await api.getAlbums(viewMode);
      setAlbums(data.albums);
    } catch (error) {
      toast.error('Failed to load albums');
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    try {
      const results = await api.search(query);
      setSearchResults(results);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If query is empty or too short, clear results immediately
    if (query.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    // Debounce the actual search API call
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 500); // 500ms delay
  };

  const handleAddFromDiscogs = async (album: DiscogsAlbum, targetStatus: 'collection' | 'wishlist') => {
    try {
      await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        discogsId: album.discogsId,
        status: targetStatus,
      });
      
      toast.success(`Album added to ${targetStatus}`);
      
      // Update local state to show "Added" in UI without reload
      setAddedAlbums(prev => {
        const next = new Set(prev);
        next.add(album.coverImageUrl || album.discogsId);
        return next;
      });
      
      // Silently refresh main list in background
      loadAlbums(); 
    } catch (error: any) {
      toast.error(error.message || 'Failed to add album');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this album from your collection?')) return;

    try {
      await api.deleteAlbum(id);
      toast.success('Album removed');
      loadAlbums();
    } catch (error) {
      toast.error('Failed to remove album');
    }
  };

  const displayAlbums = searchResults ? searchResults.local : albums;

  // Sort albums based on selected criteria
  const sortAlbums = (albumsToSort: typeof albums) => {
    const sorted = [...albumsToSort];
    switch (sortBy) {
      case 'artist':
        return sorted.sort((a, b) => a.artist_name.localeCompare(b.artist_name));
      case 'date':
        return sorted.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
      case 'title':
      default:
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
    }
  };

  const sortedAlbums = sortAlbums(displayAlbums);

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Vinyl Collector</h1>
          <p className="text-sm text-gray-600">Manage your vinyl record collection</p>

          <div className="flex gap-4 mt-6 border-b border-gray-200">
            <button
              className={`pb-3 px-1 text-sm font-medium transition-colors relative ${
                viewMode === 'collection'
                  ? 'text-purple-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setViewMode('collection')}
            >
              Collection
              {viewMode === 'collection' && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-600 rounded-t-full"></div>
              )}
            </button>
            <button
              className={`pb-3 px-1 text-sm font-medium transition-colors relative ${
                viewMode === 'wishlist'
                  ? 'text-purple-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setViewMode('wishlist')}
            >
              Wishlist
              {viewMode === 'wishlist' && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-600 rounded-t-full"></div>
              )}
            </button>
          </div>

          {/* Sort dropdown */}
          <div className="mt-4 flex items-center gap-2">
            <label htmlFor="sort-select" className="text-sm font-medium text-gray-700">
              Sort by:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'title' | 'artist' | 'date')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
            >
              <option value="title">Album Title</option>
              <option value="artist">Artist Name</option>
              <option value="date">Date Added</option>
            </select>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row gap-3 mb-12">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              className="w-full pl-10 pr-10 py-2.5 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Search albums..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults(null);
                }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button className="px-5 py-2.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors md:w-auto w-full flex items-center justify-center gap-2" onClick={() => setShowAddMenu(!showAddMenu)}>
            {showAddMenu ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Album
              </>
            )}
          </button>
        </div>

        {viewMode === 'wishlist' && albums.length > 0 && !loading && (
          <div className="mb-8 p-4 bg-purple-50 rounded-lg border border-purple-100 flex items-start gap-3">
            <svg className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-purple-900">Wishlist Mode</h3>
              <p className="text-sm text-purple-700 mt-1">
                Albums you add while viewing the wishlist will be added here automatically. Click an album to move it to your collection.
              </p>
            </div>
          </div>
        )}

        {showAddMenu && (
          <AddMenu
            onBarcodeClick={() => {
              setShowBarcodeScanner(true);
              setShowAddMenu(false);
            }}
            onImageClick={() => {
              setShowImageUploader(true);
              setShowAddMenu(false);
            }}
            onSearchClick={() => {
              setShowAddMenu(false);
              document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
            }}
            onImportClick={() => {
              setShowDiscogsImporter(true);
              setShowAddMenu(false);
            }}
            onClose={() => setShowAddMenu(false)}
            discogsConfigured={discogsConfigured}
            viewMode={viewMode}
          />
        )}

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
            <p className="mt-4 text-xl text-white font-medium">Loading your collection...</p>
          </div>
        ) : (
          <>
            {(!searchQuery || viewMode === 'collection') ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {sortedAlbums.length === 0 ? (
                  <div className="col-span-full text-center py-16 px-4">
                    <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      {searchQuery ? (
                         <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                         </svg>
                      ) : (
                         <svg className="mx-auto w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                         </svg>
                      )}
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">
                      {searchQuery ? 'No matching albums found' : (viewMode === 'wishlist' ? 'Your wishlist is empty' : 'No albums yet')}
                    </h3>
                    {!searchQuery && (
                      <p className="mt-1 text-gray-500">
                        {viewMode === 'wishlist' 
                          ? 'Search for albums above to add them to your wishlist.'
                          : 'Start building your collection by adding an album.'}
                      </p>
                    )}
                </div>
              ) : (
                displayAlbums.map((album) => (
                  <div
                    key={album.id}
                    className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow group relative overflow-hidden cursor-pointer"
                    onClick={() => setSelectedAlbum(album)}
                  >
                    <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden rounded-t-xl">
                      <img
                        src={getCoverArtUrl(album.id)}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          // If cover art fails to load, show placeholder icon
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          target.parentElement!.innerHTML = '<svg class="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>';
                        }}
                      />
                      {!album.cover_art_fetched && (
                        <div className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 rounded-full p-1 shadow-md" title="Unverified Artwork">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <h3 className="font-medium text-sm mb-0.5 truncate text-gray-900">{album.title}</h3>
                      <p className="text-xs text-gray-600 truncate mb-0.5">{album.artist_name}</p>
                      {album.year && <p className="text-xs text-gray-400">{album.year}</p>}
                    </div>
                    <button
                      className="absolute top-2 right-2 bg-white/95 hover:bg-red-50 hover:text-red-600 text-gray-600 rounded-lg p-2 transition-all duration-200 shadow-sm opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(album.id);
                      }}
                      title="Remove from collection"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            ) : searchQuery && viewMode === 'wishlist' && (!searchResults || !searchResults.discogs || searchResults.discogs.length === 0) ? (
               <div className="text-center py-16">
                 <p className="text-gray-500 mb-2">No matching albums found.</p>
                 <p className="text-sm text-gray-400">Try checking your spelling or searching for a different artist.</p>
               </div>
            ) : null}

            {searchResults && searchResults.discogs.length > 0 && (
              <div className="mt-12 pt-8 border-t border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Search Results</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {searchResults.discogs.map((album) => (
                    <div key={album.discogsId} className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow group relative overflow-hidden">
                      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden rounded-t-xl">
                        {album.coverImageUrl ? (
                          <img
                            src={album.coverImageUrl}
                            alt={album.album}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <svg className="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                          </svg>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="font-medium text-sm mb-0.5 truncate text-gray-900">{album.album}</h3>
                        <p className="text-xs text-gray-600 truncate mb-0.5">{album.artist}</p>
                        {album.year && <p className="text-xs text-gray-400">{album.year}</p>}
                      </div>
                      <div className={`absolute top-2 right-2 flex flex-col gap-1 transition-opacity duration-200 ${
                        album.inCollection || album.inWishlist || addedAlbums.has(album.coverImageUrl || album.discogsId)
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100'
                      }`}>
                        {album.inCollection ? (
                           <div className="bg-green-600 text-white rounded-lg p-2 text-xs font-medium shadow-sm flex items-center justify-center gap-1 w-32 cursor-default">
                             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                             </svg>
                             In Collection
                          </div>
                        ) : album.inWishlist ? (
                           <div className="bg-purple-600 text-white rounded-lg p-2 text-xs font-medium shadow-sm flex items-center justify-center gap-1 w-32 cursor-default">
                             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                             </svg>
                             In Wishlist
                          </div>
                        ) : addedAlbums.has(album.coverImageUrl || album.discogsId) ? (
                          <div className="bg-green-600 text-white rounded-lg p-2 text-xs font-medium shadow-sm flex items-center justify-center gap-1 w-32">
                             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                             </svg>
                             Added
                          </div>
                        ) : (
                          <>
                            <button
                              className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg p-2 text-xs font-medium shadow-sm flex items-center justify-center gap-1 w-32"
                              onClick={() => handleAddFromDiscogs(album, 'collection')}
                              title="Add to Collection"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Collection
                            </button>
                            <button
                              className="bg-white hover:bg-gray-100 text-purple-600 border border-purple-200 rounded-lg p-2 text-xs font-medium shadow-sm flex items-center justify-center gap-1 w-32"
                              onClick={() => handleAddFromDiscogs(album, 'wishlist')}
                              title="Add to Wishlist"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                              </svg>
                              Wishlist
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Version Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-4 text-center">
        <p className="text-xs text-gray-400">
          v{__APP_VERSION__}
        </p>
      </footer>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => setShowBarcodeScanner(false)}
          onSuccess={() => {
            loadAlbums();
            setShowBarcodeScanner(false);
          }}
          viewMode={viewMode}
        />
      )}

      {showImageUploader && (
        <ImageUploader
          onClose={() => setShowImageUploader(false)}
          onSuccess={() => {
            loadAlbums();
            setShowImageUploader(false);
          }}
          viewMode={viewMode}
        />
      )}

      {showDiscogsImporter && (
        <DiscogsImporter
          onClose={() => setShowDiscogsImporter(false)}
          onSuccess={() => {
            loadAlbums();
          }}
          viewMode={viewMode}
        />
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onRefresh={() => {
            loadAlbums();
            if (searchQuery) {
              performSearch(searchQuery);
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
