import api, { type PressingDetails } from './api';

export interface PressingCandidate {
  releaseId: number;
  pressing?: PressingDetails;
  year?: number;
  catalogNumberMatch?: 'exact' | 'unverified';
}

function formatParts(value: string) {
  return value.split('·').map(part => part.trim()).filter(Boolean);
}

export function concisePressingValue(value: string, limit: number) {
  if (value.length <= limit) return value;
  const boundary = value.lastIndexOf(' · ', limit - 1);
  return `${value.slice(0, boundary > 0 ? boundary : limit - 1).trimEnd()}…`;
}

export function summarizePressingFormat(value: string, formats: readonly string[], limit: number): string {
  const summary = concisePressingValue(value, limit);
  if (summary === value) return value;

  // A shorter sibling can fit a deciding qualifier that this value would hide.
  const visiblePrefix = summary.slice(0, -1).toLowerCase();
  const peers = formats.filter(format => {
    const normalized = format.toLowerCase();
    return normalized !== value.toLowerCase() &&
      (normalized === visiblePrefix || normalized.startsWith(`${visiblePrefix} · `) ||
        concisePressingValue(format, limit).toLowerCase() === summary.toLowerCase());
  });
  if (!peers.length) return summary;

  const [medium, ...qualifiers] = formatParts(value);
  if (!medium || !qualifiers.length) return summary;
  const peerParts = peers.map(format => new Set(formatParts(format).map(part => part.toLowerCase())));
  const differences = qualifiers.map(part => ({
    part,
    occurrences: peerParts.filter(parts => parts.has(part.toLowerCase())).length,
  })).filter(({ occurrences }) => occurrences < peers.length)
    .sort((a, b) => a.occurrences - b.occurrences);
  if (!differences.length) return summary;

  const facts = [medium];
  // Keep LP or other short physical format data when it leaves room for the differences.
  const physicalFormat = qualifiers[0];
  if (/^(LP|EP|Single|\d{1,2}")$/i.test(physicalFormat) && physicalFormat !== differences[0].part &&
    [medium, physicalFormat, differences[0].part].join(' · ').length <= limit) {
    facts.push(physicalFormat);
  }
  for (const { part } of differences) {
    const room = limit - facts.join(' · ').length - ' · '.length;
    if (part.length <= room) facts.push(part);
    else if (facts.length === 1 && room >= 6) facts.push(concisePressingValue(part, room));
  }
  return facts.join(' · ');
}

const mediumNames = new Map([
  ['vinyl', 'Vinyl'], ['lp', 'Vinyl'], ['cd', 'CD'], ['cdr', 'CDr'], ['cassette', 'Cassette'],
  ['shellac', 'Shellac'], ['file', 'File'], ['dvd', 'DVD'], ['blu-ray', 'Blu-ray'], ['minidisc', 'MiniDisc'],
]);

export function pressingMedia(format = ''): string[] {
  return Array.from(new Set(formatParts(format).flatMap(part => {
    const medium = mediumNames.get(part.toLowerCase());
    return medium ? [medium] : [];
  })));
}

export function matchesPressingMedium(choice: PressingCandidate, medium: string) {
  return !medium || pressingMedia(choice.pressing?.format).includes(medium);
}

export function pressingFormatFacts(value: string) {
  const parts = formatParts(value);
  const size = parts.find(part => /^\d{1,2}\s*(?:"|″|inch(?:es)?)$/i.test(part));
  return {
    format: pressingMedia(value).join(' · '),
    size: size ? `${Number.parseInt(size, 10)}"` : '',
    type: parts.find(part => /^(LP|EP)$/i.test(part)) ?? '',
    mix: parts.find(part => /^(mono|stereo|quadraphonic)$/i.test(part)) ?? '',
    speed: parts.find(part => /^(?:16|33|45|78)[\d\s./⅓¼]*\s*rpm$/i.test(part)) ?? '',
  };
}

export function withPressingEvidence(choice: PressingCandidate, details?: PressingDetails | null,
  priority: 'listing' | 'release' = 'listing'): PressingCandidate {
  if (!details) return choice;
  const summary = { ...choice.pressing, year: choice.pressing?.year ?? choice.year };
  const [first, fallback] = priority === 'release' ? [details, summary] : [summary, details];
  return { ...choice, pressing: {
    catalogNumber: first.catalogNumber?.trim() || fallback.catalogNumber?.trim(),
    label: first.label?.trim() || fallback.label?.trim(),
    country: first.country?.trim() || fallback.country?.trim(),
    format: first.format?.trim() || fallback.format?.trim(),
    year: first.year ?? fallback.year,
    matrixRunouts: details.matrixRunouts?.length ? details.matrixRunouts : summary.matrixRunouts,
  } };
}

export function catalogNumberKey(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join('') ?? '';
}

function listedCatalogNumbers(value?: string) {
  return (value ?? '').split('·').map(part => part.trim()).filter(part => {
    const key = catalogNumberKey(part);
    return key && key !== 'none';
  });
}

export function preferredCatalogNumber(value?: string, searchedNumber = '') {
  const numbers = listedCatalogNumbers(value);
  const searchedKey = catalogNumberKey(searchedNumber);
  return numbers.find(number => catalogNumberKey(number) === searchedKey) ?? numbers[0];
}

export function sharedCatalogNumber(choices: readonly PressingCandidate[], searchedNumber?: string) {
  const entered = searchedNumber?.trim() ?? '';
  const enteredKey = catalogNumberKey(entered);
  const numbers = new Map<string, { number: string; releases: Set<number> }>();

  for (const choice of choices) {
    const parts = listedCatalogNumbers(choice.pressing?.catalogNumber);
    if (enteredKey && choice.catalogNumberMatch === 'exact') parts.push(entered);
    for (const part of parts) {
      const key = catalogNumberKey(part);
      if (!key || key === 'none') continue;
      const group = numbers.get(key) ?? { number: key === enteredKey ? entered : part.trim(), releases: new Set<number>() };
      group.releases.add(choice.releaseId);
      numbers.set(key, group);
    }
  }

  const enteredGroup = numbers.get(enteredKey);
  const shared = enteredGroup && enteredGroup.releases.size > 1 ? enteredGroup :
    [...numbers.values()].filter(group => group.releases.size > 1).sort((a, b) => b.releases.size - a.releases.size)[0];
  return shared && { number: shared.number, count: shared.releases.size };
}

type PressingResponse = { pressing: PressingDetails | null };
export type LoadPressingDetails = (releaseId: number, signal: AbortSignal) => Promise<PressingResponse>;
type PendingRead = { controller: AbortController; promise: Promise<PressingResponse>; listeners: number };

// Keep completed evidence for this dialog. A canceled subscriber must not interrupt another view of the same release.
export function createPressingDetailsLoader(): LoadPressingDetails {
  const pending = new Map<number, PendingRead>();
  const completed = new Map<number, PressingResponse>();

  return (releaseId, signal) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    const cached = completed.get(releaseId);
    if (cached) return Promise.resolve(cached);

    let read = pending.get(releaseId);
    if (!read) {
      const controller = new AbortController();
      const promise = api.getPressingDetails(releaseId, controller.signal);
      const started: PendingRead = { controller, promise, listeners: 0 };
      pending.set(releaseId, started);
      read = started;
      void promise.then(result => {
        if (pending.get(releaseId) !== started) return;
        pending.delete(releaseId);
        completed.set(releaseId, result);
      }, () => {
        if (pending.get(releaseId) === started) pending.delete(releaseId);
      });
    }

    const active = read;
    active.listeners += 1;
    return new Promise((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', abort);
        active.listeners -= 1;
      };
      const abort = () => {
        release();
        if (!active.listeners && pending.get(releaseId) === active) {
          pending.delete(releaseId);
          active.controller.abort();
        }
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      void active.promise.then(result => {
        if (signal.aborted) return;
        release();
        resolve(result);
      }, error => {
        if (signal.aborted) return;
        release();
        reject(error);
      });
    });
  };
}
