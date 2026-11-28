import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import api, { ApiError, type Album } from '../services/api';

type RemovalDetails = Pick<Album, 'id' | 'title' | 'status'>;
type RemovalResult = Pick<Awaited<ReturnType<typeof api.deleteAlbum>>, 'undoToken' | 'expiresAt'>;
type RemovalReceipt = RemovalDetails & RemovalResult;
type RemovalEntry = RemovalReceipt & { undoing?: boolean; issue?: string };

export interface RemovalHistoryHandle {
  recordRemoval: (album: RemovalDetails, result?: RemovalResult) => void;
  clear: () => void;
}

interface RemovalHistoryProps {
  ref: Ref<RemovalHistoryHandle>;
  onRestored: (album: Album) => void;
  fallbackFocus: RefObject<HTMLElement | null>;
}

const storageKey = 'side-a-removal-history';
const legacyStorageKey = 'side-a-last-removal';
const shelfNames = { collection: 'Collection', wishlist: 'Wishlist' };
const expiryTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function hasUndoTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

function isValidReceipt(value: unknown): value is RemovalReceipt {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RemovalReceipt>;
  return typeof entry.id === 'number' && Number.isSafeInteger(entry.id) && entry.id > 0 &&
    typeof entry.title === 'string' && (entry.status === 'collection' || entry.status === 'wishlist') &&
    typeof entry.undoToken === 'string' && entry.undoToken.length > 0 &&
    typeof entry.expiresAt === 'string' && hasUndoTime(entry.expiresAt);
}

function readStorage(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function readReceipts() {
  const stored = readStorage(storageKey);
  const legacy = readStorage(legacyStorageKey);
  const entries = Array.isArray(stored) ? stored.filter(isValidReceipt) : [];
  if (isValidReceipt(legacy) && 'kind' in legacy && legacy.kind === 'removed') entries.push(legacy);

  const latest = new Map<number, RemovalReceipt>();
  for (const { id, title, status, undoToken, expiresAt } of entries) {
    const existing = latest.get(id);
    if (!existing || Date.parse(expiresAt) > Date.parse(existing.expiresAt)) {
      latest.set(id, { id, title, status, undoToken, expiresAt });
    }
  }
  return [...latest.values()];
}

function persistReceipts(entries: readonly RemovalEntry[]) {
  const valid = entries.filter(isValidReceipt).map(({ id, title, status, undoToken, expiresAt }) => (
    { id, title, status, undoToken, expiresAt }
  ));
  try {
    if (valid.length) sessionStorage.setItem(storageKey, JSON.stringify(valid));
    else sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(legacyStorageKey);
  } catch {
    // A blocked storage area still allows Undo on the current page.
  }
}

export function RemovalHistory({ ref, onRestored, fallbackFocus }: RemovalHistoryProps) {
  const [entries, setEntries] = useState<RemovalEntry[]>(readReceipts);
  const [expanded, setExpanded] = useState(true);
  const [outcome, setOutcome] = useState<{ message: string; error?: boolean }>();
  const latest = useRef(entries);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const undoButtons = useRef(new Map<number, HTMLButtonElement>());
  const nextFocus = useRef<number | 'feedback' | 'toggle' | 'fallback'>(undefined);
  const listId = useId();

  const updateEntries = useCallback((next: RemovalEntry[]) => {
    latest.current = next;
    persistReceipts(next);
    setEntries(next);
  }, []);

  useEffect(() => persistReceipts(latest.current), []);

  useLayoutEffect(() => {
    const target = nextFocus.current;
    nextFocus.current = undefined;
    const destination = typeof target === 'number' ? undoButtons.current.get(target)
      : target === 'feedback' ? feedback.current
      : target === 'toggle' ? toggle.current
      : target === 'fallback' ? fallbackFocus.current : undefined;
    destination?.focus({ preventScroll: target === 'toggle' });
  });

  const containsFocus = () => panel.current?.contains(panel.current.ownerDocument.activeElement);
  const dismiss = () => {
    nextFocus.current = latest.current.length ? 'toggle' : 'fallback';
    setExpanded(false);
    setOutcome(undefined);
  };

  useImperativeHandle(ref, () => ({
    recordRemoval(album, result) {
      const { id, title, status } = album;
      const receipt = { id, title, status, ...result };
      if (isValidReceipt(receipt)) {
        nextFocus.current = id;
        setOutcome(undefined);
        setExpanded(true);
        updateEntries([receipt, ...latest.current.filter(entry => entry.id !== id)]);
      } else {
        nextFocus.current = 'feedback';
        setOutcome({ message: `“${title}” removed from ${shelfNames[status]}. Undo is unavailable.` });
        updateEntries(latest.current.filter(entry => entry.id !== id));
      }
    },
    clear() {
      nextFocus.current = containsFocus() ? 'fallback' : undefined;
      updateEntries([]);
      setExpanded(true);
      setOutcome(undefined);
    },
  }));

  useEffect(() => {
    const expire = () => {
      const expired = latest.current.filter(entry => !entry.undoing && !hasUndoTime(entry.expiresAt));
      if (!expired.length) {
        timer = schedule();
        return;
      }
      const remaining = latest.current.filter(entry => !expired.includes(entry));
      const active = panel.current?.ownerDocument.activeElement;
      const focusedEntry = expired.find(entry => undoButtons.current.get(entry.id) === active);
      if (focusedEntry || (!remaining.length && panel.current?.contains(active ?? null))) nextFocus.current = 'feedback';
      setOutcome({ message: focusedEntry || expired.length === 1
        ? `The undo window for “${(focusedEntry ?? expired[0]).title}” ended.`
        : 'The undo window for some recent removals ended.' });
      updateEntries(remaining);
    };
    const schedule = () => {
      const deadlines = latest.current.filter(entry => !entry.undoing).map(entry => Date.parse(entry.expiresAt));
      if (!deadlines.length) return;
      const delay = Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now()));
      return window.setTimeout(expire, delay);
    };
    let timer = schedule();
    return () => window.clearTimeout(timer);
  }, [entries, updateEntries]);

  const undo = async (receipt: RemovalReceipt) => {
    const belongsTo = (entry: RemovalEntry) => entry.id === receipt.id && entry.undoToken === receipt.undoToken;
    const entry = latest.current.find(belongsTo);
    if (!entry || entry.undoing || !isValidReceipt(entry)) return;

    updateEntries(latest.current.map(item => belongsTo(item) ? { ...item, undoing: true, issue: undefined } : item));
    const focusResult = () => {
      const button = undoButtons.current.get(entry.id);
      if (button && button.ownerDocument.activeElement === button) nextFocus.current = 'feedback';
    };

    let restored: Album;
    try {
      ({ album: restored } = await api.undoAlbumRemoval(entry.id, entry.undoToken));
    } catch (failure) {
      if (!latest.current.some(belongsTo)) return;
      if (failure instanceof ApiError && (failure.status === 400 || failure.status === 409)) {
        focusResult();
        setOutcome({ message: `“${entry.title}” could not be restored. ${failure.message}`, error: true });
        updateEntries(latest.current.filter(item => !belongsTo(item)));
      } else if (!hasUndoTime(entry.expiresAt)) {
        focusResult();
        setOutcome({ message: `Couldn’t verify whether “${entry.title}” was restored. The undo window ended. Check your shelves.`, error: true });
        updateEntries(latest.current.filter(item => !belongsTo(item)));
      } else {
        updateEntries(latest.current.map(item => belongsTo(item)
          ? { ...item, undoing: false, issue: 'Couldn’t confirm the undo. Try again.' } : item));
      }
      return;
    }

    if (!latest.current.some(belongsTo)) return;
    focusResult();
    setOutcome({ message: `“${restored.title}” restored to ${shelfNames[restored.status]}.` });
    updateEntries(latest.current.filter(item => !belongsTo(item)));
    onRestored(restored);
  };

  if (!entries.length && !outcome) return null;

  return (
    <aside ref={panel} className="mb-4 rounded-xl border border-gray-300 bg-white px-3 py-2" aria-label="Album removal recovery">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        {entries.length > 0 && (
          <button ref={toggle} type="button" className="rh-lookup-link -ml-2 text-left" aria-expanded={expanded} aria-controls={listId}
            onClick={() => setExpanded(current => !current)}>
            Recent removals<span className="sr-only">, {entries.length} available to undo</span>
          </button>
        )}
        {outcome && (
          <p ref={feedback} role={outcome.error ? 'alert' : 'status'} tabIndex={-1}
            className={`order-last min-w-0 basis-full py-2 text-sm [overflow-wrap:anywhere] sm:order-none sm:flex-1 ${outcome.error ? 'text-red-600' : 'text-gray-900'}`}>
            {outcome.message}
          </p>
        )}
        {(expanded || outcome) && <button type="button" className="rh-lookup-link ml-auto" onClick={dismiss}
          aria-label="Dismiss removal notice">Dismiss</button>}
      </div>
      {entries.length > 0 && <ul id={listId} className="divide-y divide-gray-200 border-t" hidden={!expanded}>
        {entries.map(entry => {
          const label = entry.undoing ? 'Restoring…' : entry.issue ? 'Retry undo removal' : 'Undo removal';
          const expiryId = `${listId}-${entry.id}-expiry`;
          return (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                <p className="font-medium">“{entry.title}” removed from {shelfNames[entry.status]}.</p>
                <p id={expiryId} className="text-xs text-gray-600">Undo until <time dateTime={entry.expiresAt}>{expiryTime.format(new Date(entry.expiresAt))}</time></p>
                {entry.issue && <p role="alert" className="mt-1 text-red-600">{entry.issue}</p>}
              </div>
              <button ref={button => {
                if (button) undoButtons.current.set(entry.id, button);
                else undoButtons.current.delete(entry.id);
              }} type="button" className="min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                aria-label={`${label} · ${entry.title}`} aria-describedby={expiryId}
                aria-disabled={entry.undoing} aria-busy={entry.undoing} onClick={() => void undo(entry)}>{label}</button>
            </li>
          );
        })}
      </ul>}
    </aside>
  );
}
