import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import api, { type PressingDetails, type SavedTitleMatch } from '../services/api';
import { listingEvidence, savedCatalogSource, savedCopyContext, savedCopyLabel, type CatalogSource } from '../albumDisplay';
import { ModalDialog } from './ModalDialog';

export type SavedAlbumOutcome = 'opened' | 'removed' | 'unavailable';
export type OpenSavedAlbum = (id: number, opener: HTMLButtonElement, inlineError?: boolean) => Promise<SavedAlbumOutcome>;

export interface LookupPressing {
  artist: string;
  year?: number;
  releaseId?: number;
  source?: CatalogSource;
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
  const detailsCache = useRef(new Map<number, PressingDetails | null>());
  const [details, setDetails] = useState<Partial<Record<number, PressingDetails | null>>>({});
  const availableCopies = matches.filter(copy => copy.id !== removed?.id);
  const selected = availableCopies.find(copy => copy.id === selectedId) ?? availableCopies[0];
  const savedSource = selected ? savedCatalogSource(selected) : undefined;
  const lookupRelease = lookup?.releaseId;
  const savedRelease = savedSource?.kind === 'pressing' ? selected?.discogs_id ?? undefined : undefined;

  useLayoutEffect(() => {
    if (removed) removalNotice.current?.focus();
  }, [removed]);

  useEffect(() => {
    const controller = new AbortController();
    const ids = new Set([lookupRelease, savedRelease]);
    for (const id of ids) {
      if (!id || detailsCache.current.has(id)) continue;
      const load = async () => {
        let pressing: PressingDetails | null;
        try {
          ({ pressing } = await api.getPressingDetails(id, controller.signal));
        } catch {
          pressing = null;
        }
        if (controller.signal.aborted) return;
        detailsCache.current.set(id, pressing);
        setDetails(current => ({ ...current, [id]: pressing }));
      };
      void load();
    }
    return () => controller.abort();
  }, [lookupRelease, savedRelease]);

  const inspect = async (copy: SavedTitleMatch, opener: HTMLButtonElement) => {
    if (openingId !== undefined) return;
    setOpeningId(copy.id);
    setFailedId(undefined);
    const result = await onOpenSaved(copy.id, opener, true);
    if (result === 'removed') setRemoved(copy);
    if (result === 'unavailable') setFailedId(copy.id);
    setOpeningId(undefined);
  };

  const lookupDetails = lookupRelease ? details[lookupRelease] : null;
  const savedDetails = savedRelease ? details[savedRelease] : null;
  const loadingDetails = lookupDetails === undefined || savedDetails === undefined;
  const lookupRecord = [title, lookup?.artist].filter(Boolean).join(' by ');
  const action = openingId === selected?.id ? 'Opening saved copy…'
    : failedId === selected?.id ? 'Retry opening saved copy' : 'Open saved album';
  const sourceLink = (context: string, record: string, source?: CatalogSource) => source?.url && (
    <a href={source.url} target="_blank" rel="noreferrer" className="rh-comparison-source">
      {context} on {source.label}<span className="sr-only"> · {record}, {source.type} (opens in a new tab)</span>
    </a>
  );
  const evidence = [
    ['Listing', listingEvidence(lookup?.source), selected ? listingEvidence(savedSource) : undefined],
    ...pressingFields.map(([key, label]) => [label, lookupDetails?.[key], savedDetails?.[key]])
      .filter(([, lookupValue, savedValue]) => lookupValue || savedValue),
    ['Year', lookup?.year, selected?.year],
    ['Discogs release ID', lookupRelease, savedRelease],
    ['Shelf', '—', selected ? (selected.status === 'wishlist' ? 'Wishlist' : 'Collection') : undefined],
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
            <p className="mt-2 max-w-prose text-sm text-gray-600">
              Side A saves one entry per artist and title.
              {lookup?.source?.url
                ? ' If this is a different pressing, use the source listing to check it or search for a different album.'
                : ' Check the sleeve for a catalog number before deciding which copy you have.'}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              Check the catalog number on the sleeve or record label. An album overview can include several pressings.
            </p>
          </div>
          {removed && (
            <p ref={removalNotice} role="status" tabIndex={-1} className="rounded-lg border border-gray-300 p-2 text-sm">
              {savedCopyLabel(removed)} is no longer saved.
              {selected ? ' Choose a remaining copy to compare.' : ' Close the comparison to return to the lookup.'}
            </p>
          )}
          {selected && (
            <div className="rh-comparison-toolbar">
              {availableCopies.length > 1 && (
                <div className="rh-comparison-select">
                  <label htmlFor={copySelectId} className="text-sm font-semibold">Saved copy to compare</label>
                  <select id={copySelectId} value={selected.id} disabled={openingId !== undefined}
                    onChange={event => { setSelectedId(Number(event.target.value)); setFailedId(undefined); }}>
                    {availableCopies.map(copy => <option key={copy.id} value={copy.id}>{savedCopyContext(copy)}</option>)}
                  </select>
                </div>
              )}
              <div>
                <button type="button" className="rh-lookup-link text-left"
                  aria-label={`${action} · ${savedCopyLabel(selected)}`}
                  aria-haspopup="dialog" aria-disabled={openingId !== undefined} aria-busy={openingId === selected.id}
                  onClick={event => void inspect(selected, event.currentTarget)}>
                  {action}
                </button>
                {failedId === selected.id && <p role="alert" className="px-2 text-sm text-red-600">Couldn’t open this saved copy. Try again.</p>}
              </div>
            </div>
          )}
          <div className="rh-comparison-links">
            {sourceLink('Lookup', lookupRelease ? `${lookupRecord}, release ${lookupRelease}` : lookupRecord, lookup?.source)}
            {selected && sourceLink('Saved copy', savedCopyLabel(selected), savedSource)}
            {onSearch && <button type="button" className="rh-lookup-link" onClick={onSearch}>{searchLabel}</button>}
          </div>
          <div>
            <table className="rh-pressing-table">
              <caption className="sr-only">Catalog evidence for {lookupRecord}</caption>
              <thead>
                <tr><th scope="col">Evidence</th><th scope="col">Lookup</th><th scope="col">Saved copy</th></tr>
              </thead>
              <tbody>
                {evidence.map(([label, lookupValue, savedValue]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{lookupValue || 'Unknown'}</td>
                    <td>{selected ? savedValue || 'Unknown' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loadingDetails && <p className="mt-2 text-sm text-gray-600" role="status">Checking release details…</p>}
            {!loadingDetails && (lookupRelease || savedRelease) && !lookupDetails && !savedDetails && (
              <p className="mt-2 text-sm text-gray-600">More details may be available in the source listing.</p>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
