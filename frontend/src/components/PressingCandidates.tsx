import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { discogsReleaseSource } from '../albumDisplay';
import {
  createPressingDetailsLoader,
  sharedCatalogNumber,
  type LoadPressingDetails,
  type PressingCandidate,
} from '../services/pressingEvidence';
import type { PressingDetails } from '../services/api';

export type { PressingCandidate } from '../services/pressingEvidence';

const pageSize = 3;
const optionFields = ['label', 'country', 'format', 'year'] as const;
const fieldLabels = { label: 'Label', country: 'Country', format: 'Format', year: 'Release year' };

type MatrixRunouts = NonNullable<PressingDetails['matrixRunouts']>;
type RunoutResult = { status: 'loading' | 'error' } | { status: 'ready'; markings: MatrixRunouts };

interface Props {
  choices: readonly PressingCandidate[];
  selectedId?: number;
  onSelect: (id: number) => void;
  searchedNumber?: string;
  savedReleaseId?: number;
  disabled?: boolean;
  loadDetails?: LoadPressingDetails;
}

function choiceField(choice: PressingCandidate, field: typeof optionFields[number]) {
  const value = choice.pressing?.[field] ?? (field === 'year' ? choice.year : undefined);
  return String(value ?? '').trim();
}

function fillMissingEvidence(choice: PressingCandidate, details?: PressingDetails): PressingCandidate {
  if (!details) return choice;
  const summary = choice.pressing;
  return { ...choice, pressing: {
    catalogNumber: summary?.catalogNumber?.trim() || details.catalogNumber,
    label: summary?.label?.trim() || details.label,
    country: summary?.country?.trim() || details.country,
    format: summary?.format?.trim() || details.format,
    year: summary?.year ?? choice.year ?? details.year,
    matrixRunouts: details.matrixRunouts ?? summary?.matrixRunouts,
  } };
}

function RunoutList({ markings }: { markings: MatrixRunouts }) {
  return <ul className="space-y-1">
    {markings.map(({ value, description }, index) => (
      <li key={`${index}-${value}`}>
        <span className="font-medium">{value}</span>
        {description && <span className="block text-xs text-gray-600">{description}</span>}
      </li>
    ))}
  </ul>;
}

function CandidateRunout({ choice, loadDetails, onDetails }: {
  choice: PressingCandidate;
  loadDetails: LoadPressingDetails;
  onDetails: (releaseId: number, details: PressingDetails) => void;
}) {
  const { releaseId } = choice;
  const initialMarkings = choice.pressing?.matrixRunouts?.length ? choice.pressing.matrixRunouts : undefined;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<RunoutResult>({ status: 'loading' });
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (initialMarkings?.length) return;
    const request = new AbortController();
    void loadDetails(releaseId, request.signal).then(({ pressing }) => {
      if (request.signal.aborted) return;
      setResult({ status: 'ready', markings: pressing?.matrixRunouts ?? [] });
      if (pressing) onDetails(releaseId, pressing);
    }, () => {
      if (!request.signal.aborted) setResult({ status: 'error' });
    });
    return () => request.abort();
  }, [attempt, initialMarkings, loadDetails, onDetails, releaseId]);

  const markings = initialMarkings?.length ? initialMarkings : result.status === 'ready' ? result.markings : [];
  const message = markings.length ? 'Runout markings loaded.' : result.status === 'loading' ? 'Checking Discogs…'
    : result.status === 'error' ? 'Couldn’t load runout markings.' : 'Discogs lists no runout markings for this release.';

  return (
    <div className="min-w-0 px-2 py-2 text-sm [overflow-wrap:anywhere]">
      <p ref={heading} tabIndex={-1} className="mb-0.5 font-semibold">
        Runout markings<span className="sr-only"> for Discogs release {releaseId}</span>
      </p>
      <p role="status" className={markings.length ? 'sr-only' : 'text-gray-600'}>
        <span className="sr-only">Discogs release {releaseId}. </span>{message}
      </p>
      {!markings.length && result.status === 'error' && (
        <button type="button" className="rh-lookup-link -ml-2" aria-label={`Retry runout markings for Discogs release ${releaseId}`}
          onClick={() => {
            heading.current?.focus({ preventScroll: true });
            setResult({ status: 'loading' });
            setAttempt(current => current + 1);
          }}>Retry runout markings</button>
      )}
      {markings.length > 0 && <RunoutList markings={markings.slice(0, 2)} />}
      {markings.length > 2 && (
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer content-center text-sm">More markings</summary>
          <RunoutList markings={markings.slice(2)} />
        </details>
      )}
    </div>
  );
}

export function PressingCandidates({
  choices, selectedId, onSelect, searchedNumber, savedReleaseId, disabled, loadDetails,
}: Props) {
  const name = useId();
  const guideId = useId();
  const candidatesId = useId();
  const pageNotice = useRef<HTMLParagraphElement>(null);
  const [checkingRunouts, setCheckingRunouts] = useState(false);
  const [requestedPage, setRequestedPage] = useState(0);
  const [loadLocally] = useState(createPressingDetailsLoader);
  const [readEvidence, setReadEvidence] = useState<Partial<Record<number, PressingDetails>>>({});
  const recordEvidence = useCallback((releaseId: number, details: PressingDetails) => {
    setReadEvidence(current => current[releaseId] === details ? current : { ...current, [releaseId]: details });
  }, []);
  const unique = choices.filter((choice, index) => choices.findIndex(other => other.releaseId === choice.releaseId) === index);
  const withDetails = unique.map(choice => fillMissingEvidence(choice, readEvidence[choice.releaseId]));
  const lastPage = Math.max(0, Math.ceil(unique.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const start = page * pageSize;
  const visible = withDetails.slice(start, start + pageSize);
  const compareGrid = checkingRunouts && visible.length > 1;
  const varying = new Set(optionFields.filter(field => (
    new Set(withDetails.map(choice => choiceField(choice, field).toLowerCase()).filter(Boolean)).size > 1
  )));
  // Keep the warning based on the search listing. Detailed release lookups can add more label numbers.
  const shared = sharedCatalogNumber(unique, searchedNumber);

  const goToPage = (next: number) => {
    setRequestedPage(next);
    pageNotice.current?.focus({ preventScroll: true });
  };

  if (!unique.length) return null;

  return (
    <fieldset disabled={disabled} aria-describedby={shared || checkingRunouts ? guideId : undefined}
      className="@container min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <legend className="text-sm font-semibold">Pressings from Discogs</legend>
      {(shared || checkingRunouts) && (
        <div id={guideId} className="space-y-1 text-sm text-gray-600">
          {shared && <p><strong className="font-semibold text-gray-900">{shared.number} is shared by {shared.count} pressings shown here.</strong>
            {' '}Check the label, country, format, and any runout markings before choosing.</p>}
          {checkingRunouts && <p>Look for etched or stamped characters in the smooth band between the last track and the center label.</p>}
        </div>
      )}
      <button type="button" className="rh-lookup-link -ml-2 text-left" aria-expanded={checkingRunouts} aria-controls={candidatesId}
        onClick={() => setCheckingRunouts(current => !current)}>
        {checkingRunouts ? 'Hide runout markings' : unique.length > 1 ? 'Compare runout markings' : 'Check runout markings'}
      </button>
      {lastPage > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <p ref={pageNotice} role="status" tabIndex={-1} className="mr-auto text-gray-600">
            Pressings {start + 1}–{start + visible.length} of {unique.length}
            {selectedId && !visible.some(choice => choice.releaseId === selectedId) && ` · Selected release ${selectedId}`}
          </p>
          {page > 0 && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page - 1)}>Previous pressings</button>}
          {page < lastPage && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page + 1)}>More pressings</button>}
        </div>
      )}
      <ul id={candidatesId} className={`min-w-0 divide-y divide-gray-200 border-y border-gray-200 ${compareGrid
        ? '@min-[30rem]:grid @min-[30rem]:grid-cols-2 @min-[30rem]:gap-2 @min-[30rem]:divide-y-0 @min-[30rem]:border-y-0' : ''}
        ${compareGrid && visible.length > 2 ? '@min-[40rem]:grid-cols-3' : ''}`}>
        {visible.map(choice => {
          const { releaseId, pressing } = choice;
          const source = discogsReleaseSource(releaseId);
          const checked = selectedId === releaseId;
          const metadata = optionFields.filter(field => choiceField(choice, field));
          return (
            <li key={releaseId} className={`min-w-0 ${checked ? 'bg-blue-50' : ''} ${compareGrid
              ? '@min-[30rem]:row-span-2 @min-[30rem]:grid @min-[30rem]:grid-rows-subgrid @min-[30rem]:rounded-lg @min-[30rem]:border @min-[30rem]:border-gray-200' : ''}`}>
              <div className={`grid min-w-0 items-start gap-x-2 ${checkingRunouts ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
                <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-sm">
                  <input type="radio" name={name} value={releaseId} checked={checked} onChange={() => onSelect(releaseId)}
                    className="mt-1 shrink-0 accent-blue-600" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{pressing?.catalogNumber || 'Catalog number unavailable'}</span>
                    {metadata.length > 0 && <span className="block text-gray-600">
                      {metadata.map((field, index) => <span key={field}>
                        {index > 0 && <span aria-hidden="true"> · </span>}
                        <span className="sr-only">{fieldLabels[field]} </span>
                        <span className={varying.has(field) ? 'font-medium text-gray-900' : undefined}>{choiceField(choice, field)}</span>
                      </span>)}
                    </span>}
                    <span className="sr-only">Discogs release {releaseId}.</span>
                    {releaseId === savedReleaseId && <span className="block text-gray-600">Your saved pressing</span>}
                    {choice.catalogNumberMatch === 'unverified' && <span className="block text-gray-600">Check the number on the listing.</span>}
                  </span>
                </label>
                {source?.url && (
                  <a className={`rh-comparison-source mx-2 w-fit ${checkingRunouts ? '' : 'sm:justify-self-end'}`}
                    href={source.url} target="_blank" rel="noreferrer">
                    Discogs {releaseId}<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
              </div>
              {checkingRunouts && <CandidateRunout choice={choice} loadDetails={loadDetails ?? loadLocally} onDetails={recordEvidence} />}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
