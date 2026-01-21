import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import api, { type Album, type SearchCoverArtResult, getCoverArtUrl } from '../services/api';

interface AlbumDetailModalProps {
  album: Album;
  onClose: () => void;
  onRefresh: () => void;
}

export const AlbumDetailModal = ({ album, onClose, onRefresh }: AlbumDetailModalProps) => {
  const [refetching, setRefetching] = useState(false);
  const [currentAlbum, setCurrentAlbum] = useState<Album>(album);

  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [candidates, setCandidates] = useState<SearchCoverArtResult[]>([]);

  // Sync state with prop if it changes externally
  useEffect(() => {
    setCurrentAlbum(album);
  }, [album]);

  const handleSearchArtwork = async () => {
    setRefetching(true);
    try {
      const data = await api.searchCoverArt(currentAlbum.id);
      
      if (data.results && data.results.length > 0) {
        setCandidates(data.results);
        setShowSelectionModal(true);
      } else {
        toast.error('No cover art found');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to search for artwork');
    } finally {
      setRefetching(false);
    }
  };

  const handleSelectArtwork = async (candidate: SearchCoverArtResult) => {
    try {
      toast.loading('Updating artwork...', { id: 'update-art' });
      const data = await api.updateCoverArt(currentAlbum.id, candidate.url, candidate.source);
      
      toast.success('Artwork updated!', { id: 'update-art' });
      if (data.album) {
        setCurrentAlbum(data.album);
      }
      setShowSelectionModal(false);
      onRefresh();
      
      // Force reload the image
      setTimeout(() => {
        const images = document.querySelectorAll(`img[alt="${currentAlbum.title}"]`);
        images.forEach((img) => {
          const imgElement = img as HTMLImageElement;
          imgElement.src = getCoverArtUrl(currentAlbum.id) + '?t=' + Date.now();
        });
      }, 500);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update artwork', { id: 'update-art' });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getArtworkSource = () => {
    // Priority: local_cover_path > cover_image_url source detection
    if (currentAlbum.local_cover_path) {
      // Has locally cached cover art
      if (currentAlbum.cover_image_url?.includes('coverartarchive.org')) {
        return { source: 'MusicBrainz (Cached Locally)', color: 'text-green-600', icon: '🎵' };
      } else {
        return { source: 'Discogs (Cached Locally)', color: 'text-blue-600', icon: '💿' };
      }
    } else if (currentAlbum.cover_image_url) {
      if (currentAlbum.cover_image_url.includes('coverartarchive.org')) {
        return { source: 'MusicBrainz Cover Art Archive', color: 'text-green-600', icon: '🎵' };
      } else if (currentAlbum.cover_image_url.includes('discogs.com')) {
        return { source: 'Discogs', color: 'text-blue-600', icon: '💿' };
      } else {
        return { source: 'External URL', color: 'text-gray-600', icon: '🌐' };
      }
    }
    return { source: 'No artwork', color: 'text-gray-400', icon: '❌' };
  };

  const artworkInfo = getArtworkSource();

  return (
    <>
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Album Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Album Artwork */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-md aspect-square bg-gray-50 rounded-xl overflow-hidden shadow-lg">
              <img
                src={getCoverArtUrl(currentAlbum.id)}
                alt={currentAlbum.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="w-24 h-24 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg></div>';
                }}
              />
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

            {/* Metadata */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              {/* Added Date */}
              <div className="flex items-start gap-3">
                <span className="text-2xl">📅</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">Added to Collection</p>
                  <p className="text-sm text-gray-600">{formatDate(currentAlbum.added_at)}</p>
                </div>
              </div>

              {/* Artwork Source */}
              <div className="flex items-start gap-3">
                <span className="text-2xl">{artworkInfo.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">Artwork Source</p>
                  <p className={`text-sm font-medium ${artworkInfo.color}`}>
                    {artworkInfo.source}
                  </p>
                  {currentAlbum.cover_image_url && (
                    <p className="text-xs text-gray-400 mt-1 truncate max-w-md">
                      {currentAlbum.cover_image_url}
                    </p>
                  )}
                </div>
              </div>

              {/* Notes */}
              {currentAlbum.notes && (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📝</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">Notes</p>
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{currentAlbum.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-gray-200 space-y-3">
            <button
              onClick={handleSearchArtwork}
              disabled={refetching}
              className="w-full px-5 py-2.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {refetching ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
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
    </div>

      {/* Cover Art Selection Modal */}
      {showSelectionModal && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          onClick={() => setShowSelectionModal(false)}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">Select Cover Art</h3>
              <button 
                onClick={() => setShowSelectionModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {candidates.map((candidate, index) => (
                  <div 
                    key={`${candidate.source}-${candidate.id}-${index}`}
                    className="group cursor-pointer relative"
                    onClick={() => handleSelectArtwork(candidate)}
                  >
                    <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border-2 border-transparent group-hover:border-purple-500 transition-all">
                      <img 
                        src={candidate.url} 
                        alt={candidate.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 bg-purple-600 text-white px-3 py-1 rounded-full text-sm font-medium transform translate-y-2 group-hover:translate-y-0 transition-all">
                          Select
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          candidate.source === 'MusicBrainz' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {candidate.source}
                        </span>
                        {candidate.year && <span className="text-xs text-gray-500">{candidate.year}</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-900 mt-1 truncate">{candidate.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
