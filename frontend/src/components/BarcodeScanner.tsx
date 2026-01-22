import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

interface BarcodeScannerProps {
  onClose: () => void;
  onSuccess: () => void;
  viewMode: 'collection' | 'wishlist';
}

export const BarcodeScanner = ({ onClose, onSuccess, viewMode }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(true);
  const [lastBarcode, setLastBarcode] = useState<string>('');

  const handleDetected = async (barcode: string) => {
    if (barcode === lastBarcode) return; // Prevent duplicate scans

    setLastBarcode(barcode);
    setScanning(false);

    try {
      toast.loading('Looking up barcode...', { id: 'barcode' });

      const result = await api.scanBarcode(barcode);

      toast.success('Album found!', { id: 'barcode' });

      // Add to collection
      await api.addAlbum({
        artist: result.artist,
        album: result.album,
        year: result.year,
        coverImageUrl: result.coverImageUrl,
        discogsId: result.discogsId,
        barcode,
        status: viewMode,
      });

      toast.success(`Added "${result.album}" by ${result.artist} to ${viewMode}`);
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Failed to find album', { id: 'barcode' });
      setScanning(true);
      setLastBarcode('');
    }
  };

  const { scannerRef, error } = useBarcodeScanner(handleDetected, scanning);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
             </div>
             <h2 className="text-xl font-bold text-gray-900">Scan Barcode</h2>
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

        <div className="relative bg-black rounded-xl overflow-hidden mb-6 shadow-md border border-gray-200">
          {error ? (
            <div className="text-center py-16 px-4">
              <div className="inline-block p-4 bg-red-50 rounded-full mb-4">
                  <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
              </div>
              <p className="text-red-500 text-lg font-medium mb-2">{error}</p>
              <p className="text-gray-400">Please allow camera access in your browser settings to scan barcodes.</p>
            </div>
          ) : (
            <>
              <div ref={scannerRef} className="w-full" style={{ minHeight: '400px' }} />
              <div className="absolute inset-0 pointer-events-none">
                {/* Scanning frame - positioned to match actual scan area (20-50% from top) */}
                <div className="absolute left-1/2 -translate-x-1/2 w-3/4 max-w-xs h-40 border-2 border-purple-500 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" style={{ top: '25%' }}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-purple-500 animate-scan" style={{ top: '50%', boxShadow: '0 0 8px 2px rgba(168, 85, 247, 0.6)' }} />
                </div>
              </div>
              
              {/* Mobile close button overlay */}
              <div className="absolute top-4 right-4 md:hidden pointer-events-auto">
                <button
                  onClick={onClose}
                  className="bg-white/90 backdrop-blur-sm text-gray-900 p-3 rounded-full shadow-lg hover:bg-white transition-colors"
                  aria-label="Close scanner"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none">
                   <span className="inline-block bg-black/60 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-medium border border-white/10">
                    Position barcode within the frame
                   </span>
              </div>
            </>
          )}
        </div>

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
