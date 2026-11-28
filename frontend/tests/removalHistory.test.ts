import { createElement, createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemovalHistory, type RemovalHistoryHandle } from '../src/components/RemovalHistory';
import { ApiError, type Album } from '../src/services/api';

const { undoAlbumRemoval, undoAlbumMove, undoPressing, undoCoverArt } = vi.hoisted(() => ({
  undoAlbumRemoval: vi.fn(), undoAlbumMove: vi.fn(), undoPressing: vi.fn(), undoCoverArt: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { undoAlbumRemoval, undoAlbumMove, undoPressing, undoCoverArt },
}));

const shelfRecord: Album = {
  id: 1, title: 'Blue Train', artist_name: 'John Coltrane', status: 'collection', added_at: '2026-08-02T00:00:00.000Z',
};
const wishlistRecord: Album = { ...shelfRecord, id: 2, title: 'Giant Steps', status: 'wishlist' };
const historyKey = 'side-a-removal-history';
const legacyKey = 'side-a-last-removal';
const storage = new Map<string, string>();
const session = new Map<string, string>();
type StorageListener = (event: Pick<StorageEvent, 'key' | 'newValue'>) => void;
const storageListeners = new Set<StorageListener>();
const history = createRef<RemovalHistoryHandle>();
const onRestored = vi.fn();
const onMovedBack = vi.fn();
const onPressingUndone = vi.fn();
const onArtworkUndone = vi.fn();
const onExternalChange = vi.fn();
let renderer: ReturnType<typeof create>;

async function mount(options: Parameters<typeof create>[1] = {}, fallbackFocus = createRef<HTMLElement>()) {
  await act(async () => {
    renderer = create(createElement(RemovalHistory, {
      ref: history, onRestored, onMovedBack, onPressingUndone, onArtworkUndone, onExternalChange, fallbackFocus,
    }), options);
  });
}

function activeReceipts() {
  return [...storage].filter(([key]) => key.startsWith('side-a-library-undo:') && !key.endsWith(':closed') && !storage.has(`${key}:closed`))
    .map(([, value]) => JSON.parse(value));
}

async function emitStorageChange(key: string, newValue: string | null) {
  if (newValue === null) storage.delete(key);
  else storage.set(key, newValue);
  await act(async () => storageListeners.forEach(listener => listener({ key, newValue })));
}

async function record(album: Album, duration = 600_000) {
  const receipt = { undoToken: `undo-${album.id}`, expiresAt: new Date(Date.now() + duration).toISOString() };
  await act(async () => history.current!.recordRemoval(album, receipt));
  return receipt;
}

function button(name: string) {
  return renderer.root.findAllByType('button').find(node => node.props['aria-label'] === name || node.children[0] === name);
}

function collapsedDetails() {
  return renderer.root.findByProps({ id: button('Recent library changes')!.props['aria-describedby'] });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    addEventListener: (name: string, listener: StorageListener) => {
      if (name === 'storage') storageListeners.add(listener);
    },
    removeEventListener: (name: string, listener: StorageListener) => {
      if (name === 'storage') storageListeners.delete(listener);
    },
  });
  const browserStorage = (items: Map<string, string>) => ({
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
  vi.stubGlobal('sessionStorage', browserStorage(session));
  vi.stubGlobal('localStorage', browserStorage(storage));
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T18:00:00.000Z'));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  storage.clear();
  session.clear();
  storageListeners.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('removal history', () => {
  it('restores a saved artwork receipt after reopening and preserves the returned artwork', async () => {
    const receipt = { undoToken: 'artwork-token', expiresAt: new Date(Date.now() + 600_000).toISOString() };
    const restored = { ...shelfRecord, local_cover_path: 'previous.jpg' };
    await mount();
    await act(async () => history.current!.recordArtwork(shelfRecord, receipt));
    await act(async () => renderer.unmount());
    await mount();
    expect(activeReceipts()).toMatchObject([{ kind: 'artwork' }]);
    undoCoverArt.mockResolvedValue({ album: restored });
    await act(async () => button('Undo artwork change')!.props.onClick());
    expect(undoCoverArt).toHaveBeenCalledExactlyOnceWith(restored.id, receipt.undoToken);
    expect(onArtworkUndone).toHaveBeenCalledExactlyOnceWith(restored);
    expect(activeReceipts()).toEqual([]);
  });

  it.each([
    [shelfRecord, wishlistRecord],
    [wishlistRecord, shelfRecord],
  ])('restores both receipts across dismissal and a fresh tab when %o is restored first', async (first, second) => {
    await mount();
    const firstReceipt = await record(shelfRecord);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    const secondReceipt = await record(wishlistRecord);
    expect(renderer.root.findAllByType('time').map(node => node.props.dateTime)).toEqual([secondReceipt.expiresAt, firstReceipt.expiresAt]);

    await act(async () => button('Dismiss library change notice')!.props.onClick());
    expect(renderer.root.findByType('ul').props.hidden).toBe(true);
    expect(button('Recent library changes, 2 available to undo')?.findByType('span').children.join('')).toContain('2 to undo');
    expect(collapsedDetails().children).toContain('Next undo expires at ');
    expect(collapsedDetails().findByType('time').props.dateTime).toBe(firstReceipt.expiresAt);
    await act(async () => button('Recent library changes')!.props.onClick());
    expect(renderer.root.findByType('ul').props.hidden).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('This list is shared across tabs in this browser.');
    await act(async () => renderer.unmount());
    session.clear();
    await mount();

    undoAlbumRemoval.mockResolvedValueOnce({ album: first }).mockResolvedValueOnce({ album: second });
    await act(async () => button(`Undo removal · ${first.title}`)!.props.onClick());
    expect(onRestored).toHaveBeenNthCalledWith(1, first);
    expect(button(`Undo removal · ${first.title}`)).toBeUndefined();
    expect(activeReceipts()).toMatchObject([{ id: second.id }]);
    await act(async () => button(`Undo removal · ${second.title}`)!.props.onClick());
    expect(undoAlbumRemoval.mock.calls).toEqual([[first.id, `undo-${first.id}`], [second.id, `undo-${second.id}`]]);
    expect(onRestored).toHaveBeenNthCalledWith(2, second);
    expect(activeReceipts()).toEqual([]);
  });

  it('expires each receipt separately and keeps a failed undo retryable until its deadline', async () => {
    await mount();
    await record(shelfRecord, 1_000);
    const remaining = await record(wishlistRecord, 10_000);
    await act(async () => button('Dismiss library change notice')!.props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(button('Undo removal · Blue Train')).toBeUndefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('The undo window for “Blue Train” ended.');
    expect(button('Recent library changes, 1 available to undo')).toBeDefined();
    expect(collapsedDetails().findByType('time').props.dateTime).toBe(remaining.expiresAt);
    await act(async () => button('Recent library changes')!.props.onClick());

    undoAlbumRemoval.mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new ApiError('This removal can no longer be undone.', 409));
    await act(async () => button('Undo removal · Giant Steps')!.props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('Couldn’t confirm the undo. Try again.');
    expect(activeReceipts()).toHaveLength(1);
    await act(async () => button('Retry undo removal · Giant Steps')!.props.onClick());
    expect(button('Retry undo removal · Giant Steps')).toBeUndefined();
    expect(activeReceipts()).toEqual([]);
    expect(JSON.stringify(renderer.toJSON())).toContain('This removal can no longer be undone.');
  });

  it('lets another undo finish while an earlier undo is pending', async () => {
    await mount();
    await record(shelfRecord);
    await record(wishlistRecord);
    const pending = Promise.withResolvers<{ album: Album }>();
    undoAlbumRemoval.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ album: wishlistRecord });

    await act(async () => button('Undo removal · Blue Train')!.props.onClick());
    expect(button('Restoring… · Blue Train')?.props['aria-busy']).toBe(true);
    await act(async () => button('Undo removal · Giant Steps')!.props.onClick());
    expect(onRestored).toHaveBeenNthCalledWith(1, wishlistRecord);
    expect(button('Restoring… · Blue Train')?.props['aria-busy']).toBe(true);
    expect(button('Recent library changes, undo in progress')).toBeDefined();

    await act(async () => pending.resolve({ album: shelfRecord }));
    expect(onRestored).toHaveBeenNthCalledWith(2, shelfRecord);
    expect(activeReceipts()).toEqual([]);
  });

  it('ignores malformed data, migrates a valid old receipt, and clears pending state after backup restore', async () => {
    const { id, title, status } = shelfRecord;
    session.set(historyKey, '{broken');
    session.set(legacyKey, JSON.stringify({ id, title, status, kind: 'removed', undoToken: 'old', expiresAt: new Date(Date.now() + 600_000).toISOString() }));
    await mount();
    expect(button('Undo removal · Blue Train')).toBeDefined();
    expect(session.has(legacyKey)).toBe(false);

    const pending = Promise.withResolvers<{ album: Album }>();
    undoAlbumRemoval.mockReturnValueOnce(pending.promise);
    await act(async () => button('Undo removal · Blue Train')!.props.onClick());
    expect(button('Restoring… · Blue Train')?.props['aria-busy']).toBe(true);
    await act(async () => history.current!.clear());
    await act(async () => pending.resolve({ album: shelfRecord }));
    expect(onRestored).not.toHaveBeenCalled();
    expect(renderer.toJSON()).toBeNull();
    expect(activeReceipts()).toEqual([]);
  });

  it('keeps receipts added by another tab and only consumes the matching token', async () => {
    await mount();
    await record(shelfRecord);
    const remote = { ...wishlistRecord, kind: 'removal', undoToken: 'remote', expiresAt: new Date(Date.now() + 600_000).toISOString() };
    const key = `side-a-library-undo:removal:${remote.id}:${remote.undoToken}`;
    await emitStorageChange(key, JSON.stringify(remote));
    expect(button('Undo removal · Giant Steps')).toBeDefined();

    const pending = Promise.withResolvers<{ album: Album }>();
    undoAlbumRemoval.mockReturnValueOnce(pending.promise);
    await act(async () => button('Undo removal · Giant Steps')!.props.onClick());
    const newer = { ...remote, undoToken: 'newer', expiresAt: new Date(Date.now() + 601_000).toISOString() };
    await emitStorageChange(`side-a-library-undo:removal:${newer.id}:${newer.undoToken}`, JSON.stringify(newer));
    await act(async () => pending.resolve({ album: wishlistRecord }));
    expect(onRestored).not.toHaveBeenCalled();
    expect(onExternalChange).toHaveBeenCalledTimes(2);
    expect(button('Undo removal · Blue Train')).toBeDefined();

    undoAlbumRemoval.mockResolvedValueOnce({ album: wishlistRecord });
    await act(async () => button('Undo removal · Giant Steps')!.props.onClick());
    expect(undoAlbumRemoval).toHaveBeenLastCalledWith(wishlistRecord.id, 'newer');
    expect(button('Undo removal · Giant Steps')).toBeUndefined();
    await emitStorageChange(`side-a-library-undo:removal:${newer.id}:${newer.undoToken}`, JSON.stringify(newer));
    expect(button('Undo removal · Giant Steps')).toBeUndefined();
    expect(button('Undo removal · Blue Train')).toBeDefined();
  });

  it('returns focus to the library when another tab consumes the final collapsed receipt', async () => {
    const ownerDocument = { activeElement: null as object | null };
    const toggle = { focus: vi.fn(() => { ownerDocument.activeElement = toggle; }) };
    const fallbackFocus = createRef<HTMLElement>();
    const focus = vi.fn();
    fallbackFocus.current = { focus } as unknown as HTMLElement;
    await mount({ createNodeMock: element => {
      if (element.type === 'aside') return { ownerDocument };
      if (element.type === 'button' && element.props['aria-controls']) return toggle;
      return null;
    } }, fallbackFocus);
    const receipt = await record(shelfRecord);
    await act(async () => button('Dismiss library change notice')!.props.onClick());
    expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });

    const key = `side-a-library-undo:removal:${shelfRecord.id}:${receipt.undoToken}:closed`;
    await emitStorageChange(key, JSON.stringify({ ...shelfRecord, ...receipt, kind: 'removal', closed: true }));
    expect(renderer.toJSON()).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it('recovers separate moves and a pressing update after remounting the history', async () => {
    await mount();
    const expiry = { expiresAt: new Date(Date.now() + 600_000).toISOString() };
    await act(async () => {
      for (const album of [shelfRecord, wishlistRecord]) {
        history.current!.recordMove({ albumId: album.id, title: album.title, from: album.status,
          to: album.status === 'collection' ? 'wishlist' : 'collection' }, { ...expiry, undoToken: `move-${album.id}` });
      }
      history.current!.recordPressing(shelfRecord, { ...expiry, undoToken: 'pressing' });
    });
    await act(async () => renderer.unmount());
    await mount();

    undoAlbumMove.mockResolvedValueOnce({ album: shelfRecord }).mockResolvedValueOnce({ album: wishlistRecord });
    undoPressing.mockResolvedValueOnce({ album: shelfRecord });
    await act(async () => { expect(await history.current!.undoMove(shelfRecord.id)).toBe(true); });
    await act(async () => button('Undo pressing change · Blue Train')!.props.onClick());
    await act(async () => button('Undo move · Giant Steps')!.props.onClick());
    expect(undoAlbumMove.mock.calls).toEqual([[shelfRecord.id, 'move-1'], [wishlistRecord.id, 'move-2']]);
    expect(undoPressing).toHaveBeenCalledWith(shelfRecord.id, 'pressing');
    expect(onMovedBack.mock.calls).toEqual([[shelfRecord], [wishlistRecord]]);
    expect(onPressingUndone).toHaveBeenCalledWith(shelfRecord);
  });

  it('drops unavailable album changes and rejects old responses after a restore in another tab', async () => {
    await mount();
    const receipt = await record(wishlistRecord);
    await act(async () => {
      history.current!.recordPressing(shelfRecord, { ...receipt, undoToken: 'pressing' });
      history.current!.forgetAlbumChanges(shelfRecord.id);
    });
    expect(button('Undo pressing change · Blue Train')).toBeUndefined();
    expect(button('Undo removal · Giant Steps')).toBeDefined();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await emitStorageChange(`side-a-library-restored:${Date.now()}`, '');
    await act(async () => history.current!.recordRemoval(wishlistRecord, receipt));
    expect(renderer.toJSON()).toBeNull();
    expect(onExternalChange).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await record(shelfRecord);
    expect(button('Undo removal · Blue Train')).toBeDefined();
  });

  it('offers tab-only undo and explains its scope when browser persistence is blocked', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    await mount();
    const receipt = await record(shelfRecord);
    expect(JSON.stringify(renderer.toJSON())).toContain('This tab only. Keep it open without reloading.');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('This list is shared across tabs in this browser.');
    await act(async () => button('Dismiss library change notice')!.props.onClick());
    expect(collapsedDetails().findByType('span').children.join('')).toBe('This tab only. Keep it open without reloading.');
    expect(collapsedDetails().findByType('time').props.dateTime).toBe(receipt.expiresAt);
    await act(async () => button('Recent library changes')!.props.onClick());
    expect(activeReceipts()).toEqual([]);
    undoAlbumRemoval.mockResolvedValueOnce({ album: shelfRecord });
    await act(async () => button('Undo removal · Blue Train')!.props.onClick());
    expect(onRestored).toHaveBeenCalledWith(shelfRecord);
  });
});
