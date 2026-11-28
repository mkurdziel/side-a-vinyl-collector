import { createElement, createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemovalHistory, type RemovalHistoryHandle } from '../src/components/RemovalHistory';
import { ApiError, type Album } from '../src/services/api';

const { undoAlbumRemoval } = vi.hoisted(() => ({ undoAlbumRemoval: vi.fn() }));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { undoAlbumRemoval },
}));

const shelfRecord: Album = {
  id: 1, title: 'Blue Train', artist_name: 'John Coltrane', status: 'collection', added_at: '2026-08-02T00:00:00.000Z',
};
const wishlistRecord: Album = { ...shelfRecord, id: 2, title: 'Giant Steps', status: 'wishlist' };
const historyKey = 'side-a-removal-history';
const legacyKey = 'side-a-last-removal';
const storage = new Map<string, string>();
const history = createRef<RemovalHistoryHandle>();
const onRestored = vi.fn();
let renderer: ReturnType<typeof create>;

async function mount() {
  await act(async () => {
    renderer = create(createElement(RemovalHistory, { ref: history, onRestored, fallbackFocus: createRef() }));
  });
}

async function record(album: Album, duration = 600_000) {
  const receipt = { undoToken: `undo-${album.id}`, expiresAt: new Date(Date.now() + duration).toISOString() };
  await act(async () => history.current!.recordRemoval(album, receipt));
  return receipt;
}

function button(name: string) {
  return renderer.root.findAllByType('button').find(node => node.props['aria-label'] === name || node.children[0] === name);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T18:00:00.000Z'));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  storage.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('removal history', () => {
  it.each([
    [shelfRecord, wishlistRecord],
    [wishlistRecord, shelfRecord],
  ])('restores both receipts across dismissal and reload when %o is restored first', async (first, second) => {
    await mount();
    const firstReceipt = await record(shelfRecord);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    const secondReceipt = await record(wishlistRecord);
    expect(renderer.root.findAllByType('time').map(node => node.props.dateTime)).toEqual([secondReceipt.expiresAt, firstReceipt.expiresAt]);

    await act(async () => button('Dismiss removal notice')!.props.onClick());
    expect(renderer.root.findByType('ul').props.hidden).toBe(true);
    await act(async () => button('Recent removals')!.props.onClick());
    expect(renderer.root.findByType('ul').props.hidden).toBe(false);
    await act(async () => renderer.unmount());
    await mount();

    undoAlbumRemoval.mockResolvedValueOnce({ album: first }).mockResolvedValueOnce({ album: second });
    await act(async () => button(`Undo removal · ${first.title}`)!.props.onClick());
    expect(onRestored).toHaveBeenNthCalledWith(1, first);
    expect(button(`Undo removal · ${first.title}`)).toBeUndefined();
    expect(JSON.parse(storage.get(historyKey) ?? 'null')).toMatchObject([{ id: second.id }]);
    await act(async () => button(`Undo removal · ${second.title}`)!.props.onClick());
    expect(undoAlbumRemoval.mock.calls).toEqual([[first.id, `undo-${first.id}`], [second.id, `undo-${second.id}`]]);
    expect(onRestored).toHaveBeenNthCalledWith(2, second);
    expect(storage.has(historyKey)).toBe(false);
  });

  it('expires each receipt separately and keeps a failed undo retryable until its deadline', async () => {
    await mount();
    await record(shelfRecord, 1_000);
    await record(wishlistRecord, 10_000);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(button('Undo removal · Blue Train')).toBeUndefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('The undo window for “Blue Train” ended.');

    undoAlbumRemoval.mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new ApiError('This removal can no longer be undone.', 409));
    await act(async () => button('Undo removal · Giant Steps')!.props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('Couldn’t confirm the undo. Try again.');
    expect(storage.has(historyKey)).toBe(true);
    await act(async () => button('Retry undo removal · Giant Steps')!.props.onClick());
    expect(button('Retry undo removal · Giant Steps')).toBeUndefined();
    expect(storage.has(historyKey)).toBe(false);
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

    await act(async () => pending.resolve({ album: shelfRecord }));
    expect(onRestored).toHaveBeenNthCalledWith(2, shelfRecord);
    expect(storage.has(historyKey)).toBe(false);
  });

  it('ignores malformed data, migrates a valid old receipt, and clears pending state after backup restore', async () => {
    const { id, title, status } = shelfRecord;
    storage.set(historyKey, '{broken');
    storage.set(legacyKey, JSON.stringify({ id, title, status, kind: 'removed', undoToken: 'old', expiresAt: new Date(Date.now() + 600_000).toISOString() }));
    await mount();
    expect(button('Undo removal · Blue Train')).toBeDefined();
    expect(storage.has(legacyKey)).toBe(false);

    const pending = Promise.withResolvers<{ album: Album }>();
    undoAlbumRemoval.mockReturnValueOnce(pending.promise);
    await act(async () => button('Undo removal · Blue Train')!.props.onClick());
    expect(button('Restoring… · Blue Train')?.props['aria-busy']).toBe(true);
    await act(async () => history.current!.clear());
    await act(async () => pending.resolve({ album: shelfRecord }));
    expect(onRestored).not.toHaveBeenCalled();
    expect(renderer.toJSON()).toBeNull();
    expect(storage.has(historyKey)).toBe(false);
  });
});
