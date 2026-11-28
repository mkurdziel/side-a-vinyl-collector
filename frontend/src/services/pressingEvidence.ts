import api, { type PressingDetails } from './api';

export interface PressingCandidate {
  releaseId: number;
  pressing?: PressingDetails;
  year?: number;
  catalogNumberMatch?: 'exact' | 'unverified';
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

function catalogNumberKey(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join('') ?? '';
}

export function sharedCatalogNumber(choices: readonly PressingCandidate[], searchedNumber?: string) {
  const entered = searchedNumber?.trim() ?? '';
  const enteredKey = catalogNumberKey(entered);
  const numbers = new Map<string, { number: string; releases: Set<number> }>();

  for (const choice of choices) {
    const parts = choice.pressing?.catalogNumber?.split('·') ?? [];
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
