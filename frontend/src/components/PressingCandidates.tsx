import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { discogsReleaseSource } from '../albumDisplay';
import {
  createPressingDetailsLoader,
  sharedCatalogNumber,
  withPressingEvidence,
  type LoadPressingDetails,
  type PressingCandidate,
} from '../services/pressingEvidence';
import type { PressingDetails } from '../services/api';

export type { PressingCandidate } from '../services/pressingEvidence';

const pageSize = 3;
const pinLimit = 2;
const optionFields = ['label', 'country', 'format', 'year'] as const;
const fieldLabels = { label: 'Label', country: 'Country', format: 'Format', year: 'Release year' };

type MatrixRunouts = NonNullable<PressingDetails['matrixRunouts']>;
type EvidenceResult = { status: 'error' } | { status: 'ready'; details: PressingDetails | null };

interface Props {
  choices: readonly PressingCandidate[];
  selectedId?: number;
  onSelect: (id: number) => void;
  searchedNumber?: string;
  savedReleaseId?: number;
  disabled?: boolean;
  loadDetails?: LoadPressingDetails;
  onReadEvidence?: (releaseId: number, details: PressingDetails) => void;
  uncertainAction?: string;
}

function choiceField(choice: PressingCandidate, field: typeof optionFields[number]) {
  const value = choice.pressing?.[field] ?? (field === 'year' ? choice.year : undefined);
  return String(value ?? '').trim();
}

function catalogNumber(choice: PressingCandidate) {
  return choice.pressing?.catalogNumber || 'Catalog number unavailable';
}

function candidateLabel(choice: PressingCandidate) {
  return [catalogNumber(choice), ...optionFields.map(field => choiceField(choice, field)).filter(Boolean),
    `Discogs release ${choice.releaseId}`].join(', ');
}

function differingFields(choices: readonly PressingCandidate[]) {
  return new Set(optionFields.filter(field => (
    new Set(choices.map(choice => choiceField(choice, field).toLowerCase()).filter(Boolean)).size > 1
  )));
}

function PressingFacts({ choice, varying }: { choice: PressingCandidate; varying?: ReadonlySet<typeof optionFields[number]> }) {
  const fields = optionFields.filter(field => choiceField(choice, field));
  return <>
    <span className="block font-semibold">{catalogNumber(choice)}</span>
    {fields.length > 0 && <span className="block text-gray-600">
      {fields.map((field, index) => <span key={field}>
        {index > 0 && <span aria-hidden="true"> · </span>}
        <span className="sr-only">{fieldLabels[field]} </span>
        <span className={varying?.has(field) ? 'font-medium text-gray-900' : undefined}>{choiceField(choice, field)}</span>
      </span>)}
    </span>}
  </>;
}

function PressingSource({ releaseId, className = '' }: { releaseId: number; className?: string }) {
  const source = discogsReleaseSource(releaseId);
  if (!source?.url) return null;
  return <a className={`rh-comparison-source w-fit max-w-full ${className}`} href={source.url} target="_blank" rel="noreferrer">
    Discogs {releaseId}<span className="sr-only"> (opens in a new tab)</span>
  </a>;
}

export function PressingSelectionSummary({ choice }: { choice: PressingCandidate }) {
  const markings = choice.pressing?.matrixRunouts ?? [];
  return <div className="min-w-0 border-t border-gray-200 pt-2 text-sm [overflow-wrap:anywhere]">
    <p className="mb-0.5 text-xs text-gray-600">Selected pressing</p>
    <PressingFacts choice={choice} />
    {markings.length > 0 && <div className="mt-1">
      <p className="mb-0.5 text-xs text-gray-600">Runout markings</p>
      <RunoutMarkings markings={markings} />
    </div>}
    <PressingSource releaseId={choice.releaseId} />
  </div>;
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

function RunoutMarkings({ markings }: { markings: MatrixRunouts }) {
  return <>
    <RunoutList markings={markings.slice(0, 2)} />
    {markings.length > 2 && (
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer content-center text-sm">More markings</summary>
        <RunoutList markings={markings.slice(2)} />
      </details>
    )}
  </>;
}

function EvidenceRequest({ releaseId, loadDetails, onResult }: {
  releaseId: number;
  loadDetails: LoadPressingDetails;
  onResult: (releaseId: number, result: EvidenceResult) => void;
}) {
  useEffect(() => {
    const request = new AbortController();
    void loadDetails(releaseId, request.signal).then(({ pressing }) => {
      if (!request.signal.aborted) onResult(releaseId, { status: 'ready', details: pressing });
    }, () => {
      if (!request.signal.aborted) onResult(releaseId, { status: 'error' });
    });
    return () => request.abort();
  }, [loadDetails, onResult, releaseId]);
  return null;
}

function CandidateRunout({ choice, result, onRetry, disabled }: {
  choice: PressingCandidate;
  result?: EvidenceResult;
  onRetry: (releaseId: number) => void;
  disabled?: boolean;
}) {
  const { releaseId } = choice;
  const heading = useRef<HTMLParagraphElement>(null);
  const markings = choice.pressing?.matrixRunouts ?? [];

  const message = markings.length ? 'Runout markings loaded.' : !result ? 'Checking Discogs…'
    : result.status === 'error' ? 'Couldn’t load runout markings.' : 'Discogs lists no runout markings for this release.';

  return (
    <div className="min-w-0 px-2 py-2 text-sm [overflow-wrap:anywhere]">
      <p ref={heading} tabIndex={-1} className="mb-0.5 font-semibold">
        Runout markings<span className="sr-only"> for Discogs release {releaseId}</span>
      </p>
      <p role="status" className={markings.length ? 'sr-only' : 'text-gray-600'}>
        <span className="sr-only">Discogs release {releaseId}. </span>{message}
      </p>
      {!markings.length && result?.status === 'error' && (
        <button type="button" className="rh-lookup-link -ml-2" disabled={disabled} aria-label={`Retry runout markings for Discogs release ${releaseId}`}
          onClick={() => {
            heading.current?.focus({ preventScroll: true });
            onRetry(releaseId);
          }}>Retry runout markings</button>
      )}
      {markings.length > 0 && <RunoutMarkings markings={markings} />}
    </div>
  );
}

function allRunoutsMissing(choices: readonly PressingCandidate[], evidence: Partial<Record<number, EvidenceResult>>) {
  return choices.length > 1 && choices.every(choice => (
    !choice.pressing?.matrixRunouts?.length && evidence[choice.releaseId]?.status === 'ready'
  ));
}

function MissingRunouts({ choices, uncertainAction }: { choices: readonly PressingCandidate[]; uncertainAction: string }) {
  const differences = [...differingFields(choices)].map(field => fieldLabels[field].toLowerCase());
  const next = differences.length
    ? `Compare the ${new Intl.ListFormat('en').format(differences)} with your record.`
    : 'Check the label, country, format, and release year against your record.';
  return <p role="status" className="border-y border-gray-200 px-2 py-2 text-sm text-gray-600">
    Discogs lists no runout markings for these pressings. {next}{' '}{uncertainAction}
  </p>;
}

export function PressingCandidates({
  choices, selectedId, onSelect, searchedNumber, savedReleaseId, disabled, loadDetails, onReadEvidence,
  uncertainAction = 'If you’re unsure, go back without choosing a pressing.',
}: Props) {
  const name = useId();
  const guideId = useId();
  const candidatesId = useId();
  const shortlistId = useId();
  const pinHintId = useId();
  const shortlistHeading = useRef<HTMLHeadingElement>(null);
  const runoutToggle = useRef<HTMLButtonElement>(null);
  const pageNotice = useRef<HTMLParagraphElement>(null);
  const [checkingRunouts, setCheckingRunouts] = useState(false);
  const [requestedPage, setRequestedPage] = useState(0);
  const [loadLocally] = useState(createPressingDetailsLoader);
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  const [evidence, setEvidence] = useState<Partial<Record<number, EvidenceResult>>>({});
  const reportEvidence = useRef(onReadEvidence);
  useEffect(() => { reportEvidence.current = onReadEvidence; }, [onReadEvidence]);
  const recordEvidence = useCallback((releaseId: number, result: EvidenceResult) => {
    setEvidence(current => ({ ...current, [releaseId]: result }));
    if (result.status === 'ready' && result.details) reportEvidence.current?.(releaseId, result.details);
  }, []);
  const unique = choices.filter((choice, index) => choices.findIndex(other => other.releaseId === choice.releaseId) === index);
  const withDetails = unique.map(choice => {
    const result = evidence[choice.releaseId];
    return withPressingEvidence(choice, result?.status === 'ready' ? result.details : undefined);
  });
  const lastPage = Math.max(0, Math.ceil(unique.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const start = page * pageSize;
  const visible = withDetails.slice(start, start + pageSize);
  const pinned = pinnedIds.flatMap(id => withDetails.filter(choice => choice.releaseId === id));
  const selectedOffPage = withDetails.find(choice => choice.releaseId === selectedId &&
    !visible.some(option => option.releaseId === selectedId) && !pinned.some(option => option.releaseId === selectedId));
  const requests = (checkingRunouts || pinned.length > 0) ? withDetails.filter(choice => (
    !choice.pressing?.matrixRunouts?.length && !evidence[choice.releaseId] &&
    (pinnedIds.includes(choice.releaseId) || (checkingRunouts && visible.includes(choice)))
  )) : [];
  const compareGrid = checkingRunouts && visible.length > 1;
  const showRunoutGuide = checkingRunouts || pinned.length > 0;
  const inlineRunouts = checkingRunouts ? visible.filter(choice => !pinnedIds.includes(choice.releaseId)) : [];
  const visibleMissing = allRunoutsMissing(inlineRunouts, evidence);
  const pinnedMissing = allRunoutsMissing(pinned, evidence);
  const varying = differingFields(withDetails);
  const pinnedDifferences = differingFields(pinned);
  // Keep the warning based on the search listing. Detailed release lookups can add more label numbers.
  const shared = sharedCatalogNumber(unique, searchedNumber);

  const goToPage = (next: number) => {
    setRequestedPage(next);
    pageNotice.current?.focus({ preventScroll: true });
  };

  const togglePin = (id: number) => {
    const existing = pinned.map(choice => choice.releaseId);
    if (existing.includes(id)) setPinnedIds(existing.filter(selected => selected !== id));
    else if (existing.length < pinLimit) setPinnedIds([...existing, id]);
  };

  const retry = (id: number) => setEvidence(current => ({ ...current, [id]: undefined }));

  if (!unique.length) return null;

  return (
    <fieldset disabled={disabled} aria-describedby={shared || showRunoutGuide ? guideId : undefined}
      className="@container min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <legend className="text-sm font-semibold">Pressings from Discogs</legend>
      {requests.map(({ releaseId }) => <EvidenceRequest key={releaseId} releaseId={releaseId}
        loadDetails={loadDetails ?? loadLocally} onResult={recordEvidence} />)}
      {(shared || showRunoutGuide) && (
        <div id={guideId} className="space-y-1 text-sm text-gray-600">
          {shared && <p><strong className="font-semibold text-gray-900">{shared.number} is shared by {shared.count} pressings in these results.</strong>
            {' '}Check the label, country, format, and any runout markings before choosing.</p>}
          {showRunoutGuide && <p>Look for etched or stamped characters in the smooth band between the last track and the center label.</p>}
        </div>
      )}
      {pinned.length > 0 && (
        <section aria-labelledby={shortlistId} className="min-w-0 space-y-2 border-y border-gray-200 py-2">
          <div>
            <h3 id={shortlistId} ref={shortlistHeading} tabIndex={-1} className="text-sm font-semibold">Pinned pressings</h3>
            <p id={pinHintId} className="text-sm text-gray-600" role="status">
              {pinned.length < pinLimit ? 'Pin one more pressing to compare across pages.' : 'Two pressings pinned. Unpin one to compare another.'}
            </p>
          </div>
          <ul className="grid min-w-0 gap-2 @min-[30rem]:grid-cols-2">
            {pinned.map(choice => {
              const { releaseId } = choice;
              const checked = releaseId === selectedId;
              return <li key={releaseId} className="grid min-w-0 content-start gap-1 border-t border-gray-200 px-2 py-2 text-sm">
                <div><PressingFacts choice={choice} varying={pinnedDifferences} /></div>
                {releaseId === savedReleaseId && <p className="text-gray-600">Your saved pressing</p>}
                <PressingSource releaseId={releaseId} />
                {!pinnedMissing && <CandidateRunout choice={choice} result={evidence[releaseId]} onRetry={retry} disabled={disabled} />}
                <div className="flex flex-wrap gap-x-1">
                  <button type="button" className="rh-lookup-link -ml-2 text-left aria-disabled:opacity-60" aria-disabled={checked}
                    aria-label={`${checked ? 'Selected pressing' : 'Select pressing'} · ${candidateLabel(choice)}`}
                    onClick={() => { if (!checked) onSelect(releaseId); }}>
                    {checked ? 'Selected pressing' : 'Select pressing'}
                  </button>
                  <button type="button" className="rh-lookup-link" aria-label={`Unpin pressing · ${candidateLabel(choice)}`}
                    onClick={() => {
                      (pinned.length > 1 ? shortlistHeading.current : runoutToggle.current)?.focus({ preventScroll: true });
                      togglePin(releaseId);
                    }}>Unpin</button>
                </div>
              </li>;
            })}
          </ul>
          {pinnedMissing && <MissingRunouts choices={pinned} uncertainAction={uncertainAction} />}
        </section>
      )}
      {selectedOffPage && <PressingSelectionSummary choice={selectedOffPage} />}
      <button type="button" ref={runoutToggle} className="rh-lookup-link -ml-2 text-left" aria-expanded={checkingRunouts} aria-controls={candidatesId}
        onClick={() => setCheckingRunouts(current => !current)}>
        {checkingRunouts ? 'Hide runout markings' : unique.length > 1 ? 'Compare runout markings' : 'Check runout markings'}
      </button>
      {lastPage > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <p ref={pageNotice} role="status" tabIndex={-1} className="mr-auto text-gray-600">Pressings {start + 1}–{start + visible.length} of {unique.length}</p>
            {page > 0 && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page - 1)}>Previous pressings</button>}
            {page < lastPage && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page + 1)}>More pressings</button>}
          </div>
          {!pinned.length && <p id={pinHintId} className="text-sm text-gray-600">Pin up to two pressings to compare across pages.</p>}
        </div>
      )}
      <ul id={candidatesId} className={`min-w-0 divide-y divide-gray-200 border-y border-gray-200 ${compareGrid
        ? '@min-[30rem]:grid @min-[30rem]:grid-cols-2 @min-[30rem]:gap-2 @min-[30rem]:divide-y-0 @min-[30rem]:border-y-0' : ''}
        ${compareGrid && visible.length > 2 ? '@min-[40rem]:grid-cols-3' : ''}`}>
        {visible.map(choice => {
          const { releaseId } = choice;
          const checked = selectedId === releaseId;
          const isPinned = pinnedIds.includes(releaseId);
          return (
            <li key={releaseId} className={`min-w-0 ${checked ? 'bg-blue-50' : ''} ${compareGrid
              ? '@min-[30rem]:row-span-2 @min-[30rem]:grid @min-[30rem]:grid-rows-subgrid @min-[30rem]:rounded-lg @min-[30rem]:border @min-[30rem]:border-gray-200' : ''}`}>
              <div className={`grid min-w-0 items-start gap-x-2 ${checkingRunouts ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
                <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-sm">
                  <input type="radio" name={name} value={releaseId} checked={checked} onChange={() => onSelect(releaseId)}
                    className="mt-1 shrink-0 accent-blue-600" />
                  <span className="min-w-0">
                    <PressingFacts choice={choice} varying={varying} />
                    <span className="sr-only">Discogs release {releaseId}.</span>
                    {releaseId === savedReleaseId && <span className="block text-gray-600">Your saved pressing</span>}
                    {choice.catalogNumberMatch === 'unverified' && <span className="block text-gray-600">Check the number on the listing.</span>}
                  </span>
                </label>
                <div className={`flex min-w-0 flex-wrap items-center gap-x-1 px-2 ${checkingRunouts ? '' : 'sm:justify-end'}`}>
                  <PressingSource releaseId={releaseId} />
                  {lastPage > 0 && <button type="button" className="rh-lookup-link aria-disabled:opacity-60"
                    aria-label={`${isPinned ? 'Unpin pressing' : 'Pin for comparison'} · ${candidateLabel(choice)}`}
                    aria-describedby={pinHintId} aria-disabled={!isPinned && pinned.length >= pinLimit}
                    onClick={() => togglePin(releaseId)}>{isPinned ? 'Unpin' : 'Pin for comparison'}</button>}
                </div>
              </div>
              {checkingRunouts && !isPinned && !visibleMissing && <CandidateRunout choice={choice} result={evidence[releaseId]} onRetry={retry} disabled={disabled} />}
            </li>
          );
        })}
      </ul>
      {visibleMissing && <MissingRunouts choices={inlineRunouts} uncertainAction={uncertainAction} />}
    </fieldset>
  );
}
