import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ApiError, type DiscogsAlbum, type PressingDetails, type SavedTitleMatch } from '../services/api';
import { createPressingDetailsLoader } from '../services/pressingEvidence';
import { discogsReleaseSource, savedCatalogSource, savedCopyContext, savedCopyLabel, type CatalogSource } from '../albumDisplay';
import { ModalDialog } from './ModalDialog';
import { PressingCandidates, type PressingCandidate } from './PressingCandidates';

export type SavedAlbumOutcome = 'opened' | 'removed' | 'unavailable';
export type OpenSavedAlbum = (id: number, opener: HTMLButtonElement, inlineError?: boolean) => Promise<SavedAlbumOutcome>;
export type SavePressing = (copy: SavedTitleMatch, releaseId: number) => Promise<{ album: SavedTitleMatch; undoToken: string }>;
export type UndoPressing = (copy: SavedTitleMatch, undoToken: string) => Promise<SavedTitleMatch>;

export interface LookupPressing {
  artist: string;
  year?: number;
  releaseId?: number;
  source?: CatalogSource;
  pressing?: PressingDetails;
  catalogNumberMatch?: DiscogsAlbum['catalogNumberMatch'];
}

interface PressingComparisonProps {
  title: string;
  lookup?: LookupPressing;
  lookupChoices?: LookupPressing[];
  searchedNumber?: string;
  matches: SavedTitleMatch[];
  onClose: () => void;
  onOpenSaved?: OpenSavedAlbum;
  onSavePressing?: SavePressing;
  onUndoPressing?: UndoPressing;
  onSavedCopyRemoved?: (id: number) => void;
  backLabel?: string;
  lookupStatus?: 'pending' | 'error' | 'ready';
  onRetryLookup?: () => void;
  onSearch?: () => void;
  searchLabel?: string;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  fallbackFocusTo: RefObject<HTMLElement | null>;
}

const pressingFields = [
  ['catalogNumber', 'Catalog number'],
  ['label', 'Label'],
  ['format', 'Format'],
  ['country', 'Country'],
  ['year', 'Release year'],
] as const;

type PressingField = typeof pressingFields[number][0];
type MatrixRunout = NonNullable<PressingDetails['matrixRunouts']>[number];
type ReleaseDetails = { status: 'available'; pressing: PressingDetails } | { status: 'missing' | 'failed' };
type ReleaseCandidate = LookupPressing & PressingCandidate;
type SaveSelection = {
  copyId: number;
  releaseId: number;
  previousRelease: SavedTitleMatch['discogs_id'];
  status: 'confirming' | 'saving' | 'failed';
  message?: string;
  changeSelection?: boolean;
};
type SavedChange = { previousRelease: SavedTitleMatch['discogs_id']; updated: SavedTitleMatch };
type PressingReceipt = {
  album: SavedTitleMatch;
  outcome: 'saved' | 'undone';
  undoToken?: string;
  error?: string;
};

function isReleaseCandidate(candidate?: LookupPressing): candidate is ReleaseCandidate {
  return !!discogsReleaseSource(candidate?.releaseId) && (!candidate?.source || candidate.source.kind === 'pressing');
}

function fieldValue(pressing: PressingDetails | undefined, key: PressingField) {
  return String(pressing?.[key] ?? '').trim() || undefined;
}

function candidateValue(candidate: LookupPressing | undefined, key: PressingField, details?: PressingDetails) {
  return fieldValue(details, key) ?? fieldValue(candidate?.pressing, key)
    ?? (key === 'year' && candidate?.year ? String(candidate.year) : undefined);
}

function candidateLabel(candidate: ReleaseCandidate, details?: PressingDetails) {
  const value = (key: PressingField) => candidateValue(candidate, key, details);
  return [
    value('catalogNumber'),
    value('country'),
    value('year'),
    value('label'),
    value('format'),
    `Discogs release ${candidate.releaseId}`,
  ].filter(Boolean).join(' · ');
}

function availableDetails(details?: ReleaseDetails) {
  return details?.status === 'available' ? details.pressing : undefined;
}

function catalogNumberKey(value?: string) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') ?? '';
}

async function fetchReleaseDetails(releaseId: number, signal: AbortSignal, loadDetails: ReturnType<typeof createPressingDetailsLoader>): Promise<ReleaseDetails> {
  try {
    const { pressing } = await loadDetails(releaseId, signal);
    return pressing && (pressing.matrixRunouts?.length || pressingFields.some(([key]) => fieldValue(pressing, key)))
      ? { status: 'available', pressing } : { status: 'missing' };
  } catch {
    return { status: 'failed' };
  }
}

function RunoutMarkings({ markings }: { markings: MatrixRunout[] }) {
  if (!markings.length) return null;
  const entries = (items: MatrixRunout[]) => (
    <ul className="space-y-1">{items.map(({ value, description }, index) => (
      <li key={`${index}-${value}`}><span className="font-medium">{value}</span>
        {description && <span className="block text-xs text-gray-600">{description}</span>}
      </li>
    ))}</ul>
  );
  return <>{entries(markings.slice(0, 2))}{markings.length > 2 && (
    <details className="mt-1">
      <summary className="min-h-11 cursor-pointer content-center text-sm">More markings</summary>
      {entries(markings.slice(2))}
    </details>
  )}</>;
}

function ReleaseDetailsStatus({ column, releaseId, details, hasRecord = true, hasGaps, onRetry }: {
  column: string;
  releaseId?: number;
  details?: ReleaseDetails;
  hasRecord?: boolean;
  hasGaps: boolean;
  onRetry: (releaseId: number) => void;
}) {
  const notice = useRef<HTMLParagraphElement>(null);
  const quiet = !!releaseId && details?.status === 'available' && !hasGaps;
  const message = !releaseId ? (hasRecord ? 'No pressing linked' : 'No saved copy')
    : !details ? 'Checking Discogs…'
      : details.status === 'failed' ? 'Discogs details couldn’t load.'
        : details.status === 'missing' ? 'Discogs has no additional details.'
          : hasGaps ? 'Dashes mark unlisted details.' : 'Discogs details loaded.';
  return (
    <>
      <p ref={notice} role="status" tabIndex={-1} className={`mt-0.5 text-xs font-normal text-gray-600${quiet ? ' sr-only focus:not-sr-only' : ''}`}>
        <span className="sr-only">{column}: </span>{message}
      </p>
      {releaseId !== undefined && details?.status === 'failed' && (
        <button type="button" className="rh-lookup-link mt-1 text-left" aria-label={`Retry details for ${column.toLowerCase()}`}
          onClick={() => {
            notice.current?.focus({ preventScroll: true });
            onRetry(releaseId);
          }}>
          Retry details
        </button>
      )}
    </>
  );
}

export function PressingComparison({
  title, lookup, lookupChoices, searchedNumber, matches, onClose, onOpenSaved, onSavePressing, onUndoPressing, onSavedCopyRemoved,
  backLabel, lookupStatus, onRetryLookup, onSearch,
  searchLabel = 'Edit album search', returnFocusTo, fallbackFocusTo,
}: PressingComparisonProps) {
  const headingId = useId();
  const copySelectId = useId();
  const savePromptId = useId();
  const saveErrorId = useId();
  const removalId = useId();
  const savedEvidenceId = useId();
  const [selectedId, setSelectedId] = useState<number>();
  const [candidateId, setCandidateId] = useState<number>();
  const [openingId, setOpeningId] = useState<number>();
  const [failedId, setFailedId] = useState<number>();
  const [removedCopies, setRemovedCopies] = useState<SavedTitleMatch[]>([]);
  const [saveSelection, setSaveSelection] = useState<SaveSelection>();
  const [savedChanges, setSavedChanges] = useState<Partial<Record<number, SavedChange>>>({});
  const [receipt, setReceipt] = useState<PressingReceipt>();
  const [undoing, setUndoing] = useState(false);
  const removalNotice = useRef<HTMLParagraphElement>(null);
  const returnAfterRemoval = useRef<HTMLButtonElement>(null);
  const copySelect = useRef<HTMLSelectElement>(null);
  const candidateRegion = useRef<HTMLDivElement>(null);
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const savePrompt = useRef<HTMLParagraphElement>(null);
  const confirmSave = useRef<HTMLButtonElement>(null);
  const changedNotice = useRef<HTMLParagraphElement>(null);
  const savedOutcome = useRef<HTMLParagraphElement>(null);
  const receiptNotice = useRef<HTMLParagraphElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const restoreSaveFocus = useRef(false);
  const saving = useRef(false);
  const releaseRequests = useRef(new Map<number, AbortController>());
  const [loadPressingDetails] = useState(createPressingDetailsLoader);
  const [details, setDetails] = useState<Partial<Record<number, ReleaseDetails>>>({});
  const removed = removedCopies.at(-1);
  const availableCopies = matches.filter(copy => !removedCopies.some(removedCopy => removedCopy.id === copy.id)).map(copy => {
    const change = savedChanges[copy.id];
    if (!change || copy.discogs_id !== change.previousRelease) return copy;
    const { discogs_id, catalog_listing, year } = change.updated;
    return { ...copy, discogs_id, catalog_listing, year };
  });
  const candidates = [lookup, ...(lookupChoices ?? [])].filter(isReleaseCandidate)
    .filter((candidate, index, choices) => choices.findIndex(choice => choice.releaseId === candidate.releaseId) === index);
  const candidate = candidates.length === 1 ? candidates[0] : candidates.find(choice => choice.releaseId === candidateId);
  const activeLookup = candidate ?? (candidates.length === 0 ? lookup : undefined);
  const catalogArtist = candidate?.artist ?? lookup?.artist ?? candidates[0]?.artist;
  const selected = availableCopies.find(copy => copy.id === selectedId) ?? availableCopies[0];
  const savedSource = selected ? savedCatalogSource(selected) : undefined;
  const lookupRelease = candidate?.releaseId;
  const lookupSource = activeLookup?.source ?? discogsReleaseSource(lookupRelease);
  const savedRelease = savedSource?.kind === 'pressing' ? selected?.discogs_id ?? undefined : undefined;
  const currentSelection = saveSelection && saveSelection.copyId === selected?.id &&
    saveSelection.releaseId === lookupRelease ? saveSelection : undefined;
  const sameSavedRelease = currentSelection?.previousRelease === selected?.discogs_id;
  const saveStatus = sameSavedRelease || currentSelection?.status === 'saving' ? currentSelection?.status : undefined;
  const savedReleaseChanged = !sameSavedRelease && currentSelection?.status === 'failed';
  const busy = saveSelection?.status === 'saving' || undoing || openingId !== undefined;
  const alreadySaved = !!lookupRelease && selected?.discogs_id === lookupRelease;
  const currentReceipt = receipt?.album.id === selected?.id ? receipt : undefined;
  const pressingUpdated = currentReceipt?.outcome === 'saved' && currentReceipt.album.discogs_id === savedRelease;
  const lookupPending = lookupStatus === 'pending';

  useLayoutEffect(() => {
    if (removed) (copySelect.current ?? savedOutcome.current ?? returnAfterRemoval.current ?? removalNotice.current)?.focus();
  }, [removed]);

  useLayoutEffect(() => {
    if (saveStatus === 'confirming') savePrompt.current?.focus();
    if (saveStatus === 'failed') confirmSave.current?.focus();
    if (savedReleaseChanged) changedNotice.current?.focus();
    if (!saveStatus && restoreSaveFocus.current) {
      restoreSaveFocus.current = false;
      saveTrigger.current?.focus();
    }
  }, [saveStatus, savedReleaseChanged]);

  useLayoutEffect(() => {
    if (receipt) (receiptNotice.current ?? savedOutcome.current)?.focus();
  }, [receipt]);

  useEffect(() => {
    const requests = releaseRequests.current;
    return () => {
      for (const request of requests.values()) request.abort();
      requests.clear();
    };
  }, []);

  useEffect(() => {
    const releaseIds = new Set([lookupRelease, savedRelease]);
    for (const [id, request] of releaseRequests.current) {
      if (releaseIds.has(id)) continue;
      request.abort();
      releaseRequests.current.delete(id);
    }
    for (const id of releaseIds) {
      if (!id || details[id] || releaseRequests.current.has(id)) continue;
      const request = new AbortController();
      releaseRequests.current.set(id, request);
      void fetchReleaseDetails(id, request.signal, loadPressingDetails).then(result => {
        if (request.signal.aborted) return;
        releaseRequests.current.delete(id);
        setDetails(current => ({ ...current, [id]: result }));
      });
    }
  }, [details, loadPressingDetails, lookupRelease, savedRelease]);

  const retryDetails = (releaseId: number) => {
    setDetails(current => ({ ...current, [releaseId]: undefined }));
  };

  const inspect = async (copy: SavedTitleMatch, opener: HTMLButtonElement) => {
    if (!onOpenSaved || openingId !== undefined || saving.current) return;
    setOpeningId(copy.id);
    setFailedId(undefined);
    const result = await onOpenSaved(copy.id, opener, true);
    if (result === 'removed') dropCopy(copy);
    if (result === 'unavailable') setFailedId(copy.id);
    setOpeningId(undefined);
  };

  const close = () => { if (!saving.current) onClose(); };
  const cancelSave = () => {
    if (saving.current) return;
    restoreSaveFocus.current = true;
    setSaveSelection(undefined);
  };
  const escape = () => {
    if (saveStatus) cancelSave();
    else close();
  };

  function dropCopy(copy: SavedTitleMatch) {
    setRemovedCopies(current => [...current, copy]);
    setSaveSelection(undefined);
    setReceipt(current => current?.album.id === copy.id ? undefined : current);
  }

  const rememberPressing = (updated: SavedTitleMatch, previousRelease: SavedTitleMatch['discogs_id']) => {
    setSavedChanges(current => ({ ...current, [updated.id]: { previousRelease, updated } }));
  };

  const save = async () => {
    if (!selected || !lookupRelease || !onSavePressing || !saveSelection || !saveStatus || busy || alreadySaved || saving.current || lookupPending) return;
    if (saveSelection.changeSelection) {
      const choices = candidateRegion.current;
      const choice = choices?.querySelector<HTMLInputElement>('input[type="radio"]:checked:not(:disabled)')
        ?? choices?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)');
      if (choice) {
        setSaveSelection(undefined);
        choice.focus();
      } else cancelSave();
      return;
    }
    const previousRelease = matches.find(copy => copy.id === selected.id)?.discogs_id;
    saving.current = true;
    setSaveSelection({ ...saveSelection, status: 'saving' });
    try {
      const { album, undoToken } = await onSavePressing(selected, lookupRelease);
      rememberPressing(album, previousRelease);
      setReceipt({ album, outcome: 'saved', undoToken });
      setSaveSelection(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        dropCopy(selected);
        onSavedCopyRemoved?.(selected.id);
        return;
      }
      const changeSelection = error instanceof ApiError && error.status === 422;
      setSaveSelection({ ...saveSelection, status: 'failed', changeSelection,
        message: error instanceof ApiError ? error.message : 'Couldn’t update this saved pressing. Try again.' });
    } finally {
      saving.current = false;
    }
  };

  const undo = async () => {
    if (!selected || !currentReceipt?.undoToken || !pressingUpdated || !onUndoPressing || busy || saving.current) return;
    const previousRelease = matches.find(copy => copy.id === selected.id)?.discogs_id;
    saving.current = true;
    setUndoing(true);
    setSaveSelection(undefined);
    try {
      const album = await onUndoPressing(currentReceipt.album, currentReceipt.undoToken);
      rememberPressing(album, previousRelease);
      setReceipt({ album, outcome: 'undone' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        dropCopy(selected);
        onSavedCopyRemoved?.(selected.id);
        return;
      }
      const retryable = !(error instanceof ApiError) || error.status >= 500;
      setReceipt({ ...currentReceipt, undoToken: retryable ? currentReceipt.undoToken : undefined,
        error: error instanceof ApiError ? error.message : 'Couldn’t undo the pressing change. Try again.' });
    } finally {
      saving.current = false;
      setUndoing(false);
    }
  };

  const lookupDetails = lookupRelease ? details[lookupRelease] : undefined;
  const savedDetails = savedRelease ? details[savedRelease] : undefined;
  const lookupPressing = availableDetails(lookupDetails);
  const savedPressing = availableDetails(savedDetails);
  const lookupRecord = [title, catalogArtist].filter(Boolean).join(' by ');
  const selectedShelf = selected?.status === 'collection' ? 'Collection' : 'Wishlist';
  const savedIdentityDiffers = selected && (selected.title !== title || selected.artist_name !== (catalogArtist ?? selected.artist_name));
  const action = openingId === selected?.id ? 'Opening saved copy…'
    : failedId === selected?.id ? 'Retry opening saved copy' : 'Open saved album';
  const sourceLink = (context: string, record: string, source?: CatalogSource) => source?.url && (
    <a href={source.url} target="_blank" rel="noreferrer" className="rh-comparison-source">
      {context} on {source.label}<span className="sr-only"> · {record}, {source.type} (opens in a new tab)</span>
    </a>
  );
  const fieldRows = pressingFields.map(([key, label]) => {
    const lookupValue = key !== 'year' || lookupRelease ? candidateValue(activeLookup, key, lookupPressing) : undefined;
    const savedValue = fieldValue(savedPressing, key) ?? (alreadySaved ? lookupValue : undefined);
    const differs = lookupValue && savedValue && (key === 'catalogNumber'
      ? catalogNumberKey(lookupValue) !== catalogNumberKey(savedValue)
      : lookupValue.toLowerCase() !== savedValue.toLowerCase());
    return { label, lookupValue, savedValue, priority: differs ? 0 : 1 };
  });
  const lookupRunouts = lookupPressing?.matrixRunouts ?? activeLookup?.pressing?.matrixRunouts ?? [];
  const savedRunouts = savedPressing?.matrixRunouts ?? (alreadySaved ? lookupRunouts : []);
  const runoutKeys = (markings: MatrixRunout[]) => [...new Set(markings.map(marking => marking.value.trim().toLowerCase()))].sort().join('\n');
  const runoutsDiffer = lookupRunouts.length && savedRunouts.length && runoutKeys(lookupRunouts) !== runoutKeys(savedRunouts);
  const runoutRow = lookupRunouts.length || savedRunouts.length ? [{
    label: 'Matrix / Runout',
    lookupValue: lookupRunouts.length ? <RunoutMarkings markings={lookupRunouts} /> : undefined,
    savedValue: savedRunouts.length ? <RunoutMarkings markings={savedRunouts} /> : undefined,
    priority: runoutsDiffer ? 0 : 1,
  }] : [];
  const evidence = [...fieldRows, ...runoutRow].sort((a, b) => a.priority - b.priority);
  const lookupHasGaps = evidence.some(row => !row.lookupValue);
  const savedHasGaps = evidence.some(row => !row.savedValue);
  const recordHelp = <details className="mt-1 max-w-prose text-sm text-gray-600">
    <summary className="min-h-11 cursor-pointer content-center font-medium">Where to check your record</summary>
    <p className="pb-2">Look for the catalog number on the sleeve or center label. The runout is the smooth band between the last track and the label. Match the etched or stamped letters and numbers to Matrix / Runout on Discogs when shown.</p>
  </details>;

  return (
    <ModalDialog labelledBy={headingId} onClose={close} onEscape={escape} returnFocusTo={returnFocusTo} fallbackFocusTo={fallbackFocusTo}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 id={headingId} ref={dialogHeading} tabIndex={-1} className="text-xl font-semibold">Review pressings</h2>
          <button type="button" className="rh-dialog-close" onClick={close} aria-label="Close pressing review"
            aria-disabled={saveSelection?.status === 'saving' || undoing}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:gap-5 sm:p-6 [overflow-wrap:anywhere]">
          <div>
            <p className="font-semibold">{title}</p>
            {(catalogArtist ?? selected?.artist_name) && <p className="text-sm text-gray-600">{catalogArtist ?? selected?.artist_name}</p>}
            {selected && (
              <div className="rh-comparison-outcome mt-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <p ref={savedOutcome} tabIndex={-1} role="status">
                    {pressingUpdated && 'Pressing updated. '}{currentReceipt?.outcome === 'undone' && 'Pressing change undone. '}
                    Saved in {selectedShelf} · {savedRelease ? `Discogs release ${savedRelease}` : 'Pressing unconfirmed'}
                  </p>
                  {pressingUpdated && currentReceipt?.undoToken && onUndoPressing && (
                    <button type="button" className="rh-lookup-link" aria-disabled={busy} aria-busy={undoing}
                      onClick={() => void undo()}>
                      {undoing ? 'Undoing…' : currentReceipt.error ? 'Retry undo' : 'Undo pressing change'}
                    </button>
                  )}
                </div>
                {savedIdentityDiffers && <p className="mt-0.5 font-normal">{selected.title} by {selected.artist_name}</p>}
                {currentReceipt?.error && <p ref={receiptNotice} tabIndex={-1} role="alert" className="text-sm font-normal text-red-600">{currentReceipt.error}</p>}
              </div>
            )}
          </div>
          {removed && (
            <div className="rounded-lg border border-gray-300 p-2 text-sm">
              <p id={removalId} ref={removalNotice} role="status" tabIndex={-1}>
                {savedCopyLabel(removed)} is no longer saved.
                {selected && ' Showing a remaining copy.'}
              </p>
              {!selected && <button ref={returnAfterRemoval} type="button" className="rh-lookup-link"
                aria-describedby={removalId} onClick={close}>{backLabel ?? 'Back to results'}</button>}
            </div>
          )}
          {lookupStatus && <div className={lookupStatus === 'ready' && candidates.length > 0 ? 'sr-only' : 'text-sm text-gray-600'}>
            <p role="status">{lookupPending ? 'Finding matching pressings on Discogs…' : lookupStatus === 'error'
              ? 'Couldn’t find catalog pressings right now.' : candidates.length > 0 ? 'Catalog pressings are ready.' : 'No matching Discogs pressings found.'}</p>
            {lookupStatus === 'error' && onRetryLookup && <button type="button" className="rh-lookup-link" onClick={() => {
              dialogHeading.current?.focus({ preventScroll: true });
              onRetryLookup();
            }}>Retry catalog search</button>}
          </div>}
          {selected && availableCopies.length > 1 && (
            <div className="rh-comparison-toolbar">
              <div className="rh-comparison-select">
                <label htmlFor={copySelectId} className="text-sm font-semibold">Saved copy to compare</label>
                <select ref={copySelect} id={copySelectId} value={selected.id} disabled={busy}
                  onChange={event => { setSelectedId(Number(event.target.value)); setFailedId(undefined); setSaveSelection(undefined); }}>
                  {availableCopies.map(copy => <option key={copy.id} value={copy.id}>{savedCopyContext(copy)}</option>)}
                </select>
              </div>
            </div>
          )}
          {!candidate && savedRelease && <section aria-labelledby={savedEvidenceId} className="grid gap-2 border-t border-gray-200 pt-3">
            <h3 id={savedEvidenceId} className="text-sm font-semibold">Saved pressing evidence</h3>
            <ReleaseDetailsStatus column="Saved copy" releaseId={savedRelease} details={savedDetails} hasGaps={false} onRetry={retryDetails} />
            {savedPressing && <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {fieldRows.map(({ label, savedValue }) => savedValue && <div key={label}>
                <dt className="text-xs text-gray-600">{label}</dt><dd className="font-medium">{savedValue}</dd>
              </div>)}
              {savedRunouts.length > 0 && <div className="col-span-full">
                <dt className="mb-1 text-xs text-gray-600">Matrix / Runout</dt>
                <dd><RunoutMarkings markings={savedRunouts} /></dd>
              </div>}
            </dl>}
          </section>}
          {candidates.length > 1 && <div ref={candidateRegion}>
            <PressingCandidates choices={candidates} selectedId={candidate?.releaseId}
              onSelect={id => { setCandidateId(id); setSaveSelection(undefined); }}
              searchedNumber={searchedNumber} savedReleaseId={savedRelease} disabled={busy || lookupPending}
              loadDetails={loadPressingDetails} />
          </div>}
          {candidate && <div>
            <table className="rh-pressing-table">
              <caption className="sr-only">Catalog evidence for {lookupRecord}</caption>
              <thead>
                <tr>
                  <th scope="col">Evidence</th>
                  <th scope="col" aria-label="Catalog match">Catalog match
                    <ReleaseDetailsStatus column="Catalog match" releaseId={lookupRelease} details={lookupDetails} hasGaps={lookupHasGaps} onRetry={retryDetails} />
                  </th>
                  <th scope="col" aria-label="Saved copy">Saved copy
                    <ReleaseDetailsStatus column="Saved copy" releaseId={savedRelease} details={savedDetails}
                      hasRecord={!!selected} hasGaps={savedHasGaps} onRetry={retryDetails} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {evidence.map(({ label, lookupValue, savedValue, priority }) => (
                  <tr key={label} className={priority === 0 ? 'rh-evidence-priority' : undefined}>
                    <th scope="row">{label}</th>
                    <td>{lookupValue || '—'}</td>
                    <td>{savedValue || '—'}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Discogs release ID</th><td>{lookupRelease}</td><td>{savedRelease ?? '—'}</td>
                </tr>
              </tbody>
            </table>
            {candidates.length === 1 && recordHelp}
          </div>}
          {selected && !lookupPending && <p className="text-sm text-gray-600">Side A saves one entry per artist and title.</p>}
          {onSavePressing && selected && candidate && !lookupPending && (!pressingUpdated || !alreadySaved) && (
            <div>
              {savedReleaseChanged && <p ref={changedNotice} tabIndex={-1} role="status" className="mb-2 text-sm text-gray-600">
                {alreadySaved ? 'The saved copy was updated and now matches this pressing.' : 'The saved pressing changed. Check the updated evidence before confirming again.'}
              </p>}
              {saveStatus ? (
                <div className="grid gap-2 rounded-lg border border-gray-300 p-3" role="group" aria-labelledby={savePromptId}>
                  <p id={savePromptId} ref={savePrompt} tabIndex={-1} className="text-sm font-medium">
                    Use {candidateLabel(candidate, lookupPressing)} for {availableCopies.length === 1
                      ? `${selected.title} in ${selectedShelf}` : savedCopyLabel(selected)}?
                  </p>
                  {savedRelease && <p className="text-sm text-gray-600">This will replace Discogs release {savedRelease} on this saved record.</p>}
                  {saveStatus === 'failed' && <p id={saveErrorId} role="alert" className="text-sm text-red-600">{saveSelection?.message}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rh-lookup-link" aria-disabled={busy} onClick={cancelSave}>Cancel</button>
                    <button ref={confirmSave} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                      aria-disabled={busy} aria-busy={saveStatus === 'saving'} aria-describedby={saveStatus === 'failed' ? saveErrorId : undefined}
                      onClick={() => void save()}>
                      {saveStatus === 'saving' ? 'Saving pressing…' : saveStatus === 'failed'
                        ? (saveSelection?.changeSelection ? 'Review selection' : 'Retry saving pressing') : 'Confirm pressing'}
                    </button>
                  </div>
                </div>
              ) : alreadySaved ? (
                !savedReleaseChanged && <p className="text-sm text-gray-600">This pressing is already saved.</p>
              ) : (
                <button ref={saveTrigger} type="button" className="rh-primary-action px-3 text-sm font-semibold" aria-disabled={busy}
                  onClick={() => {
                    if (!busy) setSaveSelection({ copyId: selected.id, releaseId: candidate.releaseId,
                      previousRelease: selected.discogs_id, status: 'confirming' });
                  }}>Use this pressing</button>
              )}
            </div>
          )}
          <div>
            <div className="rh-comparison-links">
              {selected && onOpenSaved && (
                <button type="button" className="rh-lookup-link text-left"
                  aria-label={`${action} · ${savedCopyLabel(selected)}`}
                  aria-haspopup="dialog" aria-disabled={busy} aria-busy={openingId === selected.id}
                  onClick={event => void inspect(selected, event.currentTarget)}>
                  {action}
                </button>
              )}
              {sourceLink('Catalog match', lookupRelease ? `${lookupRecord}, release ${lookupRelease}` : lookupRecord, lookupSource)}
              {selected && sourceLink('Saved copy', savedCopyLabel(selected), savedSource)}
              {onSearch && <button type="button" className="rh-lookup-link" aria-disabled={saveSelection?.status === 'saving' || undoing}
                onClick={() => { if (!saving.current) onSearch(); }}>{searchLabel}</button>}
              {backLabel && !(removed && !selected) && <button type="button" className="rh-lookup-link" aria-disabled={saveSelection?.status === 'saving' || undoing}
                onClick={close}>{backLabel}</button>}
            </div>
            {selected && failedId === selected.id && <p role="alert" className="px-2 text-sm text-red-600">Couldn’t open this saved copy. Try again.</p>}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
