import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { ModalDialog } from './ModalDialog';

type BarcodeMatch = Awaited<ReturnType<typeof api.scanBarcode>> & { barcode: string };

interface BarcodeScannerProps {
  onClose: () => void;
  onSuccess: () => void;
  viewMode: 'collection' | 'wishlist';
}

export const BarcodeScanner = ({ onClose, onSuccess }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(true);
  const lookupInProgress = useRef(false);
  const [scannedResult, setScannedResult] = useState<BarcodeMatch | null>(null);
  const [saving, setSaving] = useState<'collection' | 'wishlist' | 'move' | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');

  const handleDetected = async (barcode: string) => {
    if (lookupInProgress.current) return;

    lookupInProgress.current = true;
    setLookupError('');
    setScanning(false);

    try {
      const result = await api.scanBarcode(barcode);
      setScannedResult({ ...result, barcode });
    } catch {
      setLookupError('Could not find a record for that barcode. Check the digits and try again.');
      setScanning(true);
      lookupInProgress.current = false;
    }
  };

  const handleAddToCollection = async (status: 'collection' | 'wishlist') => {
    if (!scannedResult || saving) return;

    setSaving(status);
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the album. Try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleTransferToCollection = async () => {
    if (!scannedResult?.existingAlbumId || saving) return;

    setSaving('move');
    try {
      await api.updateStatus(scannedResult.existingAlbumId, 'collection');
      toast.success(`Moved “${scannedResult.album}” to Collection`);
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move the album. Try again.');
    } finally {
      setSaving(null);
    }
  };

  const handleScanAnother = () => {
    setScannedResult(null);
    setManualBarcode('');
    lookupInProgress.current = false;
    setScanning(true);
  };

  const { scannerRef, error, cameras, cameraId, setCameraId } = useBarcodeScanner(handleDetected, scanning);

  return (
    <ModalDialog labelledBy="barcode-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-lg flex flex-col">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <h2 id="barcode-title" className="text-lg font-bold text-gray-900">Look up a barcode</h2>
          </div>
          <button
            className="rh-dialog-close"
            aria-label="Close barcode lookup"
            onClick={onClose}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {!scannedResult && (
            <>
            {cameras.length > 1 && (
              <label className="block mb-3 text-sm font-medium text-gray-700">
                Camera
                <select
                  className="mt-1 block w-full rounded-lg border border-gray-300 p-2 bg-white"
                  value={cameraId}
                  onChange={event => setCameraId(event.target.value)}
                  disabled={!scanning}
                >
                  <option value="">Automatic (back camera)</option>
                  {cameras.map((camera, index) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="relative bg-black rounded-2xl overflow-hidden mb-4 shadow-lg border border-gray-200 aspect-[4/3]">
            <div ref={scannerRef} className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-contain [&>canvas]:hidden" />
            {error ? (
              <div className="absolute inset-0 bg-black text-center overflow-y-auto py-8 px-4">
                <div className="inline-block p-4 bg-red-50 rounded-full mb-4">
                    <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <p className="text-red-500 text-lg font-medium mb-2">{error}</p>
                <p className="text-gray-400">You can also enter the barcode below.</p>
              </div>
            ) : (
              <>
                <div className="absolute inset-0 pointer-events-none">
                  {/* Scanning frame - centered */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 max-w-xs h-40 border-2 border-purple-500 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-purple-500 animate-scan" style={{ top: '50%', boxShadow: '0 0 8px 2px rgba(84, 156, 214, 0.6)' }} />
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
            <p className="mb-4 text-sm text-gray-600">
              Keep the whole barcode visible. Move farther back if it looks blurry, or try another camera.
            </p>
            {!scanning && <p className="mb-2 text-sm text-gray-600" role="status">Looking up barcode…</p>}
            {lookupError && <p className="mb-2 text-sm text-red-600" role="alert">{lookupError}</p>}
            <form className="mb-4" onSubmit={event => {
              event.preventDefault();
              if (manualBarcode.trim()) void handleDetected(manualBarcode.trim());
            }}>
              <label htmlFor="manual-barcode" className="block mb-1 text-sm font-medium text-gray-700">
                Enter barcode manually
              </label>
              <div className="flex gap-2">
                <input
                  id="manual-barcode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{8}|[0-9]{12,14}"
                  title="Enter the 8, 12, 13, or 14 digits printed below the barcode."
                  value={manualBarcode}
                  onChange={event => setManualBarcode(event.target.value)}
                  disabled={!scanning}
                  required
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 p-2"
                />
                <button type="submit" disabled={!scanning || !manualBarcode.trim()}
                  className="rh-filled-action rounded-lg bg-purple-600 px-4 py-2 disabled:opacity-50">
                  {scanning ? 'Look up' : 'Looking up…'}
                </button>
              </div>
            </form>
            </>
          )}

        {/* Confirmation Dialog */}
        {scannedResult && (
          <div className="mb-2 bg-gray-100 rounded-xl p-4 sm:p-6 border border-gray-300">
            <h3 className="text-lg font-semibold text-gray-900 mb-4" role="status">Album found</h3>
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
                {/* Status badge for existing albums */}
                {scannedResult.existingStatus && (
                  <div className={`inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    scannedResult.existingStatus === 'collection'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-purple-100 text-purple-700'
                  }`}>
                    {scannedResult.existingStatus === 'collection' ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    )}
                    {scannedResult.existingStatus === 'collection' ? 'In Collection' : 'In Wishlist'}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
              {/* If album is in the wishlist, show prominent transfer button */}
              {scannedResult.existingStatus === 'wishlist' && scannedResult.existingAlbumId && (
                <button
                  onClick={handleTransferToCollection}
                  disabled={saving !== null}
                  className="rh-filled-action w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-3 disabled:opacity-60 group"
                >
                  {saving === 'move' ? (
                    <>
                      <span className="rh-action-spinner" aria-hidden="true" />
                      Moving…
                    </>
                  ) : (
                    <>
                      {/* Arrow up from wishlist to collection icon */}
                      <div className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <span>Move to Collection</span>
                    </>
                  )}
                </button>
              )}

              {/* If album is already in collection, show info badge */}
              {scannedResult.existingStatus === 'collection' && (
                <div className="w-full px-4 py-3 bg-green-50 border-2 border-green-200 text-green-700 rounded-xl font-medium flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Already in your Collection
                </div>
              )}

              {/* Standard add buttons - only show if album doesn't already exist */}
              {!scannedResult.existingStatus && (
                <>
                  <button
                    onClick={() => handleAddToCollection('collection')}
                    disabled={saving !== null}
                    className="rh-filled-action w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-60"
                  >
                    {saving === 'collection' ? 'Adding to Collection…' : 'Add to Collection'}
                  </button>
                  <button
                    onClick={() => handleAddToCollection('wishlist')}
                    disabled={saving !== null}
                    className="w-full px-4 py-2.5 text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100 rounded-lg font-medium transition-colors disabled:opacity-60"
                  >
                    {saving === 'wishlist' ? 'Adding to Wishlist…' : 'Add to Wishlist'}
                  </button>
                </>
              )}
              <button
                onClick={handleScanAnother}
                disabled={saving !== null}
                className="w-full px-4 py-2.5 border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition-colors disabled:opacity-60"
              >
                Scan Another
              </button>
            </div>
          </div>
        )}
        </div>

      </div>
    </ModalDialog>
  );
};
