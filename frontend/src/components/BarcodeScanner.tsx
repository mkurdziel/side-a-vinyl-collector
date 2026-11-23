import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { ApiError } from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { ModalDialog } from './ModalDialog';
import { SaveDestinationActions, type DestinationAction } from './SaveDestinationActions';

type BarcodeMatch = Awaited<ReturnType<typeof api.scanBarcode>> & { barcode: string };
type LookupFailure = 'invalid' | 'missing' | 'unavailable';
type Lookup = { status: 'scanning' | 'looking-up' }
  | { status: 'failed'; reason: LookupFailure; barcode: string }
  | { status: 'found'; match: BarcodeMatch };

const lookupMessages: Record<LookupFailure, string> = {
  invalid: 'Enter the 8, 12, 13, or 14 digits printed below the barcode.',
  missing: 'No release matched this barcode. Check the digits or search by name.',
  unavailable: 'Barcode lookup is unavailable right now. Retry or search by name.',
};
const barcodePattern = /^(?:[0-9]{8}|[0-9]{12,14})$/;

interface BarcodeScannerProps {
  onClose: () => void;
  onSuccess: () => void;
  onSearchByName: () => void;
  onMoveSaved: (id: number, title: string) => Promise<boolean>;
  onOpenSaved: (id: number) => Promise<void>;
  viewMode: 'collection' | 'wishlist';
}

export const BarcodeScanner = ({ onClose, onSuccess, onSearchByName, onMoveSaved, onOpenSaved, viewMode }: BarcodeScannerProps) => {
  const [lookup, setLookup] = useState<Lookup>({ status: 'scanning' });
  const lookupInProgress = useRef(false);
  const [saving, setSaving] = useState<DestinationAction>();
  const [duplicateId, setDuplicateId] = useState<number>();
  const saveInProgress = useRef(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const scannedResult = lookup.status === 'found' ? lookup.match : null;
  const scanning = lookup.status === 'scanning';
  const lookingUp = lookup.status === 'looking-up';
  const failure = lookup.status === 'failed' && manualBarcode.trim() === lookup.barcode ? lookup.reason : undefined;

  const lookUp = async (barcode: string) => {
    if (lookupInProgress.current) return;
    setDuplicateId(undefined);

    setManualBarcode(barcode);
    if (!barcodePattern.test(barcode)) {
      setLookup({ status: 'failed', reason: 'invalid', barcode });
      return;
    }

    lookupInProgress.current = true;
    setLookup({ status: 'looking-up' });

    try {
      const result = await api.scanBarcode(barcode);
      setLookup({ status: 'found', match: { ...result, barcode } });
    } catch (error) {
      let reason: LookupFailure = 'unavailable';
      if (error instanceof ApiError && error.status === 404) reason = 'missing';
      if (error instanceof ApiError && error.status === 400) reason = 'invalid';
      setLookup({ status: 'failed', reason, barcode });
    } finally {
      lookupInProgress.current = false;
    }
  };

  const saveMatch = async (action: DestinationAction) => {
    if (!scannedResult || saveInProgress.current) return;
    const { existingStatus, existingAlbumId } = scannedResult;
    const moveId = action === 'move' && existingStatus === 'wishlist' ? existingAlbumId : undefined;
    const adding = action !== 'move' && !existingStatus;
    if (!moveId && !adding) return;

    saveInProgress.current = true;
    setSaving(action);
    try {
      if (moveId) {
        if (!await onMoveSaved(moveId, scannedResult.album)) return;
        onClose();
        return;
      } else if (adding) {
        await api.addAlbum({
          artist: scannedResult.artist,
          album: scannedResult.album,
          year: scannedResult.year,
          coverImageUrl: scannedResult.coverImageUrl,
          discogsId: scannedResult.discogsId,
          barcode: scannedResult.barcode,
          status: action,
        });
        toast.success(`Added “${scannedResult.album}” to ${action === 'collection' ? 'Collection' : 'Wishlist'}.`);
      }
      onSuccess();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.existingAlbumId !== undefined) {
        setDuplicateId(error.existingAlbumId);
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not save the album. Try again.');
      }
    } finally {
      saveInProgress.current = false;
      setSaving(undefined);
    }
  };

  const handleScanAnother = () => {
    setManualBarcode('');
    setLookup({ status: 'scanning' });
    setDuplicateId(undefined);
    retryCamera();
  };

  const { scannerRef, error, cameras, cameraId, setCameraId, retryCamera } = useBarcodeScanner(lookUp, scanning);
  const close = () => {
    if (!saveInProgress.current) onClose();
  };

  return (
    <ModalDialog labelledBy="barcode-title" onClose={close}>
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
            disabled={!!saving}
            onClick={close}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {!scannedResult && (
            <>
              <form className="mb-2" noValidate onSubmit={event => {
                event.preventDefault();
                void lookUp(manualBarcode.trim());
              }}>
                <label htmlFor="manual-barcode" className="mb-1 block text-sm font-medium text-gray-700">
                  Enter barcode manually
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-barcode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={manualBarcode}
                    onChange={event => setManualBarcode(event.target.value)}
                    disabled={lookingUp}
                    aria-invalid={failure === 'invalid'}
                    aria-describedby={failure ? 'barcode-lookup-error' : undefined}
                    required
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 p-2"
                  />
                  <button
                    type="submit"
                    disabled={!manualBarcode.trim()}
                    aria-disabled={lookingUp || undefined}
                    className="rh-filled-action min-h-11 rounded-lg bg-purple-600 px-3 py-2 disabled:opacity-50 aria-disabled:opacity-60"
                  >
                    {lookingUp ? 'Looking up…' : failure === 'unavailable' ? 'Retry lookup' : 'Look up'}
                  </button>
                </div>
              </form>

              {lookingUp && <p className="my-2 text-sm text-gray-600" role="status">Looking up barcode…</p>}
              {failure && (
                <p id="barcode-lookup-error" className="my-2 text-sm text-red-600" role="alert">
                  {lookupMessages[failure]}
                </p>
              )}

              <div className="mb-4 flex flex-wrap gap-x-3">
                <button
                  type="button"
                  onClick={onSearchByName}
                  className="min-h-11 rounded-lg px-2 text-sm font-medium text-purple-600 hover:bg-gray-100"
                >
                  Search by name
                </button>
                {lookup.status === 'failed' && (
                  <button
                    type="button"
                    onClick={handleScanAnother}
                    className="min-h-11 rounded-lg px-2 text-sm font-medium text-purple-600 hover:bg-gray-100"
                  >
                    Scan again
                  </button>
                )}
              </div>

              {scanning && (
                <>
                  {cameras.length > 1 && (
                    <label className="mb-3 block text-sm font-medium text-gray-700">
                      Camera
                      <select
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2"
                        value={cameraId}
                        onChange={event => setCameraId(event.target.value)}
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
                  <div className={error ? 'hidden' : 'relative mb-3 aspect-[4/3] overflow-hidden rounded-xl bg-black'}>
                    <div ref={scannerRef} className="size-full [&>video]:size-full [&>video]:object-contain [&>canvas]:hidden" />
                    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                      <div className="absolute left-1/2 top-1/2 h-40 w-3/4 max-w-xs -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-purple-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                        <div className="animate-scan absolute inset-x-0 top-1/2 h-0.5 bg-purple-500" />
                      </div>
                    </div>
                  </div>
                  {error ? (
                    <div className="rounded-lg border border-gray-300 px-3 py-2">
                      <p className="text-sm text-red-600" role="alert">{error}</p>
                      <button
                        type="button"
                        onClick={retryCamera}
                        className="min-h-11 rounded-lg px-2 text-sm font-medium text-purple-600 hover:bg-gray-100"
                      >
                        Retry camera
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">
                      Keep the whole barcode in the frame. Move farther back if it looks blurry.
                    </p>
                  )}
                </>
              )}
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
              </div>
            </div>
            <div className="grid gap-2">
              {saving && <p role="status" className="text-sm text-gray-600">Saving this album…</p>}
              {duplicateId !== undefined ? (
                <div className="grid gap-1">
                  <p role="alert" className="text-sm">This album is already saved.</p>
                  <button type="button" className="rh-primary-action px-3 text-sm font-semibold"
                    onClick={() => void onOpenSaved(duplicateId)}>Open saved album</button>
                </div>
              ) : <SaveDestinationActions
                albumTitle={scannedResult.album}
                preferred={viewMode}
                existingStatus={scannedResult.existingStatus ?? undefined}
                canMove={Boolean(scannedResult.existingAlbumId)}
                onOpenSaved={scannedResult.existingAlbumId ? () => void onOpenSaved(scannedResult.existingAlbumId!) : undefined}
                pending={saving}
                onSelect={action => void saveMatch(action)}
              />}
              <button
                type="button"
                onClick={handleScanAnother}
                disabled={!!saving}
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
