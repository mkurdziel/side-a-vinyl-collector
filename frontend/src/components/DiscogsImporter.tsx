import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { type DiscogsAlbum } from '../services/api';

interface DiscogsImporterProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const DiscogsImporter = ({ onClose, onSuccess }: DiscogsImporterProps) => {
  const [loading, setLoading] = useState(false);
  const [albums, setAlbums] = useState<DiscogsAlbum[]>([]);
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const handleFetchCollection = async () => {
    setLoading(true);
    try {
      const result = await api.importDiscogsCollection();
      setAlbums(result.albums);
      toast.success(`Found ${result.count} albums in your Discogs collection`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to fetch Discogs collection');
    } finally {
      setLoading(false);
    }
  };

  const handleImportAlbum = async (album: DiscogsAlbum) => {
    try {
      await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        discogsId: album.discogsId,
      });
      setImported(prev => new Set(prev).add(album.discogsId));
      toast.success(`Added ${album.album}`);
    } catch (error: any) {
      if (error.message.includes('already in collection')) {
        setSkipped(prev => new Set(prev).add(album.discogsId));
        toast(`${album.album} already in collection`, { icon: 'ℹ️' });
      } else {
        toast.error(error.message || 'Failed to import album');
      }
    }
  };

  const handleImportAll = async () => {
    setLoading(true);
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (const album of albums) {
      if (imported.has(album.discogsId) || skipped.has(album.discogsId)) continue;

      try {
        await api.addAlbum({
          artist: album.artist,
          album: album.album,
          year: album.year,
          coverImageUrl: album.coverImageUrl,
          discogsId: album.discogsId,
        });
        setImported(prev => new Set(prev).add(album.discogsId));
        successCount++;
      } catch (error: any) {
        if (error.message.includes('already in collection')) {
          setSkipped(prev => new Set(prev).add(album.discogsId));
          duplicateCount++;
        } else {
          errorCount++;
        }
      }
    }

    setLoading(false);

    const messages = [];
    if (successCount > 0) messages.push(`${successCount} imported`);
    if (duplicateCount > 0) messages.push(`${duplicateCount} already exist`);
    if (errorCount > 0) messages.push(`${errorCount} failed`);

    const message = messages.join(', ');
    if (successCount > 0 || duplicateCount > 0) {
      toast.success(message);
    } else if (errorCount > 0) {
      toast.error(message);
    }

    if (successCount > 0) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose} style={{ margin: 0, padding: 0 }}>
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()} style={{ margin: '0 1rem' }}>
        <div className="flex items-center justify-between border-b border-gray-200" style={{ padding: '1.5rem', margin: 0 }}>
          <h2 className="text-xl font-bold text-gray-900" style={{ margin: 0 }}>Import from Discogs</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            style={{ padding: 0, margin: 0 }}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: '2rem', margin: 0 }}>
          {albums.length === 0 ? (
            <div className="text-center" style={{ padding: '4rem 0' }}>
              <svg className="mx-auto w-16 h-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ margin: '0 auto 1rem auto' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-lg font-medium text-gray-900 mb-2" style={{ margin: '0 0 0.5rem 0' }}>Ready to import</p>
              <p className="text-sm text-gray-500 mb-6" style={{ margin: '0 0 1.5rem 0' }}>Click the button below to fetch your Discogs collection</p>
              <button
                className="btn-primary"
                onClick={handleFetchCollection}
                disabled={loading}
                style={{ margin: 0 }}
              >
                {loading ? 'Fetching...' : 'Fetch Collection'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
                <p className="text-sm text-gray-600" style={{ margin: 0 }}>
                  {albums.length} albums found • {imported.size} imported • {skipped.size} skipped
                </p>
                <button
                  className="btn-primary"
                  onClick={handleImportAll}
                  disabled={loading || imported.size + skipped.size === albums.length}
                  style={{ margin: 0 }}
                >
                  {loading ? 'Importing...' : 'Import All'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {albums.map((album) => {
                  const isImported = imported.has(album.discogsId);
                  const isSkipped = skipped.has(album.discogsId);

                  return (
                    <div key={album.discogsId} className={`glass-card overflow-hidden ${isImported || isSkipped ? 'opacity-50' : ''}`}>
                      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                        {album.coverImageUrl ? (
                          <img
                            src={album.coverImageUrl}
                            alt={album.album}
                            className="w-full h-full object-cover"
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
                      {!isImported && !isSkipped && (
                        <div style={{ padding: '0.75rem' }}>
                          <button
                            className="w-full btn-primary text-sm"
                            style={{ padding: '0.5rem' }}
                            onClick={() => handleImportAlbum(album)}
                          >
                            Import
                          </button>
                        </div>
                      )}
                      {isImported && (
                        <div style={{ padding: '0.75rem' }}>
                          <div className="w-full text-center text-sm text-green-600 font-medium">
                            ✓ Imported
                          </div>
                        </div>
                      )}
                      {isSkipped && (
                        <div style={{ padding: '0.75rem' }}>
                          <div className="w-full text-center text-sm text-gray-500 font-medium">
                            Already exists
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
