import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album, DiscogsAlbum, SearchResult } from '../src/services/api';

const { getAlbum, getAlbums, getPressingDetails, search, searchCatalogNumber, addAlbum, updateStatus, deleteAlbum } = vi.hoisted(() => ({
  getAlbum: vi.fn(),
  getAlbums: vi.fn(),
  getPressingDetails: vi.fn(),
  search: vi.fn(),
  searchCatalogNumber: vi.fn(),
  addAlbum: vi.fn(),
  updateStatus: vi.fn(),
  deleteAlbum: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { getAlbum, getAlbums, getPressingDetails, search, searchCatalogNumber, addAlbum, updateStatus, deleteAlbum, checkDiscogsConfig: async () => ({ configured: true }) },
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
import { CatalogPressingPicker } from '../src/components/CatalogPressingPicker';
import { PressingComparison } from '../src/components/PressingComparison';

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

async function chooseScope(value: 'saved' | 'collection' | 'wishlist' | 'catalog' | 'catalog-number') {
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
  getPressingDetails.mockResolvedValue({ pressing: null });
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
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeUndefined();
    const saveDefault = renderer.root.findByProps({ id: 'catalog-save-shelf' });
    expect(button('Wishlist')).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(2);
    expect(saveDefault.props.value).toBe('collection');
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    await act(async () => discovery.resolve({ local: [], discogs: [catalog] }));
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeDefined();
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeUndefined();
    await act(async () => saveDefault.props.onChange({ target: { value: 'wishlist' } }));
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeDefined();
    expect(saveDefault.props.value).toBe('wishlist');

    await act(async () => button('Back to Collection').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    await act(async () => button('Wishlist').props.onClick());
    await editSearch('Coltrane');
    await act(async () => button('Back to Wishlist').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    const status = renderer.root.findByType('header').findByProps({ role: 'status' });
    expect(status.findByType('span').children.join('')).toBe('1 album in Wishlist');
  });

  it('filters separate shelf scopes without clearing the query or changing the browse shelf', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await chooseScope('collection');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenLastCalledWith('Coltrane', expect.any(AbortSignal), 'saved', 'collection', 0, 'title');
    await chooseScope('wishlist');
    expect(search).toHaveBeenLastCalledWith('Coltrane', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    expect(button('Back to Collection')).toBeDefined();
  });

  it('keeps a catalog save bound to its original shelf when the default changes', async () => {
    const add = Promise.withResolvers<{ album: Album }>();
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    const destination = renderer.root.findByProps({ id: 'catalog-save-shelf' });
    await act(async () => destination.props.onChange({ target: { value: 'wishlist' } }));
    const addButton = button('Add to Wishlist · Giant Steps by John Coltrane');
    await act(async () => addButton.props.onClick());
    await act(async () => destination.props.onChange({ target: { value: 'collection' } }));

    const saving = button('Adding to Wishlist… · Giant Steps by John Coltrane');
    expect(saving.props['aria-disabled']).toBe(true);
    await act(async () => saving.props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'wishlist' }));
    await act(async () => add.resolve({ album: { ...saved, id: 2, title: 'Giant Steps' } }));
    expect(button('Open Giant Steps by John Coltrane, Wishlist, saved record 2')).toBeDefined();
    expect(button('Open saved album · Giant Steps by John Coltrane, Wishlist, saved record 2')).toBe(addButton);
    expect(renderer.root.findByProps({ className: 'rh-saved-outcome' }).children.join('')).toBe('Album saved in Wishlist · Saved pressing unconfirmed');
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeUndefined();
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
    await act(async () => renderer.root.findByProps({ id: 'catalog-save-shelf' }).props.onChange({ target: { value: 'wishlist' } }));
    await act(async () => button('Add to Wishlist · Giant Steps by John Coltrane').props.onClick());

    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => add.resolve({ album: added }));
    expect(search.mock.calls[3][1].aborted).toBe(true);
    expect(search.mock.calls[5][0]).toBe('Coltrane');

    await act(async () => staleSearch.resolve(match));
    expect(button('Open Giant Steps by John Coltrane, Wishlist, saved record 2')).toBeDefined();
    expect(button('Compare pressings for Giant Steps by John Coltrane')).toBeDefined();
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeUndefined();
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
      .filter(node => ['Move to Collection · Giant Steps by John Coltrane', 'Move to Collection — Giant Steps'].includes(node.props['aria-label']));
    expect(moveButtons()).toHaveLength(2);
    await act(async () => {
      for (const button of moveButtons()) button.props.onClick({ currentTarget: { ownerDocument: {} } });
    });

    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(album.id, 'collection', 'wishlist');
    expect(moveButtons().every(node => node.props['aria-disabled'])).toBe(true);
    await act(async () => moving.resolve());

    expect(moveButtons()).toHaveLength(0);
    expect(button('Open Giant Steps by John Coltrane, Collection, saved record 42')).toBeDefined();
    expect(renderer.root.findByProps({ className: 'rh-saved-outcome' }).children.join('')).toBe('This pressing saved in Collection');
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
    await act(async () => button('Add album manually').props.onClick());
    expect(renderer.root.findByProps({ name: 'artist' }).props.defaultValue).toBe('John Coltrane');
    expect(renderer.root.findByProps({ name: 'album' }).props.defaultValue).toBe('Alternate Album');
    expect(button('Add to Wishlist')).toBeDefined();
    await act(async () => button('Cancel').props.onClick());
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onManualClick());
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
    await act(async () => button('Add to Collection · Giant Steps by John Coltrane').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('This album is already saved.');
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeUndefined();
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
    expect(button('Move to Collection · Giant Steps by John Coltrane')).toBeUndefined();
    expect(button('Open Giant Steps by John Coltrane, Wishlist, Discogs release 104')).toBeDefined();
    expect(button('Open Giant Steps by John Coltrane, Collection, Discogs release 105')).toBeDefined();
    await act(async () => button('Compare pressings for Giant Steps by John Coltrane').props.onClick());
    expect(button('Open saved album · Giant Steps by John Coltrane, Wishlist, Discogs release 104')).toBeDefined();
    const copyLabel = renderer.root.findAllByType('label').find(node => node.children.includes('Saved copy to compare'))!;
    const copySelect = renderer.root.findByProps({ id: copyLabel.props.htmlFor });
    expect(copySelect.findAllByType('option')).toHaveLength(2);
    await act(async () => copySelect.props.onChange({ target: { value: '82' } }));
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

  it('saves a master as an album overview even when the result supplies a legacy default release ID', async () => {
    const catalogListing = { source: 'discogs', kind: 'master', id: 91 } as const;
    search.mockResolvedValue({ local: [], discogs: [{ ...catalog, id: 91, source: 'discogs', discogsListing: 'master', year: 1960 }] });
    addAlbum.mockResolvedValueOnce({ album: { ...saved, title: catalog.album, status: 'collection', catalog_listing: catalogListing } });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(renderer.root.findByProps({ href: 'https://www.discogs.com/master/91' }).props.target).toBe('_blank');
    expect(renderer.root.findAllByType('summary').some(summary => summary.props['aria-label']?.startsWith('Album information'))).toBe(false);
    await act(async () => button('Add to Collection · Giant Steps by John Coltrane, 1960, Discogs album overview').props.onClick());
    expect(addAlbum.mock.calls[0][0]).toMatchObject({ catalogListing });
    expect(addAlbum.mock.calls[0][0]).not.toHaveProperty('discogsId');
  });

  it('keeps a comparison open when its only saved copy has been removed', async () => {
    const copy = { ...saved, title: catalog.album };
    search.mockResolvedValue({ local: [copy], discogs: [{ ...catalog, inWishlist: true,
      existingMatch: 'title', existingAlbumId: copy.id, titleMatches: [copy] }] });
    getAlbum.mockRejectedValueOnce(Object.assign(new Error('Album not found'), { status: 404 }));
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Compare pressings for Giant Steps by John Coltrane').props.onClick());
    await act(async () => renderer.root.findByType(PressingComparison)
      .findByProps({ 'aria-label': 'Open saved album · Giant Steps by John Coltrane, Wishlist, saved record 1' })
      .props.onClick({ currentTarget: { isConnected: true } }));
    expect(JSON.stringify(renderer.toJSON())).toContain('is no longer saved.');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Retry opening saved copy');
    await act(async () => button('Close pressing comparison').props.onClick());
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeDefined();
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Giant Steps');
  });

  it('offers Undo inside the open saved details and updates both shelf labels after reversing', async () => {
    const copy = { ...saved, title: catalog.album, discogs_id: 2219 };
    search.mockResolvedValue({ local: [], discogs: [{ ...catalog, inWishlist: true,
      existingMatch: 'title', existingAlbumId: copy.id, titleMatches: [copy] }] });
    getAlbum.mockResolvedValueOnce({ album: copy });
    updateStatus.mockResolvedValue(undefined);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Compare pressings for Giant Steps by John Coltrane').props.onClick());
    await act(async () => button('Open saved album · Giant Steps by John Coltrane, Wishlist, Discogs release 2219')
      .props.onClick({ currentTarget: { isConnected: true } }));
    const detail = renderer.root.findByProps({ labelledBy: 'album-details-title' });
    await act(async () => detail.findByProps({ 'aria-label': 'Move to Collection — Giant Steps' })
      .props.onClick({ currentTarget: { ownerDocument: {} } }));
    const undo = detail.findAllByType('button').find(node => node.children.includes('Undo move'))!;
    await act(async () => undo.props.onClick());
    expect(updateStatus.mock.calls).toEqual([[copy.id, 'collection', 'wishlist'], [copy.id, 'wishlist', 'collection']]);
    expect(JSON.stringify(renderer.toJSON())).toContain('Moved back to ');
    await act(async () => button('Back to matches').props.onClick());
    expect(button('Open saved album · Giant Steps by John Coltrane, Wishlist, Discogs release 2219')).toBeDefined();
  });

  it('announces the saved sort refresh without replacing the catalog or accepting an older page', async () => {
    const moreSaved = Promise.withResolvers<SearchResult>();
    const sorted = Promise.withResolvers<SearchResult>();
    search.mockImplementation(async (_query, _signal, scope, _shelf, offset, sort) => {
      if (scope === 'catalog') return { local: [], discogs: [catalog] };
      if (sort === 'artist') return sorted.promise;
      return offset ? moreSaved.promise : { local: [saved], discogs: [], nextOffset: 20 };
    });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Load more saved albums').props.onClick());
    const continuation = search.mock.lastCall![1];
    await act(async () => renderer.root.findByProps({ id: 'sort-select' }).props.onChange({ target: { value: 'artist' } }));
    expect(continuation.aborted).toBe(true);
    const savedSection = renderer.root.findByProps({ 'aria-labelledby': 'saved-results-title' });
    const status = savedSection.findByProps({ role: 'status' });
    expect(status.children.join('')).toBe('Updating saved results by artist name…');
    expect(savedSection.findByProps({ 'aria-busy': true })).toBeDefined();
    expect(search.mock.calls.filter(([, , scope]) => scope === 'catalog')).toHaveLength(1);
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeDefined();

    await act(async () => moreSaved.resolve({ local: [{ ...saved, id: 7, title: 'Stale page' }], discogs: [] }));
    await act(async () => sorted.resolve({ local: [saved], discogs: [] }));
    expect(status.children.join('')).toBe('1 saved match.');
    expect(savedSection.findByProps({ 'aria-busy': false })).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Stale page');
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

  it('retries a partial catalog search without replacing loaded saved pages', async () => {
    const retry = Promise.withResolvers<SearchResult>();
    search.mockImplementation(async (_query, _signal, kind, _shelf, offset) => {
      if (kind === 'catalog') return { local: [], discogs: [catalog], errors: ['provider unavailable'] };
      return offset
        ? { local: [{ ...saved, id: 22, title: 'A Love Supreme' }], discogs: [], nextOffset: 40 }
        : { local: [saved], discogs: [], nextOffset: 20 };
    });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Load more saved albums').props.onClick());
    search.mockReturnValueOnce(retry.promise);
    await act(async () => button('Retry catalogs').props.onClick({ currentTarget: { ownerDocument: {} } }));
    expect(button('Retry catalogs').props['aria-disabled']).toBe(true);
    expect(button('Open A Love Supreme by John Coltrane, Wishlist, saved record 22')).toBeDefined();
    expect(search.mock.calls.map(([, , kind, , offset]) => [kind, offset])).toEqual([
      ['saved', 0], ['catalog', 0], ['saved', 20], ['catalog', 0],
    ]);
    await act(async () => retry.resolve({ local: [], discogs: [catalog] }));
    expect(button('Retry catalogs')).toBeUndefined();
    expect(button('Open A Love Supreme by John Coltrane, Wishlist, saved record 22')).toBeDefined();
    expect(button('Load more saved albums')).toBeDefined();
  });

  it('uses the explicit identifier lookup and only saves the edition the collector chose', async () => {
    const first = { ...catalog, discogsListing: 'release' as const, pressing: { catalogNumber: 'ABC-123' } };
    const second = { ...first, id: 102, discogsId: 102, pressing: { catalogNumber: 'ABC-123', format: 'Vinyl' } };
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [{ ...first, pressingChoices: [first, second], catalogNumberMatch: 'exact' }] });
    addAlbum.mockResolvedValue({ album: { ...saved, title: catalog.album, status: 'collection', discogs_id: 102 } });
    await renderLibrary();
    await chooseScope('catalog-number');
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).not.toHaveBeenCalled();
    expect(searchCatalogNumber).toHaveBeenCalledExactlyOnceWith('ABC-123', expect.any(AbortSignal), 0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Catalog number matches');

    await act(async () => button('Check pressings for Giant Steps by John Coltrane, Discogs release 101')
      .props.onClick({ currentTarget: { closest: () => null } }));
    const picker = renderer.root.findByType(CatalogPressingPicker);
    expect(addAlbum).not.toHaveBeenCalled();
    expect(picker.findAllByType('input')).toHaveLength(2);
    await act(async () => picker.findByProps({ value: 102 }).props.onChange());
    await act(async () => picker.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discogsId: 102, status: 'collection' }));
  });

  it('saves a catalog match as an album unless the collector chose a pressing', async () => {
    search.mockImplementation(async (_query, _signal, kind) => ({ local: [], discogs: kind === 'catalog'
      ? [{ ...catalog, discogsListing: 'release', masterId: 60, year: 2019 }] : [] }));
    addAlbum.mockResolvedValue({ album: { ...saved, title: catalog.album, status: 'collection' } });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add to Collection · Giant Steps by John Coltrane, 2019, Discogs release 101').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'collection', catalogListing: { source: 'discogs', kind: 'master', id: 60 },
    }));
    expect(addAlbum.mock.lastCall?.[0].discogsId).toBeUndefined();
    expect(addAlbum.mock.lastCall?.[0].year).toBeUndefined();
  });
});
