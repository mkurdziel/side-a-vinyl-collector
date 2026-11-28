import { useState } from 'react';
import type { PressingDetails } from '../services/api';
import { matchesPressingMedium, withPressingEvidence, type PressingCandidate } from '../services/pressingEvidence';

const storagePrefix = 'side-a:pressing-preparation:v1:';
export const pressingPinLimit = 2;

interface Preparation {
  page: number;
  medium: string;
  pins: number[];
  comparing: boolean;
  checkingRunouts: boolean;
}

const emptyPreparation: Preparation = { page: 0, medium: '', pins: [], comparing: false, checkingRunouts: false };

function readPreparation(key?: string): Preparation {
  if (!key) return emptyPreparation;
  try {
    const raw = globalThis.sessionStorage.getItem(storagePrefix + key);
    const stored = (raw ? JSON.parse(raw) : null) as Partial<Preparation> | null;
    if (!stored) return emptyPreparation;
    return {
      page: typeof stored.page === 'number' && Number.isSafeInteger(stored.page) && stored.page > 0 ? stored.page : 0,
      medium: typeof stored.medium === 'string' ? stored.medium : '',
      pins: Array.isArray(stored.pins)
        ? [...new Set(stored.pins.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, pressingPinLimit) : [],
      comparing: stored.comparing === true,
      checkingRunouts: stored.checkingRunouts === true,
    };
  } catch {
    return emptyPreparation;
  }
}

export function usePressingPreparation(key: string | undefined, choices: readonly PressingCandidate[],
  evidence?: Partial<Record<number, PressingDetails>>) {
  const [session, setSession] = useState(() => ({ key, state: readPreparation(key) }));
  const current = session.key === key ? session : { key, state: readPreparation(key) };
  if (current !== session) setSession(current);

  const { state } = current;
  const medium = choices.some(choice => matchesPressingMedium(withPressingEvidence(choice, evidence?.[choice.releaseId]), state.medium))
    ? state.medium : '';
  const pins = state.pins.filter(id => choices.some(choice => choice.releaseId === id));
  const update = (changes: Partial<Preparation>) => {
    const next = { ...state, medium, pins, ...changes };
    setSession({ key, state: next });
    if (!key) return;
    try {
      globalThis.sessionStorage.setItem(storagePrefix + key, JSON.stringify(next));
    } catch {
      // Comparison still works in memory if tab storage is unavailable.
    }
  };

  return { ...state, medium, pins, update };
}
