import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { type Album, type SearchCoverArtResult, getCoverArtUrl } from '../services/api';
import { ModalDialog } from './ModalDialog';

interface AlbumDetailModalProps {
  album: Album;
  onClose: () => void;
  onRefresh: (updatedAlbum?: Album) => void;
}

export const AlbumDetailModal = ({ album, onClose, onRefresh }: AlbumDetailModalProps) => {
  const [refetching, setRefetching] = useState(false);
  const [currentAlbum, setCurrentAlbum] = useState<Album>(album);
  const [receivedAlbum, setReceivedAlbum] = useState(album);

  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [candidates, setCandidates] = useState<SearchCoverArtResult[]>([]);
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});
  const [savingArtwork, setSavingArtwork] = useState(false);
  const [failedCoverUrl, setFailedCoverUrl] = useState('');
  const artworkButtonRef = useRef<HTMLButtonElement>(null);
  const coverVersion = currentAlbum.local_cover_path ? `?v=${encodeURIComponent(currentAlbum.local_cover_path)}` : '';
  const coverUrl = getCoverArtUrl(currentAlbum.id) + coverVersion;

  // Reset local artwork edits when the parent supplies a different album value.
  // React retries this render before committing children, avoiding a stale frame.
  if (receivedAlbum !== album) {
    setReceivedAlbum(album);
    setCurrentAlbum(album);
  }

  const handleSearchArtwork = async () => {
    setRefetching(true);
    try {
      const data = await api.searchCoverArt(currentAlbum.id);
      
      if (data.results && data.results.length > 0) {
        setCandidates(data.results);
        setImageDimensions({});
        setShowSelectionModal(true);
      } else {
        toast.error('No cover art found');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not find cover art. Try again.');
    } finally {
      setRefetching(false);
    }
  };

  const handleSelectArtwork = async (candidate: SearchCoverArtResult) => {
    if (savingArtwork) return;

    setSavingArtwork(true);
    try {
      toast.loading('Updating artwork…', { id: 'update-art' });
      const data = await api.updateCoverArt(currentAlbum.id, candidate.url, candidate.source);
      const updatedAlbum = { ...currentAlbum, ...data.album };

      toast.success('Artwork updated', { id: 'update-art' });
      setCurrentAlbum(updatedAlbum);
      setShowSelectionModal(false);
      onRefresh(updatedAlbum);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the artwork. Try another cover.', { id: 'update-art' });
    } finally {
      setSavingArtwork(false);
    }
  };

  const handleAddToCollection = async () => {
    try {
      await api.updateStatus(currentAlbum.id, 'collection');
      toast.success('Moved to collection');
      onRefresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to move to Collection');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const artworkUrl = currentAlbum.cover_image_url;
  const artworkSource = artworkUrl?.includes('coverartarchive.org')
    ? 'MusicBrainz Cover Art Archive'
    : artworkUrl?.includes('discogs.com')
      ? 'Discogs'
      : artworkUrl
        ? 'External image'
        : currentAlbum.local_cover_path ? 'Saved artwork' : 'No cover art';

  return (
    <ModalDialog labelledBy="album-details-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-2xl">
        {/* Header */}
        <div className="rh-dialog-header flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <h2 id="album-details-title" className="text-xl font-bold text-gray-900">Album details</h2>
          <button
            onClick={onClose}
            className="rh-dialog-close"
            aria-label="Close album details"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-6">
          {/* Album Artwork */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-md aspect-square bg-gray-50 rounded-xl overflow-hidden shadow-lg">
              {failedCoverUrl !== coverUrl ? (
                <img
                  src={coverUrl}
                  alt={currentAlbum.title}
                  className="w-full h-full object-cover"
                  onError={() => setFailedCoverUrl(coverUrl)}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">Cover unavailable</div>
              )}
            </div>
          </div>

          {/* Album Info */}
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900">{currentAlbum.title}</h3>
              <p className="text-lg text-gray-600 mt-1">{currentAlbum.artist_name}</p>
              {currentAlbum.year && (
                <p className="text-sm text-gray-500 mt-1">{currentAlbum.year}</p>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-gray-700">Shelf</dt>
                <dd className="text-sm text-gray-600">{currentAlbum.status === 'wishlist' ? 'Wishlist' : 'Collection'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-700">First saved</dt>
                <dd className="text-sm text-gray-600">{formatDate(currentAlbum.added_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-700">Artwork</dt>
                <dd className="text-sm text-gray-600">{artworkSource}</dd>
              </div>
              {currentAlbum.notes && (
                <div className="sm:col-span-3">
                  <dt className="text-sm font-medium text-gray-700">Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-600">{currentAlbum.notes}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-gray-200 space-y-3">
            {currentAlbum.status === 'wishlist' && (
              <button
                onClick={handleAddToCollection}
                className="w-full px-5 py-2.5 rh-filled-action text-sm font-medium bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Move to Collection
              </button>
            )}

            {currentAlbum.status === 'collection' && (
              <button
                onClick={async () => {
                  if (!confirm('Move this album from your collection to your wishlist?')) return;
                  try {
                    await api.updateStatus(currentAlbum.id, 'wishlist');
                    toast.success('Moved to wishlist');
                    onRefresh();
                    onClose();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Failed to move to Wishlist');
                  }
                }}
                className="w-full px-5 py-2.5 text-sm font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Move to Wishlist
              </button>
            )}

            {currentAlbum.status === 'wishlist' && (
              <button
                onClick={async () => {
                  if (!confirm('Remove this album from your wishlist entirely?')) return;
                  try {
                    await api.deleteAlbum(currentAlbum.id);
                    toast.success('Album removed entirely');
                    onRefresh();
                    onClose();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Failed to remove album');
                  }
                }}
                className="w-full px-5 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove from Wishlist
              </button>
            )}

            <button
              ref={artworkButtonRef}
              onClick={handleSearchArtwork}
              disabled={refetching}
              className="w-full px-5 py-2.5 rh-filled-action text-sm font-medium bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {refetching ? (
                <>
                  <div className="rh-action-spinner" aria-hidden="true"></div>
                  Searching for Artwork...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Artwork
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {showSelectionModal && (
        <ModalDialog labelledBy="choose-cover-title" onClose={() => setShowSelectionModal(false)} returnFocusTo={artworkButtonRef}>
          <div className="rh-dialog-panel max-w-4xl flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 id="choose-cover-title" className="text-xl font-bold text-gray-900">Choose cover art</h2>
              <button 
                onClick={() => setShowSelectionModal(false)}
                className="rh-dialog-close"
                aria-label="Close cover chooser"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {candidates.map((candidate, index) => {
                  const key = `${candidate.source}-${candidate.id}-${index}`;
                  const dimensions = imageDimensions[key];
                  const failed = dimensions === 'Unavailable';

                  return (
                    <button
                      type="button"
                      key={key}
                      className="group cursor-pointer relative"
                      disabled={savingArtwork || failed}
                      onClick={() => handleSelectArtwork(candidate)}
                      aria-label={`Use ${candidate.title} cover from ${candidate.source}`}
                    >
                      <span className="block aspect-square overflow-hidden rounded-lg border border-gray-300 bg-gray-100 group-hover:border-purple-500">
                        {failed ? (
                          <span className="grid h-full place-items-center px-2 text-xs text-gray-400">Image unavailable</span>
                        ) : (
                          <img
                            src={candidate.url}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onLoad={event => {
                              const { naturalWidth, naturalHeight } = event.currentTarget;
                              setImageDimensions(previous => ({ ...previous, [key]: `${naturalWidth} × ${naturalHeight}` }));
                            }}
                            onError={() => setImageDimensions(previous => ({ ...previous, [key]: 'Unavailable' }))}
                          />
                        )}
                      </span>
                      <span className="block pt-2 text-left">
                        <span className="block text-sm font-medium text-gray-900 break-words">{candidate.title}</span>
                        <span className="block text-xs text-gray-400">{candidate.source}{candidate.year ? ` · ${candidate.year}` : ''}</span>
                        {!failed && dimensions && <span className="block text-xs text-gray-400">{dimensions}</span>}
                        {failed ? null : (
                          <span className="mt-1 block text-sm font-medium text-purple-700">
                            {savingArtwork ? 'Updating…' : 'Use this cover'}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ModalDialog>
      )}
    </ModalDialog>
  );
};
