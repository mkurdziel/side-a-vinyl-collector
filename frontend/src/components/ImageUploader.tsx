import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { type DiscogsAlbum } from '../services/api';

interface ImageUploaderProps {
  onClose: () => void;
  onSuccess: () => void;
  viewMode: 'collection' | 'wishlist';
}

export const ImageUploader = ({ onClose, onSuccess, viewMode }: ImageUploaderProps) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [matches, setMatches] = useState<DiscogsAlbum[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0);
  const [extractedInfo, setExtractedInfo] = useState<{ artist?: string; album?: string; year?: number; provider?: string; usedFallback?: boolean } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be less than 10MB');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setImagePreview(base64);

      // Analyze image
      setAnalyzing(true);
      try {
        toast.loading('Analyzing image with AI...', { id: 'analyze' });
        const result = await api.analyzeImage(base64);

        const aiConfidence = result.extractedText.confidence || 0;
        setConfidence(aiConfidence);
        setExtractedInfo(result.extractedText);

        if (aiConfidence >= 70) {
          toast.success(`Image analyzed! (${aiConfidence}% confident)`, { id: 'analyze' });
        } else if (aiConfidence >= 50) {
          toast('Image analyzed with moderate confidence', { id: 'analyze', icon: '⚠️' });
        } else {
          toast('Low confidence - results may not be accurate', { id: 'analyze', icon: '⚠️' });
        }

        if (result.discogsMatches.length === 0) {
          toast.error('No matches found. Try a clearer image.');
        } else {
          setMatches(result.discogsMatches);
        }
      } catch (error: any) {
        toast.error(error.message || 'Failed to analyze image', { id: 'analyze' });
      } finally {
        setAnalyzing(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const handleSelectMatch = async (match: DiscogsAlbum) => {
    try {
      toast.loading('Adding to collection...', { id: 'add' });

      await api.addAlbum({
        artist: match.artist,
        album: match.album,
        year: match.year,
        coverImageUrl: match.coverImageUrl,
        discogsId: match.discogsId,
        status: viewMode,
      });

      toast.success(`Added "${match.album}" by ${match.artist} to ${viewMode}`, { id: 'add' });
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add album', { id: 'add' });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Upload Album Image</h2>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-full"
            onClick={onClose}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          {!imagePreview ? (
            <label className="block w-full cursor-pointer group">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 group-hover:bg-purple-50 group-hover:border-purple-300 transition-all duration-200">
                <div className="w-16 h-16 mb-4 flex items-center justify-center bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform duration-200">
                  <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="mb-2 text-lg font-semibold text-gray-700 group-hover:text-purple-700">Click to upload album cover</p>
                <p className="text-sm text-gray-500 group-hover:text-purple-500">JPG, PNG, or HEIC (max 10MB)</p>
              </div>
            </label>
          ) : (
            <div className="relative group">
              <div className="bg-gray-100 rounded-xl border border-gray-200 p-2">
                <img src={imagePreview} alt="Album cover" className="w-full h-64 object-contain rounded-lg shadow-sm" />
              </div>
              {!analyzing && (
                <button 
                  onClick={() => setImagePreview('')}
                  className="absolute top-4 right-4 bg-white/90 text-gray-700 hover:text-red-600 p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
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
          <div className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-purple-600/30 border-t-purple-600 rounded-full animate-spin mb-4"></div>
            <p className="text-lg font-medium text-gray-700">Analyzing with AI Vision...</p>
          </div>
        )}

        {matches.length > 0 && (
          <div className="mb-6">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-bold text-gray-900">AI Detection Results</h3>
                {confidence > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-600">Confidence:</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            confidence >= 70 ? 'bg-green-500' :
                            confidence >= 50 ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`}
                          style={{ width: `${confidence}%` }}
                        />
                      </div>
                      <span className={`text-sm font-bold ${
                        confidence >= 70 ? 'text-green-600' :
                        confidence >= 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {confidence}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {extractedInfo && (
                <div className="text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2">
                     <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                     </svg>
                     <span>
                        Detected: <span className="font-medium text-gray-900">{extractedInfo.artist || 'Unknown'}</span> - <span className="font-medium text-gray-900">{extractedInfo.album || 'Unknown'}</span>
                        {extractedInfo.year && ` (${extractedInfo.year})`}
                     </span>
                  </div>
                  {extractedInfo.provider && (
                    <div className="text-xs text-gray-500 mt-1 ml-6">
                      {extractedInfo.usedFallback ? (
                        <>
                          Provider: <span className="font-medium capitalize">{extractedInfo.provider}</span> <span className="text-yellow-600">(fallback)</span>
                        </>
                      ) : (
                        <>
                          Provider: <span className="font-medium capitalize">{extractedInfo.provider}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Select the correct album:</h4>
            <div className="space-y-3">
              {matches.map((match) => (
                <div
                  key={match.discogsId}
                  className="bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all p-3 flex gap-4 cursor-pointer group"
                  onClick={() => handleSelectMatch(match)}
                >
                  {match.coverImageUrl && (
                    <img
                      src={match.coverImageUrl}
                      alt={match.album}
                      className="w-16 h-16 object-cover rounded-lg shadow-sm"
                    />
                  )}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h4 className="font-bold text-gray-900 truncate group-hover:text-purple-700 transition-colors">{match.album}</h4>
                    <p className="text-gray-600 truncate">{match.artist}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {match.year && <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{match.year}</span>}
                      {match.fromProvider && match.confidence !== undefined && (
                        <span className="text-xs text-gray-400">
                           {match.confidence}% match
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center px-2">
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              ))}
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
    </div>
  );
};
