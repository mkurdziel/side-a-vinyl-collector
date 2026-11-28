import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import api, { ApiError, type Album } from '../services/api';
import { formatUndoDeadline } from '../services/undoDeadline';

type AlbumDetails = Pick<Album, 'id' | 'title' | 'status'>;
type UndoReceipt = { undoToken?: string; expiresAt?: string };
type ShelfMove = { albumId: number; title: string; from: Album['status']; to: Album['status'] };
type Kind = 'removal' | 'move' | 'pressing' | 'artwork' | 'addition';
type Receipt = AlbumDetails & Required<UndoReceipt> & { kind: Kind; closed?: true };
type Entry = Receipt & { undoing?: boolean; issue?: string; tabOnly?: boolean };
export type CatalogAdditionRecovery = Omit<Entry, 'kind' | 'closed'>;

export interface RemovalHistoryHandle {
  recordRemoval: (album: AlbumDetails, result?: UndoReceipt) => void;
  recordMove: (move: ShelfMove, result?: UndoReceipt) => void;
  recordPressing: (album: AlbumDetails, result?: UndoReceipt) => void;
  recordArtwork: (album: AlbumDetails, result: Required<UndoReceipt>) => void;
  recordAddition: (album: AlbumDetails, result: Required<UndoReceipt>) => void;
  undoAddition: (albumId: number, undoToken: string) => Promise<boolean>;
  undoMove: (albumId: number) => Promise<boolean>;
  focusMove: (albumId: number) => void;
  forgetPressing: (albumId: number, undoToken: string) => void;
  forgetArtwork: (albumId: number, undoToken: string) => void;
  forgetAlbumChanges: (albumId: number) => void;
  clear: (restoredAt?: string) => void;
}

interface RemovalHistoryProps {
  ref: Ref<RemovalHistoryHandle>;
  onRestored: (album: Album) => void;
  onMovedBack?: (album: Album) => void;
  onPressingUndone?: (album: Album) => void;
  onArtworkUndone?: (album: Album) => void;
  onAdditionUndone?: (album: Album) => void;
  onAdditionsChanged?: (entries: CatalogAdditionRecovery[]) => void;
  onExternalChange?: () => void;
  fallbackFocus: RefObject<HTMLElement | null>;
}

const receiptPrefix = 'side-a-library-undo:';
const restorePrefix = 'side-a-library-restored:';
const legacyHistoryKey = 'side-a-removal-history';
const legacyReceiptKey = 'side-a-last-removal';
const undoWindow = 10 * 60_000;
const shelfNames = { collection: 'Collection', wishlist: 'Wishlist' };
const actions = {
  removal: { label: 'Undo removal', pending: 'Restoring…', request: (id: number, token: string) => api.undoAlbumRemoval(id, token) },
  move: { label: 'Undo move', pending: 'Moving back…', request: (id: number, token: string) => api.undoAlbumMove(id, token) },
  pressing: { label: 'Undo pressing change', pending: 'Restoring pressing…', request: (id: number, token: string) => api.undoPressing(id, token) },
  artwork: { label: 'Undo artwork change', pending: 'Restoring artwork…', request: (id: number, token: string) => api.undoCoverArt(id, token) },
  addition: { label: 'Undo add', pending: 'Undoing add…', request: (id: number, token: string) => api.undoAlbumAddition(id, token) },
};

const deadline = (receipt: Pick<Receipt, 'expiresAt'>) => Date.parse(receipt.expiresAt);
const receiptKey = (receipt: Pick<Receipt, 'id' | 'kind' | 'undoToken'>) =>
  `${receiptPrefix}${receipt.kind}:${receipt.id}:${encodeURIComponent(receipt.undoToken)}`;
const closedKey = (key: string) => `${key}:closed`;

function isReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<Receipt>;
  return typeof entry.kind === 'string' && Object.hasOwn(actions, entry.kind) &&
    Number.isSafeInteger(entry.id) && (entry.id ?? 0) > 0 && typeof entry.title === 'string' &&
    (entry.status === 'collection' || entry.status === 'wishlist') &&
    typeof entry.undoToken === 'string' && !!entry.undoToken && entry.undoToken.length <= 256 &&
    typeof entry.expiresAt === 'string' && Number.isFinite(Date.parse(entry.expiresAt));
}

function parseStored(value: string | null) {
  try { return JSON.parse(value ?? 'null') as unknown; } catch { return null; }
}

function readStorage() {
  const receipts = new Map<string, Receipt>();
  const restoreKeys: { key: string; at: number }[] = [];
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith(receiptPrefix)) {
        const receipt = parseStored(localStorage.getItem(key));
        if (!isReceipt(receipt)) continue;
        const actionKey = receiptKey(receipt);
        if (receipt.closed && key === closedKey(actionKey)) receipts.set(actionKey, receipt);
        else if (key === actionKey && !receipts.has(actionKey)) receipts.set(actionKey, receipt);
      } else if (key?.startsWith(restorePrefix)) {
        const at = Number(key.slice(restorePrefix.length));
        if (Number.isFinite(at)) restoreKeys.push({ key, at });
      }
    }
  } catch {
    // Recovery is still available on the current page when browser storage is blocked.
  }
  const restoredAt = Math.max(0, ...restoreKeys.map(({ at }) => at));
  return { receipts, restoredAt, obsoleteRestoreKeys: restoreKeys.filter(({ at }) => at < restoredAt) };
}

function persist(key: string, receipt: Receipt) {
  try {
    localStorage.setItem(key, JSON.stringify(receipt));
    return true;
  } catch {
    return false;
  }
}

function forgetStored(key: string) {
  try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

function selectReceipts(receipts: Map<string, Receipt>, restoredAt: number, now: number) {
  const latest = new Map<string, Receipt>();
  for (const receipt of receipts.values()) {
    const expiresAt = deadline(receipt);
    if (expiresAt <= now || expiresAt <= restoredAt + undoWindow) continue;
    const group = `${receipt.kind}:${receipt.id}`;
    const previous = latest.get(group);
    if (!previous || expiresAt > deadline(previous)) latest.set(group, receipt);
  }
  return [...latest.values()].filter(receipt => {
    if (receipt.closed) return false;
    const removal = latest.get(`removal:${receipt.id}`);
    return receipt.kind === 'removal' || !removal || deadline(receipt) > deadline(removal);
  }).sort((a, b) => deadline(b) - deadline(a));
}

function description(receipt: Receipt) {
  if (receipt.kind === 'move') return `“${receipt.title}” moved to ${shelfNames[receipt.status]}.`;
  if (receipt.kind === 'pressing') return `Pressing updated for “${receipt.title}”.`;
  if (receipt.kind === 'artwork') return `Artwork updated for “${receipt.title}”.`;
  if (receipt.kind === 'addition') return `“${receipt.title}” added to ${shelfNames[receipt.status]}.`;
  return `“${receipt.title}” removed from ${shelfNames[receipt.status]}.`;
}

function successMessage(receipt: Receipt, restored: Album) {
  if (receipt.kind === 'move') return `“${restored.title}” moved back to ${shelfNames[restored.status]}.`;
  if (receipt.kind === 'pressing') return `Pressing restored for “${restored.title}”.`;
  if (receipt.kind === 'artwork') return `Artwork restored for “${restored.title}”.`;
  if (receipt.kind === 'addition') return `Add undone. “${restored.title}” is off ${shelfNames[receipt.status]}.`;
  return `“${restored.title}” restored to ${shelfNames[restored.status]}.`;
}

export function RemovalHistory({ ref, onRestored, onMovedBack, onPressingUndone, onArtworkUndone,
  onAdditionUndone, onAdditionsChanged, onExternalChange, fallbackFocus }: RemovalHistoryProps) {
  const [entries, setEntries] = useState<Entry[]>(() => {
    const { receipts, restoredAt } = readStorage();
    return selectReceipts(receipts, restoredAt, Date.now());
  });
  const [expanded, setExpanded] = useState(true);
  const [outcome, setOutcome] = useState<{ message: string; error?: boolean }>();
  const latest = useRef(entries);
  const volatile = useRef(new Map<string, Receipt>());
  const restoreTime = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const undoButtons = useRef(new Map<string, HTMLButtonElement>());
  const nextFocus = useRef<{ key: string } | 'feedback' | 'toggle' | 'fallback'>(undefined);
  const listId = useId();
  const collapsedDetailsId = useId();
  const externalChange = useRef(onExternalChange);
  useEffect(() => { externalChange.current = onExternalChange; }, [onExternalChange]);
  useEffect(() => { onAdditionsChanged?.(entries.filter(entry => entry.kind === 'addition')); }, [entries, onAdditionsChanged]);

  const updateEntries = useCallback((next: Entry[]) => {
    latest.current = next;
    setEntries(next);
  }, []);

  const put = useCallback((receipt: Receipt) => {
    const key = receiptKey(receipt);
    const { id, kind, title, status, undoToken, expiresAt, closed } = receipt;
    const stored = { id, kind, title, status, undoToken, expiresAt, closed };
    if (persist(closed ? closedKey(key) : key, stored)) volatile.current.delete(key);
    else volatile.current.set(key, stored);
  }, []);

  const refresh = useCallback(() => {
    const { receipts, restoredAt, obsoleteRestoreKeys } = readStorage();
    restoreTime.current = Math.max(restoreTime.current, restoredAt);
    const now = Date.now();
    for (const { key } of obsoleteRestoreKeys) forgetStored(key);
    for (const [key, receipt] of [...receipts, ...volatile.current]) {
      if (deadline(receipt) <= now || deadline(receipt) <= restoreTime.current + undoWindow) {
        receipts.delete(key);
        volatile.current.delete(key);
        forgetStored(key);
        forgetStored(closedKey(key));
      } else if (receipt.closed || !receipts.get(key)?.closed) {
        receipts.set(key, receipt);
      }
    }
    const previous = new Map(latest.current.map(entry => [receiptKey(entry), entry]));
    const next: Entry[] = selectReceipts(receipts, restoreTime.current, now).map(receipt => {
      const key = receiptKey(receipt);
      const current = previous.get(key);
      return { ...receipt, undoing: current?.undoing, issue: current?.issue, tabOnly: volatile.current.has(key) };
    });
    const selected = new Set(next.map(receiptKey));
    // A request sent before its deadline can still succeed after the local timer would expire.
    for (const entry of latest.current) {
      if (entry.undoing && deadline(entry) <= now && !selected.has(receiptKey(entry)) &&
          !receipts.has(receiptKey(entry)) && deadline(entry) > restoreTime.current + undoWindow) next.push(entry);
    }
    updateEntries(next);
  }, [updateEntries]);

  useEffect(() => {
    try {
      const history = parseStored(sessionStorage.getItem(legacyHistoryKey));
      const legacy = parseStored(sessionStorage.getItem(legacyReceiptKey));
      const candidates = Array.isArray(history) ? history : [];
      if (legacy && typeof legacy === 'object' && 'kind' in legacy && legacy.kind === 'removed') candidates.push(legacy);
      let migrated = true;
      const { receipts, restoredAt } = readStorage();
      for (const value of candidates) {
        const receipt: unknown = { ...value, kind: 'removal' };
        if (!isReceipt(receipt) || deadline(receipt) <= Date.now() || deadline(receipt) <= restoredAt + undoWindow) continue;
        const key = receiptKey(receipt);
        if (!receipts.has(key) && !persist(key, receipt)) {
          volatile.current.set(key, receipt);
          migrated = false;
        }
      }
      if (migrated) {
        sessionStorage.removeItem(legacyHistoryKey);
        sessionStorage.removeItem(legacyReceiptKey);
      }
    } catch { /* Storage may be disabled. */ }
    refresh();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(receiptPrefix) && !event.key.startsWith(restorePrefix)) return;
      const active = panel.current?.ownerDocument.activeElement;
      const focused = latest.current.find(entry => undoButtons.current.get(receiptKey(entry)) === active);
      const before = restoreTime.current;
      refresh();
      const restored = restoreTime.current > before;
      if (focused && !latest.current.some(entry => receiptKey(entry) === receiptKey(focused))) {
        nextFocus.current = latest.current.length ? 'toggle' : 'fallback';
      } else if (!latest.current.length && active && (active === toggle.current || (restored && panel.current?.contains(active)))) {
        nextFocus.current = !restored && feedback.current ? 'feedback' : 'fallback';
      }
      if (restored) setOutcome(undefined);
      if (event.newValue !== null || event.key === null) externalChange.current?.();
    };
    window.addEventListener?.('storage', onStorage);
    return () => window.removeEventListener?.('storage', onStorage);
  }, [refresh]);

  useLayoutEffect(() => {
    const target = nextFocus.current;
    nextFocus.current = undefined;
    const destination = typeof target === 'object' ? undoButtons.current.get(target.key)
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

  const record = (kind: Kind, album: AlbumDetails, result?: UndoReceipt) => {
    const receipt: unknown = { ...album, ...result, kind };
    const stored = readStorage();
    const cutoff = Math.max(restoreTime.current, stored.restoredAt);
    if (isReceipt(receipt) && deadline(receipt) <= cutoff + undoWindow) return;
    if (isReceipt(receipt) && deadline(receipt) > Date.now()) {
      const key = receiptKey(receipt);
      if (stored.receipts.get(key)?.closed || volatile.current.get(key)?.closed) return;
      if (kind === 'removal') nextFocus.current = { key };
      put(receipt);
      setOutcome(undefined);
      if (kind !== 'addition' || !latest.current.length) setExpanded(kind !== 'addition');
    } else if (kind === 'removal') {
      nextFocus.current = 'feedback';
      setOutcome({ message: `“${album.title}” removed from ${shelfNames[album.status]}. Undo is unavailable.` });
    }
    refresh();
  };

  const undo = async (entry: Entry) => {
    const key = receiptKey(entry);
    const belongsTo = (other: Entry) => receiptKey(other) === key;
    const current = latest.current.find(belongsTo);
    if (!current || current.undoing || deadline(current) <= Date.now()) return false;
    updateEntries(latest.current.map(item => belongsTo(item) ? { ...item, undoing: true, issue: undefined } : item));
    const focusResult = () => {
      const button = undoButtons.current.get(key);
      if (button && button.ownerDocument.activeElement === button) nextFocus.current = 'feedback';
    };
    const complete = () => {
      focusResult();
      // A separate marker survives a concurrent write of the receipt and suppresses superseded actions.
      put({ id: entry.id, title: entry.title, status: entry.status, kind: entry.kind,
        undoToken: entry.undoToken, expiresAt: entry.expiresAt, closed: true });
      updateEntries(latest.current.filter(item => !belongsTo(item)));
      refresh();
    };

    let restored: Album;
    try {
      ({ album: restored } = await actions[entry.kind].request(entry.id, entry.undoToken));
    } catch (failure) {
      if (!latest.current.some(belongsTo)) return false;
      if (failure instanceof ApiError && [400, 404, 409].includes(failure.status)) {
        complete();
        const issue = entry.kind === 'addition' ? `Couldn’t undo adding “${entry.title}”.` : `“${entry.title}” could not be restored.`;
        setOutcome({ message: `${issue} ${failure.message}`, error: true });
        externalChange.current?.();
      } else if (deadline(entry) <= Date.now()) {
        complete();
        setOutcome({ message: `Couldn’t verify the undo for “${entry.title}”. The undo window ended. Check your library.`, error: true });
      } else {
        updateEntries(latest.current.map(item => belongsTo(item)
          ? { ...item, undoing: false, issue: 'Couldn’t confirm the undo. Try again.' } : item));
      }
      return false;
    }

    if (!latest.current.some(belongsTo)) return false;
    complete();
    setOutcome({ message: successMessage(entry, restored) });
    ({ removal: onRestored, move: onMovedBack, pressing: onPressingUndone, artwork: onArtworkUndone, addition: onAdditionUndone })[entry.kind]?.(restored);
    return true;
  };

  const forgetReceipt = (kind: Kind, id: number, undoToken: string) => {
    const entry = latest.current.find(item => item.kind === kind && item.id === id && item.undoToken === undoToken);
    if (!entry) return;
    put({ ...entry, closed: true });
    refresh();
  };

  useImperativeHandle(ref, () => ({
    recordRemoval(album, result) { record('removal', album, result); },
    recordMove({ albumId, title, to }, result) { record('move', { id: albumId, title, status: to }, result); },
    recordPressing(album, result) { record('pressing', album, result); },
    recordArtwork(album, result) { record('artwork', album, result); },
    recordAddition(album, result) { record('addition', album, result); },
    undoAddition(albumId, undoToken) {
      const entry = latest.current.find(item => item.kind === 'addition' && item.id === albumId && item.undoToken === undoToken);
      return entry ? undo(entry) : Promise.resolve(false);
    },
    undoMove(albumId) {
      const entry = latest.current.find(item => item.kind === 'move' && item.id === albumId);
      return entry ? undo(entry) : Promise.resolve(false);
    },
    focusMove(albumId) {
      const entry = latest.current.find(item => item.kind === 'move' && item.id === albumId);
      if (entry) undoButtons.current.get(receiptKey(entry))?.focus();
    },
    forgetPressing(id, undoToken) { forgetReceipt('pressing', id, undoToken); },
    forgetArtwork(id, undoToken) { forgetReceipt('artwork', id, undoToken); },
    forgetAlbumChanges(id) {
      for (const entry of latest.current) {
        if (entry.id === id && entry.kind !== 'removal') put({ ...entry, closed: true });
      }
      refresh();
    },
    clear(restoredAt) {
      const at = restoredAt ? Date.parse(restoredAt) : Date.now();
      restoreTime.current = Math.max(restoreTime.current, Number.isFinite(at) ? at : Date.now());
      try { localStorage.setItem(`${restorePrefix}${restoreTime.current}`, ''); } catch { /* Storage may be disabled. */ }
      nextFocus.current = containsFocus() ? 'fallback' : undefined;
      setExpanded(true);
      setOutcome(undefined);
      refresh();
    },
  }));

  useEffect(() => {
    const deadlines = entries.filter(entry => !entry.undoing).map(deadline);
    if (!deadlines.length) return;
    const delay = Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now()));
    const timer = window.setTimeout(() => {
      const expired = latest.current.filter(entry => !entry.undoing && deadline(entry) <= Date.now());
      const active = panel.current?.ownerDocument.activeElement;
      const focused = expired.find(entry => undoButtons.current.get(receiptKey(entry)) === active);
      refresh();
      if (!expired.length) return;
      if (focused || (!latest.current.length && containsFocus())) nextFocus.current = 'feedback';
      setOutcome({ message: focused || expired.length === 1
        ? `The undo window for “${(focused ?? expired[0]).title}” ended.`
        : 'The undo window for some recent changes ended.' });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [entries, refresh]);

  if (!entries.length && !outcome) return null;

  const available = entries.filter(entry => !entry.undoing);
  const availableCount = available.length;
  const nextDeadline = available.at(-1)?.expiresAt;
  const tabOnlyCount = available.filter(entry => entry.tabOnly).length;
  const showCollapsedDetails = !expanded && !!nextDeadline;

  return (
    <aside ref={panel} className="mb-4 rounded-xl border border-gray-300 bg-white px-3 py-2" aria-label="Library change recovery">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        {entries.length > 0 && (
          <button ref={toggle} type="button" className="rh-lookup-link -ml-2 text-left" aria-expanded={expanded} aria-controls={listId}
            aria-label={`Recent library changes, ${availableCount ? `${availableCount} available to undo` : 'undo in progress'}`}
            aria-describedby={showCollapsedDetails ? collapsedDetailsId : undefined}
            onClick={() => setExpanded(current => !current)}>
            Recent library changes<span aria-hidden="true" className="ml-1.5 text-xs font-normal text-gray-600 tabular-nums">
              · {availableCount ? `${availableCount} to undo` : 'Undo in progress'}
            </span>
          </button>
        )}
        {showCollapsedDetails && (
          <p id={collapsedDetailsId} className="min-w-0 pb-1 text-xs text-gray-600 tabular-nums sm:pb-0">
            {availableCount === 1 ? 'Undo until ' : 'Next undo expires at '}
            <time dateTime={nextDeadline}>{formatUndoDeadline(nextDeadline)}</time>
            {tabOnlyCount > 0 && <span className="block">
              {tabOnlyCount === availableCount ? 'This tab only.' : 'Some undos need this tab.'} Keep it open without reloading.
            </span>}
          </p>
        )}
        {outcome && (
          <p ref={feedback} role={outcome.error ? 'alert' : 'status'} tabIndex={-1}
            className={`order-last min-w-0 basis-full py-2 text-sm [overflow-wrap:anywhere] sm:order-none sm:flex-1 ${outcome.error ? 'text-red-600' : 'text-gray-900'}`}>
            {outcome.message}
          </p>
        )}
        {(expanded || outcome) && <button type="button" className="rh-lookup-link ml-auto" onClick={dismiss}
          aria-label="Dismiss library change notice">Dismiss</button>}
      </div>
      {expanded && availableCount > 0 && <p className="pb-2 text-xs text-gray-600">
        Undo each change here within 10 minutes of making it.{tabOnlyCount === 0 && ' This list is shared across tabs in this browser.'}
      </p>}
      {entries.length > 0 && <ul id={listId} className="divide-y divide-gray-200 border-t" hidden={!expanded}>
        {entries.map(entry => {
          const action = actions[entry.kind];
          const label = entry.undoing ? action.pending : entry.issue ? `Retry ${action.label.toLowerCase()}` : action.label;
          const key = receiptKey(entry);
          const expiryId = `${listId}-${entry.kind}-${entry.id}-expiry`;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                <p className="font-medium">{description(entry)}</p>
                {!entry.undoing && <p id={expiryId} className="text-xs text-gray-600 tabular-nums">
                  Undo until <time dateTime={entry.expiresAt}>{formatUndoDeadline(entry.expiresAt)}</time>
                  {entry.tabOnly && <span className="block">This tab only. Keep it open without reloading.</span>}
                </p>}
                {entry.issue && <p role="alert" className="mt-1 text-red-600">{entry.issue}</p>}
              </div>
              <button ref={button => {
                if (button) undoButtons.current.set(key, button);
                else undoButtons.current.delete(key);
              }} type="button" className="min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                aria-label={`${label} · ${entry.title}`} aria-describedby={entry.undoing ? undefined : expiryId}
                aria-disabled={entry.undoing} aria-busy={entry.undoing} onClick={() => void undo(entry)}>{label}</button>
            </li>
          );
        })}
      </ul>}
    </aside>
  );
}
