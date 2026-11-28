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

function formatQualifiers(value: string) {
  return value.split('·').map(part => part.trim().toLowerCase()).filter(part => (
    part && part !== 'album' && !Object.values(pressingFormatFacts(part)).some(Boolean)
  )).sort().join('·');
}

const runoutClue = 'Look just inside the last track for etched or stamped marks.';

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

function comparisonRows(left: PressingCandidate, right?: PressingCandidate, searchedNumber?: string, showAll = false, includeListedFormat = false) {
  const choices = right ? [left, right] : [left];
  const rows = comparisonFacts.map(({ label, read, readFull, compare }) => {
    const compact = choices.map(choice => read(choice, searchedNumber));
    const full = readFull ? choices.map(readFull) : compact;
    const differs = hasKnownDifference(compare ? full.map(compare) : full);
    return { label, values: showAll || differs ? full : compact, differs };
  });
  const formats = choices.map(choice => choiceField(choice, 'format'));
  const qualifiersDiffer = !!right && formats.every(Boolean) && new Set(formats.map(formatQualifiers)).size > 1;
  if (includeListedFormat || qualifiersDiffer) rows.push({ label: 'Listed format', values: formats, differs: qualifiersDiffer });
  if (right && !showAll) {
    const markings = choices.map(choice => choice.pressing?.matrixRunouts?.map(marking => marking.value.trim()).filter(Boolean) ?? []);
    const keys = markings.map(marks => new Set(marks.map(mark => mark.toLowerCase())));
    if (keys.every(key => key.size) && (keys[0].size !== keys[1].size || [...keys[0]].some(mark => !keys[1].has(mark)))) {
      const values = markings.map((marks, index) => marks.find(mark => !keys[1 - index].has(mark.toLowerCase())) ?? marks[0]);
      rows.push({ label: 'Runout marks', values, differs: true });
    }
  }
  return rows.filter(({ values }) => values.some(Boolean));
}

const exampleEvidencePriority = [
  { label: pressingFieldLabels.catalogNumber, cue: 'Check the sleeve or label.' },
  { label: pressingFieldLabels.label, cue: 'Check the center label.' },
  { label: 'Runout marks', cue: runoutClue },
  { label: 'Mix', cue: 'Check the sleeve or label.' },
  { label: 'Format', cue: 'Check your media.' },
  { label: 'Size', cue: 'Check the record size.' },
  { label: 'Speed', cue: 'Check the center label.' },
  { label: 'Record type', cue: 'Check the sleeve.' },
  { label: 'Listed format', cue: 'Check the edition details on your sleeve.' },
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

export function PressingPreview({ reference, target, searchedNumber, showAll = false, cue, cueAction, includeListedFormat = false }: {
  reference?: PreviewColumn;
  target: PreviewColumn;
  searchedNumber?: string;
  showAll?: boolean;
  cue?: string;
  cueAction?: ReactNode;
  includeListedFormat?: boolean;
}) {
  const columns = reference ? [reference, target] : [target];
  const facts = comparisonRows(columns[0].choice, columns[1]?.choice, searchedNumber, showAll, includeListedFormat);

  // Keep true differences first. A missing value is only worth an early row when it helps explain an uncertain match.
  const differences = facts.filter(fact => fact.differs);
  const priorityLabels = exampleEvidencePriority.map(evidence => evidence.label);
  if (showAll || cue) differences.sort((a, b) => priorityLabels.indexOf(a.label) - priorityLabels.indexOf(b.label));
  const priority = [...differences, ...facts.filter(fact => !fact.differs && fact.values.every(Boolean)),
    ...facts.filter(fact => fact.values.some(value => !value))];
  const importantMissing = facts.find(fact => fact.values.some(value => !value) && fact.label !== pressingFieldLabels.year);
  const lead = reference && !showAll ? differences : priority;
  const rows = showAll ? priority : lead.slice(0, 3);
  if (rows.length < 3 && !showAll && importantMissing && !rows.includes(importantMissing)) rows.push(importantMissing);
  const checking = columns.some(column => column.state === 'pending');
  const unavailable = columns.some(column => column.state === 'unavailable');
  const comparedPair = reference && !showAll;

  return <table className="rh-pressing-table rh-pressing-preview">
    <caption className={cue ? 'rh-pressing-preview__cue' : 'sr-only'}>
      <span className={cueAction ? 'rh-pressing-preview__cue-actions' : undefined}>
        {cue ?? (showAll ? 'Full listing evidence' : 'Pressing evidence preview')}{cueAction}
      </span>
    </caption>
    <thead><tr>
      <th scope="col">Evidence</th>
      {columns.map(({ choice, label }) => <th key={choice.releaseId} scope="col">
        {label} <span className="rh-pressing-preview__release">{choice.releaseId}</span>
      </th>)}
    </tr></thead>
    <tbody>{(!rows.length || (comparedPair && !differences.length)) && <tr><td colSpan={columns.length + 1}>{checking
      ? 'Checking Discogs for listing evidence…' : unavailable ? 'Some Discogs evidence is unavailable.'
        : comparedPair ? 'No confirmed differences in the available facts.' : 'No physical details listed yet.'}</td></tr>}
    {rows.map(({ label, values, differs }) => <tr key={label} className={differs ? 'rh-evidence-priority' : undefined}>
      <th scope="row">{label}{differs && <span className="rh-pressing-difference">Differs</span>}</th>
      {values.map((value, index) => <td key={index} className={value ? undefined : 'text-gray-600'}>
        {value || (columns[index].state === 'pending' ? 'Checking…' : columns[index].state === 'unavailable' ? 'Unavailable' : 'Unlisted')}
      </td>)}
    </tr>)}</tbody>
  </table>;
}

export function PressingPairSelects({ choices, firstId, secondId, onChangeFirst, onChangeSecond, searchedNumber, savedReleaseId }: {
  choices: readonly PressingCandidate[];
  firstId: number;
  secondId: number;
  onChangeFirst: (releaseId: number) => void;
  onChangeSecond: (releaseId: number) => void;
  searchedNumber?: string;
  savedReleaseId?: number;
}) {
  const id = useId();
  const formats = choices.map(choice => choiceField(choice, 'format'));
  const choiceFacts = choices.map(choice => [
    summaryField(choice, 'label'),
    candidateNumber(choice, searchedNumber),
    summaryField(choice, 'format', formats),
    summaryField(choice, 'country'),
    summaryField(choice, 'year'),
  ]);
  const varying = choiceFacts[0]?.map((_, index) => hasKnownDifference(choiceFacts.map(facts => facts[index])));
  const options = choices.map(({ releaseId }, index) => {
    const facts = choiceFacts[index];
    return {
      id: releaseId,
      label: [
        ...facts.filter((_, index) => varying?.[index]),
        `Discogs ${releaseId}`,
        releaseId === savedReleaseId && 'Saved pressing',
        ...facts.filter((_, index) => !varying?.[index]),
      ].filter(Boolean).join(' · '),
    };
  });

  return (
    <div className="rh-pressing-pair" role="group" aria-label="Listings to compare">
      {[
        { label: 'First listing', value: firstId, excludedId: secondId, onChange: onChangeFirst },
        { label: 'Second listing', value: secondId, excludedId: firstId, onChange: onChangeSecond },
      ].map(({ label, value, excludedId, onChange }, index) => (
        <div key={label} className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-${index}`} className="text-xs font-medium text-gray-600">{label}</label>
          <select id={`${id}-${index}`} value={value} className="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 px-2 text-sm"
            onChange={event => onChange(Number(event.target.value))}>
            {options.filter(option => option.id !== excludedId).map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
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

function CandidateRunout({ choice, result, onRetry, disabled, fullEvidence = false }: {
  choice: PressingCandidate;
  result?: EvidenceResult;
  onRetry: (releaseId: number) => void;
  disabled?: boolean;
  fullEvidence?: boolean;
}) {
  const { releaseId } = choice;
  const heading = useRef<HTMLParagraphElement>(null);
  const markings = choice.pressing?.matrixRunouts ?? [];

  const evidenceFailed = fullEvidence && result?.status === 'error';
  const message = evidenceFailed ? 'Couldn’t load full Discogs evidence.' : markings.length ? 'Runout markings loaded.' : !result ? 'Checking Discogs…'
    : result.status === 'error' ? 'Couldn’t load runout markings.' : 'Discogs lists no runout markings for this release.';

  return (
    <div className="min-w-0 px-2 py-2 text-sm [overflow-wrap:anywhere]">
      <p ref={heading} tabIndex={-1} className="mb-0.5 font-semibold">
        Runout markings<span className="sr-only"> for Discogs release {releaseId}</span>
      </p>
      <p role="status" className={markings.length && !evidenceFailed ? 'sr-only' : 'text-gray-600'}>
        <span className="sr-only">Discogs release {releaseId}. </span>{message}
      </p>
      {(evidenceFailed || (!markings.length && result?.status === 'error')) && (
        <button type="button" className="rh-lookup-link -ml-2" disabled={disabled}
          aria-label={`Retry ${fullEvidence ? 'evidence' : 'runout markings'} for Discogs release ${releaseId}`}
          onClick={() => {
            heading.current?.focus({ preventScroll: true });
            onRetry(releaseId);
          }}>{fullEvidence ? 'Retry evidence' : 'Retry runout markings'}</button>
      )}
      {markings.length > 0 && <RunoutMarkings markings={markings} />}
    </div>
  );
}

export function PressingPairEvidence({ reference, target, searchedNumber, loadDetails, onLocate, canLocate, locateContext, unavailableLocation,
  disabled, uncertainAction, announceChanges, children }: {
  reference?: PreviewColumn;
  target: PreviewColumn;
  searchedNumber?: string;
  loadDetails?: LoadPressingDetails;
  onLocate?: (releaseId: number) => void;
  canLocate?: (releaseId: number) => boolean;
  locateContext?: (releaseId: number) => string | undefined;
  unavailableLocation?: (releaseId: number) => string;
  disabled?: boolean;
  uncertainAction?: string;
  announceChanges?: boolean;
  children?: ReactNode;
}) {
  const runoutId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [runoutsOpen, setRunoutsOpen] = useState(false);
  const [loadLocally] = useState(createPressingDetailsLoader);
  const [evidence, setEvidence] = useState<Partial<Record<number, EvidenceResult>>>({});
  const record = useCallback((releaseId: number, result: EvidenceResult) => {
    setEvidence(current => ({ ...current, [releaseId]: result }));
  }, []);
  const retry = (releaseId: number) => setEvidence(current => ({ ...current, [releaseId]: undefined }));
  const columns = reference ? [reference, target] : [target];
  const summaryDifference = reference && strongestDifference(reference.choice, target.choice, searchedNumber);
  const checkReleaseDetails = !!reference && !summaryDifference;
  const shouldLoad = checkReleaseDetails || detailsOpen || runoutsOpen;
  const full: PreviewColumn[] = columns.map(column => {
    const result = evidence[column.choice.releaseId];
    return {
      ...column,
      choice: withPressingEvidence(column.choice, result?.status === 'ready' ? result.details : undefined, 'release'),
      state: !result ? 'pending' : result.status === 'error' ? 'unavailable' : undefined,
    };
  });
  const preview = checkReleaseDetails || runoutsOpen ? full : columns;
  const checkingOverview = checkReleaseDetails && full.some(column => column.state === 'pending');
  const difference = reference && strongestDifference(preview[0].choice, preview[1].choice, searchedNumber);
  const cue = reference ? (difference?.label === pressingFieldLabels.country ? 'Check the label. Release market is where sold.'
    : difference?.cue ?? runoutClue) : 'Check the sleeve or center label for the catalog number.';
  const diffSummary = difference ? `${difference.label} differs, ${difference.values.map(value => concisePressingValue(value, 36)).join(' and ')}.`
    : 'No confirmed differences in the listing preview.';
  const runouts = (withSources: boolean) => full.map(({ choice }) => {
    const source = withSources && discogsReleaseSource(choice.releaseId);
    return <div key={choice.releaseId} className="min-w-0">
      {source && source.url && <a className="rh-comparison-source text-xs" href={source.url} target="_blank" rel="noreferrer">
        Release {choice.releaseId} on Discogs<span className="sr-only"> (opens in a new tab)</span>
      </a>}
      {!withSources && <p className="px-2 pt-2 text-xs font-medium">Discogs release {choice.releaseId}</p>}
      {(!withSources || !runoutsOpen) && <CandidateRunout fullEvidence choice={choice} result={evidence[choice.releaseId]} onRetry={retry} disabled={disabled} />}
    </div>;
  });

  return <>
    {shouldLoad && full.map(({ choice: { releaseId } }) => !evidence[releaseId] && <EvidenceRequest key={releaseId} releaseId={releaseId}
      loadDetails={loadDetails ?? loadLocally} onResult={record} />)}
    <PressingPreview reference={reference && preview[0]} target={reference ? preview[1] : preview[0]} searchedNumber={searchedNumber} cue={cue}
      cueAction={reference && <button type="button" className="rh-lookup-link rh-pressing-runout-action" disabled={disabled}
        aria-expanded={runoutsOpen} aria-controls={runoutId} aria-description={runoutClue}
        onClick={() => setRunoutsOpen(open => !open)}>{runoutsOpen ? 'Hide pair runouts' : 'Check pair runouts'}</button>} />
    {reference && <div id={runoutId} hidden={!runoutsOpen} className="rh-pressing-pair rh-pressing-pair-runouts" role="group" aria-label="Runout marks for this pair">
      {runoutsOpen && runouts(false)}
    </div>}
    {children}
    {reference && onLocate && <div className="rh-pressing-pair" aria-label="Find the compared listings" role="group">
      {columns.map(({ choice: { releaseId } }) => {
        const location = locateContext?.(releaseId);
        return !canLocate || canLocate(releaseId)
          ? <button key={releaseId} type="button" className="rh-lookup-link text-left" disabled={disabled}
            aria-label={`Go to Discogs release ${releaseId}${location ? ` · ${location}` : ''}`}
            onClick={() => onLocate(releaseId)}>Find release {releaseId}{location && ` · ${location}`}</button>
          : <p key={releaseId} className="self-center text-xs text-gray-600">
            {unavailableLocation?.(releaseId) ?? `Release ${releaseId} is outside these choices.`}
          </p>;
      })}
    </div>}
    {reference && <p role="status" className="sr-only">{checkingOverview ? 'Checking Discogs for listing differences.'
      : (announceChanges || checkReleaseDetails) && `Comparing Discogs releases ${reference.choice.releaseId} and ${target.choice.releaseId}. ${diffSummary}`}</p>}
    {reference && !difference && uncertainAction && <p className="text-xs text-gray-600">{uncertainAction}</p>}
    <details className="rh-pressing-secondary" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>{runoutsOpen ? 'More listing evidence' : 'More evidence and runout marks'}</summary>
      {detailsOpen && <div className="grid min-w-0 gap-2 pb-2">
        <PressingPreview reference={reference && full[0]} target={reference ? full[1] : full[0]} searchedNumber={searchedNumber} showAll includeListedFormat />
        <div className={reference ? 'rh-pressing-pair' : undefined} role="group" aria-label="Sources and release details">{runouts(true)}</div>
        {(!reference || difference) && uncertainAction && <p className="text-xs text-gray-600">{uncertainAction}</p>}
      </div>}
    </details>
  </>;
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
  const runoutStatusId = useId();
  const runoutHelpId = useId();
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
  const [chosenPair, setChosenPair] = useState<{ firstId: number; secondId: number; explicit?: boolean }>();
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
  const allowPairChoice = withDetails.length > 2;
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
  const reference = target && !selectedOutsideMedia
    ? (saved && saved.releaseId !== target.releaseId ? saved : visible.find(choice => choice.releaseId !== target.releaseId))
    : undefined;
  const targetLabel = selectedOutsideMedia ? 'Selected pressing outside filter'
    : selection ? (target?.releaseId === savedReleaseId ? 'Saved pressing selected' : 'Selected pressing')
      : example ? (reference ? 'Catalog example' : 'Catalog listing') : 'Saved pressing';
  const cue = example && exampleCue(example, reference, searchedNumber);
  const comparisonChoices = saved ? [saved, ...withDetails.filter(choice => choice.releaseId !== savedReleaseId)] : withDetails;
  const firstChoice = chosenPair && comparisonChoices.find(choice => choice.releaseId === chosenPair.firstId);
  const secondChoice = chosenPair && comparisonChoices.find(choice => choice.releaseId === chosenPair.secondId);
  const customPair = firstChoice && secondChoice ? { firstChoice, secondChoice } : undefined;
  const isExplicitPair = !!(customPair && chosenPair?.explicit);
  const rightListing = customPair?.secondChoice ?? target;
  const leftListing = customPair?.firstChoice ?? reference ?? (allowPairChoice && rightListing
    ? comparisonChoices.find(choice => choice.releaseId !== rightListing.releaseId) : undefined);
  const canChoosePair = allowPairChoice && leftListing && rightListing;
  const canCompare = !!(leftListing && rightListing);

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
    const heading = runoutHeading.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    revealPressingEvidence(heading, 'nearest');
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
    return choice.releaseId === selectedId || unique.length === 1 ? selectedEvidenceState : undefined;
  };
  const listingColumn = (choice: PressingCandidate, label: string): PreviewColumn => ({
    choice: choice.releaseId === selectedId || (unique.length === 1 && unique[0].releaseId === choice.releaseId)
      ? withPressingEvidence(choice, selectedEvidence, 'release') : choice,
    label,
    state: evidenceState(choice),
  });
  const referenceColumn = leftListing && listingColumn(leftListing, leftListing.releaseId === savedReleaseId ? 'Saved pressing'
    : isExplicitPair ? 'First listing' : 'Catalog reference');
  const targetColumn = rightListing && listingColumn(rightListing.releaseId === savedReleaseId && saved ? saved : rightListing,
    isExplicitPair ? (rightListing.releaseId === savedReleaseId ? 'Saved pressing' : 'Second listing') : targetLabel);
  const choiceLocation = (releaseId: number) => {
    const index = available.findIndex(choice => choice.releaseId === releaseId);
    if (index >= 0) return { page: Math.floor(index / pageSize), allMedia: false };
    const allIndex = withDetails.findIndex(choice => choice.releaseId === releaseId);
    return allIndex < 0 ? undefined : { page: Math.floor(allIndex / pageSize), allMedia: true };
  };
  const locateContext = (releaseId: number) => {
    const location = choiceLocation(releaseId);
    if (!location) return undefined;
    if (location.allMedia) return `All media · page ${location.page + 1}`;
    return location.page === page ? undefined : `page ${location.page + 1}`;
  };
  const locateComparedChoice = (releaseId: number) => {
    const location = choiceLocation(releaseId);
    if (!location) return;
    if (!location.allMedia && location.page === page) {
      returnToChoices(releaseId);
      return;
    }
    if (!customPair && leftListing && rightListing) setChosenPair({ firstId: leftListing.releaseId, secondId: rightListing.releaseId });
    findChoice(releaseId, location.allMedia);
  };

  if (!unique.length) return null;

  return (
    <fieldset disabled={disabled} aria-labelledby={headingId}
      aria-describedby={[shared && sharedNumberId, morePressingsUrl && incompleteListId].filter(Boolean).join(' ') || undefined}
      className="@container min-w-0 space-y-2 [overflow-wrap:anywhere]">
      {requests.map(({ releaseId }) => <EvidenceRequest key={releaseId} releaseId={releaseId}
        loadDetails={loadDetails ?? loadLocally} onResult={recordEvidence} />)}
      <div className="grid gap-1">
        <div className="rh-pressing-chooser-heading">
          <p id={headingId} className="text-sm font-semibold">Choose a pressing</p>
          {offerMediaFilter && <div className="rh-pressing-tools text-sm text-gray-600">
            <label htmlFor={mediumId}>Media</label>
            <select id={mediumId} value={medium} aria-controls={candidatesId}
              className="min-h-11 max-w-full rounded-lg border border-gray-300 px-2"
              onChange={event => changeMedium(event.target.value)}>
              <option value="">All media</option>
              {media.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>}
        </div>
        {(shared || morePressingsUrl) && <p className="text-xs text-gray-600">
          {shared && <span id={sharedNumberId} className="block">{shared.number} is shared by {shared.count} pressings in these results.</span>}
          {morePressingsUrl && <span id={incompleteListId} className="block">
            {unique.length === 1 ? 'One listing shown from a partial Discogs result.' : 'Discogs returned a partial list for this album.'}
          </span>}
        </p>}
        {cue?.difference && <p className="rh-pressing-choice-clue text-xs text-gray-600">
          <strong className="font-semibold text-gray-900">{cue.difference}</strong>{' '}{cue.guidance}
          {cue.describeMarket && ' Market means where sold. Where made can differ.'}
        </p>}
      </div>
      {selectedOutsideMedia && <button type="button" className="rh-lookup-link -ml-2 text-left" onClick={showSelection}>Show selected pressing in All media</button>}
      {showRunouts && <div>
        <h3 ref={runoutHeading} tabIndex={-1} className="text-sm font-semibold"
          aria-describedby={visibleMissing ? runoutStatusId : undefined}>Runout marks on these pressings</h3>
        <p id={runoutStatusId} role="status" aria-atomic="true" className="text-sm text-gray-600">
          {visibleMissing && missingRunoutMessage(inlineRunouts, inlineRunoutScope, uncertainAction)}
        </p>
        <p className="text-xs text-gray-600">{runoutClue}</p>
      </div>}
      {showComparison && canCompare && allowPinning && !firstPin && <p id={pinHintId} className="text-xs text-gray-600">Pin two pressings to compare them across pages.</p>}
      <ul id={candidatesId} ref={candidateList} className={`min-w-0 divide-y divide-gray-200 border-y border-gray-200 ${compareGrid
        ? '@min-[30rem]:grid @min-[30rem]:grid-cols-2 @min-[30rem]:gap-2 @min-[30rem]:divide-y-0 @min-[30rem]:border-y-0' : ''}
        ${compareGrid && visible.length > 2 ? '@min-[40rem]:grid-cols-3' : ''}`}>
        {visible.map(choice => {
          const { releaseId } = choice;
          const checked = selectedId === releaseId;
          const isPinned = pinnedIds.includes(releaseId);
          const isCompared = showComparison && !!leftListing && (leftListing.releaseId === releaseId || rightListing?.releaseId === releaseId);
          const roles = [
            checked ? (releaseId === savedReleaseId ? 'Saved pressing selected' : 'Selected pressing') : releaseId === savedReleaseId && 'Your saved pressing',
            isCompared && 'Compared',
            isPinned && 'Pinned',
          ].filter(Boolean).join(' · ');
          return (
            <li key={releaseId} className={`min-w-0 ${checked ? 'bg-blue-50' : ''} ${compareGrid
              ? '@min-[30rem]:row-span-2 @min-[30rem]:grid @min-[30rem]:grid-rows-subgrid @min-[30rem]:rounded-lg @min-[30rem]:border @min-[30rem]:border-gray-200' : ''}`}>
              <div className={`grid min-w-0 items-start gap-x-2 ${showRunouts ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
                <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 px-2 py-2 text-sm">
                  <input type="radio" name={name} value={releaseId} checked={checked} onChange={() => onSelect(releaseId)}
                    className="mt-1 shrink-0 accent-blue-600" />
                  <span className="min-w-0">
                    {roles && <span className="rh-pressing-candidate-role">{roles}</span>}
                    <PressingFacts choice={choice} varying={varying} formats={formats} searchedNumber={searchedNumber} />
                    {choice.catalogNumberMatch === 'unverified' && <span className="block text-gray-600">Check the number on the listing.</span>}
                  </span>
                </label>
                {showComparison && (canCompare || unique.length > 1) && <div className={`flex min-w-0 flex-wrap items-center gap-x-1 px-2 ${showRunouts ? '' : 'sm:max-w-64 sm:justify-end'}`}>
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
      <div className="rh-pressing-evidence-actions" role="group" aria-label="Optional pressing evidence">
        <div className="rh-pressing-evidence-actions__row">
          <button type="button" ref={compareToggle} className="rh-lookup-link rh-pressing-compare"
            aria-expanded={showComparison} aria-controls={comparisonId}
            onClick={toggleComparison}>{canCompare ? 'Compare listings' : 'Inspect listing evidence'}</button>
          <button type="button" className="rh-lookup-link rh-pressing-compare"
            aria-expanded={showRunouts} aria-controls={candidatesId} aria-describedby={runoutHelpId} onClick={toggleRunouts}>
            {showRunouts ? 'Hide runout marks' : 'Check runout marks'}
          </button>
        </div>
        <p id={runoutHelpId} className="text-xs text-gray-600">{runoutClue}</p>
        {(firstPin || morePressingsUrl) && <div className="flex flex-wrap items-center gap-x-2">
          {firstPin && <button type="button" className="rh-lookup-link rh-pressing-compare" aria-controls={showComparison ? shortlistId : undefined}
            aria-label={secondPin ? 'Compare 2 pinned pressings' : 'Go to 1 pinned pressing'}
            onClick={() => jumpToShortlist()}>{secondPin ? 'Compare 2 pins' : '1 pinned'}</button>}
          {morePressingsUrl && <a href={morePressingsUrl} className="rh-comparison-source" target="_blank" rel="noreferrer">
            Find more on Discogs<span className="sr-only"> (opens in a new tab)</span>
          </a>}
        </div>}
      </div>
      <div id={comparisonId} role="region" aria-labelledby={showComparison ? comparisonHeadingId : undefined} hidden={!showComparison}>
        {showComparison && <div className="rh-pressing-evidence-tools grid gap-2">
          <div className="rh-pressing-chooser-heading">
            <h3 id={comparisonHeadingId} ref={comparisonHeading} tabIndex={-1} className="text-sm font-semibold">Listing evidence</h3>
            <button type="button" className="rh-lookup-link" aria-controls={candidatesId}
              onClick={() => returnToChoices()}>{visible.length === 1 ? 'Back to pressing' : 'Back to pressings'}</button>
          </div>
          {referenceColumn && targetColumn ? (
            <PressingPairEvidence reference={referenceColumn} target={targetColumn} searchedNumber={searchedNumber}
              loadDetails={loadDetails ?? loadLocally} onLocate={locateComparedChoice}
              canLocate={releaseId => !!choiceLocation(releaseId)} locateContext={locateContext}
              unavailableLocation={releaseId => `Release ${releaseId} is the saved listing.`}
              disabled={disabled} uncertainAction={uncertainAction} announceChanges={isExplicitPair}>
              {canChoosePair && <PressingPairSelects choices={comparisonChoices} searchedNumber={searchedNumber} savedReleaseId={savedReleaseId}
                firstId={leftListing.releaseId} secondId={rightListing.releaseId}
                onChangeFirst={firstId => setChosenPair({ firstId, secondId: rightListing.releaseId, explicit: true })}
                onChangeSecond={secondId => setChosenPair({ firstId: leftListing.releaseId, secondId, explicit: true })} />}
              <RecordEvidenceHelp />
            </PressingPairEvidence>
          ) : targetColumn && <PressingPairEvidence target={targetColumn} searchedNumber={searchedNumber}
            loadDetails={loadDetails ?? loadLocally} disabled={disabled} uncertainAction={uncertainAction} />}
        </div>}
      </div>
      {showComparison && canCompare && savedComparison}
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
