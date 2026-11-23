import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { type DiscogsAlbum } from '../services/api';
import { ModalDialog } from './ModalDialog';
import { SaveDestinationActions, type DestinationAction } from './SaveDestinationActions';

interface ImageUploaderProps {
  onClose: () => void;
  onSuccess: () => void;
  onSearchByName: (query?: string) => void;
  onMoveSaved: (id: number, title: string) => Promise<boolean>;
  onOpenSaved: (id: number) => Promise<void>;
  viewMode: 'collection' | 'wishlist';
}

export const ImageUploader = ({ onClose, onSuccess, onSearchByName, onMoveSaved, onOpenSaved, viewMode }: ImageUploaderProps) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [matches, setMatches] = useState<DiscogsAlbum[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [extractedInfo, setExtractedInfo] = useState<Awaited<ReturnType<typeof api.analyzeImage>>['extractedText'] | null>(null);
  const [saving, setSaving] = useState<{ id: number; action: DestinationAction }>();
  const saveInProgress = useRef(false);
  const [analysisError, setAnalysisError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const clearPhoto = () => {
    setImagePreview('');
    setMatches([]);
    setExtractedInfo(null);
    setAnalysisError('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    clearPhoto();

    // Validate file type
    const isHEIC = /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)$/i.test(file.type);
    if (!file.type.startsWith('image/') && !isHEIC) {
      setAnalysisError('Choose an image file, such as JPG, PNG, or HEIC.');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setAnalysisError('Choose an image under 10 MB.');
      return;
    }

    // Convert to base64
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setAnalyzing(false);
      setAnalysisError('Could not read this image. Choose it again or try another photo.');
    };
    reader.onload = async () => {
      const base64 = reader.result as string;

      // Check if this is a HEIC image (browsers can't display HEIC)
      // Only set preview for displayable formats
      if (!isHEIC) {
        setImagePreview(base64);
      } else {
        // Set a placeholder for HEIC images
        setImagePreview('HEIC');
      }

      try {
        const result = await api.analyzeImage(base64);

        setExtractedInfo(result.extractedText);

        if (result.discogsMatches.length === 0) {
          setAnalysisError('No catalog albums matched the detected text.');
        } else {
          setMatches(result.discogsMatches);
        }
      } catch {
        setAnalysisError('Could not identify this cover.');
      } finally {
        setAnalyzing(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const saveMatch = async (match: DiscogsAlbum, action: DestinationAction) => {
    if (match.inCollection || saveInProgress.current) return;
    const moveId = action === 'move' && match.inWishlist ? match.existingAlbumId : undefined;
    const adding = action !== 'move' && !match.inWishlist;
    if (!moveId && !adding) return;

    saveInProgress.current = true;
    setSaving({ id: match.discogsId, action });
    try {
      if (moveId) {
        if (!await onMoveSaved(moveId, match.album)) return;
        onClose();
        return;
      } else if (adding) {
        await api.addAlbum({
          artist: match.artist,
          album: match.album,
          year: match.year,
          coverImageUrl: match.coverImageUrl,
          discogsId: match.discogsId,
          status: action,
        });
        toast.success(`Added “${match.album}” to ${action === 'collection' ? 'Collection' : 'Wishlist'}.`);
      }
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the album. Try again.');
    } finally {
      saveInProgress.current = false;
      setSaving(undefined);
    }
  };

  return (
    <ModalDialog labelledBy="identify-cover-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-2xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 id="identify-cover-title" className="text-xl font-bold text-gray-900">Identify a cover</h2>
          </div>
          <button
            className="rh-dialog-close"
            aria-label="Close cover identification"
            onClick={onClose}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <input ref={fileInput} id="cover-photo-file" type="file" accept="image/*,.heic,.heif"
            onChange={handleFileChange} disabled={analyzing || !!saving} className={imagePreview ? 'hidden' : 'sr-only'}
            aria-label="Choose a cover photo" />
          {!imagePreview ? (
            <label htmlFor="cover-photo-file" className="rh-upload-label block w-full cursor-pointer rounded-2xl group">
              <div className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 group-hover:bg-purple-50 group-hover:border-purple-300 transition-all duration-200">
                <div className="w-16 h-16 mb-4 flex items-center justify-center bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform duration-200">
                  <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="mb-2 text-lg font-semibold text-gray-700 group-hover:text-purple-700">Choose a cover photo</p>
                <p className="text-sm text-gray-500 group-hover:text-purple-500">JPG, PNG, or HEIC (max 10MB)</p>
              </div>
            </label>
          ) : (
            <div className="relative group">
              <div className="bg-gray-100 rounded-xl border border-gray-200 p-2">
                {imagePreview === 'HEIC' ? (
                  <div className="w-full h-64 flex flex-col items-center justify-center rounded-lg bg-gray-50 border-2 border-dashed border-gray-300">
                    <svg className="w-16 h-16 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-600">HEIC Image</p>
                    <p className="text-xs text-gray-500 mt-1">Preview not available</p>
                  </div>
                ) : (
                  <img src={imagePreview} alt="Album cover" className="w-full h-64 object-contain rounded-lg shadow-sm" />
                )}
              </div>
              {!analyzing && (
                <button 
                  onClick={clearPhoto}
                  disabled={!!saving}
                  className="rh-dialog-close absolute top-4 right-4 bg-white/95 hover:text-red-600"
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {analyzing && (
          <div className="text-center py-8" role="status">
            <div className="inline-block w-12 h-12 border-4 border-purple-600/30 border-t-purple-600 rounded-full animate-spin mb-4"></div>
            <p className="text-lg font-medium text-gray-700">Looking for matching albums…</p>
          </div>
        )}

        {extractedInfo && (
          <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            <p className="[overflow-wrap:anywhere]">
              Detected text: <strong className="text-gray-900">{[extractedInfo.artist, extractedInfo.album].filter(Boolean).join(' · ')}</strong>
            </p>
            {typeof extractedInfo.confidence === 'number' && extractedInfo.confidence > 0 && (
              <p>Text recognition confidence: {Math.round(extractedInfo.confidence)}%</p>
            )}
          </div>
        )}

        {analysisError && (
          <div className="mb-4 space-y-2">
            <p className="text-sm text-red-600" role="alert">{analysisError}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rh-primary-action px-3 text-sm font-semibold"
                onClick={() => onSearchByName([extractedInfo?.artist, extractedInfo?.album].filter(Boolean).join(' '))}>
                Search by name
              </button>
              <button type="button" className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-100"
                onClick={() => fileInput.current?.click()}>
                Choose another photo
              </button>
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-3 text-xl font-bold text-gray-900" role="status">
              {matches.length === 1 ? '1 possible match' : `${matches.length} possible matches`}
            </h3>
            <div className="space-y-3">
              {matches.map(match => {
                const existingStatus = match.inCollection ? 'collection' : match.inWishlist ? 'wishlist' : undefined;

                return (
                  <article key={match.discogsId} className="rounded-xl border border-gray-300 p-3">
                    <div className="flex items-start gap-3">
                      {match.coverImageUrl && (
                        <img src={match.coverImageUrl} alt="" loading="lazy" className="size-14 rounded-lg object-cover" />
                      )}
                      <div className="min-w-0">
                        <h4 className="font-semibold text-gray-900 break-words">{match.album}</h4>
                        <p className="text-sm text-gray-600 break-words">
                          {match.artist}{match.year ? ` · ${match.year}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <SaveDestinationActions
                        albumTitle={match.album}
                        preferred={viewMode}
                        existingStatus={existingStatus}
                        canMove={Boolean(match.existingAlbumId)}
                        onOpenSaved={match.existingAlbumId ? () => void onOpenSaved(match.existingAlbumId!) : undefined}
                        pending={saving?.id === match.discogsId ? saving.action : undefined}
                        disabled={!!saving}
                        onSelect={action => void saveMatch(match, action)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
            <button 
                className="px-6 py-2.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors" 
                onClick={onClose}
            >
            Cancel
            </button>
        </div>
      </div>
    </ModalDialog>
  );
};
