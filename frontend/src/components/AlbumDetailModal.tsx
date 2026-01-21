import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { type Album, getCoverArtUrl } from '../services/api';

interface AlbumDetailModalProps {
  album: Album;
  onClose: () => void;
  onRefresh: () => void;
}

export const AlbumDetailModal = ({ album, onClose, onRefresh }: AlbumDetailModalProps) => {
  const [refetching, setRefetching] = useState(false);

  const handleRefetchArtwork = async () => {
    setRefetching(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const response = await fetch(`${API_URL}/api/cover-art/${album.id}/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message || 'Artwork refreshed successfully');
        onRefresh();
        // Force reload the image by updating the timestamp
        setTimeout(() => {
          const images = document.querySelectorAll(`img[alt="${album.title}"]`);
          images.forEach((img) => {
            const imgElement = img as HTMLImageElement;
            imgElement.src = getCoverArtUrl(album.id) + '?t=' + Date.now();
          });
        }, 500);
      } else {
        toast.error(data.error || 'Failed to refresh artwork');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to refresh artwork');
    } finally {
      setRefetching(false);
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
    if (album.local_cover_path) {
      // Has locally cached cover art
      if (album.cover_image_url?.includes('coverartarchive.org')) {
        return { source: 'MusicBrainz (Cached Locally)', color: 'text-green-600', icon: '🎵' };
      } else {
        return { source: 'Discogs (Cached Locally)', color: 'text-blue-600', icon: '💿' };
      }
    } else if (album.cover_image_url) {
      if (album.cover_image_url.includes('coverartarchive.org')) {
        return { source: 'MusicBrainz Cover Art Archive', color: 'text-green-600', icon: '🎵' };
      } else if (album.cover_image_url.includes('discogs.com')) {
        return { source: 'Discogs', color: 'text-blue-600', icon: '💿' };
      } else {
        return { source: 'External URL', color: 'text-gray-600', icon: '🌐' };
      }
    }
    return { source: 'No artwork', color: 'text-gray-400', icon: '❌' };
  };

  const artworkInfo = getArtworkSource();

  return (
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
                src={getCoverArtUrl(album.id)}
                alt={album.title}
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
              <h3 className="text-2xl font-bold text-gray-900">{album.title}</h3>
              <p className="text-lg text-gray-600 mt-1">{album.artist_name}</p>
              {album.year && (
                <p className="text-sm text-gray-500 mt-1">{album.year}</p>
              )}
            </div>

            {/* Metadata */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              {/* Added Date */}
              <div className="flex items-start gap-3">
                <span className="text-2xl">📅</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">Added to Collection</p>
                  <p className="text-sm text-gray-600">{formatDate(album.added_at)}</p>
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
                  {album.cover_image_url && (
                    <p className="text-xs text-gray-400 mt-1 truncate max-w-md">
                      {album.cover_image_url}
                    </p>
                  )}
                </div>
              </div>

              {/* Notes */}
              {album.notes && (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">📝</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">Notes</p>
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{album.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-gray-200 space-y-3">
            <button
              onClick={handleRefetchArtwork}
              disabled={refetching}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {refetching ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Fetching Official Artwork...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Artwork from MusicBrainz
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
  );
};
