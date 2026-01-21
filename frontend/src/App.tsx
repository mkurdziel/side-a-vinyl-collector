import { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import api, { type Album, type DiscogsAlbum, getCoverArtUrl } from './services/api';
import { AddMenu } from './components/AddMenu';
import { BarcodeScanner } from './components/BarcodeScanner';
import { ImageUploader } from './components/ImageUploader';
import { DiscogsImporter } from './components/DiscogsImporter';
import { AlbumDetailModal } from './components/AlbumDetailModal';


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
  const [discogsConfigured, setDiscogsConfigured] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    loadAlbums();
    checkDiscogsConfig();
  }, []);

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
      const data = await api.getAlbums();
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

  const handleAddFromDiscogs = async (album: DiscogsAlbum) => {
    try {
      await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        discogsId: album.discogsId,
      });
      toast.success('Album added to collection');
      loadAlbums();
      setSearchResults(null);
      setSearchQuery('');
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Vinyl Collector</h1>
          <p className="text-sm text-gray-600">Manage your vinyl record collection</p>
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
              className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
          />
        )}

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
            <p className="mt-4 text-xl text-white font-medium">Loading your collection...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {displayAlbums.length === 0 ? (
                <div className="col-span-full text-center py-16 px-4">
                  <svg className="mx-auto w-16 h-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <p className="text-lg font-medium text-gray-900 mb-1">No albums yet</p>
                  <p className="text-sm text-gray-500">Add your first vinyl record to get started</p>
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
                      <button
                        className="absolute top-2 right-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg p-2 text-xs font-medium transition-all duration-200 shadow-sm flex items-center gap-1"
                        onClick={() => handleAddFromDiscogs(album)}
                        title="Add to collection"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => setShowBarcodeScanner(false)}
          onSuccess={() => {
            loadAlbums();
            setShowBarcodeScanner(false);
          }}
        />
      )}

      {showImageUploader && (
        <ImageUploader
          onClose={() => setShowImageUploader(false)}
          onSuccess={() => {
            loadAlbums();
            setShowImageUploader(false);
          }}
        />
      )}

      {showDiscogsImporter && (
        <DiscogsImporter
          onClose={() => setShowDiscogsImporter(false)}
          onSuccess={() => {
            loadAlbums();
          }}
        />
      )}

      {selectedAlbum && (
        <AlbumDetailModal
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onRefresh={() => {
            loadAlbums();
          }}
        />
      )}
    </div>
  );
}

export default App;
