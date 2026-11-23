import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album, DiscogsAlbum, SearchResult } from '../src/services/api';

const { getAlbum, getAlbums, search, addAlbum, updateStatus, deleteAlbum } = vi.hoisted(() => ({
  getAlbum: vi.fn(),
  getAlbums: vi.fn(),
  search: vi.fn(),
  addAlbum: vi.fn(),
  updateStatus: vi.fn(),
  deleteAlbum: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { getAlbum, getAlbums, search, addAlbum, updateStatus, deleteAlbum, checkDiscogsConfig: async () => ({ configured: true }) },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));
vi.mock('react-hot-toast', () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/components/SettingsModal', () => ({ SettingsModal: () => null }));

import App from '../src/App';
import { AddMenu } from '../src/components/AddMenu';
import { ImageUploader } from '../src/components/ImageUploader';

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

async function chooseScope(value: 'saved' | 'shelf' | 'catalog') {
  await act(async () => renderer.root.findByProps({ id: 'search-scope' }).props.onChange({ target: { value } }));
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
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => fn());
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
    expect(search).toHaveBeenCalledWith('old', expect.any(AbortSignal), 'saved', undefined, 0, 'title');
    expect(JSON.stringify(renderer.toJSON())).toContain('Searching saved albums');

    await editSearch('Coltrane');
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][1].aborted).toBe(true);
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1').type).toBe('button');

    await act(async () => older.resolve({ local: [], discogs: [] }));
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
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
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Late collection entry');
  });

  it('shows saved matches before catalogs and keeps the save default separate from shelf browsing', async () => {
    const discovery = Promise.withResolvers<SearchResult>();
    search.mockImplementation((_, __, scope) => scope === 'catalog' ? discovery.promise : Promise.resolve({ local: [saved], discogs: [] }));
    getAlbums.mockImplementation(async (shelf: string) => ({ albums: shelf === 'wishlist' ? [saved] : [] }));
    await renderLibrary();
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenCalledExactlyOnceWith('Coltrane', expect.any(AbortSignal), 'saved', undefined, 0, 'title');
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();

    await chooseScope('catalog');
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(button('Add Giant Steps to Wishlist')).toBeUndefined();
    const saveDefault = renderer.root.findByProps({ id: 'catalog-save-shelf' });
    await act(async () => button('Wishlist').props.onClick());
    expect(search).toHaveBeenCalledTimes(3);
    expect(saveDefault.props.value).toBe('collection');
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    await act(async () => discovery.resolve({ local: [], discogs: [catalog] }));
    expect(button('Add Giant Steps to Wishlist')).toBeDefined();
    await act(async () => saveDefault.props.onChange({ target: { value: 'wishlist' } }));
    await act(async () => button('Collection').props.onClick());
    expect(saveDefault.props.value).toBe('wishlist');

    await act(async () => button('Wishlist').props.onClick());
    await act(async () => button('Back to Wishlist').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    const status = renderer.root.findByType('header').findByProps({ role: 'status' });
    expect(status.findByType('span').children.join('')).toBe('1 album in Wishlist');
  });

  it('filters This shelf searches when the user changes shelves', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await chooseScope('shelf');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenLastCalledWith('Coltrane', expect.any(AbortSignal), 'saved', 'collection', 0, 'title');
    await act(async () => button('Wishlist').props.onClick());
    expect(search).toHaveBeenLastCalledWith('Coltrane', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
  });

  it('serializes the two add destinations for the same catalog record', async () => {
    const add = Promise.withResolvers<{ album: Album }>();
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    await act(async () => {
      button('Add Giant Steps to Wishlist').props.onClick();
      button('Add Giant Steps to Collection').props.onClick();
    });

    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'wishlist' }));
    expect(button('Add Giant Steps to Collection').props['aria-disabled']).toBe(true);
    await act(async () => add.resolve({ album: { ...saved, id: 2, title: 'Giant Steps' } }));
    expect(renderer.root.findByProps({ 'aria-label': 'Giant Steps is in Wishlist' })).toBeDefined();
    expect(renderer.root.findByProps({ 'aria-label': 'Saved title matches for Giant Steps' })).toBeDefined();
    expect(button('Add Giant Steps to Collection')).toBeUndefined();
  });

  it('rechecks catalog membership when an add overtakes an in-flight search', async () => {
    const staleSearch = Promise.withResolvers<SearchResult>();
    const add = Promise.withResolvers<{ album: Album }>();
    const added = { ...saved, id: 2, title: 'Giant Steps' };
    const match = { local: [], discogs: [catalog] };
    let catalogRequests = 0;
    search.mockImplementation(async (_, __, scope) => {
      if (scope === 'saved') return { local: catalogRequests >= 2 ? [added] : [], discogs: [] };
      catalogRequests += 1;
      if (catalogRequests === 2) return staleSearch.promise;
      return catalogRequests === 1 ? match : { local: [], discogs: [{ ...catalog, inWishlist: true, existingAlbumId: added.id }] };
    });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add Giant Steps to Wishlist').props.onClick());

    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => add.resolve({ album: added }));
    expect(search.mock.calls[3][1].aborted).toBe(true);
    expect(search.mock.calls[5][0]).toBe('Coltrane');

    await act(async () => staleSearch.resolve(match));
    expect(renderer.root.findByProps({ 'aria-label': 'Giant Steps is in Wishlist' })).toBeDefined();
    expect(renderer.root.findByProps({ 'aria-label': 'Saved title matches for Giant Steps' })).toBeDefined();
    expect(button('Add Giant Steps to Collection')).toBeUndefined();
  });

  it('moves a wishlist result by its saved ID and updates catalog and saved results together', async () => {
    const moving = Promise.withResolvers<void>();
    const album = { ...saved, id: 42, title: 'Giant Steps' };
    search.mockResolvedValue({
      local: [album],
      discogs: [{ ...catalog, inWishlist: true, existingAlbumId: album.id, existingMatch: 'release' }],
    });
    updateStatus.mockReturnValueOnce(moving.promise);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    const moveButtons = () => renderer.root.findAllByType('button')
      .filter(node => ['Move Giant Steps to Collection', 'Move to Collection — Giant Steps'].includes(node.props['aria-label']));
    expect(moveButtons()).toHaveLength(2);
    await act(async () => {
      for (const button of moveButtons()) button.props.onClick({ currentTarget: { ownerDocument: {} } });
    });

    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(album.id, 'collection', 'wishlist');
    expect(moveButtons().every(node => node.props['aria-disabled'])).toBe(true);
    await act(async () => moving.resolve());

    expect(moveButtons()).toHaveLength(0);
    expect(renderer.root.findByProps({ 'aria-label': 'Giant Steps is in Collection' })).toBeDefined();
    expect(button('Giant Steps: Release ID in Collection')).toBeDefined();
    expect(getAlbums).toHaveBeenCalledTimes(2);

    await act(async () => button('Undo').props.onClick());
    expect(updateStatus).toHaveBeenLastCalledWith(album.id, 'wishlist', 'collection');
    expect(moveButtons()).toHaveLength(2);
    expect(button('Undo')).toBeUndefined();
  });

  it('uses the guarded notes-aware removal confirmation directly from Collection details', async () => {
    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'collection' ? [{ ...saved, status: shelf }] : [] }));
    deleteAlbum.mockRejectedValueOnce(Object.assign(new Error('Changed shelf'), { status: 409 }));
    await renderLibrary();
    expect(button('Move to Wishlist — Blue Train')).toBeDefined();
    await act(async () => button('Open Blue Train by John Coltrane, Collection, saved record 1').props.onClick({ currentTarget: { isConnected: true } }));
    const details = renderer.root.findByProps({ labelledBy: 'album-details-title' });
    await act(async () => details.findByProps({ 'aria-label': 'Remove from Collection — Blue Train' }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('any notes saved with it');
    expect(deleteAlbum).not.toHaveBeenCalled();
    await act(async () => button('Remove album').props.onClick());
    expect(deleteAlbum).toHaveBeenCalledExactlyOnceWith(saved.id, 'collection');
    expect(JSON.stringify(renderer.toJSON())).toContain('Open the current record');
    expect(button('Remove album').props['aria-disabled']).toBe(true);
    getAlbum.mockResolvedValueOnce({ album: saved });
    await act(async () => button('Open current album').props.onClick());
    expect(getAlbum).toHaveBeenCalledExactlyOnceWith(saved.id);
    expect(button('Remove album')).toBeUndefined();
    expect(renderer.root.findByProps({ labelledBy: 'album-details-title' })
      .findByProps({ 'aria-label': 'Remove from Wishlist — Blue Train' })).toBeDefined();
  });

  it('starts a catalog search on an empty shelf and prefills manual entry after a miss', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await act(async () => button('Find a record to add').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('catalog');
    await editSearch('Unlisted record');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add album manually').props.onClick());
    expect(renderer.root.findByProps({ name: 'album' }).props.defaultValue).toBe('Unlisted record');
    expect(button('Add to Collection')).toBeDefined();
  });

  it('prefills edited details for manual entry beside populated catalog results', async () => {
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    await renderLibrary();
    await act(async () => button('Wishlist').props.onClick());
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onImageClick());
    await act(async () => renderer.root.findByType(ImageUploader).props.onSearchByName(
      'John Coltrane Giant Steps', { artist: 'John Coltrane', album: 'Giant Steps' },
    ));
    await editSearch('John Coltrane Alternate Album');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Collection').props.onClick());
    await act(async () => button('Add album manually').props.onClick());
    expect(renderer.root.findByProps({ name: 'artist' }).props.defaultValue).toBe('John Coltrane');
    expect(renderer.root.findByProps({ name: 'album' }).props.defaultValue).toBe('Alternate Album');
    expect(button('Add to Wishlist')).toBeDefined();
  });

  it('offers the existing saved album after a catalog add conflict', async () => {
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    addAlbum.mockRejectedValueOnce(Object.assign(new Error('Already saved'), { status: 409, existingAlbumId: saved.id }));
    getAlbum.mockResolvedValueOnce({ album: saved });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add Giant Steps to Collection').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('This album is already saved.');
    expect(button('Add Giant Steps to Collection')).toBeUndefined();
    expect(button('Open saved album').props.autoFocus).toBe(true);
    await act(async () => button('Open saved album').props.onClick());
    expect(getAlbum).toHaveBeenCalledExactlyOnceWith(saved.id);
  });

  it('shows every matching saved album for an ambiguous catalog title without offering a transfer', async () => {
    const matches: Album[] = [
      { ...saved, id: 81, title: 'Giant Steps', discogs_id: 104 },
      { ...saved, id: 82, title: 'Giant Steps', discogs_id: 105, status: 'collection' },
    ];
    search.mockResolvedValue({ local: matches, discogs: [{ ...catalog, existingMatch: 'title', inWishlist: true,
      inCollection: true, titleMatches: matches }] });
    const pendingDetails = Promise.withResolvers<{ album: Album }>();
    getAlbum.mockReturnValueOnce(pendingDetails.promise).mockResolvedValueOnce({ album: matches[1] });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(button('Move Giant Steps to Collection')).toBeUndefined();
    expect(button('Open Giant Steps by John Coltrane, Wishlist, Discogs release 104')).toBeDefined();
    expect(button('Open Giant Steps by John Coltrane, Collection, Discogs release 105')).toBeDefined();
    await act(async () => button('Compare pressings for Giant Steps').props.onClick());
    expect(button('Open saved album · Giant Steps by John Coltrane, Wishlist, Discogs release 104')).toBeDefined();
    const opener = { isConnected: true };
    const collectionCopy = ' · Giant Steps by John Coltrane, Collection, Discogs release 105';
    await act(async () => button('Open saved album' + collectionCopy).props.onClick({ currentTarget: opener }));
    expect(button('Opening saved copy…' + collectionCopy).props['aria-busy']).toBe(true);
    await act(async () => pendingDetails.reject(new Error('Offline')));
    expect(JSON.stringify(renderer.toJSON())).toContain('Couldn’t open this saved copy.');
    await act(async () => button('Retry opening saved copy' + collectionCopy).props.onClick({ currentTarget: opener }));
    expect(getAlbum.mock.calls).toEqual([[82], [82]]);
    const details = renderer.root.findByProps({ labelledBy: 'album-details-title' });
    expect(details.props.returnFocusTo.current).toBe(opener);
    await act(async () => button('Back to matches').props.onClick());
    expect(button('Open saved album' + collectionCopy)).toBeDefined();
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Giant Steps');
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('appends saved matches and discards a catalog continuation after a new query', async () => {
    const nextCatalog = Promise.withResolvers<SearchResult>();
    search.mockImplementation(async (q, _signal, scope, _shelf, offset) => {
      if (q !== 'Coltrane') return { local: [], discogs: [] };
      if (scope === 'catalog') return offset ? nextCatalog.promise : { local: [], discogs: [catalog], nextOffset: 30 };
      return offset
        ? { local: [{ ...saved, id: 22, title: 'A Love Supreme' }], discogs: [] }
        : { local: [saved], discogs: [], nextOffset: 20 };
    });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Load more saved albums').props.onClick());
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(button('Open A Love Supreme by John Coltrane, Wishlist, saved record 22')).toBeDefined();
    await act(async () => button('Load more catalog albums').props.onClick());
    const catalogSignal = search.mock.lastCall![1];
    await editSearch('Parker');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => nextCatalog.resolve({ local: [], discogs: [{ ...catalog, album: 'Stale page' }] }));
    expect(catalogSignal.aborted).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Stale page');
  });
});
