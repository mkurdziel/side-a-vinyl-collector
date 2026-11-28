import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { discogsReleaseSource } from '../albumDisplay';
import { pressingPinLimit as pinLimit, type usePressingPreparation } from '../hooks/usePressingPreparation';
import {
  catalogNumberKey,
  concisePressingValue,
  createPressingDetailsLoader,
  matchesPressingMedium,
  preferredCatalogNumber,
  pressingFormatFacts,
  pressingMedia,
  sharedCatalogNumber,
  summarizePressingFormat,
  withPressingEvidence,
  type LoadPressingDetails,
  type PressingCandidate,
} from '../services/pressingEvidence';
import type { PressingDetails } from '../services/api';

export type { PressingCandidate } from '../services/pressingEvidence';

const pageSize = 3;
const optionFields = ['format', 'country', 'year', 'label'] as const;
const pressingFieldLabels = {
  catalogNumber: 'Catalog number',
  label: 'Label',
  format: 'Format',
  country: 'Release country',
  year: 'Release year',
};
const fieldLimits = { label: 32, format: 36, country: 28, year: 4 };

type MatrixRunouts = NonNullable<PressingDetails['matrixRunouts']>;
type EvidenceResult = { status: 'error' } | { status: 'ready'; details: PressingDetails | null };
type EvidenceState = 'pending' | 'unavailable';
type OptionField = typeof optionFields[number];

interface Props {
  choices: readonly PressingCandidate[];
  selectedId?: number;
  onSelect: (id: number) => void;
  searchedNumber?: string;
  savedReleaseId?: number;
  savedEvidence?: PressingDetails;
  savedEvidenceState?: EvidenceState;
  selectedEvidence?: PressingDetails;
  selectedEvidenceState?: EvidenceState;
  disabled?: boolean;
  preparation: ReturnType<typeof usePressingPreparation>;
  onChangeMedium?: () => void;
  loadDetails?: LoadPressingDetails;
  onReadEvidence?: (releaseId: number, details: PressingDetails) => void;
  uncertainAction?: string;
  morePressingsUrl?: string;
  savedComparison?: ReactNode;
}

function choiceField(choice: PressingCandidate, field: OptionField | 'catalogNumber') {
  const value = choice.pressing?.[field] ?? (field === 'year' ? choice.year : undefined);
  return String(value ?? '').trim();
}

function summaryField(choice: PressingCandidate, field: OptionField, formats: readonly string[] = []) {
  const value = choiceField(choice, field);
  if (field === 'format') return summarizePressingFormat(value, formats, fieldLimits.format);
  // Discogs search labels may include a long list of company credits.
  return concisePressingValue(field === 'label' ? value.split(' · ', 1)[0] : value, fieldLimits[field]);
}

function candidateNumber(choice: PressingCandidate, searchedNumber?: string) {
  const number = preferredCatalogNumber(choiceField(choice, 'catalogNumber'), searchedNumber);
  return concisePressingValue(number ?? '', 26);
}

function candidateLabel(choice: PressingCandidate, searchedNumber: string | undefined, formats: readonly string[]) {
  return [
    candidateNumber(choice, searchedNumber),
    summaryField(choice, 'format', formats),
    summaryField(choice, 'country'),
    summaryField(choice, 'year'),
    `Discogs release ${choice.releaseId}`,
  ].filter(Boolean).join(', ');
}

function differingFields(choices: readonly PressingCandidate[]) {
  return new Set(optionFields.filter(field => (
    field === 'format'
      ? (['format', 'size', 'type', 'mix', 'speed'] as const).some(key => hasKnownDifference(choices.map(choice => pressingFormatFacts(choiceField(choice, field))[key])))
      : hasKnownDifference(choices.map(choice => choiceField(choice, field)))
  )));
}

function hasKnownDifference(values: readonly string[]) {
  return new Set(values.map(value => value.toLowerCase()).filter(Boolean)).size > 1;
}

const comparisonFacts = [
  { label: 'Format', read: (choice: PressingCandidate) => pressingFormatFacts(choiceField(choice, 'format')).format },
  { label: 'Mix', read: (choice: PressingCandidate) => pressingFormatFacts(choiceField(choice, 'format')).mix },
  { label: 'Size', read: (choice: PressingCandidate) => pressingFormatFacts(choiceField(choice, 'format')).size },
  { label: 'Record type', read: (choice: PressingCandidate) => pressingFormatFacts(choiceField(choice, 'format')).type },
  { label: 'Speed', read: (choice: PressingCandidate) => pressingFormatFacts(choiceField(choice, 'format')).speed },
  { label: pressingFieldLabels.label, read: (choice: PressingCandidate) => summaryField(choice, 'label'),
    readFull: (choice: PressingCandidate) => choiceField(choice, 'label') },
  { label: pressingFieldLabels.country, read: (choice: PressingCandidate) => choiceField(choice, 'country') },
  { label: pressingFieldLabels.year, read: (choice: PressingCandidate) => choiceField(choice, 'year') },
  { label: pressingFieldLabels.catalogNumber, read: candidateNumber,
    readFull: (choice: PressingCandidate) => choiceField(choice, 'catalogNumber').split('·')
      .map(number => preferredCatalogNumber(number)).filter(Boolean).join(' · '),
    compare: (value: string) => [...new Set(value.split('·').map(catalogNumberKey))].sort().join('·') },
];

function comparisonRows(left: PressingCandidate, right?: PressingCandidate, searchedNumber?: string, showAll = false) {
  return comparisonFacts.map(({ label, read, readFull, compare }) => {
    const values = (right ? [left, right] : [left]).map(choice => (
      showAll && readFull ? readFull(choice) : read(choice, searchedNumber)
    ));
    const differs = hasKnownDifference(compare ? values.map(compare) : values);
    return { label, values, differs };
  }).filter(({ values }) => values.some(Boolean));
}

const exampleEvidencePriority = [
  { label: pressingFieldLabels.catalogNumber, cue: 'Check the sleeve or label.' },
  { label: pressingFieldLabels.label, cue: 'Check the center label.' },
  { label: 'Mix', cue: 'Check the sleeve or label.' },
  { label: 'Format', cue: 'Check your media.' },
  { label: 'Size', cue: 'Check the record size.' },
  { label: 'Speed', cue: 'Check the center label.' },
  { label: 'Record type', cue: 'Check the sleeve.' },
  { label: pressingFieldLabels.country, prefix: 'Discogs markets · ', cue: 'Check the label or etched marks.' },
  { label: pressingFieldLabels.year, prefix: 'Discogs release years · ', cue: 'Check the label or etched marks.' },
];

function strongestDifference(left: PressingCandidate, right: PressingCandidate, searchedNumber?: string, showAll = false) {
  const facts = comparisonRows(left, right, searchedNumber, showAll);
  for (const [priority, evidence] of exampleEvidencePriority.entries()) {
    const fact = facts.find(row => row.label === evidence.label && row.differs);
    if (fact) return { ...evidence, values: fact.values, priority };
  }
}

function firstAlternative(first: PressingCandidate, choices: readonly PressingCandidate[], searchedNumber?: string) {
  const number = preferredCatalogNumber(choiceField(first, 'catalogNumber'), searchedNumber);
  const media = pressingMedia(choiceField(first, 'format'));
  const options = choices.filter(choice => choice.releaseId !== first.releaseId);
  const withSharedNumber = options.filter(choice => number &&
    catalogNumberKey(preferredCatalogNumber(choiceField(choice, 'catalogNumber'), searchedNumber) ?? '') === catalogNumberKey(number));
  const related = withSharedNumber.length ? withSharedNumber : options;
  const sameMedium = related.filter(choice => pressingMedia(choiceField(choice, 'format')).some(value => media.includes(value)));
  const comparable = sameMedium.length ? sameMedium : related;
  let best = comparable[0];
  let bestPriority = Infinity;
  for (const choice of comparable) {
    const priority = strongestDifference(first, choice, searchedNumber)?.priority ?? Infinity;
    if (priority < bestPriority) {
      best = choice;
      bestPriority = priority;
    }
  }
  return best;
}

function exampleCue(example: PressingCandidate, reference?: PressingCandidate, searchedNumber?: string) {
  if (!reference) return { guidance: 'Check the number and label on your copy.' };
  const difference = strongestDifference(reference, example, searchedNumber);
  if (difference) {
    const values = difference.values.map(value => concisePressingValue(value, 20)).join(' / ');
    return {
      difference: `${difference.prefix ?? ''}${values}.`,
      guidance: difference.cue,
      describeMarket: difference.label === pressingFieldLabels.country,
    };
  }
  return { guidance: 'Look for etched or stamped marks just inside the last track.' };
}

interface PreviewColumn {
  choice: PressingCandidate;
  label: string;
  state?: EvidenceState;
}

export function PressingPreview({ reference, target, searchedNumber, showAll = false }: {
  reference?: PreviewColumn;
  target: PreviewColumn;
  searchedNumber?: string;
  showAll?: boolean;
}) {
  const columns = reference ? [reference, target] : [target];
  const facts = comparisonRows(columns[0].choice, columns[1]?.choice, searchedNumber, showAll);

  // Keep true differences first. A missing value is only worth an early row when it helps explain an uncertain match.
  const differences = facts.filter(fact => fact.differs);
  if (showAll) differences.sort((a, b) => exampleEvidencePriority.findIndex(evidence => evidence.label === a.label)
    - exampleEvidencePriority.findIndex(evidence => evidence.label === b.label));
  const priority = [...differences, ...facts.filter(fact => !fact.differs && fact.values.every(Boolean)),
    ...facts.filter(fact => fact.values.some(value => !value))];
  const importantMissing = facts.find(fact => fact.values.some(value => !value) && fact.label !== pressingFieldLabels.year);
  const rows = showAll ? priority : priority.slice(0, 3);
  if (!showAll && importantMissing && !rows.includes(importantMissing) && !rows[2]?.differs) rows[2] = importantMissing;

  return <table className="rh-pressing-table rh-pressing-preview">
    <caption className="sr-only">Pressing evidence preview</caption>
    <thead><tr>
      <th scope="col">Evidence</th>
      {columns.map(({ choice, label }) => <th key={choice.releaseId} scope="col">
        {label} <span className="rh-pressing-preview__release">{choice.releaseId}</span>
      </th>)}
    </tr></thead>
    <tbody>{!rows.length && <tr><td colSpan={columns.length + 1}>No physical details listed yet.</td></tr>}
    {rows.map(({ label, values, differs }) => <tr key={label} className={differs ? 'rh-evidence-priority' : undefined}>
      <th scope="row">{label}{differs && <span className="rh-pressing-difference">Differs</span>}</th>
      {values.map((value, index) => <td key={index} className={value ? undefined : 'text-gray-600'}>
        {value || (columns[index].state === 'pending' ? 'Checking…' : columns[index].state === 'unavailable' ? 'Unavailable' : 'Unlisted')}
      </td>)}
    </tr>)}</tbody>
  </table>;
}

function RecordEvidenceHelp() {
  return <details className="rh-pressing-secondary text-sm text-gray-600">
    <summary>Where to check your record</summary>
    <div className="grid max-w-prose gap-2 pb-2">
      <p>Look for the catalog number, label name, and mono or stereo on the sleeve or center label. Look for etched or stamped runout marks in the smooth band just inside the last track.</p>
      <p>Discogs release country describes the market for the release. It can differ from where your record was made.</p>
    </div>
  </details>;
}

function PressingFacts({ choice, varying, formats, searchedNumber, compact }: {
  choice: PressingCandidate;
  varying?: ReadonlySet<OptionField>;
  formats?: readonly string[];
  searchedNumber?: string;
  compact?: boolean;
}) {
  const number = candidateNumber(choice, searchedNumber);
  const label = summaryField(choice, 'label');
  const fact = (field: OptionField) => {
    const value = summaryField(choice, field, formats);
    if (!value) return null;
    return <span className={`min-w-0 max-w-full ${compact && field !== 'year' ? 'truncate' : 'shrink-0'} ${varying?.has(field) ? 'font-semibold text-gray-900' : ''}`}>
      <span className="sr-only">{pressingFieldLabels[field]} </span>{value}
    </span>;
  };
  const line = `flex min-w-0 gap-x-2 text-gray-600 ${compact ? '' : 'flex-wrap'}`;
  return <>
    <span className={line}>
      <span className={`min-w-0 max-w-full font-semibold text-gray-900 ${compact ? 'truncate' : ''}`}>
        {number ? <><span className="sr-only">Catalog number </span>{number}</> : 'Catalog number unavailable'}
      </span>
      {fact('format')}
    </span>
    <span className={line}>
      {fact('country')}
      {fact('year')}
      <span className="max-w-full shrink-0">Discogs<span className="sr-only"> release</span> {choice.releaseId}</span>
    </span>
    {!compact && label && <span className={`block ${varying?.has('label') ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span className="sr-only">Label </span>{label}
    </span>}
  </>;
}

function PressingListingDetails({ choice }: { choice: PressingCandidate }) {
  const source = discogsReleaseSource(choice.releaseId);
  const rows = [
    { label: pressingFieldLabels.catalogNumber, value: choiceField(choice, 'catalogNumber') },
    ...optionFields.map(field => ({
      label: field === 'label' ? 'Labels and credits' : pressingFieldLabels[field],
      value: choiceField(choice, field),
    })),
  ].filter(({ value }) => value);
  if (!source && !rows.length) return null;
  return (
    <details className="min-w-0 text-gray-600 open:basis-full">
      <summary className="min-h-11 cursor-pointer content-center px-2 text-sm">
        Listing details<span className="sr-only"> for Discogs release {choice.releaseId}</span>
      </summary>
      <div className="grid min-w-0 gap-2 px-2 pb-2 text-sm">
        {rows.length > 0 && <dl className="grid gap-2">
          {rows.map(({ label, value }) => <div key={label}>
            <dt className="text-xs">{label}</dt><dd className="text-gray-900">{value}</dd>
          </div>)}
        </dl>}
        {source?.url && <a className="rh-comparison-source w-fit max-w-full" href={source.url} target="_blank" rel="noreferrer">
          View on Discogs<span className="sr-only"> · release {choice.releaseId} (opens in a new tab)</span>
        </a>}
      </div>
    </details>
  );
}

export function PressingSelectionSummary({ choice, compact, formats, searchedNumber, id, identityOnly }: {
  choice: PressingCandidate;
  compact?: boolean;
  formats?: readonly string[];
  searchedNumber?: string;
  id?: string;
  identityOnly?: boolean;
}) {
  if (identityOnly) {
    const number = candidateNumber(choice, searchedNumber);
    return <p id={id} className="text-xs text-gray-600">
      <span className="font-semibold text-gray-900">Selected pressing</span>
      {' · '}{number && <><span className="sr-only">Catalog number </span>{number} · </>}
      Discogs<span className="sr-only"> release</span> {choice.releaseId}
    </p>;
  }

  const markings = choice.pressing?.matrixRunouts ?? [];
  return <div id={id} className={`min-w-0 text-gray-600 [overflow-wrap:anywhere] ${compact ? 'text-xs' : 'border-t border-gray-200 pt-2 text-sm'}`}>
    <p className="mb-0.5 text-xs font-semibold text-gray-900">Selected pressing</p>
    <PressingFacts choice={choice} compact={compact} formats={formats} searchedNumber={searchedNumber} />
    {!compact && <>
      {markings.length > 0 && <div className="mt-1">
        <p className="mb-0.5 text-xs text-gray-600">Runout markings</p>
        <RunoutMarkings markings={markings} />
      </div>}
      <PressingListingDetails choice={choice} />
    </>}
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
  return choices.length > 0 && choices.every(choice => (
    !choice.pressing?.matrixRunouts?.length && evidence[choice.releaseId]?.status === 'ready'
  ));
}

function missingRunoutMessage(choices: readonly PressingCandidate[], scope: string, uncertainAction: string) {
  const differences = [...differingFields(choices)]
    .filter(field => field === 'format' || field === 'label')
    .map(field => pressingFieldLabels[field].toLowerCase());
  const next = differences.length
    ? `Compare the ${new Intl.ListFormat('en').format(differences)} on your sleeve or label.`
    : 'Check the catalog number and label on your copy.';
  return `Discogs lists no runout markings for ${scope}. ${next} ${uncertainAction}`;
}

function revealPressingEvidence(element: HTMLElement, align: 'start' | 'nearest') {
  const evidence = element.closest<HTMLElement>('.rh-pressing-review__evidence');
  if (!evidence) return;
  const scrollContainer = getComputedStyle(evidence).overflowY === 'visible'
    ? evidence.closest<HTMLElement>('.rh-pressing-review') : evidence;
  if (!scrollContainer) return;

  const style = getComputedStyle(scrollContainer);
  const viewTop = scrollContainer.getBoundingClientRect().top + scrollContainer.clientTop;
  const header = scrollContainer !== evidence ? scrollContainer.querySelector<HTMLElement>(':scope > .rh-dialog-header') : null;
  const start = viewTop + (header?.offsetHeight ?? 0) + (parseFloat(style.scrollPaddingBlockStart) || 0);
  const end = viewTop + scrollContainer.clientHeight - (parseFloat(style.scrollPaddingBlockEnd) || 0);
  const bounds = element.getBoundingClientRect();
  const top = bounds.top - (parseFloat(getComputedStyle(element).scrollMarginBlockStart) || 0);
  if (align === 'start' || top < start) scrollContainer.scrollTop += top - start;
  else if (bounds.bottom > end) scrollContainer.scrollTop += bounds.bottom - end;
}

export function PressingCandidates({
  choices, selectedId, onSelect, searchedNumber, savedReleaseId, savedEvidence, savedEvidenceState, selectedEvidence, selectedEvidenceState,
  disabled, loadDetails, onReadEvidence,
  preparation, onChangeMedium, morePressingsUrl, savedComparison,
  uncertainAction = 'If you’re unsure, go back without choosing a pressing.',
}: Props) {
  const name = useId();
  const headingId = useId();
  const sharedNumberId = useId();
  const incompleteListId = useId();
  const candidatesId = useId();
  const comparisonId = useId();
  const comparisonHeadingId = useId();
  const runoutToolsId = useId();
  const runoutStatusId = useId();
  const mediumId = useId();
  const shortlistId = useId();
  const pinnedRunoutStatusId = useId();
  const pinHintId = useId();
  const shortlistHeading = useRef<HTMLHeadingElement>(null);
  const compareToggle = useRef<HTMLButtonElement>(null);
  const comparisonHeading = useRef<HTMLHeadingElement>(null);
  const runoutHeading = useRef<HTMLHeadingElement>(null);
  const candidateList = useRef<HTMLUListElement>(null);
  const { checkingRunouts: showRunouts, comparing: showComparison, page: requestedPage, medium, pins: pinnedIds, update } = preparation;
  const [focusRequest, setFocusRequest] = useState<{ releaseId: number }>();
  const focusShortlist = useRef(false);
  const shortlistOrigin = useRef<number>(undefined);
  const focusComparison = useRef(false);
  const focusRunouts = useRef(false);
  const [loadLocally] = useState(createPressingDetailsLoader);
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
  const formats = withDetails.map(choice => choiceField(choice, 'format'));
  const media = [...new Set(formats.flatMap(pressingMedia))];
  const allowPinning = withDetails.length > pageSize;
  const offerMediaFilter = !!medium || (showComparison && allowPinning && media.length > 1);
  const available = withDetails.filter(choice => matchesPressingMedium(choice, medium));
  const lastPage = Math.max(0, Math.ceil(available.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const start = page * pageSize;
  const visible = available.slice(start, start + pageSize);
  const pinned = pinnedIds.flatMap(id => withDetails.filter(choice => choice.releaseId === id));
  const [firstPin, secondPin] = pinned;
  const pinnedCue = firstPin && secondPin && strongestDifference(firstPin, secondPin, searchedNumber, true);
  const selection = withDetails.find(choice => choice.releaseId === selectedId);
  const selectedOutsideMedia = selection && !matchesPressingMedium(selection, medium);
  const selectedOffPage = selection && !selectedOutsideMedia && !visible.includes(selection) && !pinned.includes(selection);
  const inlineRunouts = showRunouts ? visible.filter(choice => !showComparison || !pinnedIds.includes(choice.releaseId)) : [];
  const requests = showComparison || showRunouts ? withDetails.filter(choice => (
    !choice.pressing?.matrixRunouts?.length && !evidence[choice.releaseId] &&
    ((showComparison && pinnedIds.includes(choice.releaseId)) || inlineRunouts.includes(choice))
  )) : [];
  const compareGrid = showRunouts && visible.length > 1;
  const visibleMissing = allRunoutsMissing(inlineRunouts, evidence);
  const inlineRunoutScope = inlineRunouts.length === 1 ? `release ${inlineRunouts[0].releaseId}`
    : inlineRunouts.length === visible.length ? 'these pressings' : 'the unpinned pressings shown here';
  const pinnedMissing = pinned.length > 1 && allRunoutsMissing(pinned, evidence);
  const varying = differingFields(withDetails);
  // Keep the warning based on the search listing. Detailed release lookups can add more label numbers.
  const shared = sharedCatalogNumber(unique, searchedNumber);
  const savedChoice = withDetails.find(choice => choice.releaseId === savedReleaseId);
  const saved = savedReleaseId === undefined ? undefined : withPressingEvidence(savedChoice ?? { releaseId: savedReleaseId }, savedEvidence, 'release');
  const first = saved ?? visible[0];
  const example = !selection && first ? firstAlternative(first, visible, searchedNumber) ?? (saved ? undefined : first) : undefined;
  const target = selection ?? example ?? (visible.length ? saved : undefined);
  const reference = target && !selectedOutsideMedia && target.releaseId !== savedReleaseId
    ? saved ?? visible.find(choice => choice.releaseId !== target.releaseId)
    : undefined;
  const targetLabel = selectedOutsideMedia ? 'Selected pressing outside filter'
    : selection ? (target?.releaseId === savedReleaseId ? 'Saved pressing selected' : 'Selected pressing')
      : example ? 'Catalog example' : 'Saved pressing';
  const cue = example && exampleCue(example, reference, searchedNumber);
  const needsChoiceJump = (morePressingsUrl || cue?.describeMarket) && visible.length > 0;

  useLayoutEffect(() => {
    if (!showComparison || !focusComparison.current) return;
    focusComparison.current = false;
    const heading = comparisonHeading.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    revealPressingEvidence(heading, 'start');
  }, [showComparison]);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    const radio = candidateList.current?.querySelector<HTMLInputElement>(`input[value="${focusRequest.releaseId}"]`);
    if (!radio) return;
    radio.focus({ preventScroll: true });
    revealPressingEvidence(radio.closest('label') ?? radio, 'nearest');
  }, [focusRequest]);

  useLayoutEffect(() => {
    if (!showComparison || !focusShortlist.current) return;
    focusShortlist.current = false;
    const heading = shortlistHeading.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    revealPressingEvidence(heading, 'start');
  }, [showComparison]);

  useLayoutEffect(() => {
    if (!showRunouts || !focusRunouts.current) return;
    focusRunouts.current = false;
    runoutHeading.current?.focus();
  }, [showRunouts]);

  const toggleComparison = () => {
    focusComparison.current = !showComparison;
    update({ comparing: !showComparison });
  };

  const toggleRunouts = () => {
    focusRunouts.current = !showRunouts;
    update({ checkingRunouts: !showRunouts });
  };

  const jumpToShortlist = (releaseId?: number) => {
    shortlistOrigin.current = releaseId;
    const heading = shortlistHeading.current;
    if (showComparison && heading) {
      heading.focus({ preventScroll: true });
      revealPressingEvidence(heading, 'start');
    } else {
      focusShortlist.current = true;
      update({ comparing: true });
    }
  };

  const goToPage = (next: number) => {
    update({ page: next });
    const firstChoice = available[next * pageSize];
    if (firstChoice) setFocusRequest({ releaseId: firstChoice.releaseId });
  };

  const returnToChoices = (releaseId = selectedId) => {
    const choice = visible.find(candidate => candidate.releaseId === releaseId) ?? visible[0];
    if (choice) setFocusRequest({ releaseId: choice.releaseId });
  };

  const togglePin = (id: number) => {
    if (pinnedIds.includes(id)) update({ pins: pinnedIds.filter(selected => selected !== id) });
    else if (pinnedIds.length < pinLimit) update({ pins: [...pinnedIds, id] });
  };

  const retry = (id: number) => setEvidence(current => ({ ...current, [id]: undefined }));
  const changeMedium = (next: string) => {
    update({ medium: next, page: 0 });
    onChangeMedium?.();
  };
  const findChoice = (releaseId: number, inAllMedia = false) => {
    const candidates = inAllMedia ? withDetails : available;
    const index = candidates.findIndex(choice => choice.releaseId === releaseId);
    if (index < 0) return;
    update({ medium: inAllMedia ? '' : medium, page: Math.floor(index / pageSize) });
    if (inAllMedia) onChangeMedium?.();
    setFocusRequest({ releaseId });
  };
  const showSelection = () => {
    if (!selection) return;
    findChoice(selection.releaseId, true);
  };
  const evidenceState = (choice: PressingCandidate): EvidenceState | undefined => {
    if (choice.releaseId === savedReleaseId) return savedEvidenceState;
    if (evidence[choice.releaseId]?.status === 'ready' || (choice.releaseId === selectedId && selectedEvidence)) return undefined;
    if (evidence[choice.releaseId]?.status === 'error') return 'unavailable';
    if (requests.some(request => request.releaseId === choice.releaseId)) return 'pending';
    return choice.releaseId === selectedId ? selectedEvidenceState : undefined;
  };

  if (!unique.length) return null;

  return (
    <fieldset disabled={disabled} aria-labelledby={headingId}
      aria-describedby={[shared && sharedNumberId, morePressingsUrl && incompleteListId].filter(Boolean).join(' ') || undefined}
      className="@container min-w-0 space-y-2 [overflow-wrap:anywhere]">
      {requests.map(({ releaseId }) => <EvidenceRequest key={releaseId} releaseId={releaseId}
        loadDetails={loadDetails ?? loadLocally} onResult={recordEvidence} />)}
      <div>
        <div className="rh-pressing-chooser-heading">
          <p id={headingId} className={needsChoiceJump ? 'text-sm font-semibold max-[25rem]:sr-only' : 'text-sm font-semibold'}>
            Choose a pressing
          </p>
          {needsChoiceJump && <button type="button"
            className="rh-lookup-link rh-pressing-compare rh-pressing-choice-jump"
            aria-controls={candidatesId} onClick={() => returnToChoices()}>Go to pressings</button>}
          <div className="rh-pressing-chooser-actions">
            <button type="button" ref={compareToggle} className="rh-lookup-link rh-pressing-compare"
              aria-expanded={showComparison} aria-controls={`${runoutToolsId} ${comparisonId} ${candidatesId}`}
              onClick={toggleComparison}>Compare listings</button>
            {firstPin && <button type="button" className="rh-lookup-link rh-pressing-compare" aria-controls={showComparison ? shortlistId : undefined}
              aria-label={secondPin ? 'Compare 2 pinned pressings' : 'Go to 1 pinned pressing'}
              onClick={() => jumpToShortlist()}>{secondPin ? 'Compare 2 pins' : '1 pinned'}</button>}
          </div>
        </div>
        {(shared || morePressingsUrl) && <div className="rh-pressing-scope">
          <p className="text-xs text-gray-600">
            {shared && <span id={sharedNumberId} className="block">{shared.number} is shared by {shared.count} pressings in these results.</span>}
            {morePressingsUrl && <span id={incompleteListId} className="block">Discogs returned a partial list for this album.</span>}
          </p>
          {morePressingsUrl && <a href={morePressingsUrl} className="rh-comparison-source rh-pressing-scope__link" target="_blank" rel="noreferrer">
            Find more on Discogs<span className="sr-only"> (opens in a new tab)</span>
          </a>}
        </div>}
        <div className="rh-pressing-example">
          <p className="rh-pressing-example__clue text-xs text-gray-600">
            {example && cue && unique.length > 1 ? <>
              <span className="block font-semibold text-gray-900">Example only · Discogs {example.releaseId}</span>
              {cue.difference && <><strong className="font-semibold text-gray-900">{cue.difference}</strong>{' '}</>}
              {cue.guidance}
            </> : 'Check the number, label, or etched marks on your copy.'}
          </p>
          <button type="button" className="rh-lookup-link rh-pressing-example__action"
            aria-expanded={showRunouts} aria-controls={candidatesId} onClick={toggleRunouts}>
            {showRunouts ? 'Hide runout marks' : 'Check runout marks'}
          </button>
          {cue?.describeMarket && <p className="rh-pressing-example__market text-xs text-gray-600">Market means where sold. Where made can differ.</p>}
        </div>
      </div>
      <div id={runoutToolsId} hidden={!showComparison}>
        {showComparison && <div className="rh-pressing-evidence-tools">
          <div className="flex flex-wrap items-center gap-x-3">
            <RecordEvidenceHelp />
            {example && unique.length > 1 && <button type="button" className="rh-lookup-link -ml-2 text-left" onClick={() => findChoice(example.releaseId)}>
              Find example in list<span className="sr-only"> · Discogs {example.releaseId}</span>
            </button>}
          </div>
          {allowPinning && !firstPin && <p id={pinHintId} className="text-xs text-gray-600">Pin two pressings to compare them across pages.</p>}
        </div>}
      </div>
      {offerMediaFilter && <div className="rh-pressing-tools">
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
          <label htmlFor={mediumId}>Media</label>
          <select id={mediumId} value={medium} aria-controls={candidatesId}
            className="min-h-11 max-w-full rounded-lg border border-gray-300 px-2"
            onChange={event => changeMedium(event.target.value)}>
            <option value="">All media</option>
            {media.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>}
      {selectedOutsideMedia && <button type="button" className="rh-lookup-link -ml-2 text-left" onClick={showSelection}>Show selected pressing in All media</button>}
      {showRunouts && <div>
        <h3 ref={runoutHeading} tabIndex={-1} className="text-sm font-semibold"
          aria-describedby={visibleMissing ? runoutStatusId : undefined}>Runout marks on these pressings</h3>
        <p id={runoutStatusId} role="status" aria-atomic="true" className="text-sm text-gray-600">
          {visibleMissing && missingRunoutMessage(inlineRunouts, inlineRunoutScope, uncertainAction)}
        </p>
        <p className="text-xs text-gray-600">Look just inside the last track for etched or stamped marks.</p>
      </div>}
      <ul id={candidatesId} ref={candidateList} className={`min-w-0 divide-y divide-gray-200 border-y border-gray-200 ${compareGrid
        ? '@min-[30rem]:grid @min-[30rem]:grid-cols-2 @min-[30rem]:gap-2 @min-[30rem]:divide-y-0 @min-[30rem]:border-y-0' : ''}
        ${compareGrid && visible.length > 2 ? '@min-[40rem]:grid-cols-3' : ''}`}>
        {visible.map(choice => {
          const { releaseId } = choice;
          const checked = selectedId === releaseId;
          const isPinned = pinnedIds.includes(releaseId);
          return (
            <li key={releaseId} className={`min-w-0 ${checked ? 'bg-blue-50' : ''} ${compareGrid
              ? '@min-[30rem]:row-span-2 @min-[30rem]:grid @min-[30rem]:grid-rows-subgrid @min-[30rem]:rounded-lg @min-[30rem]:border @min-[30rem]:border-gray-200' : ''}`}>
              <div className={`grid min-w-0 items-start gap-x-2 ${showRunouts ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
                <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-sm">
                  <input type="radio" name={name} value={releaseId} checked={checked} onChange={() => onSelect(releaseId)}
                    className="mt-1 shrink-0 accent-blue-600" />
                  <span className="min-w-0">
                  {checked && <span className="rh-pressing-candidate-role">{releaseId === savedReleaseId ? 'Saved pressing selected' : 'Selected pressing'}</span>}
                    <PressingFacts choice={choice} varying={varying} formats={formats} searchedNumber={searchedNumber} />
                  {releaseId === savedReleaseId && !checked && <span className="block text-gray-600">Your saved pressing</span>}
                    {choice.catalogNumberMatch === 'unverified' && <span className="block text-gray-600">Check the number on the listing.</span>}
                  </span>
                </label>
                {showComparison && <div className={`flex min-w-0 flex-wrap items-center gap-x-1 px-2 ${showRunouts ? '' : 'sm:max-w-64 sm:justify-end'}`}>
                  {allowPinning && <button type="button" className="rh-lookup-link aria-disabled:opacity-60"
                    aria-label={`${isPinned ? 'Unpin pressing' : 'Pin for comparison'} · ${candidateLabel(choice, searchedNumber, formats)}`}
                    aria-describedby={pinHintId} aria-disabled={!isPinned && pinned.length >= pinLimit}
                    onClick={() => togglePin(releaseId)}>{isPinned ? 'Unpin' : 'Pin'}</button>}
                  {releaseId === secondPin?.releaseId && <button type="button" className="rh-lookup-link" aria-controls={shortlistId}
                    onClick={() => jumpToShortlist(releaseId)}>Compare pinned pressings</button>}
                  <PressingListingDetails choice={choice} />
                </div>}
              </div>
              {inlineRunouts.includes(choice) && !visibleMissing && <CandidateRunout choice={choice} result={evidence[releaseId]} onRetry={retry} disabled={disabled} />}
            </li>
          );
        })}
      </ul>
      {(allowPinning || medium) && (
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <p role="status" className="mr-auto text-xs text-gray-600">
            {lastPage > 0
              ? `Pressings ${start + 1}–${start + visible.length} of ${available.length}`
              : `${available.length} ${medium ? `${medium} ` : ''}${available.length === 1 ? 'pressing' : 'pressings'}`}
          </p>
          {page > 0 && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page - 1)}>Previous pressings</button>}
          {page < lastPage && <button type="button" className="rh-lookup-link" onClick={() => goToPage(page + 1)}>More pressings</button>}
        </div>
      )}
      <div id={comparisonId} role="region" aria-labelledby={showComparison ? comparisonHeadingId : undefined} hidden={!showComparison}>
        {showComparison && <div className="rh-pressing-evidence-tools grid gap-2">
          <div className="rh-pressing-chooser-heading">
            <h3 id={comparisonHeadingId} ref={comparisonHeading} tabIndex={-1} className="text-sm font-semibold">Listing evidence</h3>
            <button type="button" className="rh-lookup-link" aria-controls={candidatesId}
              onClick={() => returnToChoices()}>Back to pressings</button>
          </div>
          {target && (unique.length > 1 || reference || !savedComparison) && <PressingPreview searchedNumber={searchedNumber}
            reference={reference && { choice: reference, label: saved ? 'Saved pressing' : 'Catalog reference', state: evidenceState(reference) }}
            target={{
              choice: target.releaseId === savedReleaseId && saved ? saved : withPressingEvidence(target, selectedEvidence, 'release'),
              label: targetLabel,
              state: evidenceState(target),
            }} />}
          {savedComparison}
        </div>}
      </div>
      {showComparison && firstPin && (
        <section id={shortlistId} aria-labelledby={`${shortlistId}-title`} className="rh-pressing-evidence-tools grid min-w-0 gap-2">
          <div className="rh-pressing-chooser-heading">
            <h3 id={`${shortlistId}-title`} ref={shortlistHeading} tabIndex={-1} className="text-sm font-semibold"
              aria-describedby={pinnedMissing ? pinnedRunoutStatusId : undefined}>{secondPin ? 'Pinned pressing evidence' : 'Pinned pressings'}</h3>
            <button type="button" className="rh-lookup-link" aria-controls={candidatesId}
              onClick={() => returnToChoices(shortlistOrigin.current)}>Back to pressing choices</button>
          </div>
          {secondPin && <>
            <p className="text-xs text-gray-600">
              {pinnedCue ? pinnedCue.cue : 'No confirmed listing differences. Check the etched or stamped marks just inside the last track.'}
              {pinnedCue && pinnedCue.label === pressingFieldLabels.country && ' Release market means where sold.'}
            </p>
            <PressingPreview showAll searchedNumber={searchedNumber}
              reference={{ choice: firstPin, label: 'First pin', state: evidenceState(firstPin) }}
              target={{ choice: secondPin, label: 'Second pin', state: evidenceState(secondPin) }} />
          </>}
          <p id={pinHintId} role="status" className="text-xs text-gray-600">
            {secondPin ? 'Unpin one to compare another pressing.' : 'Pin one more pressing to compare across pages.'}
          </p>
          <p id={pinnedRunoutStatusId} role="status" aria-atomic="true" className="empty:sr-only text-sm text-gray-600">
            {pinnedMissing && missingRunoutMessage(pinned, 'the pinned pressings', uncertainAction)}
          </p>
          <ul className="grid min-w-0 gap-2 @min-[30rem]:grid-cols-2">
            {pinned.map(choice => {
              const { releaseId } = choice;
              const checked = releaseId === selectedId;
              const outsideMedia = !matchesPressingMedium(choice, medium);
              return <li key={releaseId} className="grid min-w-0 content-start gap-1 border-t border-gray-200 px-2 py-2 text-sm">
                {secondPin ? <p className="font-semibold">Discogs release {releaseId}</p>
                  : <div><PressingFacts choice={choice} formats={formats} searchedNumber={searchedNumber} /></div>}
                {releaseId === savedReleaseId && <p className="text-gray-600">Your saved pressing</p>}
                {outsideMedia && <p className="text-gray-600">Outside the {medium} filter</p>}
                <PressingListingDetails choice={choice} />
                {!pinnedMissing && <CandidateRunout choice={choice} result={evidence[releaseId]} onRetry={retry} disabled={disabled} />}
                <div className="flex flex-wrap gap-x-1">
                  <button type="button" className="rh-lookup-link -ml-2 text-left aria-disabled:opacity-60" aria-disabled={checked || outsideMedia}
                    aria-label={`${checked ? 'Selected pressing' : 'Select pressing'} · ${candidateLabel(choice, searchedNumber, formats)}`}
                    onClick={() => { if (!checked && !outsideMedia) onSelect(releaseId); }}>
                    {checked ? 'Selected pressing' : 'Select pressing'}
                  </button>
                  <button type="button" className="rh-lookup-link" aria-label={`Unpin pressing · ${candidateLabel(choice, searchedNumber, formats)}`}
                    onClick={() => {
                      const control = secondPin ? shortlistHeading.current : compareToggle.current;
                      if (control) {
                        control.focus({ preventScroll: true });
                        revealPressingEvidence(control, 'nearest');
                      }
                      togglePin(releaseId);
                    }}>Unpin</button>
                </div>
              </li>;
            })}
          </ul>
        </section>
      )}
      {selectedOffPage && <details className="rh-pressing-secondary">
        <summary>Selected pressing details</summary>
        <PressingSelectionSummary choice={selection} formats={formats} searchedNumber={searchedNumber} />
      </details>}
    </fieldset>
  );
}
