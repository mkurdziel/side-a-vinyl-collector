import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { type DiscogsAlbum } from '../services/api';

interface ImageUploaderProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const ImageUploader = ({ onClose, onSuccess }: ImageUploaderProps) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [matches, setMatches] = useState<DiscogsAlbum[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');

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
        toast.loading('Analyzing image...', { id: 'analyze' });
        const result = await api.analyzeImage(base64);
        toast.success('Image analyzed!', { id: 'analyze' });

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
      });

      toast.success(`Added "${match.album}" by ${match.artist}`, { id: 'add' });
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
        className="glass-card max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">🖼️ Upload Album Image</h2>
          <button
            className="text-3xl text-gray-400 hover:text-gray-700 transition-colors w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="mb-6">
          {!imagePreview ? (
            <label className="block glass-card-hover p-12 text-center cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div>
                <span className="text-7xl block mb-4">📸</span>
                <p className="text-xl font-semibold text-gray-800 mb-2">Click to upload album cover</p>
                <p className="text-sm text-gray-600">JPG, PNG, or HEIC (max 10MB)</p>
              </div>
            </label>
          ) : (
            <div className="glass-card p-4">
              <img src={imagePreview} alt="Album cover" className="w-full rounded-lg" />
            </div>
          )}
        </div>

        {analyzing && (
          <div className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-[--color-vinyl-600]/30 border-t-[--color-vinyl-600] rounded-full animate-spin mb-4"></div>
            <p className="text-lg font-medium text-gray-700">Analyzing with Claude Vision...</p>
          </div>
        )}

        {matches.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Select the correct album:</h3>
            <div className="space-y-3">
              {matches.map((match) => (
                <div
                  key={match.discogsId}
                  className="glass-card-hover p-4 flex gap-4 cursor-pointer"
                  onClick={() => handleSelectMatch(match)}
                >
                  {match.coverImageUrl && (
                    <img
                      src={match.coverImageUrl}
                      alt={match.album}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-800 truncate">{match.album}</h4>
                    <p className="text-gray-600 truncate">{match.artist}</p>
                    {match.year && <span className="text-sm text-gray-500">{match.year}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="w-full btn-danger" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
};
