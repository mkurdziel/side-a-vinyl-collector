import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { importDiscogsCollection, addAlbum, getAlbums } = vi.hoisted(() => ({
  importDiscogsCollection: vi.fn(),
  addAlbum: vi.fn(),
  getAlbums: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { importDiscogsCollection, addAlbum, getAlbums },
}));

import { DiscogsImporter } from '../src/components/DiscogsImporter';
import { AddMenu } from '../src/components/AddMenu';
import { ApiError } from '../src/services/api';

const albums = [
  { id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy' },
  { id: 2, discogsId: 2, artist: 'Portishead', album: 'Third' },
  { id: 3, discogsId: 3, artist: 'Portishead', album: 'Roseland NYC Live' },
];
const importerProps = { open: true, onOpen: vi.fn(), onClose: vi.fn(), onSuccess: vi.fn(), onImportingChange: vi.fn(), viewMode: 'collection' as const };
let renderer: ReturnType<typeof create>;

function findButton(label: string) {
  const button = renderer.root.findAllByType('button').find(node =>
    (node.props['aria-label'] ?? node.children.join('')) === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

const content = () => renderer.root.findAllByType('p').map(node => node.children.join('')).join('\n');

async function loadCollection() {
  await act(async () => {
    renderer = create(createElement(DiscogsImporter, importerProps));
  });
  await act(async () => findButton('Load Discogs collection').props.onClick());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const session = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  });
  vi.resetAllMocks();
  importDiscogsCollection.mockResolvedValue({ albums, count: albums.length, page: 1, totalPages: 1 });
  addAlbum.mockResolvedValue({});
  getAlbums.mockResolvedValue({ albums: [] });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe('Discogs import', () => {
  it('retains per-record outcomes when reopened and retries only failures to their original shelf', async () => {
    addAlbum.mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError('Album already in collection/wishlist', 409))
      .mockRejectedValueOnce(new ApiError('Service unavailable', 503));
    await loadCollection();
    await act(async () => findButton('Select all (3)').props.onClick());
    await act(async () => findButton('Import 3 records to Collection').props.onClick());

    expect(content()).toContain('1 imported to Collection · 1 already in your library · 1 failed to import to Collection');
    expect(content()).toContain('Imported to Collection');
    expect(content()).toContain('Import to Collection failed');
    expect(findButton('Retry import of Roseland NYC Live').props.disabled).toBe(false);
    expect(importerProps.onSuccess).toHaveBeenCalledOnce();

    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, open: false })));
    expect(renderer.toJSON()).toBeNull();
    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, viewMode: 'wishlist' })));

    expect(content()).toContain('1 imported to Collection · 1 already in your library · 1 failed to import to Collection');
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    await act(async () => findButton('Retry failed (1)').props.onClick());
    expect(addAlbum).toHaveBeenCalledTimes(4);
    expect(addAlbum).toHaveBeenLastCalledWith(expect.objectContaining({ discogsId: 3, status: 'collection' }), expect.any(AbortSignal));
    expect(content()).toContain('2 imported to Collection · 1 already in your library');
    expect(content()).not.toContain('Import to Collection failed');
  });

  it('continues one batch across dismissal and shelf changes without overlapping requests', async () => {
    const firstAlbum = Promise.withResolvers<object>();
    addAlbum.mockReturnValueOnce(firstAlbum.promise);
    await loadCollection();
    await act(async () => findButton('Select all (3)').props.onClick());
    const run = findButton('Import 3 records to Collection').props.onClick;
    await act(async () => {
      void run();
      void run();
    });
    expect(addAlbum).toHaveBeenCalledOnce();
    expect(content()).toContain('Importing 1 of 3 to Collection…');
    expect(content()).toContain('Queued for Collection');

    await act(async () => findButton('Close Discogs import').props.onClick());
    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, open: false, viewMode: 'wishlist' })));
    expect(content()).toContain('Importing 1 of 3 to Collection…');
    await act(async () => findButton('Reopen Discogs import').props.onClick());
    expect(importerProps.onOpen).toHaveBeenCalledOnce();
    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, viewMode: 'wishlist' })));
    expect(content()).toContain('Importing 1 of 3 to Collection…');
    await act(async () => firstAlbum.resolve({}));

    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([
      [1, 'collection'], [2, 'collection'], [3, 'collection'],
    ]);
    expect(content()).toContain('3 imported to Collection');
    expect(importerProps.onSuccess).toHaveBeenCalledOnce();
  });

  it('stops before the next queued record and preserves the first outcome', async () => {
    const first = Promise.withResolvers<object>();
    addAlbum.mockReturnValueOnce(first.promise);
    await loadCollection();
    await act(async () => findButton('Select all (3)').props.onClick());
    await act(async () => { void findButton('Import 3 records to Collection').props.onClick(); });
    await act(async () => findButton('Stop after current record').props.onClick());
    await act(async () => first.resolve({}));

    expect(addAlbum).toHaveBeenCalledOnce();
    expect(content()).toContain('Import stopped.');
    expect(content()).toContain('Imported to Collection');
    expect(findButton('Resume remaining (2)').props.disabled).toBe(false);
    await act(async () => findButton('Resume remaining (2)').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([
      [1, 'collection'], [2, 'collection'], [3, 'collection'],
    ]);
  });

  it('imports only the checked subset', async () => {
    await loadCollection();
    expect(findButton('Import selected records').props.disabled).toBe(true);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Import 1 record to Collection').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ discogsId: 2, status: 'collection', applyCatalogReference: true }),
      expect.any(AbortSignal),
    );
    expect(content()).toContain('1 imported to Collection');
    expect(renderer.root.findByProps({ 'aria-label': 'Select Dummy by Portishead' }).props.checked).toBe(false);
  });

  it('locks the chosen shelf during import and keeps results from later batches distinct', async () => {
    const pending = Promise.withResolvers<object>();
    addAlbum.mockReturnValueOnce(pending.promise);
    await loadCollection();
    const controls = () => renderer.root.findByType('select');
    const choose = (shelf: string) => controls().props.onChange({ target: { value: shelf } });
    const select = (title: string) => renderer.root.findByProps({ 'aria-label': `Select ${title} by Portishead` })
      .props.onChange({ currentTarget: { checked: true } });

    expect(controls().props.value).toBe('collection');
    await act(async () => { choose('wishlist'); select('Dummy'); });
    await act(async () => { void findButton('Import 1 record to Wishlist').props.onClick(); });
    expect(controls().props.disabled).toBe(true);
    await act(async () => choose('collection'));
    expect(controls().props.value).toBe('wishlist');
    expect(content()).toContain('Importing 1 of 1 to Wishlist…');
    await act(async () => pending.resolve({}));
    expect(controls().props.disabled).toBe(false);
    expect(content()).toContain('1 imported to Wishlist');

    await act(async () => { choose('collection'); select('Third'); });
    await act(async () => findButton('Import 1 record to Collection').props.onClick());
    expect(content()).toContain('1 imported to Collection · 1 imported to Wishlist');
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist'], [2, 'collection']]);
  });

  it('keeps configuration help and lets a failed collection load be retried', async () => {
    importDiscogsCollection.mockRejectedValueOnce(new ApiError('Invalid connection', 400));
    await loadCollection();
    expect(content()).toContain('Ask your server administrator to check the connection.');
    await act(async () => findButton('Reload Discogs collection').props.onClick());
    expect(content()).toContain('3 records available');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('continues past a page with no eligible records and retries the same page without writing', async () => {
    importDiscogsCollection.mockResolvedValueOnce({ albums: [], count: 0, page: 1, totalPages: 2, nextPage: 2 })
      .mockRejectedValueOnce(new ApiError('Unavailable', 503))
      .mockResolvedValueOnce({ albums, count: 3, page: 2, totalPages: 2 });
    await loadCollection();
    expect(content()).toContain('No new records on the pages loaded so far.');
    expect(content()).toContain('1 of 2 Discogs pages loaded');
    expect(importDiscogsCollection.mock.calls).toEqual([[1]]);
    await act(async () => findButton('Load more Discogs records').props.onClick());
    expect(content()).toContain('Could not load Discogs page 2');
    await act(async () => findButton('Retry Discogs page').props.onClick());
    expect(importDiscogsCollection.mock.calls).toEqual([[1], [2], [2]]);
    expect(content()).toContain('2 of 2 Discogs pages loaded');
    expect(content()).toContain('3 records available');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps selections across pages and lets the user choose only one pressing of the same title', async () => {
    const otherPressing = { ...albums[0], id: 4, discogsId: 4, year: 2014, pressing: { catalogNumber: 'TEST 2014' } };
    importDiscogsCollection.mockResolvedValueOnce({ albums: albums.slice(0, 2), count: 2, page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [otherPressing, albums[1]], count: 2, page: 2, totalPages: 2 });
    const checkbox = (label: string) => renderer.root.findByProps({ 'aria-label': label });
    const select = (label: string) => checkbox(label).props.onChange({ currentTarget: { checked: true } });
    await loadCollection();
    await act(async () => select('Select Dummy by Portishead'));
    await act(async () => findButton('Load more Discogs records').props.onClick());
    expect(checkbox('Select Dummy by Portishead · Discogs release 1').props.checked).toBe(true);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Select Third by Portishead' })).toHaveLength(1);
    expect(content()).toContain('TEST 2014');
    await act(async () => select('Select Dummy by Portishead · Discogs release 4'));
    expect(checkbox('Select Dummy by Portishead · Discogs release 1').props.checked).toBe(false);
    await act(async () => findButton('Import 1 record to Collection').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ discogsId: 4, status: 'collection', applyCatalogReference: true }),
      expect.any(AbortSignal),
    );
    expect(content()).toContain('Another pressing of this album is in the import review.');
  });

  it('reopens a two-page Wishlist review, retries a failed refresh, and waits to import the exact choices', async () => {
    const firstPage = { albums: [albums[0]], page: 1, totalPages: 2, nextPage: 2 };
    const secondPage = { albums: albums.slice(1), page: 2, totalPages: 2 };
    importDiscogsCollection.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(firstPage).mockRejectedValueOnce(new ApiError('Unavailable', 503))
      .mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
    await loadCollection();
    const select = (title: string) => renderer.root.findByProps({ 'aria-label': `Select ${title} by Portishead` })
      .props.onChange({ currentTarget: { checked: true } });
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      select('Dummy');
    });
    await act(async () => findButton('Load more Discogs records').props.onClick());
    await act(async () => select('Roseland NYC Live'));
    expect(content()).toContain('2 selected for Wishlist');

    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, { ...importerProps, open: false })); });
    expect(content()).toContain('Discogs review · 2 selected for Wishlist');
    expect(findButton('Open Discogs review')).toBeTruthy();
    await act(async () => renderer.update(createElement(DiscogsImporter, importerProps)));
    await act(async () => findButton('Resume review').props.onClick());
    expect(content()).toContain('Could not refresh your review. Your choices are kept. Try again.');
    expect(content()).toContain('Saved review · 2 selected for Wishlist');
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => findButton('Retry review').props.onClick());

    expect(importDiscogsCollection.mock.calls.map(([page]) => page)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(getAlbums.mock.calls.map(([shelf, , cache]) => [shelf, cache])).toEqual([
      ['collection', 'no-store'], ['wishlist', 'no-store'], ['collection', 'no-store'], ['wishlist', 'no-store'],
    ]);
    expect(content()).toContain('2 of 2 Discogs pages loaded');
    expect(renderer.root.findByType('select').props.value).toBe('wishlist');
    expect(renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.checked).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => findButton('Import 2 records to Wishlist').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist'], [3, 'wishlist']]);
    expect(sessionStorage.getItem('side-a:discogs-import-review:v1')).toBeNull();
  });

  it('flags a title saved elsewhere and a missing release when resuming, then discards the review cleanly', async () => {
    importDiscogsCollection.mockResolvedValueOnce({ albums, page: 1, totalPages: 1 })
      .mockResolvedValueOnce({ albums: albums.slice(2), page: 1, totalPages: 1 });
    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'wishlist'
      ? [{ discogs_id: 7, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist' }] : [] }));
    await loadCollection();
    await act(async () => findButton('Select all (3)').props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    await act(async () => findButton('Resume review').props.onClick());

    expect(content()).toContain('2 selections need your attention.');
    const notes = renderer.root.findAllByType('li').map(node => node.children.join('')).join('\n');
    expect(notes).toContain('Dummy by Portishead · Discogs 1. Already in Wishlist.');
    expect(notes).toContain('Third by Portishead · Discogs 2. Unavailable on the refreshed pages.');
    expect(findButton('Import 1 record to Collection').props.disabled).toBe(false);
    await act(async () => findButton('Discard review').props.onClick());
    expect(findButton('Load Discogs collection')).toBeTruthy();
    expect(sessionStorage.getItem('side-a:discogs-import-review:v1')).toBeNull();
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('clears only bulk choices when a later page exposes competing pressings and groups each title', async () => {
    const alternateDummy = { ...albums[0], id: 4, discogsId: 4, pressing: { catalogNumber: 'ALT 04' } };
    const alternateThird = { ...albums[1], id: 5, discogsId: 5, pressing: { catalogNumber: 'ALT 05' } };
    importDiscogsCollection.mockResolvedValueOnce({ albums: albums.slice(0, 2), page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [alternateDummy, alternateThird], page: 2, totalPages: 2 });
    await loadCollection();
    const checkbox = (title: string, release?: number) => renderer.root.findByProps({
      'aria-label': `Select ${title} by Portishead${release ? ` · Discogs release ${release}` : ''}`,
    });
    await act(async () => checkbox('Third').props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Select all loaded (2)').props.onClick());
    expect(checkbox('Dummy').props.checked).toBe(true);
    await act(async () => findButton('Load more Discogs records').props.onClick());

    expect(checkbox('Dummy', 1).props.checked).toBe(false);
    expect(checkbox('Dummy', 4).props.checked).toBe(false);
    expect(checkbox('Third', 2).props.checked).toBe(true);
    expect(checkbox('Third', 5).props.checked).toBe(false);
    expect(content()).toContain('1 selection needs your attention.');
    expect(renderer.root.findByProps({ 'aria-label': 'Pressings of Dummy by Portishead' }).findAllByType('article')).toHaveLength(2);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('rechecks selection provenance when a resumed source page now has an alternate pressing', async () => {
    const alternateDummy = { ...albums[0], id: 4, discogsId: 4 };
    const alternateThird = { ...albums[1], id: 5, discogsId: 5 };
    const firstPage = { albums: albums.slice(0, 2), page: 1, totalPages: 2, nextPage: 2 };
    importDiscogsCollection.mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ albums: albums.slice(2), page: 2, totalPages: 2 })
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ albums: [albums[2], alternateDummy, alternateThird], page: 2, totalPages: 2 });
    await loadCollection();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' })
      .props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Select all loaded (2)').props.onClick());
    await act(async () => findButton('Load more Discogs records').props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    await act(async () => findButton('Resume review').props.onClick());

    expect(renderer.root.findByProps({ 'aria-label': 'Select Dummy by Portishead · Discogs release 1' }).props.checked).toBe(false);
    expect(renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead · Discogs release 2' }).props.checked).toBe(true);
    expect(content()).toContain('1 selection needs your attention.');
    expect(findButton('Import 1 record to Collection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps confirmed receipts and reconciles a lost response on both shelves before an explicit resume', async () => {
    const unresolved = Promise.withResolvers<object>();
    addAlbum.mockResolvedValueOnce({}).mockImplementationOnce(() => {
      const journal = JSON.parse(sessionStorage.getItem('side-a:discogs-import:v1') ?? '[]');
      expect(journal.map(({ status, destination }: { status: string; destination: string }) => [status, destination])).toEqual([
        ['imported', 'wishlist'], ['sending', 'wishlist'], ['pending', 'wishlist'],
      ]);
      return unresolved.promise;
    });
    await loadCollection();
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      findButton('Select all (3)').props.onClick();
    });
    await act(async () => {
      void findButton('Import 3 records to Wishlist').props.onClick();
    });
    expect(addAlbum).toHaveBeenCalledTimes(2);

    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'wishlist'
      ? [{ discogs_id: 2, title: 'Third', artist_name: 'Portishead', status: 'wishlist' }] : [] }));
    await act(async () => renderer.unmount());
    await act(async () => {
      renderer = create(createElement(DiscogsImporter, importerProps));
    });
    expect(getAlbums.mock.calls.map(([shelf, , cache]) => [shelf, cache])).toEqual([
      ['collection', 'no-store'], ['wishlist', 'no-store'],
    ]);
    expect(addAlbum).toHaveBeenCalledTimes(2);
    expect(content()).toContain('1 imported to Wishlist · 1 found in Wishlist');
    expect(content()).toContain('Found in Wishlist after checking your shelves');
    expect(content()).toContain('1 to Wishlist');

    await act(async () => findButton('Resume remaining (1)').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([
      [1, 'wishlist'], [2, 'wishlist'], [3, 'wishlist'],
    ]);
    expect(content()).toContain('2 imported to Wishlist · 1 found in Wishlist');
  });

  it('gives server setup instructions only when configuration is missing', async () => {
    const props = {
      onBarcodeClick: vi.fn(), onImageClick: vi.fn(), onSearchClick: vi.fn(),
      onImportClick: vi.fn(), onManualClick: vi.fn(), onClose: vi.fn(), viewMode: 'collection' as const,
    };
    await act(async () => { renderer = create(createElement(AddMenu, { ...props, discogsConfigured: null })); });
    expect(content()).toContain('Checking the Discogs connection…');
    await act(async () => renderer.update(createElement(AddMenu, { ...props, discogsConfigured: null, discogsCheckFailed: true })));
    expect(content()).toContain('Could not check the Discogs connection');
    expect(content()).not.toContain('Discogs setup instructions');
    await act(async () => renderer.update(createElement(AddMenu, { ...props, discogsConfigured: false })));
    expect(renderer.root.findByType('a').props.href).toMatch(/#configuration$/);
    expect(content()).toContain('Ask your server administrator');
  });
});
