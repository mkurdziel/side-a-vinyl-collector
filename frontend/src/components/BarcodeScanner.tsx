import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

interface BarcodeScannerProps {
  onClose: () => void;
  onSuccess: () => void;
  viewMode: 'collection' | 'wishlist';
}

export const BarcodeScanner = ({ onClose, onSuccess }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(true);
  const [lastBarcode, setLastBarcode] = useState<string>('');
  const [scannedResult, setScannedResult] = useState<any>(null);

  const handleDetected = async (barcode: string) => {
    if (barcode === lastBarcode) return; // Prevent duplicate scans

    setLastBarcode(barcode);
    setScanning(false);

    try {
      toast.loading('Looking up barcode...', { id: 'barcode' });

      const result = await api.scanBarcode(barcode);

      toast.success('Album found!', { id: 'barcode' });
      setScannedResult({ ...result, barcode });
    } catch (error: any) {
      toast.error(error.message || 'Failed to find album', { id: 'barcode' });
      setScanning(true);
      setLastBarcode('');
    }
  };

  const handleAddToCollection = async (status: 'collection' | 'wishlist') => {
    if (!scannedResult) return;

    try {
      await api.addAlbum({
        artist: scannedResult.artist,
        album: scannedResult.album,
        year: scannedResult.year,
        coverImageUrl: scannedResult.coverImageUrl,
        discogsId: scannedResult.discogsId,
        barcode: scannedResult.barcode,
        status,
      });

      toast.success(`Added "${scannedResult.album}" by ${scannedResult.artist} to ${status}`);
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add album');
    }
  };

  const handleScanAnother = () => {
    setScannedResult(null);
    setLastBarcode('');
    setScanning(true);
  };

  const { scannerRef, error } = useBarcodeScanner(handleDetected, scanning);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col relative max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900">Scan Barcode</h2>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full transition-all"
            onClick={onClose}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {!scannedResult && (
            <div className="relative bg-black rounded-2xl overflow-hidden mb-4 shadow-lg border border-gray-200 aspect-[4/3]">
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
                <div ref={scannerRef} className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden" />
                <div className="absolute inset-0 pointer-events-none">
                  {/* Scanning frame - centered */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 max-w-xs h-40 border-2 border-purple-500 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-purple-500 animate-scan" style={{ top: '50%', boxShadow: '0 0 8px 2px rgba(168, 85, 247, 0.6)' }} />
                  </div>
                </div>
                
                  <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none z-10">
                     <span className="inline-block bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-medium border border-white/10">
                      Align barcode in frame
                     </span>
                  </div>
                </>
              )}
            </div>
          )}

        {/* Confirmation Dialog */}
        {scannedResult && (
          <div className="mb-6 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-6 border border-purple-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Album Found!</h3>
            <div className="flex gap-4 mb-4">
              {scannedResult.coverImageUrl && (
                <img 
                  src={scannedResult.coverImageUrl} 
                  alt={scannedResult.album}
                  className="w-24 h-24 rounded-lg object-cover shadow-md"
                />
              )}
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{scannedResult.album}</p>
                <p className="text-sm text-gray-600">{scannedResult.artist}</p>
                {scannedResult.year && <p className="text-sm text-gray-500">{scannedResult.year}</p>}
                <p className="text-xs text-gray-400 mt-1">Barcode: {scannedResult.barcode}</p>
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleAddToCollection('collection')}
                className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
              >
                Add to Collection
              </button>
              <button
                onClick={() => handleAddToCollection('wishlist')}
                className="w-full px-4 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium transition-colors"
              >
                Add to Wishlist
              </button>
              <button
                onClick={handleScanAnother}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Scan Another
              </button>
            </div>
          </div>
        )}
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-center bg-gray-50">
            <button 
                className="w-full sm:w-auto px-10 py-3 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-xl font-bold transition-all shadow-sm active:scale-95" 
                onClick={onClose}
            >
            Exit Scanner
            </button>
        </div>
      </div>
    </div>
  );
};
