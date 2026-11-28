import { useLayoutEffect, useRef, useState } from 'react';
import api, { ApiError, isExactSavedMatch, type Album, type BarcodeAlbumMatch, type DiscogsAlbum } from '../services/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { ModalDialog } from './ModalDialog';
import { SaveDestinationActions, type DestinationAction } from './SaveDestinationActions';
import { applyLookupPressingEdits, applyLookupShelfEdits, catalogAlbumReference, catalogSaveReference, discogsReleaseSource, type LookupPressingEdits, type LookupShelfEdits } from '../albumDisplay';
import { CatalogPressingPicker } from './CatalogPressingPicker';
import type { OpenSavedAlbum, SavePressing, UndoPressing } from './PressingComparison';
import { LookupRecovery } from './LookupRecovery';
import type { ManualAlbumDraft } from './ManualAlbumDialog';
import { barcodePattern } from '../services/barcodeInput';

type BarcodeMatch = BarcodeAlbumMatch & { barcode: string };
type Shelf = Album['status'];
type LookupFailure = 'invalid' | 'missing' | 'unavailable';
type BarcodeChoices = { barcode: string; matches: BarcodeAlbumMatch[]; savedMatch?: BarcodeMatch };
type Lookup = { status: 'scanning' | 'looking-up' }
  | { status: 'failed'; reason: LookupFailure; barcode: string }
  | { status: 'choosing'; choices: BarcodeChoices; returnIndex?: number }
  | { status: 'found'; match: BarcodeMatch; selection?: { choices: BarcodeChoices; index: number }; catalogLookup?: 'checking' | 'missing' | 'unavailable' }
  | { status: 'saved'; match: BarcodeMatch; destination: Shelf; album?: Album; movedId?: number; restored?: boolean };

const lookupMessages: Record<LookupFailure, string> = {
  invalid: 'Enter the 8, 12, 13, or 14 digits printed below the barcode.',
  missing: 'No release matched this barcode. Check the digits or search by name.',
  unavailable: 'Barcode lookup is unavailable right now. Retry or search by name.',
};
interface BarcodeScannerProps {
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  initialBarcode?: string;
  onSearchByCatalogNumber?: () => void;
  onSuccess: () => void;
  onSearchByName: (query?: string, draft?: ManualAlbumDraft) => void;
  onManual: (draft?: ManualAlbumDraft) => void;
  onMoveSaved: (id: number, title: string) => Promise<boolean>;
  onUndoMove: (id: number) => Promise<boolean>;
  onOpenSaved: OpenSavedAlbum;
  onSavePressing?: SavePressing;
  onUndoPressing?: UndoPressing;
  onSavedCopyRemoved?: (id: number) => void;
  lookupShelfEdits?: LookupShelfEdits;
  lookupPressingEdits?: LookupPressingEdits;
  viewMode: 'collection' | 'wishlist';
}

export const BarcodeScanner = ({
  onClose, onBack, backLabel, initialBarcode, onSearchByCatalogNumber,
  onSuccess, onSearchByName, onManual, onMoveSaved, onUndoMove, onOpenSaved, onSavePressing,
  onUndoPressing, onSavedCopyRemoved, lookupShelfEdits, lookupPressingEdits, viewMode,
}: BarcodeScannerProps) => {
  const [lookup, setLookup] = useState<Lookup>({ status: 'scanning' });
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const lookupInProgress = useRef(false);
  const [saving, setSaving] = useState<DestinationAction>();
  const [undoing, setUndoing] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const [duplicateId, setDuplicateId] = useState<number>();
  const [saveIssue, setSaveIssue] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [pressingReview, setPressingReview] = useState<{ album: DiscogsAlbum; destination: Shelf }>();
  const saveInProgress = useRef(false);
  const manualInput = useRef<HTMLInputElement>(null);
  const scannerTitle = useRef<HTMLHeadingElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const choicesTitle = useRef<HTMLHeadingElement>(null);
  const returnChoice = useRef<HTMLButtonElement>(null);
  const reviewOpener = useRef<HTMLButtonElement>(null);
  const openSavedButton = useRef<HTMLButtonElement>(null);
  const lastInput = useRef<'camera' | 'manual'>('manual');
  const focusNextScan = useRef(false);
  const completedBarcode = useRef<string | undefined>(undefined);
  const [manualBarcode, setManualBarcode] = useState(initialBarcode ?? '');
  const scannedResult = lookup.status === 'found'
    ? applyLookupShelfEdits(applyLookupPressingEdits(lookup.match, lookupPressingEdits), lookupShelfEdits) : null;
  const releaseId = scannedResult?.discogsId;
  const release = scannedResult && releaseId !== undefined && discogsReleaseSource(releaseId) ? {
    ...scannedResult, id: releaseId, discogsId: releaseId, source: 'discogs', discogsListing: 'release',
  } satisfies DiscogsAlbum : undefined;
  const titleOnly = scannedResult?.existingStatus && !isExactSavedMatch(scannedResult.existingMatch);
  const foundDuplicate = duplicateId !== undefined && lookupShelfEdits?.[duplicateId] !== null ? duplicateId : undefined;
  const scanning = lookup.status === 'scanning';
  const lookingUp = lookup.status === 'looking-up';
  const choosing = lookup.status === 'choosing';
  const savedMatch = choosing ? lookup.choices.savedMatch : undefined;
  const selection = lookup.status === 'found' ? lookup.selection : undefined;
  const checkingCatalog = lookup.status === 'found' && lookup.catalogLookup === 'checking';
  const failure = lookup.status === 'failed' && manualBarcode.trim() === lookup.barcode ? lookup.reason : undefined;

  useLayoutEffect(() => {
    if (initialBarcode !== undefined) manualInput.current?.focus({ preventScroll: true });
  }, [initialBarcode]);

  useLayoutEffect(() => {
    if (lookup.status === 'found' && !lookup.catalogLookup) resultTitle.current?.focus();
    if (lookup.status === 'choosing') (returnChoice.current ?? choicesTitle.current)?.focus();
    if (lookup.status === 'scanning' && focusNextScan.current) {
      focusNextScan.current = false;
      if (lastInput.current === 'manual') manualInput.current?.focus();
      else scannerTitle.current?.focus();
    }
  }, [lookup]);

  useLayoutEffect(() => {
    if (!pressingReview && (lookup.status === 'saved' || foundDuplicate !== undefined))
      (openSavedButton.current ?? resultTitle.current)?.focus();
  }, [foundDuplicate, lookup, pressingReview]);

  const lookUp = async (barcode: string, source: 'camera' | 'manual' = 'camera', savedMatch?: BarcodeMatch) => {
    if (lookupInProgress.current || (source === 'camera' && completedBarcode.current === barcode)) return;
    lastInput.current = source;
    if (source === 'manual') setCameraEnabled(false);
    setDuplicateId(undefined);
    setSaveIssue(undefined);

    setManualBarcode(barcode);
    if (!barcodePattern.test(barcode)) {
      setLookup({ status: 'failed', reason: 'invalid', barcode });
      return;
    }

    lookupInProgress.current = true;
    setLookup(savedMatch ? { status: 'found', match: savedMatch, catalogLookup: 'checking' } : { status: 'looking-up' });

    try {
      const result = savedMatch ? await api.scanBarcode(barcode, true) : await api.scanBarcode(barcode);
      if ('matches' in result || savedMatch) {
        const matches = 'matches' in result ? result.matches : [result];
        setLookup({ status: 'choosing', choices: { barcode, matches, savedMatch } });
      } else {
        setLookup({ status: 'found', match: { ...result, barcode } });
      }
    } catch (error) {
      let reason: LookupFailure = 'unavailable';
      if (error instanceof ApiError && error.status === 404) reason = 'missing';
      if (error instanceof ApiError && error.status === 400) reason = 'invalid';
      setLookup(savedMatch
        ? { status: 'found', match: savedMatch, catalogLookup: reason === 'missing' ? 'missing' : 'unavailable' }
        : { status: 'failed', reason, barcode });
    } finally {
      lookupInProgress.current = false;
    }
  };

  const chooseMatch = (choices: BarcodeChoices, index: number) => {
    setDuplicateId(undefined);
    setSaveIssue(undefined);
    setLookup({ status: 'found', match: { ...choices.matches[index], barcode: choices.barcode }, selection: { choices, index } });
  };

  const editBarcode = () => {
    lastInput.current = 'manual';
    focusNextScan.current = true;
    setCameraEnabled(false);
    setLookup({ status: 'scanning' });
  };

  const saveMatch = async (action: DestinationAction, confirmed?: DiscogsAlbum) => {
    if (!scannedResult || lookupInProgress.current || saveInProgress.current || foundDuplicate !== undefined) return false;
    const { existingStatus, existingAlbumId, existingMatch } = scannedResult;
    const moveId = action === 'move' && existingStatus === 'wishlist' && isExactSavedMatch(existingMatch) ? existingAlbumId : undefined;
    const adding = action !== 'move' && !existingStatus;
    if (!moveId && !adding) return false;

    saveInProgress.current = true;
    setSaving(action);
    setSaveIssue(undefined);
    try {
      if (moveId) {
        if (!await onMoveSaved(moveId, scannedResult.album)) return false;
        setLookup({ status: 'saved', match: scannedResult, destination: 'collection', movedId: moveId });
        return true;
      } else if (adding) {
        const reference = confirmed ? catalogSaveReference(confirmed) : release ? catalogAlbumReference(release)
          : { catalogListing: scannedResult.catalogListing ?? undefined };
        const { album } = await api.addAlbum({
          artist: scannedResult.artist,
          album: scannedResult.album,
          coverImageUrl: confirmed?.coverImageUrl ?? scannedResult.coverImageUrl,
          ...reference,
          applyCatalogReference: true,
          barcode: scannedResult.barcode,
          status: action,
        });
        setLookup({ status: 'saved', match: scannedResult, destination: action, album });
        onSuccess();
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.existingAlbumId !== undefined) {
        setDuplicateId(error.existingAlbumId);
      } else {
        setSaveIssue(error instanceof Error ? error.message : 'Could not save the album. Try again.');
      }
      return false;
    } finally {
      saveInProgress.current = false;
      setSaving(undefined);
    }
  };

  const openSaved = async (id: number, opener: HTMLButtonElement) => {
    if (opening) return;
    setOpening(true);
    const outcome = await onOpenSaved(id, opener, true);
    setOpening(false);
    if (outcome === 'unavailable') setSaveIssue('Could not open this saved album. Try again.');
    if (outcome === 'removed') {
      setSaveIssue('This album is no longer saved.');
      setDuplicateId(undefined);
      if (lookup.status === 'saved') setLookup({ ...lookup, album: undefined });
    }
  };

  const handleScanAnother = () => {
    completedBarcode.current = lookup.status === 'saved' ? lookup.match.barcode : undefined;
    focusNextScan.current = true;
    setManualBarcode('');
    setLookup({ status: 'scanning' });
    setDuplicateId(undefined);
    setSaveIssue(undefined);
    setUndoFailed(false);
    setCameraEnabled(lastInput.current === 'camera');
    if (lastInput.current === 'camera') retryCamera();
  };

  const undoSavedMove = async () => {
    if (lookup.status !== 'saved' || lookup.movedId === undefined || saveInProgress.current) return;
    saveInProgress.current = true;
    setUndoing(true);
    setUndoFailed(false);
    try {
      if (await onUndoMove(lookup.movedId)) {
        setLookup({ ...lookup, destination: 'wishlist', movedId: undefined, restored: true });
      } else {
        setUndoFailed(true);
      }
    } finally {
      saveInProgress.current = false;
      setUndoing(false);
    }
  };

  const { scannerRef, error, cameras, cameraId, setCameraId, retryCamera } = useBarcodeScanner(lookUp, scanning && cameraEnabled);
  const editMatchedSearch = () => {
    if (!scannedResult) return;
    const { artist, album } = scannedResult;
    onSearchByName(`${artist} ${album}`, { artist, album });
  };
  const toggleCamera = () => {
    if (cameraEnabled) {
      setCameraEnabled(false);
      lastInput.current = 'manual';
    } else {
      lastInput.current = 'camera';
      setCameraEnabled(true);
    }
  };
  const close = () => {
    if (!saveInProgress.current) onClose();
  };

  return (
    <ModalDialog labelledBy="barcode-title" onClose={close}>
      <div className="rh-dialog-panel max-w-lg flex flex-col">
        <header className="rh-dialog-header flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <svg aria-hidden="true" className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <h2 ref={scannerTitle} tabIndex={-1} id="barcode-title" className="text-lg font-bold text-gray-900">Look up a barcode</h2>
          </div>
          <button
            className="rh-dialog-close"
            aria-label="Close barcode lookup"
            disabled={!!saving || undoing}
            onClick={close}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {onBack && (!choosing || backLabel) && <button type="button" className="rh-lookup-link mb-2" disabled={!!saving || undoing}
            onClick={() => { if (!saveInProgress.current) onBack(); }}>{backLabel ?? 'Back to add methods'}</button>}
          {!scannedResult && lookup.status !== 'saved' && !choosing && (
            <>
              <form className="mb-2" noValidate onSubmit={event => {
                event.preventDefault();
                void lookUp(manualBarcode.trim(), 'manual');
              }}>
                <label htmlFor="manual-barcode" className="mb-1 block text-sm font-medium text-gray-700">
                  Enter barcode manually
                </label>
                <div className="flex gap-2">
                  <input
                    ref={manualInput}
                    id="manual-barcode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={manualBarcode}
                    onChange={event => setManualBarcode(event.target.value)}
                    disabled={lookingUp}
                    aria-invalid={failure === 'invalid'}
                    aria-describedby={failure ? 'barcode-lookup-error' : 'barcode-entry-hint'}
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
                {!failure && <p id="barcode-entry-hint" className="mt-1 text-xs text-gray-600">Use the digits printed below the barcode.</p>}
              </form>

              {lookingUp && <p className="my-2 text-sm text-gray-600" role="status">Looking up barcode…</p>}
              {failure && (
                <p id="barcode-lookup-error" className="my-2 text-sm text-red-600" role="alert">
                  {lookupMessages[failure]}
                </p>
              )}

              {failure && !lookingUp && onSearchByCatalogNumber && <button type="button" className="rh-lookup-link text-left"
                onClick={onSearchByCatalogNumber}>Look up the catalog number on the sleeve or label</button>}

              <div className="mb-4 flex flex-wrap gap-x-3">
                <button
                  type="button"
                  onClick={() => onSearchByName()}
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
                    {cameraEnabled ? 'Scan again' : 'Try another barcode'}
                  </button>
                )}
              </div>

              {scanning && (
                <div className="rh-camera-options">
                  <button type="button" className="rh-lookup-link" onClick={toggleCamera} aria-expanded={cameraEnabled}>
                    {cameraEnabled ? 'Stop camera' : 'Scan with camera'}
                  </button>
                </div>
              )}

              {scanning && cameraEnabled && (
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

          {lookup.status === 'choosing' && (
            <section className="space-y-2" aria-labelledby="barcode-choices-title">
              <div>
                <h3 ref={choicesTitle} id="barcode-choices-title" tabIndex={-1} className="text-lg font-semibold">
                  Choose the album on your sleeve
                </h3>
                <p className="text-sm text-gray-600">
                  Barcode <bdi className="tabular-nums">{lookup.choices.barcode}</bdi>
                  {' · '}{lookup.choices.matches.length} {lookup.choices.matches.length === 1 ? 'album match' : 'album matches'}
                </p>
              </div>
              <ul className="divide-y divide-gray-200 border-y border-gray-200" aria-label="Matching albums">
                {lookup.choices.matches.map((match, index, options) => {
                  const sameName = options.some((other, otherIndex) => otherIndex !== index &&
                    match.artist.toLowerCase() === other.artist.toLowerCase() && match.album.toLowerCase() === other.album.toLowerCase());
                  const reference = sameName && (match.masterId ? `Discogs album ${match.masterId}` : `Discogs release ${match.discogsId}`);
                  return (
                    <li key={match.discogsId}>
                      <button type="button" ref={lookup.returnIndex === index ? returnChoice : undefined}
                        className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100"
                        onClick={() => chooseMatch(lookup.choices, index)}>
                        {match.coverImageUrl && <img src={match.coverImageUrl} alt="" loading="lazy" className="size-10 shrink-0 rounded-sm object-cover" />}
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="block text-sm leading-snug font-semibold">{match.album}</span>
                          <span className="block text-xs leading-snug text-gray-600">
                            {[match.artist, match.year, reference].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-start gap-x-2">
                {savedMatch && <button type="button" className="rh-lookup-link"
                  onClick={() => setLookup({ status: 'found', match: savedMatch })}>Back to saved match</button>}
                <button type="button" className="rh-lookup-link" onClick={editBarcode}>Edit barcode</button>
                <button type="button" className="rh-lookup-link" onClick={() => onSearchByName()}>Search by name</button>
              </div>
            </section>
          )}
          {scannedResult && lookup.status === 'found' && (
            <div className="space-y-3">
              <div className="rh-lookup-record">
                {scannedResult.coverImageUrl && (
                  <img
                    src={scannedResult.coverImageUrl}
                    alt=""
                    className="size-16 shrink-0 rounded-lg object-cover sm:size-20"
                  />
                )}
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <h3 ref={resultTitle} tabIndex={-1} className="text-lg font-semibold text-gray-900">{scannedResult.album}</h3>
                  <p className="text-sm text-gray-600">{scannedResult.artist}</p>
                  {scannedResult.year && <p className="text-sm text-gray-500">{scannedResult.year}</p>}
                  <p className="mt-1 text-xs tabular-nums text-gray-600">Barcode {scannedResult.barcode}</p>
                </div>
              </div>
              {selection && <button type="button" className="rh-lookup-link" disabled={!!saving || opening}
                onClick={() => setLookup({ status: 'choosing', choices: selection.choices, returnIndex: selection.index })}>
                Back to barcode matches
              </button>}
              <div className="grid gap-2">
                {saving && <p role="status" className="text-sm text-gray-600">Saving this album…</p>}
                {saveIssue && <p role="alert" className="text-sm text-red-600">{saveIssue}</p>}
                {foundDuplicate !== undefined ? (
                  <div className="grid gap-1">
                    <p role="alert" className="text-sm">This album is already saved.</p>
                    <button ref={openSavedButton} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                      aria-busy={opening} aria-disabled={opening || checkingCatalog} onClick={event => {
                        if (!checkingCatalog) void openSaved(foundDuplicate, event.currentTarget);
                      }}>
                      Open saved album
                    </button>
                  </div>
                ) : <SaveDestinationActions
                  albumTitle={scannedResult.album}
                  preferred={viewMode}
                  existingStatus={scannedResult.existingStatus ?? undefined}
                  existingMatch={scannedResult.existingMatch}
                  existingAlbumId={scannedResult.existingAlbumId}
                  titleMatches={scannedResult.titleMatches}
                  lookup={{
                    artist: scannedResult.artist, year: scannedResult.year, releaseId: release?.discogsId,
                    source: discogsReleaseSource(release?.discogsId), pressing: scannedResult.pressing,
                  }}
                  lookupChoices={release?.pressingChoices?.map(choice => ({
                    artist: choice.artist, year: choice.year, releaseId: choice.discogsId, pressing: choice.pressing,
                  }))}
                  onReviewNewPressings={release && ((destination, opener) => {
                    reviewOpener.current = opener;
                    setSaveIssue(undefined);
                    setPressingReview({ album: release, destination });
                  })}
                  onSearch={editMatchedSearch}
                  searchLabel="Search catalogs by name"
                  onOpenSaved={onOpenSaved}
                  onSavePressing={release ? onSavePressing : undefined}
                  onUndoPressing={onUndoPressing}
                  onSavedCopyRemoved={onSavedCopyRemoved}
                  pending={saving}
                  disabled={checkingCatalog}
                  onSelect={action => void saveMatch(action)}
                />}
                {scannedResult.source === 'local' && (
                  <div>
                    <button type="button" className="rh-lookup-link" aria-disabled={checkingCatalog || opening || !!saving}
                      onClick={() => {
                        if (!opening && !saveInProgress.current) void lookUp(scannedResult.barcode, 'manual', scannedResult);
                      }}>
                      {lookup.catalogLookup === 'unavailable' ? 'Retry Discogs lookup' : 'Check Discogs for this barcode'}
                    </button>
                    {checkingCatalog && <p className="text-sm text-gray-600" role="status">Checking Discogs for other matches…</p>}
                    {lookup.catalogLookup === 'missing' && <p className="text-sm text-gray-600" role="status">Discogs has no matches for this barcode.</p>}
                    {lookup.catalogLookup === 'unavailable' && <p className="text-sm text-red-600" role="alert">
                      Could not check Discogs. Retry or continue with the saved match.
                    </p>}
                  </div>
                )}
                <div className="flex flex-wrap items-start justify-between gap-x-2">
                  {!titleOnly && <LookupRecovery draft={{ artist: scannedResult.artist, album: scannedResult.album }}
                    disabled={!!saving || checkingCatalog} onSearchByName={onSearchByName} onManual={onManual} />}
                  <button type="button" onClick={handleScanAnother} disabled={!!saving || checkingCatalog} className="rh-lookup-link">
                    Scan a different barcode
                  </button>
                </div>
              </div>
            </div>
          )}
          {lookup.status === 'saved' && (
            <div className="space-y-3">
              <div className="rh-lookup-record">
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h3 ref={resultTitle} tabIndex={-1} className="text-lg font-semibold text-gray-900">{lookup.match.album}</h3>
                  <p className="text-sm text-gray-600">{lookup.match.artist}</p>
                  <p role="status" className="mt-2 text-sm font-semibold">
                    {lookup.restored ? 'Moved back to Wishlist' : lookup.destination === 'collection' ? 'Saved to Collection' : 'Saved to Wishlist'}
                    {lookup.album && (lookup.album.discogs_id ? ` · Discogs release ${lookup.album.discogs_id}` : ' · Pressing unconfirmed')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {lookup.album && <button ref={openSavedButton} type="button" className="rh-lookup-link"
                  aria-busy={opening} aria-disabled={opening} onClick={event => void openSaved(lookup.album!.id, event.currentTarget)}>
                  Open saved album
                </button>}
                <button type="button" className="rh-primary-action px-4 text-sm font-semibold" disabled={undoing}
                  onClick={handleScanAnother}>Scan next</button>
                <button type="button" className="rh-lookup-link" onClick={close} disabled={undoing}>Done</button>
                {lookup.movedId !== undefined && <button type="button" className="rh-lookup-link" disabled={undoing}
                  onClick={() => void undoSavedMove()}>{undoing ? 'Undoing…' : 'Undo move'}</button>}
              </div>
              {saveIssue && <p role="alert" className="text-sm text-red-600">{saveIssue}</p>}
              {undoFailed && lookup.movedId !== undefined && (
                <div>
                  <p role="alert" className="text-sm text-red-600">Could not undo this move. Check the album’s current shelf.</p>
                  <button type="button" className="rh-lookup-link"
                    onClick={event => void onOpenSaved(lookup.movedId!, event.currentTarget)}>Open saved album</button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
      {pressingReview && (
        <CatalogPressingPicker album={pressingReview.album} destination={pressingReview.destination}
          opener={reviewOpener} fallback={openSavedButton} duplicate={foundDuplicate !== undefined}
          issue={foundDuplicate !== undefined ? 'This album is already saved.' : saveIssue}
          onOpenDuplicate={foundDuplicate === undefined ? undefined : opener => void openSaved(foundDuplicate, opener)}
          onClose={() => setPressingReview(undefined)}
          onSave={confirmed => saveMatch(pressingReview.destination, confirmed)}
          onSaveWithoutPressing={() => saveMatch(pressingReview.destination)} />
      )}
    </ModalDialog>
  );
};
