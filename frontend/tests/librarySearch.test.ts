import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album, DiscogsAlbum, SearchResult } from '../src/services/api';

const { getAlbums, search, addAlbum, updateStatus } = vi.hoisted(() => ({
  getAlbums: vi.fn(),
  search: vi.fn(),
  addAlbum: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock('../src/services/api', () => ({
  default: { getAlbums, search, addAlbum, updateStatus, checkDiscogsConfig: async () => ({ configured: true }) },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));
vi.mock('react-hot-toast', () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/components/SettingsModal', () => ({ SettingsModal: () => null }));

import App from '../src/App';

const saved: Album = {
  id: 1,
  title: 'Blue Train',
  artist_name: 'John Coltrane',
  added_at: '2026-08-02T00:00:00.000Z',
  status: 'wishlist',
};
const catalog: DiscogsAlbum = {
  id: 101,
  discogsId: 101,
  artist: 'John Coltrane',
  album: 'Giant Steps',
};

let renderer: ReturnType<typeof create>;

async function renderLibrary() {
  await act(async () => { renderer = create(createElement(App)); });
}

async function editSearch(value: string) {
  await act(async () => {
    renderer.root.findByProps({ id: 'album-search' }).props.onChange({ target: { value } });
  });
}

function button(name: string) {
  return renderer.root.findAllByType('button').find(node => (
    node.props['aria-label'] === name || node.children.join('') === name
  ))!;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__APP_VERSION__', 'test');
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.useFakeTimers();
  getAlbums.mockResolvedValue({ albums: [] });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('library and catalog search', () => {
  it('cancels a queued search when cleared and ignores an older response', async () => {
    const older = Promise.withResolvers<SearchResult>();
    search.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ local: [saved], discogs: [] });
    await renderLibrary();

    await editSearch('queued');
    await act(async () => button('Clear search').props.onClick());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).not.toHaveBeenCalled();

    await editSearch('old');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenCalledWith('old', expect.any(AbortSignal));
    expect(JSON.stringify(renderer.toJSON())).toContain('Searching your library and catalogs');

    await editSearch('Coltrane');
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][1].aborted).toBe(true);
    expect(button('Open Blue Train by John Coltrane').type).toBe('button');

    await act(async () => older.resolve({ local: [], discogs: [] }));
    expect(button('Open Blue Train by John Coltrane')).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('No matches');
  });

  it('keeps a late shelf response out of the selected shelf and offers retry after failure', async () => {
    const collection = Promise.withResolvers<{ albums: Album[] }>();
    getAlbums.mockReturnValueOnce(collection.promise)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ albums: [saved] });
    await renderLibrary();

    await act(async () => button('Wishlist').props.onClick());
    expect(getAlbums.mock.calls[0][1].aborted).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Couldn’t load');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('is empty');
    await act(async () => button('Retry').props.onClick());

    await act(async () => collection.resolve({
      albums: [{ ...saved, id: 2, title: 'Late collection entry', status: 'collection' }],
    }));
    expect(button('Open Blue Train by John Coltrane')).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Late collection entry');
  });

  it('keeps a global query and matches visible when switching the default shelf', async () => {
    search.mockResolvedValue({ local: [saved], discogs: [catalog] });
    getAlbums.mockImplementation(async (shelf: string) => ({ albums: shelf === 'wishlist' ? [saved] : [] }));
    await renderLibrary();
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    await act(async () => button('Wishlist').props.onClick());
    await act(async () => button('Wishlist').props.onClick());

    expect(search).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    expect(button('Wishlist').props['aria-pressed']).toBe(true);
    expect(button('Open Blue Train by John Coltrane')).toBeDefined();
    expect(button('Add Giant Steps to Wishlist')).toBeDefined();
    const status = renderer.root.findByType('header').findByProps({ role: 'status' });
    expect(status.findByType('span').children.join('')).toBe('1 saved album · 1 catalog match');

    await act(async () => button('Back to Wishlist').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    expect(status.findByType('span').children.join('')).toBe('1 album in Wishlist');
  });

  it('serializes the two add destinations for the same catalog record', async () => {
    const add = Promise.withResolvers<{ album: Album }>();
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    await act(async () => {
      button('Add Giant Steps to Wishlist').props.onClick();
      button('Add Giant Steps to Collection').props.onClick();
    });

    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'wishlist' }));
    expect(button('Add Giant Steps to Collection').props['aria-disabled']).toBe(true);
    await act(async () => add.resolve({ album: { ...saved, id: 2, title: 'Giant Steps' } }));
    expect(renderer.root.findAllByProps({ 'aria-label': 'Giant Steps is in Wishlist' })).toHaveLength(2);
    expect(button('Add Giant Steps to Collection')).toBeUndefined();
  });

  it('rechecks catalog membership when an add overtakes an in-flight search', async () => {
    const staleSearch = Promise.withResolvers<SearchResult>();
    const add = Promise.withResolvers<{ album: Album }>();
    const added = { ...saved, id: 2, title: 'Giant Steps' };
    const match = { local: [], discogs: [catalog] };
    search.mockResolvedValueOnce(match)
      .mockReturnValueOnce(staleSearch.promise)
      .mockResolvedValueOnce({ local: [added], discogs: [{ ...catalog, inWishlist: true }] });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add Giant Steps to Wishlist').props.onClick());

    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => add.resolve({ album: added }));
    expect(search.mock.calls[1][1].aborted).toBe(true);
    expect(search.mock.calls[2][0]).toBe('Coltrane');

    await act(async () => staleSearch.resolve(match));
    expect(renderer.root.findAllByProps({ 'aria-label': 'Giant Steps is in Wishlist' })).toHaveLength(2);
    expect(button('Add Giant Steps to Collection')).toBeUndefined();
  });

  it('moves a wishlist result by its saved ID and updates catalog and saved results together', async () => {
    const moving = Promise.withResolvers<void>();
    const album = { ...saved, id: 42, title: 'Giant Steps' };
    search.mockResolvedValue({
      local: [album],
      discogs: [{ ...catalog, inWishlist: true, existingAlbumId: album.id }],
    });
    updateStatus.mockReturnValueOnce(moving.promise);
    await renderLibrary();
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    const moveButtons = () => renderer.root.findAllByType('button')
      .filter(node => node.props['aria-label'] === 'Move Giant Steps to Collection');
    expect(moveButtons()).toHaveLength(2);
    await act(async () => {
      for (const button of moveButtons()) button.props.onClick();
    });

    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(album.id, 'collection');
    expect(moveButtons().every(node => node.props['aria-disabled'])).toBe(true);
    await act(async () => moving.resolve());

    expect(moveButtons()).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Giant Steps is in Collection' })).toHaveLength(2);
    expect(getAlbums).toHaveBeenCalledTimes(2);
  });
});
