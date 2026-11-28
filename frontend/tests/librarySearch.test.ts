import { StrictMode, createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album, DiscogsAlbum, SearchResult } from '../src/services/api';

const { getAlbum, getAlbums, getPressingDetails, search, searchCatalogNumber, addAlbum, updateStatus, undoAlbumMove,
  updatePressing, deleteAlbum, undoAlbumRemoval, undoAlbumAddition } = vi.hoisted(() => ({
  getAlbum: vi.fn(),
  getAlbums: vi.fn(),
  getPressingDetails: vi.fn(),
  search: vi.fn(),
  searchCatalogNumber: vi.fn(),
  addAlbum: vi.fn(),
  updateStatus: vi.fn(),
  undoAlbumMove: vi.fn(),
  updatePressing: vi.fn(),
  deleteAlbum: vi.fn(),
  undoAlbumRemoval: vi.fn(),
  undoAlbumAddition: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { getAlbum, getAlbums, getPressingDetails, search, searchCatalogNumber, addAlbum, updateStatus, undoAlbumMove, updatePressing,
    deleteAlbum, undoAlbumRemoval, undoAlbumAddition, checkDiscogsConfig: async () => ({ configured: true }) },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));
vi.mock('react-hot-toast', () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/components/SettingsModal', () => ({ SettingsModal: () => null }));

import App from '../src/App';
import { AddMenu } from '../src/components/AddMenu';
import { BarcodeScanner } from '../src/components/BarcodeScanner';
import { AlbumDetailModal } from '../src/components/AlbumDetailModal';
import { ImageUploader } from '../src/components/ImageUploader';
import { CatalogPressingPicker } from '../src/components/CatalogPressingPicker';
import { PressingComparison } from '../src/components/PressingComparison';
import { readSearchSession, writeSearchSession } from '../src/services/searchSession';

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

async function chooseScope(value: 'saved' | 'collection' | 'wishlist' | 'catalog') {
  const select = renderer.root.findByProps({ id: 'search-scope' });
  const shelf = value === 'catalog' ? 'saved' : value;
  if (select.props.value !== shelf) {
    await act(async () => select.props.onChange({ target: { value: shelf } }));
  }
  if (value === 'saved' || value === 'catalog') {
    const toggle = button('Search catalogs too');
    if (toggle && toggle.props['aria-pressed'] !== (value === 'catalog')) {
      await act(async () => toggle.props.onClick());
    }
  }
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
  const makeStorage = () => {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
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
  it('runs an exact saved-name lookup only after a single-character name is submitted, and resumes it', async () => {
    const shortTitle = { ...saved, id: 20, title: 'O', artist_name: 'Unknown Fixture Artist' };
    search.mockResolvedValue({ local: [shortTitle], discogs: [] });
    await renderLibrary();
    await act(async () => button('Search catalogs too').props.onClick());
    await editSearch('O');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).not.toHaveBeenCalled();
    expect(button('Search').props.disabled).toBe(false);
    expect(button('Search').children.join('')).toBe('Search');
    expect(renderer.root.findByProps({ id: 'album-search' }).props['aria-describedby']).toBe('short-search-scope');
    expect(renderer.root.findByProps({ id: 'short-search-scope' }).children.join(''))
      .toBe('Exact names in Collection and Wishlist. Online catalogs need two characters.');

    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(search).toHaveBeenCalledExactlyOnceWith('O', expect.any(AbortSignal), 'saved', undefined, 0, 'title');
    expect(button('Open O by Unknown Fixture Artist, Wishlist, saved record 20')).toBeDefined();
    expect(button('Search catalogs too')).toBeUndefined();
    expect(button('Search options, Exact name, Both shelves')).toBeDefined();
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(readSearchSession()?.drafts.name).toMatchObject({ query: 'O', scope: 'catalog', exactName: true });

    await act(async () => renderer.unmount());
    search.mockClear();
    await renderLibrary();
    expect(search).toHaveBeenCalledExactlyOnceWith('O', expect.any(AbortSignal), 'saved', undefined, 0, 'title');
    await editSearch('É');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenCalledTimes(1);
    await chooseScope('wishlist');
    expect(renderer.root.findByProps({ id: 'short-search-scope' }).children.join(''))
      .toBe('Exact names in Wishlist. Online catalogs need two characters.');
    search.mockResolvedValueOnce({ local: [], discogs: [] });
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(search).toHaveBeenLastCalledWith('É', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
    expect(JSON.stringify(renderer.toJSON())).toContain('No exact title or artist matches “É” in Wishlist.');
  });

  it('keeps lookup controls in reading order as a long catalog number is typed and submitted', async () => {
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [] });
    const focusCatalogResults = vi.fn();
    await act(async () => {
      renderer = create(createElement(App), { createNodeMock: element => (
        element.props.id === 'catalog-results-title' ? { focus: focusCatalogResults } : null
      ) });
    });
    await act(async () => button('Catalog number').props.onClick());

    const form = renderer.root.findByType('form');
    const tabOrder = () => form.findAll(node => node.type === 'input' || node.type === 'button')
      .slice(0, 5).map(node => node.props['aria-label'] ?? node.props.id);
    const lookupControls = ['album-search', 'Clear search', 'Look up in Discogs', 'Add Album', 'Search options, Catalog number, Discogs'];
    await editSearch('4006381');
    expect(tabOrder()).toEqual(lookupControls);
    await editSearch('40063813');
    expect(tabOrder()).toEqual(lookupControls);
    await editSearch('4006381333931');
    expect(tabOrder()).toEqual(lookupControls);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('4006381333931');
    expect(button('Look up in Discogs').props.type).toBe('submit');
    expect(focusCatalogResults).not.toHaveBeenCalled();
    await act(async () => form.props.onSubmit({ preventDefault: () => {} }));
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });
    expect(searchCatalogNumber).toHaveBeenCalledExactlyOnceWith('4006381333931', expect.any(AbortSignal), 0);
    expect(focusCatalogResults).toHaveBeenCalledOnce();

    await act(async () => button('Clear search').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    expect(button('Clear search')).toBeUndefined();
  });

  it('shows search method and source and resumes the lookup and destination after checking a barcode', async () => {
    search.mockImplementation(async (_query, _signal, kind) => kind === 'saved'
      ? { local: [], discogs: [] } : { local: [], discogs: [catalog] });
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [catalog] });
    await renderLibrary();

    const options = button('Search options, Name search, Both shelves');
    expect(options.props['aria-expanded']).toBe(false);
    expect(renderer.root.findByType('header').findByProps({ htmlFor: 'sort-select' }).children).toEqual(['Sort']);
    const compactSortValue = () => renderer.root.findByProps({ className: 'rh-compact-sort-value' }).children.join('');
    expect(compactSortValue()).toBe('Title');
    await act(async () => renderer.root.findByProps({ id: 'sort-select' }).props.onChange({ target: { value: 'artist' } }));
    expect(compactSortValue()).toBe('Artist');
    expect(localStorage.getItem('albumSortBy')).toBe('artist');
    await act(async () => options.props.onClick());
    expect(options.props['aria-expanded']).toBe(true);
    expect(renderer.root.findByProps({ id: 'lookup-options' }).findAllByType('select').map(select => select.props.id))
      .toEqual(['search-scope']);
    expect(button('Catalog number').props['aria-describedby']).toBe('catalog-number-clue');
    expect(button('Barcode').props['aria-describedby']).toBe('barcode-clue');

    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const saveDestination = () => renderer.root.findByProps({ 'aria-label': 'Save new matches to' });
    await act(async () => saveDestination().props.onChange({ target: { value: 'wishlist' } }));
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('4006381333931');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(saveDestination().props.value).toBe('wishlist');

    const catalogOptions = button('Search options, Catalog number, Discogs');
    expect(catalogOptions.props['aria-expanded']).toBe(false);
    await act(async () => catalogOptions.props.onClick());
    await act(async () => button('Barcode').props.onClick());
    expect(renderer.root.findByType(BarcodeScanner).props.viewMode).toBe('wishlist');
    expect(renderer.root.findByProps({ id: 'manual-barcode' }).props.value).toBe('4006381333931');
    await act(async () => button('Back to search').props.onClick());

    expect(renderer.root.findAllByType(BarcodeScanner)).toHaveLength(0);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('4006381333931');
    expect(saveDestination().props.value).toBe('wishlist');
    expect(searchCatalogNumber).toHaveBeenCalledTimes(1);
    await act(async () => button('Name').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    expect(saveDestination().props.value).toBe('wishlist');
  });

  it('offers barcode lookup on a catalog-number miss without copying an invalid check digit', async () => {
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('4006381333932');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(JSON.stringify(renderer.toJSON())).toContain('For digits below the bars, use barcode lookup.');
    await act(async () => button('Look up a barcode').props.onClick());
    const barcodeField = renderer.root.findByProps({ id: 'manual-barcode' });
    expect(barcodeField.props.value).toBe('');
    expect(barcodeField.props['aria-describedby']).toBe('barcode-entry-hint');
    expect(renderer.root.findByProps({ id: 'barcode-entry-hint' }).children.join('')).toContain('Your previous query wasn’t recognized as a barcode.');
    await act(async () => button('Back to search').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('4006381333932');
    expect(searchCatalogNumber).toHaveBeenCalledTimes(1);
  });

  it('hands off a non-barcode label clue to the catalog number field without starting a lookup', async () => {
    await renderLibrary();
    await act(async () => button('Barcode').props.onClick());
    const dialog = renderer.root.findByType(BarcodeScanner);
    await act(async () => dialog.findByProps({ id: 'manual-barcode' }).props.onChange({ target: { value: 'ABC-123' } }));
    await act(async () => dialog.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    await act(async () => button('Look up a catalog number').props.onClick());

    expect(renderer.root.findAllByType(BarcodeScanner)).toHaveLength(0);
    expect(button('Search options, Catalog number, Discogs')).toBeDefined();
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    expect(searchCatalogNumber).not.toHaveBeenCalled();
  });

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
    const wishlist = Promise.withResolvers<{ albums: Album[] }>();
    getAlbums.mockReturnValueOnce(collection.promise)
      .mockReturnValueOnce(wishlist.promise)
      .mockResolvedValueOnce({ albums: [saved] });
    await renderLibrary();
    const countStatus = () => renderer.root.findByType('header').findByProps({ role: 'status' });
    expect(countStatus().children).toEqual(['Loading Collection…']);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.disabled).toBeUndefined();

    await act(async () => button('Wishlist').props.onClick());
    expect(getAlbums.mock.calls[0][1].aborted).toBe(true);
    expect(countStatus().children).toEqual(['Loading Wishlist…']);
    expect(JSON.stringify(renderer.toJSON()).match(/Loading Wishlist…/g)).toHaveLength(1);
    await act(async () => wishlist.reject(new Error('Offline')));
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

    expect(renderer.root.findAllByType('button').filter(node => node.children.join('') === 'Search catalogs too')).toHaveLength(1);
    await act(async () => button('Search catalogs too').props.onClick());
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'aria-label': 'Save new matches to' })).toHaveLength(0);
    expect(button('Wishlist')).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    await act(async () => discovery.resolve({ local: [], discogs: [catalog] }));
    const saveDefault = renderer.root.findByProps({ 'aria-label': 'Save new matches to' });
    expect(saveDefault.props.value).toBe('collection');
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeDefined();
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeUndefined();
    await act(async () => saveDefault.props.onChange({ target: { value: 'wishlist' } }));
    expect(button('Add to Wishlist · Giant Steps by John Coltrane')).toBeDefined();
    expect(saveDefault.props.value).toBe('wishlist');
    await chooseScope('saved');
    await act(async () => button('Search catalogs too').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.value).toBe('wishlist');

    await act(async () => button('Back to Collection').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    await act(async () => button('Wishlist').props.onClick());
    await editSearch('Coltrane');
    await act(async () => button('Back to Wishlist').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    const status = renderer.root.findByType('header').findByProps({ role: 'status' });
    expect(status.findByType('span').children.map(child => typeof child === 'string' ? child : child.children.join('')).join(''))
      .toBe('1 album in Wishlist');
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

  it('keeps online results and the chosen destination when searched shelves change', async () => {
    search.mockImplementation(async (_query, _signal, scope) => scope === 'catalog'
      ? { local: [], discogs: [catalog] } : { local: [saved], discogs: [] });
    await renderLibrary();
    await chooseScope('wishlist');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Search catalogs too').props.onClick());
    const saveDestination = () => renderer.root.findByProps({ 'aria-label': 'Save new matches to' });
    await act(async () => saveDestination().props.onChange({ target: { value: 'wishlist' } }));
    search.mockClear();

    await chooseScope('collection');
    expect(search).toHaveBeenCalledExactlyOnceWith('Coltrane', expect.any(AbortSignal), 'saved', 'collection', 0, 'title');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(saveDestination().props.value).toBe('wishlist');

    await act(async () => button('Search catalogs too').props.onClick());
    expect(button('Search catalogs too').props['aria-pressed']).toBe(false);
    await act(async () => renderer.unmount());
    await renderLibrary();

    await act(async () => button('Search catalogs too').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('collection');
    expect(saveDestination().props.value).toBe('wishlist');
  });

  it('labels approximate saved rows and counts literal title, artist, or combined matches as direct', async () => {
    const fiddler = { ...saved, id: 4, artist_name: '101 Strings', title: 'Fiddler On The Roof' };
    const fuzzy = { ...saved, id: 5, artist_name: 'Neil Diamond', title: 'Stones', match_kind: 'approximate' as const };
    search.mockImplementation(async query => query === 'roof'
      ? { local: [fiddler, fuzzy], discogs: [], nextOffset: 20 }
      : { local: query === 'Suntones' ? [fuzzy] : [fiddler], discogs: [] });
    await renderLibrary();
    const savedStatus = () => renderer.root.findByProps({ 'aria-labelledby': 'saved-results-title' })
      .findAllByProps({ role: 'status' })[0].children.join('');
    for (const query of ['Fiddler', 'Strings', 'strings fiddler']) {
      await editSearch(query);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(savedStatus()).toBe('1 saved match.');
      expect(renderer.root.findAllByProps({ id: 'saved-result-match-4' })).toHaveLength(0);
    }

    await editSearch('Suntones');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(savedStatus()).toBe('0 direct matches · 1 approximate match.');
    expect(renderer.root.findByProps({ id: 'saved-result-match-5' }).children.join('')).toBe('Approximate match');
    expect(renderer.root.findByProps({ id: 'saved-result-5' }).props['aria-describedby']).toBe('saved-result-match-5');
    expect(button('Open Stones by Neil Diamond, Wishlist, saved record 5').props['aria-describedby']).toBe('saved-result-match-5');

    await editSearch('roof');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(savedStatus()).toBe('1 direct match · 1 approximate match. More available.');
  });

  it('widens an empty scoped search once and resumes without changing its shelf or save destination', async () => {
    const discovery = Promise.withResolvers<SearchResult>();
    search.mockImplementation((_query, _signal, scope) => scope === 'catalog' ? discovery.promise : Promise.resolve({ local: [], discogs: [] }));
    await renderLibrary();
    await chooseScope('wishlist');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(JSON.stringify(renderer.toJSON())).toContain('No saved albums match');
    expect(renderer.root.findAllByType('button').filter(node => node.children.join('') === 'Search catalogs too')).toHaveLength(1);

    await act(async () => button('Search catalogs too').props.onClick());
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('Coltrane', expect.any(AbortSignal), 'catalog', undefined, 0, 'title');
    expect(JSON.stringify(renderer.toJSON())).toContain('No saved albums match');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    const statuses = renderer.root.findAllByProps({ role: 'status' });
    expect(statuses.filter(node => node.children.join('') === 'Searching online catalogs…')).toHaveLength(1);
    await act(async () => discovery.resolve({ local: [], discogs: [catalog] }));
    expect(renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.value).toBe('collection');
    expect(readSearchSession()?.drafts.name).toMatchObject({ query: 'Coltrane', scope: 'wishlist-catalog', destination: 'collection' });

    await act(async () => renderer.unmount());
    search.mockClear();
    await renderLibrary();
    expect(search).toHaveBeenCalledWith('Coltrane', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
    expect(search).toHaveBeenCalledWith('Coltrane', expect.any(AbortSignal), 'catalog', undefined, 0, 'title');
    expect(button('Search options, Name search, Wishlist and online catalogs')).toBeDefined();
    expect(renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.value).toBe('collection');
  });

  it('keeps an in-flight catalog save tied to the item’s chosen shelf', async () => {
    const add = Promise.withResolvers<{ album: Album }>();
    search.mockResolvedValue({ local: [], discogs: [catalog] });
    addAlbum.mockReturnValueOnce(add.promise);
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    const destination = renderer.root.findByProps({ 'aria-label': 'Save new matches to' });
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
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.onChange({ target: { value: 'wishlist' } }));
    await act(async () => button('Add to Wishlist · Giant Steps by John Coltrane').props.onClick());

    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => add.resolve({ album: added }));
    expect(search.mock.calls[3][1].aborted).toBe(true);
    expect(search.mock.calls[5][0]).toBe('Coltrane');

    await act(async () => staleSearch.resolve(match));
    expect(button('Open Giant Steps by John Coltrane, Wishlist, saved record 2')).toBeDefined();
    expect(button('Compare with saved album · Giant Steps by John Coltrane')).toBeDefined();
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeUndefined();
  });

  it('moves a wishlist result by its saved ID and updates catalog and saved results together', async () => {
    const moving = Promise.withResolvers<{ undoToken: string; expiresAt: string }>();
    const album = { ...saved, id: 42, title: 'Giant Steps' };
    search.mockResolvedValue({
      local: [album],
      discogs: [{ ...catalog, inWishlist: true, existingAlbumId: album.id, existingMatch: 'release' }],
    });
    updateStatus.mockReturnValueOnce(moving.promise);
    undoAlbumMove.mockResolvedValue({ album });
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
    await act(async () => moving.resolve({ undoToken: 'move-42', expiresAt: new Date(Date.now() + 600_000).toISOString() }));

    expect(moveButtons()).toHaveLength(0);
    expect(button('Open Giant Steps by John Coltrane, Collection, saved record 42')).toBeDefined();
    expect(renderer.root.findByProps({ className: 'rh-saved-outcome' }).children.join('')).toBe('This pressing saved in Collection');
    expect(getAlbums).toHaveBeenCalledTimes(2);

    await act(async () => button('Undo move · Giant Steps').props.onClick());
    expect(undoAlbumMove).toHaveBeenCalledExactlyOnceWith(album.id, 'move-42');
    expect(moveButtons()).toHaveLength(2);
    expect(button('Undo move · Giant Steps')).toBeUndefined();
  });

  it('uses the guarded notes-aware removal confirmation directly from Collection details', async () => {
    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'collection' ? [{ ...saved, status: shelf }] : [] }));
    deleteAlbum.mockRejectedValueOnce(Object.assign(new Error('Changed shelf'), { status: 409 }));
    await renderLibrary();
    expect(button('Move to Wishlist — Blue Train')).toBeDefined();
    await act(async () => button('Open Blue Train by John Coltrane, Collection, saved record 1').props.onClick({ currentTarget: { isConnected: true } }));
    const details = renderer.root.findByProps({ labelledBy: 'album-details-title' });
    await act(async () => details.findByProps({ 'aria-label': 'Remove from Collection — Blue Train' }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('and its notes will leave');
    expect(JSON.stringify(renderer.toJSON())).toContain('in this browser for 10 minutes');
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

  it('starts catalog search on an empty shelf and carries an ambiguous query as a manual reference', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await act(async () => button('Find a record to add').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    await editSearch('Unknown Artist Unlisted record');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add album manually').props.onClick());
    expect(renderer.root.findByProps({ value: 'Unknown Artist Unlisted record', maxLength: 255 })).toBeDefined();
    expect(renderer.root.findByProps({ name: 'album' }).props.value).toBe('');
    expect(renderer.root.findByProps({ name: 'artist' }).props.value).toBe('');
    expect(button('Add to Collection')).toBeDefined();
    await act(async () => button('Cancel').props.onClick());
    await editSearch('Unknown Artist — Unlisted record');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add album manually').props.onClick());
    expect(renderer.root.findByProps({ name: 'album' }).props.value).toBe('Unlisted record');
    expect(renderer.root.findByProps({ name: 'artist' }).props.value).toBe('Unknown Artist');
  });

  it('keeps removal undo available and restores the same saved record after a delay', async () => {
    const record = { ...saved, status: 'collection' as const, discogs_id: 22, notes: 'First pressing notes' };
    let present = true;
    getAlbums.mockImplementation(async () => ({ albums: present ? [record] : [] }));
    deleteAlbum.mockImplementation(async () => {
      present = false;
      return { message: 'Album removed', undoToken: 'undo-removal', expiresAt: new Date(Date.now() + 600_000).toISOString() };
    });
    undoAlbumRemoval.mockImplementation(async () => {
      present = true;
      return { album: record };
    });
    await renderLibrary();
    await act(async () => button('Open Blue Train by John Coltrane, Collection, Discogs release 22').props.onClick({ currentTarget: {} }));
    await act(async () => button('Remove from Collection — Blue Train').props.onClick());
    await act(async () => button('Remove album').props.onClick());
    expect(button('Open Blue Train by John Coltrane, Collection, Discogs release 22')).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    const notice = renderer.root.findByProps({ 'aria-label': 'Library change recovery' });
    expect(notice.findAllByType('p').some(node =>
      node.children.filter(child => typeof child === 'string').join('').includes('removed from Collection')
    )).toBe(true);
    await act(async () => button('Undo removal').props.onClick());
    expect(undoAlbumRemoval).toHaveBeenCalledExactlyOnceWith(record.id, 'undo-removal');
    expect(notice.findAllByProps({ role: 'status' }).some(node =>
      node.children.join('') === '“Blue Train” restored to Collection.'
    )).toBe(true);
    expect(button('Open Blue Train by John Coltrane, Collection, Discogs release 22')).toBeDefined();
  });

  it('opens both search sources from Add without retyping and keeps that scope when clearing the query', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await chooseScope('wishlist');
    await editSearch('Blue Train');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenCalledExactlyOnceWith('Blue Train', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onSearchClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Blue Train');
    expect(search).toHaveBeenCalledWith('Blue Train', expect.any(AbortSignal), 'saved', undefined, 0, 'title');
    expect(search).toHaveBeenLastCalledWith('Blue Train', expect.any(AbortSignal), 'catalog', undefined, 0, 'title');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(button('Return to Collection')).toBeDefined();

    await act(async () => button('Clear search').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(renderer.root.findByProps({ htmlFor: 'search-scope' }).children.join('')).toBe('Search shelves');
    expect(renderer.root.findAllByProps({ href: '#catalog-results-title' })).toHaveLength(0);

    await act(async () => button('Return to Collection').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('wishlist');
    expect(button('Return to Collection')).toBeUndefined();
  });

  it('can return from an initially blank Add search and focus the active shelf', async () => {
    const focusSearch = vi.fn();
    const focusWishlist = vi.fn();
    await act(async () => {
      renderer = create(createElement(App), { createNodeMock: element => {
        if (element.props.id === 'album-search') return { focus: focusSearch };
        if (element.type === 'button' && element.props.children === 'Wishlist') return { focus: focusWishlist };
        return null;
      } });
    });
    await act(async () => button('Wishlist').props.onClick());
    await chooseScope('collection');
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onSearchClick());
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });

    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
    expect(focusSearch).toHaveBeenCalledOnce();
    expect(search).not.toHaveBeenCalled();
    expect(button('Clear search')).toBeUndefined();
    await act(async () => button('Return to Wishlist').props.onClick());
    await act(async () => { await vi.advanceTimersByTimeAsync(16); });

    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('collection');
    expect(button('Return to Wishlist')).toBeUndefined();
    expect(focusWishlist).toHaveBeenCalledOnce();
  });

  it('keeps the Add return point across temporary scope and search method changes', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await chooseScope('wishlist');
    await editSearch('Blue Train');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onSearchClick());

    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Blue Train');
    expect(button('Return to Collection')).toBeDefined();
    await act(async () => button('Catalog number').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('ABC-123');
    expect(button('Return to Collection')).toBeDefined();
    expect(searchCatalogNumber).toHaveBeenCalledOnce();
    await act(async () => button('Name').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Blue Train');
    expect(button('Return to Collection')).toBeDefined();

    await chooseScope('collection');
    await act(async () => button('Clear search').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('collection');
    expect(button('Return to Collection')).toBeDefined();
    await act(async () => button('Return to Collection').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('wishlist');
    expect(button('Return to Collection')).toBeUndefined();
    await act(async () => button('Catalog number').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('ABC-123');
  });

  it('returns from a blank Add number search to its opening shelf even after browsing elsewhere', async () => {
    const focusWishlist = vi.fn();
    await act(async () => {
      renderer = create(createElement(App), { createNodeMock: element => {
        if (element.type === 'button' && element.props.children === 'Wishlist') return { focus: focusWishlist };
        return null;
      } });
    });
    await act(async () => button('Wishlist').props.onClick());
    await chooseScope('collection');
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onCatalogNumberClick());
    await act(async () => button('Collection').props.onClick());
    expect(button('Return to Wishlist')).toBeDefined();
    expect(button('Catalog number').props['aria-pressed']).toBe(true);

    await act(async () => button('Return to Wishlist').props.onClick());
    expect(button('Wishlist').props['aria-pressed']).toBe(true);
    expect(focusWishlist).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('collection');
    expect(button('Return to Wishlist')).toBeUndefined();
  });

  it('continues a catalog-number miss in online name search while keeping the name draft', async () => {
    search.mockResolvedValue({ local: [], discogs: [] });
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [] });
    await renderLibrary();
    await editSearch('Blue Train');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('ABC-404');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Search by name').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Blue Train');
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(search).toHaveBeenLastCalledWith('Blue Train', expect.any(AbortSignal), 'catalog', undefined, 0, 'title');
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
    expect(renderer.root.findByProps({ name: 'artist' }).props.value).toBe('John Coltrane');
    expect(renderer.root.findByProps({ name: 'album' }).props.value).toBe('Alternate Album');
    expect(button('Add to Wishlist')).toBeDefined();
    await act(async () => button('Cancel').props.onClick());
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onManualClick());
    expect(renderer.root.findByProps({ name: 'artist' }).props.value).toBe('John Coltrane');
    expect(renderer.root.findByProps({ name: 'album' }).props.value).toBe('Alternate Album');
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
    await act(async () => button('Compare with saved album · Giant Steps by John Coltrane').props.onClick());
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
    await act(async () => button('Compare with saved album · Giant Steps by John Coltrane').props.onClick());
    await act(async () => renderer.root.findByType(PressingComparison)
      .findByProps({ 'aria-label': 'Open saved album · Giant Steps by John Coltrane, Wishlist, saved record 1' })
      .props.onClick({ currentTarget: { isConnected: true } }));
    expect(JSON.stringify(renderer.toJSON())).toContain('is no longer saved.');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Retry opening saved copy');
    await act(async () => button('Close pressing review').props.onClick());
    expect(button('Add to Collection · Giant Steps by John Coltrane')).toBeDefined();
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Giant Steps');
  });

  it('offers Undo inside the open saved details and updates both shelf labels after reversing', async () => {
    const copy = { ...saved, title: catalog.album, discogs_id: 2219 };
    search.mockResolvedValue({ local: [], discogs: [{ ...catalog, inWishlist: true,
      existingMatch: 'title', existingAlbumId: copy.id, titleMatches: [copy] }] });
    getAlbum.mockResolvedValueOnce({ album: copy });
    updateStatus.mockResolvedValue({ undoToken: 'undo-shelf-move', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    undoAlbumMove.mockResolvedValue({ album: copy });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Compare with saved album · Giant Steps by John Coltrane').props.onClick());
    await act(async () => button('Open saved album · Giant Steps by John Coltrane, Wishlist, Discogs release 2219')
      .props.onClick({ currentTarget: { isConnected: true } }));
    const detail = renderer.root.findByProps({ labelledBy: 'album-details-title' });
    await act(async () => detail.findByProps({ 'aria-label': 'Move to Collection — Giant Steps' })
      .props.onClick({ currentTarget: { ownerDocument: {} } }));
    const undo = detail.findAllByType('button').find(node => node.children.includes('Undo move'))!;
    await act(async () => undo.props.onClick());
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(copy.id, 'collection', 'wishlist');
    expect(undoAlbumMove).toHaveBeenCalledExactlyOnceWith(copy.id, 'undo-shelf-move');
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

  it('paginates all fetched editions for an exact number and saves only the chosen pressing', async () => {
    const choices = Array.from({ length: 9 }, (_, index) => {
      const id = 101 + index;
      return { ...catalog, id, discogsId: id, discogsListing: 'release' as const, ...(index > 0 && { year: 2020 }),
        catalogNumberMatch: 'exact' as const, pressing: { catalogNumber: 'ABC-123', format: 'Vinyl' } };
    });
    searchCatalogNumber.mockResolvedValue({ local: [], catalogSampled: true,
      discogs: [{ ...choices[0], pressingChoices: choices, pressingSampled: true }] });
    addAlbum.mockResolvedValue({ album: { ...saved, title: catalog.album, status: 'collection', discogs_id: 109 } });
    await renderLibrary();
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onCatalogNumberClick());
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).not.toHaveBeenCalled();
    expect(searchCatalogNumber).toHaveBeenCalledExactlyOnceWith('ABC-123', expect.any(AbortSignal), 0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Discogs lists this catalog number');

    expect(button('Save album only to Collection · Giant Steps by John Coltrane, Discogs release 101').children.join(''))
      .toBe('Save album only to Collection');
    await act(async () => button('Review pressing · Giant Steps by John Coltrane, Discogs release 101')
      .props.onClick({ currentTarget: { closest: () => null } }));
    const picker = renderer.root.findByType(CatalogPressingPicker);
    expect(addAlbum).not.toHaveBeenCalled();
    const radioIds = () => picker.findAllByType('input').map(radio => radio.props.value);
    expect(radioIds()).toEqual([101, 102, 103]);
    const link = picker.findAllByType('a').find(node => node.props.href.startsWith('https://www.discogs.com/search/'))!;
    expect(new URL(link.props.href).searchParams.get('q')).toBe('John Coltrane Giant Steps ABC-123');
    await act(async () => button('More pressings').props.onClick());
    expect(radioIds()).toEqual([104, 105, 106]);
    await act(async () => button('More pressings').props.onClick());
    expect(radioIds()).toEqual([107, 108, 109]);
    expect(picker.findAllByType('input').every(radio => !radio.props.checked)).toBe(true);
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => picker.findByProps({ value: 109 }).props.onChange());
    expect(JSON.stringify(renderer.toJSON())).toContain('Only part of the Discogs results are shown.');
    await act(async () => picker.findByType('form').props.onSubmit({ preventDefault: () => {} }));
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discogsId: 109, status: 'collection' }));
    expect(addAlbum.mock.lastCall?.[0].year).toBeUndefined();
  });

  it('puts the catalog number source, counts, and saved-release evidence before catalog cards', async () => {
    const exact = { ...catalog, album: saved.title, discogsListing: 'release' as const, catalogNumberMatch: 'exact' as const,
      inWishlist: true, existingAlbumId: saved.id, existingMatch: 'release' as const };
    const other = { ...catalog, album: 'Alternate album', id: 102, discogsId: 102, discogsListing: 'release' as const,
      inCollection: true, existingAlbumId: 2, existingMatch: 'title' as const,
      titleMatches: [{ ...saved, id: 2, title: 'Alternate album', status: 'collection' as const }],
      catalogNumberMatch: 'unverified' as const };
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [exact, other], catalogSampled: true });
    await renderLibrary();
    await act(async () => button('Catalog number').props.onClick());
    expect(button('Look up in Discogs')).toBeDefined();
    expect(renderer.root.findByProps({ id: 'number-lookup-source' }).children.join('')).toContain('Discogs');
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    const shelfMatches = renderer.root.findByProps({ 'aria-labelledby': 'number-saved-results-title' });
    expect(shelfMatches.findAllByType('li')).toHaveLength(2);
    const annotations = shelfMatches.findAllByType('p').map(paragraph => paragraph.children.join(''));
    expect(annotations).toContain('Discogs lists this number for your saved release.');
    expect(annotations).toContain('Same album on your shelf. Its pressing is unconfirmed.');
    const catalogHeader = renderer.root.findByProps({ className: 'rh-catalog-bar rh-catalog-bar-sticky' });
    expect(catalogHeader.findByProps({ role: 'status' }).children.join('')).toContain('2 matches. Discogs returned a partial list.');
    expect(JSON.stringify(renderer.toJSON())).toContain('Catalog number unverified');
  });

  it('can save an unconfirmed album straight from the pressing review', async () => {
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [{ ...catalog, discogsListing: 'release', masterId: 60,
      year: 2019, pressing: { catalogNumber: 'ABC-123' }, catalogNumberMatch: 'exact' }] });
    addAlbum.mockResolvedValue({ album: { ...saved, title: catalog.album, status: 'collection' } });
    await renderLibrary();
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Review pressing · Giant Steps by John Coltrane, 2019, Discogs release 101')
      .props.onClick({ currentTarget: { closest: () => null } }));
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => button('Save without pressing to Collection').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'collection', applyCatalogReference: true, catalogListing: { source: 'discogs', kind: 'master', id: 60 },
    }));
    expect(addAlbum.mock.lastCall?.[0].discogsId).toBeUndefined();
    expect(addAlbum.mock.lastCall?.[0].year).toBeUndefined();
  });

  it('restores each lookup method with its own query, results and scope', async () => {
    search.mockImplementation(async (_query, _signal, kind) => kind === 'saved'
      ? { local: [saved], discogs: [] }
      : { local: [], discogs: [catalog] });
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [{ ...catalog, discogsListing: 'release', pressing: { catalogNumber: 'ABC-123' } }] });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Coltrane');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Catalog number').props.onClick());
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    await act(async () => button('Name').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Coltrane');
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
    expect(button('Search catalogs too').props['aria-pressed']).toBe(true);
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(search).toHaveBeenCalledTimes(2);

    await act(async () => button('Catalog number').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('ABC-123');
    expect(JSON.stringify(renderer.toJSON())).toContain('ABC-123');
    expect(searchCatalogNumber).toHaveBeenCalledTimes(1);
  });

  it('requeries an interrupted Add lookup and returns to the matching record without a selected pressing', async () => {
    const release = { ...catalog, discogsListing: 'release' as const, catalogNumberMatch: 'exact' as const,
      pressing: { catalogNumber: 'ABC-123' } };
    const updatedRelease = { ...release, id: 105, discogsId: 105 };
    search.mockResolvedValue({ local: [], discogs: [] });
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [release] });
    await renderLibrary();
    await act(async () => button('Wishlist').props.onClick());
    await chooseScope('collection');
    await editSearch('Blue Train');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onCatalogNumberClick());
    await editSearch('ABC-123');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.onChange({ target: { value: 'collection' } }));

    const result = renderer.root.findByProps({ 'data-lookup-result': 'catalog' });
    const target = result.props['data-lookup-target'];
    const opener = {
      closest: () => ({ dataset: { lookupResult: 'catalog', lookupTarget: target }, querySelector: () => null }),
    };
    await act(async () => {
      renderer.root.findByType('main').props.onClickCapture({ target: opener });
      button('Review pressing · Giant Steps by John Coltrane, Discogs release 101').props.onClick({ currentTarget: opener });
    });
    await act(async () => renderer.root.findByProps({ type: 'radio', value: 101 }).props.onChange());
    expect(readSearchSession()).toEqual({ mode: 'catalog-number', shelf: 'wishlist',
      addOrigin: { shelf: 'wishlist', scope: 'collection', destination: 'collection' },
      drafts: { name: { scope: 'collection', query: 'Blue Train', destination: 'collection' },
        'catalog-number': { scope: 'catalog-number', query: 'ABC-123', destination: 'collection' } },
      anchor: { kind: 'catalog', target, throughOffset: 0 } });
    const storage = sessionStorage.getItem('side-a:search-session:v1')!;
    expect(storage).not.toMatch(/pressing|result[s]?":|Discogs release|101/);

    await act(async () => renderer.unmount());
    const focusResult = vi.fn();
    const body = {};
    const doc = { body, activeElement: body, getElementById: vi.fn(() => ({ focus: focusResult })) };
    searchCatalogNumber.mockClear();
    searchCatalogNumber.mockResolvedValue({ local: [], discogs: [updatedRelease] });
    await act(async () => {
      renderer = create(createElement(StrictMode, null, createElement(App)), { createNodeMock: element =>
        element.props.id === 'album-search' ? { ownerDocument: doc, focus: vi.fn() } : null });
    });
    expect(searchCatalogNumber).toHaveBeenCalledExactlyOnceWith('ABC-123', expect.any(AbortSignal), 0);
    expect(doc.getElementById).toHaveBeenCalledExactlyOnceWith(target);
    expect(focusResult).toHaveBeenCalledOnce();
    expect(button('Return to Wishlist')).toBeDefined();
    expect(renderer.root.findAllByType(CatalogPressingPicker)).toHaveLength(0);
    expect(button('Review pressing · Giant Steps by John Coltrane, Discogs release 101')).toBeUndefined();
    expect(renderer.root.findByProps({ 'aria-label': 'Save new matches to' }).props.value).toBe('collection');
    await act(async () => button('Review pressing · Giant Steps by John Coltrane, Discogs release 105')
      .props.onClick({ currentTarget: opener }));
    expect(renderer.root.findByProps({ type: 'radio', value: 105 }).props.checked).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => button('Close pressing review').props.onClick());
    search.mockClear();
    await act(async () => button('Name').props.onClick());
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Blue Train');
    expect(search).toHaveBeenCalledExactlyOnceWith('Blue Train', expect.any(AbortSignal), 'saved', 'collection', 0, 'title');
  });

  it('rebuilds the previously viewed saved pages when resuming a later result', async () => {
    const later = { ...saved, id: 2, title: 'Blue World' };
    writeSearchSession({ mode: 'name', shelf: 'wishlist',
      drafts: { name: { query: 'Blue', scope: 'wishlist', destination: 'wishlist' } },
      anchor: { kind: 'saved', target: 'saved-result-2', throughOffset: 20 } });
    search.mockResolvedValueOnce({ local: [saved], discogs: [], nextOffset: 20 })
      .mockResolvedValueOnce({ local: [later], discogs: [] });

    await renderLibrary();
    expect(search.mock.calls.map(([query, , kind, shelf, offset]) => [query, kind, shelf, offset]))
      .toEqual([['Blue', 'saved', 'wishlist', 0], ['Blue', 'saved', 'wishlist', 20]]);
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(button('Open Blue World by John Coltrane, Wishlist, saved record 2')).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('Search resumed at your last result.');
  });

  it('continues with a fresh search when the recorded album is missing from the results', async () => {
    writeSearchSession({ mode: 'name', shelf: 'collection',
      drafts: { name: { query: 'Blue Train', scope: 'saved', destination: 'collection' } },
      anchor: { kind: 'saved', target: 'saved-result-11', throughOffset: 0 } });
    search.mockResolvedValue({ local: [saved], discogs: [] });

    await renderLibrary();
    expect(search).toHaveBeenCalledOnce();
    expect(button('Open Blue Train by John Coltrane, Wishlist, saved record 1')).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Search resumed at your last result.');
  });

  it('keeps search and Add return usable with malformed or unavailable browser storage', async () => {
    sessionStorage.setItem('side-a:search-session:v1', '{damaged');
    await renderLibrary();
    expect(search).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());

    const denied = () => { throw new Error('Storage unavailable'); };
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied });
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied });
    search.mockResolvedValue({ local: [saved], discogs: [] });
    await renderLibrary();
    await act(async () => button('Add Album').props.onClick());
    await act(async () => renderer.root.findByType(AddMenu).props.onSearchClick());
    await chooseScope('wishlist');
    await editSearch('Blue Train');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(search).toHaveBeenNthCalledWith(1, 'Blue Train', expect.any(AbortSignal), 'saved', 'wishlist', 0, 'title');
    expect(search).toHaveBeenNthCalledWith(2, 'Blue Train', expect.any(AbortSignal), 'catalog', undefined, 0, 'title');
    await act(async () => button('Return to Collection').props.onClick());
    expect(renderer.root.findByProps({ id: 'search-scope' }).props.value).toBe('saved');
  });

  it('opens a saved-album review with matching pressings and returns to the same album', async () => {
    getAlbums.mockResolvedValue({ albums: [saved] });
    search.mockResolvedValue({ local: [], discogs: [
      { ...catalog, album: saved.title, discogsListing: 'release', pressing: { catalogNumber: 'BLP 1577' } },
      { ...catalog, id: 104, discogsId: 104, discogsListing: 'release' },
    ] });
    await renderLibrary();
    await act(async () => button('Open Blue Train by John Coltrane, Wishlist, saved record 1').props.onClick({ currentTarget: {} }));
    await act(async () => button('Review pressings').props.onClick({ currentTarget: {} }));

    const review = renderer.root.findByType(PressingComparison);
    expect(review.props.lookupChoices.map((choice: { releaseId: number }) => choice.releaseId)).toEqual([101]);
    expect(review.props.matches).toEqual([saved]);
    expect(search).toHaveBeenCalledExactlyOnceWith('John Coltrane Blue Train', expect.any(AbortSignal), 'catalog', undefined, 0);

    await act(async () => button('Leave pressing unconfirmed').props.onClick());
    expect(renderer.root.findAllByType(PressingComparison)).toHaveLength(0);
    expect(renderer.root.findByType(AlbumDetailModal).props.album.id).toBe(saved.id);
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('');
  });

  it('saves a catalog match as an album unless the collector chose a pressing', async () => {
    search.mockImplementation(async (_query, _signal, kind) => ({ local: [], discogs: kind === 'catalog'
      ? [{ ...catalog, discogsListing: 'release', masterId: 60, year: 2019 }] : [] }));
    const added = { ...saved, id: 54, title: catalog.album, status: 'collection' as const };
    addAlbum.mockResolvedValue({ album: added, undoToken: 'addition-54', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    undoAlbumAddition.mockResolvedValue({ album: added });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const label = 'Giant Steps by John Coltrane, 2019, Discogs release 101';
    expect(button(`Review pressing · ${label}`).props['data-catalog-primary']).toBe(true);
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => button('Save album only to Collection · Giant Steps by John Coltrane, 2019, Discogs release 101').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'collection', catalogListing: { source: 'discogs', kind: 'master', id: 60 }, allowUndo: true,
    }));
    expect(addAlbum.mock.lastCall?.[0].discogsId).toBeUndefined();
    expect(addAlbum.mock.lastCall?.[0].year).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('side-a-library-undo:addition:54:addition-54') ?? 'null'))
      .toMatchObject({ id: 54, status: 'collection' });
    const undo = button(`Undo adding ${label} to Collection`);
    expect(undo).toBeDefined();
    await act(async () => undo.props.onClick({ currentTarget: { closest: () => null } }));
    expect(undoAlbumAddition).toHaveBeenCalledExactlyOnceWith(54, 'addition-54');
    expect(button(`Undo adding ${label} to Collection`)).toBeUndefined();
    expect(button(`Review pressing · ${label}`)).toBeDefined();
    expect(renderer.root.findByProps({ id: 'album-search' }).props.value).toBe('Giant Steps');
  });

  it('keeps the saved result and comparison open after confirming an alternate pressing', async () => {
    const copy = { ...saved, title: catalog.album, notes: 'Keep these notes' };
    const first = { ...catalog, discogsListing: 'release' as const, pressing: { catalogNumber: '100', format: 'Vinyl' } };
    const alternate = { ...first, id: 102, discogsId: 102, pressing: { catalogNumber: '102', format: 'Vinyl' } };
    search.mockImplementation(async (_query, _signal, kind) => kind === 'saved'
      ? { local: [copy], discogs: [], nextOffset: 20 }
      : { local: [], discogs: [{ ...first, pressingChoices: [first, alternate], inWishlist: true, existingMatch: 'title', titleMatches: [copy] }] });
    updatePressing.mockResolvedValue({ album: { ...copy, discogs_id: 102 }, undoToken: 'undo-pressing-102' });
    await renderLibrary();
    await chooseScope('catalog');
    await editSearch('Giant Steps');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => button('Compare with saved album · Giant Steps by John Coltrane, Discogs release 101').props.onClick());
    const dialog = renderer.root.findByType(PressingComparison);
    await act(async () => dialog.findByProps({ type: 'radio', value: 102 }).props.onChange());
    await act(async () => button('Use this pressing').props.onClick());
    expect(updatePressing).not.toHaveBeenCalled();
    await act(async () => button('Confirm pressing').props.onClick());
    expect(updatePressing).toHaveBeenCalledExactlyOnceWith(copy.id, 102, null);
    expect(JSON.stringify(renderer.toJSON())).toContain('Pressing updated. ');
    expect(button('Open Giant Steps by John Coltrane, Wishlist, Discogs release 102')).toBeDefined();
    expect(button('Load more saved albums')).toBeDefined();
    expect(search).toHaveBeenCalledTimes(2);
  });
});
