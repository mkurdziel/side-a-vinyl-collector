import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

interface BarcodeScannerProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const BarcodeScanner = ({ onClose, onSuccess }: BarcodeScannerProps) => {
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
      });

      toast.success(`Added "${result.album}" by ${result.artist}`);
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
        className="glass-card max-w-2xl w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">📷 Scan Barcode</h2>
          <button
            className="text-3xl text-gray-400 hover:text-gray-700 transition-colors w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="relative bg-black rounded-xl overflow-hidden mb-6">
          {error ? (
            <div className="text-center py-16 px-4">
              <p className="text-red-400 text-lg mb-2">{error}</p>
              <p className="text-gray-400">Make sure to allow camera access</p>
            </div>
          ) : (
            <>
              <div ref={scannerRef} className="w-full" style={{ minHeight: '400px' }} />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-1/3 border-2 border-[--color-vinyl-400] rounded-lg shadow-lg">
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-[--color-vinyl-400] animate-pulse" />
                </div>
              </div>
              <p className="absolute bottom-4 left-0 right-0 text-center text-white text-lg font-medium bg-black/50 py-2">
                Position barcode within the frame
              </p>
            </>
          )}
        </div>

        <button className="w-full btn-danger" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
};
