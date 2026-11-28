import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import api, { type PressingDetails, type SavedTitleMatch } from '../services/api';
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
  matches: SavedTitleMatch[];
  onClose: () => void;
  onOpenSaved: OpenSavedAlbum;
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
const releaseDetailsMessages = {
  available: 'Available',
  missing: 'No details returned',
  failed: 'Couldn’t load details',
};

async function fetchReleaseDetails(releaseId: number, signal: AbortSignal): Promise<ReleaseDetails> {
  try {
    const { pressing } = await api.getPressingDetails(releaseId, signal);
    return pressing && pressingFields.some(([key]) => pressing[key]?.trim())
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
  title, lookup, matches, onClose, onOpenSaved, onSearch, searchLabel = 'Edit album search', returnFocusTo, fallbackFocusTo,
}: PressingComparisonProps) {
  const headingId = useId();
  const copySelectId = useId();
  const [selectedId, setSelectedId] = useState<number>();
  const [openingId, setOpeningId] = useState<number>();
  const [failedId, setFailedId] = useState<number>();
  const [removed, setRemoved] = useState<SavedTitleMatch>();
  const removalNotice = useRef<HTMLParagraphElement>(null);
  const releaseRequests = useRef(new Map<number, AbortController>());
  const [details, setDetails] = useState<Partial<Record<number, ReleaseDetails>>>({});
  const availableCopies = matches.filter(copy => copy.id !== removed?.id);
  const selected = availableCopies.find(copy => copy.id === selectedId) ?? availableCopies[0];
  const savedSource = selected ? savedCatalogSource(selected) : undefined;
  const releaseSource = discogsReleaseSource(lookup?.releaseId);
  const lookupSource = lookup?.source ?? releaseSource;
  const lookupRelease = releaseSource && lookupSource?.kind === 'pressing' ? lookup?.releaseId : undefined;
  const savedRelease = savedSource?.kind === 'pressing' ? selected?.discogs_id ?? undefined : undefined;

  useLayoutEffect(() => {
    if (removed) removalNotice.current?.focus();
  }, [removed]);

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
    if (openingId !== undefined) return;
    setOpeningId(copy.id);
    setFailedId(undefined);
    const result = await onOpenSaved(copy.id, opener, true);
    if (result === 'removed') setRemoved(copy);
    if (result === 'unavailable') setFailedId(copy.id);
    setOpeningId(undefined);
  };

  const lookupDetails = lookupRelease ? details[lookupRelease] : undefined;
  const savedDetails = savedRelease ? details[savedRelease] : undefined;
  const lookupPressing = lookupDetails?.status === 'available' ? lookupDetails.pressing : undefined;
  const savedPressing = savedDetails?.status === 'available' ? savedDetails.pressing : undefined;
  const lookupRecord = [title, lookup?.artist].filter(Boolean).join(' by ');
  const selectedShelf = selected?.status === 'collection' ? 'Collection' : 'Wishlist';
  const savedIdentityDiffers = selected && (selected.title !== title || selected.artist_name !== lookup?.artist);
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
      lookupPressing?.[key]?.trim() || lookup?.pressing?.[key]?.trim(),
      savedPressing?.[key]?.trim(),
    ]),
    ['Year', lookup?.year, selected?.year],
    ['Discogs release ID', lookupRelease, savedRelease],
  ];

  return (
    <ModalDialog labelledBy={headingId} onClose={onClose} returnFocusTo={returnFocusTo} fallbackFocusTo={fallbackFocusTo}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 id={headingId} className="text-xl font-semibold">Compare pressings</h2>
          <button type="button" className="rh-dialog-close" onClick={onClose} aria-label="Close pressing comparison">
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:gap-5 sm:p-6 [overflow-wrap:anywhere]">
          <div>
            <p className="font-semibold">{title}</p>
            {lookup?.artist && <p className="text-sm text-gray-600">{lookup.artist}</p>}
            {selected && (
              <div className="rh-comparison-outcome mt-2" aria-live="polite">
                <p>Saved in {selectedShelf} · {savedRelease ? `Discogs release ${savedRelease}` : 'Pressing unconfirmed'}</p>
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
          {selected && availableCopies.length > 1 && (
            <div className="rh-comparison-toolbar">
              <div className="rh-comparison-select">
                <label htmlFor={copySelectId} className="text-sm font-semibold">Saved copy to compare</label>
                <select id={copySelectId} value={selected.id} disabled={openingId !== undefined}
                  onChange={event => { setSelectedId(Number(event.target.value)); setFailedId(undefined); }}>
                  {availableCopies.map(copy => <option key={copy.id} value={copy.id}>{savedCopyContext(copy)}</option>)}
                </select>
              </div>
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
          <div>
            <div className="rh-comparison-links">
              {selected && (
                <button type="button" className="rh-lookup-link text-left"
                  aria-label={`${action} · ${savedCopyLabel(selected)}`}
                  aria-haspopup="dialog" aria-disabled={openingId !== undefined} aria-busy={openingId === selected.id}
                  onClick={event => void inspect(selected, event.currentTarget)}>
                  {action}
                </button>
              )}
              {sourceLink('Catalog match', lookupRelease ? `${lookupRecord}, release ${lookupRelease}` : lookupRecord, lookupSource)}
              {selected && sourceLink('Saved copy', savedCopyLabel(selected), savedSource)}
              {onSearch && <button type="button" className="rh-lookup-link" onClick={onSearch}>{searchLabel}</button>}
            </div>
            {selected && failedId === selected.id && <p role="alert" className="px-2 text-sm text-red-600">Couldn’t open this saved copy. Try again.</p>}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
