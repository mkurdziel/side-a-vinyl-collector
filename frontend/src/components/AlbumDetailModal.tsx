import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import api, { type Album, type SearchCoverArtResult, getCoverArtUrl } from '../services/api';
import { ModalDialog } from './ModalDialog';

interface AlbumDetailModalProps {
  album: Album;
  onClose: () => void;
  shelfActions?: ReactNode;
  onRefresh: (updatedAlbum?: Album) => void;
}

export const AlbumDetailModal = ({ album, onClose, onRefresh, shelfActions }: AlbumDetailModalProps) => {
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

        <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
          <div className="rh-details-identity">
            <div className="aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {failedCoverUrl !== coverUrl ? (
                <img src={coverUrl} alt="" className="size-full object-cover" onError={() => setFailedCoverUrl(coverUrl)} />
              ) : (
                <div className="flex h-full items-center justify-center p-1 text-center text-xs text-gray-600">Cover unavailable</div>
              )}
            </div>
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">{currentAlbum.title}</h3>
              <p className="mt-1 text-base text-gray-600">{currentAlbum.artist_name}</p>
              <p className="mt-2 text-sm font-medium text-gray-700">
                {currentAlbum.status === 'wishlist' ? 'Wishlist' : 'Collection'}
                {currentAlbum.year ? ` · ${currentAlbum.year}` : ''}
              </p>
            </div>
          </div>

          {shelfActions && <div className="border-t border-gray-200 pt-3">{shelfActions}</div>}

          <dl className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-4">
            <div>
              <dt className="text-sm font-medium text-gray-700">First saved</dt>
              <dd className="text-sm text-gray-600">{formatDate(currentAlbum.added_at)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-700">Artwork</dt>
              <dd className="text-sm text-gray-600">{artworkSource}</dd>
            </div>
            {currentAlbum.notes && (
              <div className="col-span-full min-w-0">
                <dt className="text-sm font-medium text-gray-700">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-600 [overflow-wrap:anywhere]">{currentAlbum.notes}</dd>
              </div>
            )}
          </dl>

          <button ref={artworkButtonRef} type="button" onClick={handleSearchArtwork} disabled={refetching}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-60">
            {refetching ? <><span className="rh-action-spinner" aria-hidden="true" />Searching for artwork…</> : 'Find different artwork'}
          </button>
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
