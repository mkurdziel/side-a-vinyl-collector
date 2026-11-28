import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import api, { ApiError, type PressingDetails, type SavedTitleMatch } from '../services/api';
import { discogsReleaseSource, listingEvidence, savedCatalogSource, savedCopyContext, savedCopyLabel, type CatalogSource } from '../albumDisplay';
import { ModalDialog } from './ModalDialog';

export type SavedAlbumOutcome = 'opened' | 'removed' | 'unavailable';
export type OpenSavedAlbum = (id: number, opener: HTMLButtonElement, inlineError?: boolean) => Promise<SavedAlbumOutcome>;

export interface LookupPressing {
  artist: string;
  year?: number;
  releaseId?: number;
  source?: CatalogSource;
  pressing?: PressingDetails;
}

interface PressingComparisonProps {
  title: string;
  lookup?: LookupPressing;
  lookupChoices?: LookupPressing[];
  matches: SavedTitleMatch[];
  onClose: () => void;
  onOpenSaved: OpenSavedAlbum;
  onSavePressing?: (copy: SavedTitleMatch, releaseId: number) => Promise<SavedTitleMatch>;
  onSearch?: () => void;
  searchLabel?: string;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  fallbackFocusTo: RefObject<HTMLButtonElement | null>;
}

const pressingFields = [
  ['catalogNumber', 'Catalog number'],
  ['label', 'Label'],
  ['format', 'Format'],
  ['country', 'Country'],
] as const;

type ReleaseDetails = { status: 'available'; pressing: PressingDetails } | { status: 'missing' | 'failed' };
type ReleaseCandidate = LookupPressing & { releaseId: number };
type SaveSelection = {
  copyId: number;
  releaseId: number;
  previousRelease: SavedTitleMatch['discogs_id'];
  status: 'confirming' | 'saving' | 'failed';
  message?: string;
  changeSelection?: boolean;
};
type SavedChange = { previousRelease: SavedTitleMatch['discogs_id']; updated: SavedTitleMatch };
const releaseDetailsMessages = {
  available: 'Available',
  missing: 'No details returned',
  failed: 'Couldn’t load details',
};

function isReleaseCandidate(candidate?: LookupPressing): candidate is ReleaseCandidate {
  return !!discogsReleaseSource(candidate?.releaseId) && (!candidate?.source || candidate.source.kind === 'pressing');
}

function candidateLabel(candidate: ReleaseCandidate, details?: PressingDetails) {
  return [
    details?.catalogNumber?.trim() || candidate.pressing?.catalogNumber?.trim() || 'Catalog number unavailable',
    details?.format?.trim() || candidate.pressing?.format?.trim(),
    details?.year ?? candidate.year,
    `Discogs release ${candidate.releaseId}`,
  ].filter(Boolean).join(' · ');
}

async function fetchReleaseDetails(releaseId: number, signal: AbortSignal): Promise<ReleaseDetails> {
  try {
    const { pressing } = await api.getPressingDetails(releaseId, signal);
    return pressing && (pressing.year || pressingFields.some(([key]) => pressing[key]?.trim()))
      ? { status: 'available', pressing } : { status: 'missing' };
  } catch {
    return { status: 'failed' };
  }
}

function ReleaseDetailsStatus({ column, releaseId, details, hasRecord = true, onRetry }: {
  column: string;
  releaseId?: number;
  details?: ReleaseDetails;
  hasRecord?: boolean;
  onRetry: (releaseId: number) => void;
}) {
  const notice = useRef<HTMLParagraphElement>(null);
  let message = hasRecord ? 'No specific release' : 'No saved copy';
  if (releaseId) message = details ? releaseDetailsMessages[details.status] : 'Checking Discogs…';
  return (
    <>
      <p ref={notice} role="status" tabIndex={-1} className="text-sm text-gray-600">
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
  title, lookup, lookupChoices, matches, onClose, onOpenSaved, onSavePressing, onSearch,
  searchLabel = 'Edit album search', returnFocusTo, fallbackFocusTo,
}: PressingComparisonProps) {
  const headingId = useId();
  const copySelectId = useId();
  const candidateSelectId = useId();
  const savePromptId = useId();
  const saveErrorId = useId();
  const [selectedId, setSelectedId] = useState<number>();
  const [candidateId, setCandidateId] = useState<number>();
  const [openingId, setOpeningId] = useState<number>();
  const [failedId, setFailedId] = useState<number>();
  const [removed, setRemoved] = useState<SavedTitleMatch>();
  const [saveSelection, setSaveSelection] = useState<SaveSelection>();
  const [savedChanges, setSavedChanges] = useState<Partial<Record<number, SavedChange>>>({});
  const removalNotice = useRef<HTMLParagraphElement>(null);
  const candidateSelect = useRef<HTMLSelectElement>(null);
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const savePrompt = useRef<HTMLParagraphElement>(null);
  const confirmSave = useRef<HTMLButtonElement>(null);
  const changedNotice = useRef<HTMLParagraphElement>(null);
  const savedOutcome = useRef<HTMLDivElement>(null);
  const restoreSaveFocus = useRef(false);
  const saving = useRef(false);
  const releaseRequests = useRef(new Map<number, AbortController>());
  const [details, setDetails] = useState<Partial<Record<number, ReleaseDetails>>>({});
  const availableCopies = matches.filter(copy => copy.id !== removed?.id).map(copy => {
    const change = savedChanges[copy.id];
    if (!change || copy.discogs_id !== change.previousRelease) return copy;
    const { discogs_id, catalog_listing, year } = change.updated;
    return { ...copy, discogs_id, catalog_listing, year };
  });
  const candidates = [lookup, ...(lookupChoices ?? [])].filter(isReleaseCandidate)
    .filter((candidate, index, choices) => choices.findIndex(choice => choice.releaseId === candidate.releaseId) === index);
  const candidate = candidates.find(choice => choice.releaseId === candidateId) ?? candidates[0];
  const activeLookup = candidate ?? lookup;
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
  const busy = saveSelection?.status === 'saving' || openingId !== undefined;
  const alreadySaved = !!lookupRelease && selected?.discogs_id === lookupRelease;
  const pressingUpdated = !!selected && !!savedRelease && savedChanges[selected.id]?.updated.discogs_id === savedRelease;

  useLayoutEffect(() => {
    if (removed) removalNotice.current?.focus();
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
    if (Object.keys(savedChanges).length) savedOutcome.current?.focus();
  }, [savedChanges]);

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
      void fetchReleaseDetails(id, request.signal).then(result => {
        if (request.signal.aborted) return;
        releaseRequests.current.delete(id);
        setDetails(current => ({ ...current, [id]: result }));
      });
    }
  }, [details, lookupRelease, savedRelease]);

  const retryDetails = (releaseId: number) => {
    setDetails(current => ({ ...current, [releaseId]: undefined }));
  };

  const inspect = async (copy: SavedTitleMatch, opener: HTMLButtonElement) => {
    if (openingId !== undefined || saving.current) return;
    setOpeningId(copy.id);
    setFailedId(undefined);
    const result = await onOpenSaved(copy.id, opener, true);
    if (result === 'removed') setRemoved(copy);
    if (result === 'unavailable') setFailedId(copy.id);
    setOpeningId(undefined);
  };

  const close = () => { if (!saving.current) onClose(); };

  const save = async () => {
    if (!selected || !lookupRelease || !onSavePressing || !saveSelection || !saveStatus || busy || alreadySaved || saving.current) return;
    if (saveSelection.changeSelection) {
      if (!candidateSelect.current) restoreSaveFocus.current = true;
      setSaveSelection(undefined);
      candidateSelect.current?.focus();
      return;
    }
    const previousRelease = matches.find(copy => copy.id === selected.id)?.discogs_id;
    saving.current = true;
    setSaveSelection({ ...saveSelection, status: 'saving' });
    try {
      const updated = await onSavePressing(selected, lookupRelease);
      setSavedChanges(current => ({ ...current, [updated.id]: { previousRelease, updated } }));
      setSaveSelection(undefined);
    } catch (error) {
      const changeSelection = error instanceof ApiError && (error.status === 404 || error.status === 422);
      setSaveSelection({ ...saveSelection, status: 'failed', changeSelection,
        message: error instanceof ApiError ? error.message : 'Couldn’t update this saved pressing. Try again.' });
    } finally {
      saving.current = false;
    }
  };

  const lookupDetails = lookupRelease ? details[lookupRelease] : undefined;
  const savedDetails = savedRelease ? details[savedRelease] : undefined;
  const lookupPressing = lookupDetails?.status === 'available' ? lookupDetails.pressing : undefined;
  const savedPressing = savedDetails?.status === 'available' ? savedDetails.pressing : undefined;
  const lookupRecord = [title, activeLookup?.artist].filter(Boolean).join(' by ');
  const selectedShelf = selected?.status === 'collection' ? 'Collection' : 'Wishlist';
  const savedIdentityDiffers = selected && (selected.title !== title || selected.artist_name !== activeLookup?.artist);
  const action = openingId === selected?.id ? 'Opening saved copy…'
    : failedId === selected?.id ? 'Retry opening saved copy' : 'Open saved album';
  const sourceLink = (context: string, record: string, source?: CatalogSource) => source?.url && (
    <a href={source.url} target="_blank" rel="noreferrer" className="rh-comparison-source">
      {context} on {source.label}<span className="sr-only"> · {record}, {source.type} (opens in a new tab)</span>
    </a>
  );
  const evidence = [
    ['Listing', listingEvidence(lookupSource), selected ? listingEvidence(savedSource) : undefined],
    ...pressingFields.map(([key, label]) => [
      label,
      lookupPressing?.[key]?.trim() || activeLookup?.pressing?.[key]?.trim(),
      savedPressing?.[key]?.trim(),
    ]),
    ['Release year', lookupPressing?.year ?? (lookupRelease ? activeLookup?.year : undefined),
      savedPressing?.year ?? (alreadySaved ? activeLookup?.year : undefined)],
    ['Discogs release ID', lookupRelease, savedRelease],
  ];

  return (
    <ModalDialog labelledBy={headingId} onClose={close} returnFocusTo={returnFocusTo} fallbackFocusTo={fallbackFocusTo}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 id={headingId} className="text-xl font-semibold">Compare pressings</h2>
          <button type="button" className="rh-dialog-close" onClick={close} aria-label="Close pressing comparison"
            aria-disabled={saveSelection?.status === 'saving'}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:gap-5 sm:p-6 [overflow-wrap:anywhere]">
          <div>
            <p className="font-semibold">{title}</p>
            {activeLookup?.artist && <p className="text-sm text-gray-600">{activeLookup.artist}</p>}
            {selected && (
              <div ref={savedOutcome} tabIndex={-1} className="rh-comparison-outcome mt-2" aria-live="polite">
                <p>{pressingUpdated && 'Pressing updated. '}Saved in {selectedShelf} · {savedRelease ? `Discogs release ${savedRelease}` : 'Pressing unconfirmed'}</p>
                {savedIdentityDiffers && <p className="mt-0.5 font-normal">{selected.title} by {selected.artist_name}</p>}
              </div>
            )}
          </div>
          {removed && (
            <p ref={removalNotice} role="status" tabIndex={-1} className="rounded-lg border border-gray-300 p-2 text-sm">
              {savedCopyLabel(removed)} is no longer saved.
              {selected ? ' Choose a remaining copy to compare.' : ' Close the comparison to return to the lookup.'}
            </p>
          )}
          {(candidates.length > 1 || (selected && availableCopies.length > 1)) && (
            <div className="rh-comparison-toolbar">
              {candidate && candidates.length > 1 && <div className="rh-comparison-select">
                <label htmlFor={candidateSelectId} className="text-sm font-semibold">Catalog pressing to compare</label>
                <select ref={candidateSelect} id={candidateSelectId} value={candidate.releaseId} disabled={busy}
                  onChange={event => { setCandidateId(Number(event.target.value)); setSaveSelection(undefined); }}>
                  {candidates.map(choice => <option key={choice.releaseId} value={choice.releaseId}>{candidateLabel(choice)}</option>)}
                </select>
              </div>}
              {selected && availableCopies.length > 1 && <div className="rh-comparison-select">
                <label htmlFor={copySelectId} className="text-sm font-semibold">Saved copy to compare</label>
                <select id={copySelectId} value={selected.id} disabled={busy}
                  onChange={event => { setSelectedId(Number(event.target.value)); setFailedId(undefined); setSaveSelection(undefined); }}>
                  {availableCopies.map(copy => <option key={copy.id} value={copy.id}>{savedCopyContext(copy)}</option>)}
                </select>
              </div>}
            </div>
          )}
          <div>
            <p className="mb-2 max-w-prose text-sm text-gray-600">Check the catalog number on the sleeve or record label.</p>
            <table className="rh-pressing-table">
              <caption className="sr-only">Catalog evidence for {lookupRecord}</caption>
              <thead>
                <tr><th scope="col">Evidence</th><th scope="col">Catalog match</th><th scope="col">Saved copy</th></tr>
              </thead>
              <tbody>
                {evidence.map(([label, lookupValue, savedValue]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{lookupValue || '—'}</td>
                    <td>{savedValue || '—'}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Release details</th>
                  <td><ReleaseDetailsStatus column="Catalog match" releaseId={lookupRelease} details={lookupDetails} onRetry={retryDetails} /></td>
                  <td><ReleaseDetailsStatus column="Saved copy" releaseId={savedRelease} details={savedDetails}
                    hasRecord={!!selected} onRetry={retryDetails} /></td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-sm text-gray-600">Side A saves one entry per artist and title.</p>
          </div>
          {onSavePressing && selected && candidate && (!pressingUpdated || !alreadySaved) && (
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
                    <button type="button" className="rh-lookup-link" aria-disabled={busy}
                      onClick={() => {
                        if (saving.current) return;
                        restoreSaveFocus.current = true;
                        setSaveSelection(undefined);
                      }}>Cancel</button>
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
              {selected && (
                <button type="button" className="rh-lookup-link text-left"
                  aria-label={`${action} · ${savedCopyLabel(selected)}`}
                  aria-haspopup="dialog" aria-disabled={busy} aria-busy={openingId === selected.id}
                  onClick={event => void inspect(selected, event.currentTarget)}>
                  {action}
                </button>
              )}
              {sourceLink('Catalog match', lookupRelease ? `${lookupRecord}, release ${lookupRelease}` : lookupRecord, lookupSource)}
              {selected && sourceLink('Saved copy', savedCopyLabel(selected), savedSource)}
              {onSearch && <button type="button" className="rh-lookup-link" aria-disabled={saveSelection?.status === 'saving'}
                onClick={() => { if (!saving.current) onSearch(); }}>{searchLabel}</button>}
            </div>
            {selected && failedId === selected.id && <p role="alert" className="px-2 text-sm text-red-600">Couldn’t open this saved copy. Try again.</p>}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
