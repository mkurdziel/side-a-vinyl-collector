import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ModalDialog } from './ModalDialog';
import api, { type DiscogsAlbum } from '../services/api';

interface DiscogsImporterProps {
  onClose: () => void;
  onSuccess: () => void;
  viewMode: 'collection' | 'wishlist';
}

export const DiscogsImporter = ({ onClose, onSuccess, viewMode }: DiscogsImporterProps) => {
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'error' | 'empty'>('idle');
  const [pendingAlbum, setPendingAlbum] = useState<number | null>(null);
  const [albums, setAlbums] = useState<DiscogsAlbum[]>([]);
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const handleFetchCollection = async () => {
    setLoading(true);
    setFetchStatus('idle');
    try {
      const result = await api.importDiscogsCollection();
      setAlbums(result.albums);
      if (result.albums.length === 0) setFetchStatus('empty');
    } catch {
      setFetchStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const handleImportAlbum = async (album: DiscogsAlbum) => {
    if (loading || pendingAlbum !== null) return;
    setPendingAlbum(album.discogsId);
    try {
      await api.addAlbum({
        artist: album.artist,
        album: album.album,
        year: album.year,
        coverImageUrl: album.coverImageUrl,
        discogsId: album.discogsId,
        status: viewMode,
      });
      setImported(prev => new Set(prev).add(album.discogsId));
      toast.success(`Imported “${album.album}” to ${viewMode === 'collection' ? 'Collection' : 'Wishlist'}`);
      onSuccess();
    } catch (error) {
      if (error instanceof Error && error.message.includes('already in collection')) {
        setSkipped(prev => new Set(prev).add(album.discogsId));
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not import the album. Try again.');
      }
    } finally {
      setPendingAlbum(null);
    }
  };

  const handleImportAll = async () => {
    if (loading || pendingAlbum !== null) return;
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
          status: viewMode,
        });
        setImported(prev => new Set(prev).add(album.discogsId));
        successCount++;
      } catch (error) {
        if (error instanceof Error && error.message.includes('already in collection')) {
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
    <ModalDialog labelledBy="discogs-import-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-6xl flex flex-col">
        <div className="rh-dialog-header flex items-center justify-between border-b border-gray-200 p-4 sm:p-6">
          <h2 id="discogs-import-title" className="text-xl font-bold text-gray-900">Import from Discogs to {viewMode === 'collection' ? 'Collection' : 'Wishlist'}</h2>
          <button
            onClick={onClose}
            className="rh-dialog-close"
            aria-label="Close Discogs import"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-8">
          {albums.length === 0 ? (
            <div className="text-center py-16">
              <svg className="mx-auto w-16 h-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-lg font-medium text-gray-900 mb-2" role="status">
                {loading ? 'Loading your Discogs collection…' : fetchStatus === 'empty' ? 'Your Discogs collection is empty' : 'Review your Discogs collection'}
              </p>
              {fetchStatus === 'error' ? (
                <p className="text-sm text-red-600 mb-6" role="alert">Could not load your Discogs collection. Check that Discogs is connected and try again.</p>
              ) : (
                <p className="text-sm text-gray-500 mb-6">{fetchStatus === 'empty' ? 'Add records in Discogs before importing.' : 'Load records to choose which ones to import.'}</p>
              )}
              <button
                className="rh-filled-action px-5 py-2.5 text-sm font-medium bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleFetchCollection}
                disabled={loading}
              >
                {loading ? 'Loading…' : fetchStatus === 'idle' ? 'Load Discogs collection' : 'Try again'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <p className="text-sm text-gray-600" role="status">
                  {albums.length} albums found • {imported.size} imported • {skipped.size} skipped
                </p>
                <button
                  className="rh-filled-action px-5 py-2.5 text-sm font-medium bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleImportAll}
                  disabled={loading || pendingAlbum !== null || imported.size + skipped.size === albums.length}
                >
                  {loading ? 'Importing...' : 'Import All'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {albums.map((album) => {
                  const isImported = imported.has(album.discogsId);
                  const isSkipped = skipped.has(album.discogsId);

                  return (
                    <div key={album.discogsId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                            className="rh-filled-action w-full px-4 py-2 text-sm font-medium bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
                            onClick={() => handleImportAlbum(album)}
                            disabled={loading || pendingAlbum !== null}
                            aria-label={`Import ${album.album}`}
                          >
                            {pendingAlbum === album.discogsId ? 'Importing…' : 'Import'}
                          </button>
                        </div>
                      )}
                      {isImported && (
                        <div style={{ padding: '0.75rem' }}>
                          <div className="w-full text-center text-sm text-green-600 font-medium">
                            Imported
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
    </ModalDialog>
  );
};
