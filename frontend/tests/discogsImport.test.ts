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

async function openImportReview() {
  await act(async () => findButton('Review selection').props.onClick());
}

const releaseChoice = (id: number) => renderer.root.findByProps({ id: `discogs-import-release-${id}` });

const content = () => renderer.root.findAllByType('p').map(node => node.children.join('')).join('\n');

async function loadCollection(options?: Parameters<typeof create>[1]) {
  await act(async () => {
    renderer = create(createElement(DiscogsImporter, importerProps), options);
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
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await openImportReview();
    await act(async () => findButton('Import 3 titles to Collection').props.onClick());

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
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await openImportReview();
    const run = findButton('Import 3 titles to Collection').props.onClick;
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
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await openImportReview();
    await act(async () => { void findButton('Import 3 titles to Collection').props.onClick(); });
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
    expect(findButton('Review selection').props.disabled).toBe(true);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.onChange({ currentTarget: { checked: true } }));
    await openImportReview();
    await act(async () => findButton('Import 1 title to Collection').props.onClick());
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
    await openImportReview();
    await act(async () => { void findButton('Import 1 title to Wishlist').props.onClick(); });
    expect(controls().props.disabled).toBe(true);
    await act(async () => choose('collection'));
    expect(controls().props.value).toBe('wishlist');
    expect(content()).toContain('Importing 1 of 1 to Wishlist…');
    await act(async () => pending.resolve({}));
    expect(controls().props.disabled).toBe(false);
    expect(content()).toContain('1 imported to Wishlist');

    await act(async () => { choose('collection'); select('Third'); });
    await openImportReview();
    await act(async () => findButton('Import 1 title to Collection').props.onClick());
    expect(content()).toContain('1 imported to Collection · 1 imported to Wishlist');
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist'], [2, 'collection']]);
  });

  it('keeps configuration help and lets a failed collection load be retried', async () => {
    importDiscogsCollection.mockRejectedValueOnce(new ApiError('Invalid connection', 400));
    await loadCollection();
    expect(content()).toContain('Ask your server administrator to check the connection.');
    await act(async () => findButton('Reload Discogs collection').props.onClick());
    expect(content()).toContain('3 Discogs listings across 3 titles');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('continues past a page with no eligible records and retries the same page without writing', async () => {
    importDiscogsCollection.mockResolvedValueOnce({ albums: [], count: 0, page: 1, totalPages: 2, nextPage: 2 })
      .mockRejectedValueOnce(new ApiError('Unavailable', 503))
      .mockResolvedValueOnce({ albums, count: 3, page: 2, totalPages: 2 });
    await loadCollection();
    expect(content()).toContain('No new listings on the pages loaded so far.');
    expect(content()).toContain('1 of 2 Discogs pages loaded');
    expect(importDiscogsCollection.mock.calls.map(([page]) => page)).toEqual([1]);
    await act(async () => findButton('Load next Discogs page').props.onClick());
    expect(content()).toContain('Could not load Discogs page 2');
    await act(async () => findButton('Retry Discogs page').props.onClick());
    expect(importDiscogsCollection.mock.calls.map(([page]) => page)).toEqual([1, 2, 2]);
    expect(content()).toContain('2 of 2 Discogs pages loaded');
    expect(content()).toContain('3 Discogs listings across 3 titles');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps partial coverage upfront and at signoff after the next page is canceled', async () => {
    let nextPageSignal: AbortSignal | undefined;
    importDiscogsCollection.mockResolvedValueOnce({ albums: albums.slice(0, 2), page: 1, totalPages: 3, nextPage: 2 })
      .mockImplementationOnce((_page: number, signal: AbortSignal) => new Promise((_, reject) => {
        nextPageSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
    await loadCollection();
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      releaseChoice(1).props.onChange({ currentTarget: { checked: true } });
    });
    const coverage = renderer.root.findByProps({ id: 'discogs-page-coverage' });
    expect(coverage.children.join('')).toBe('1 of 3 Discogs pages loaded');
    const actions = coverage.parent?.parent?.findAllByType('button');
    expect(actions?.some(node => node.children.join('') === 'Load next Discogs page')).toBe(true);
    expect(actions?.some(node => node.children.join('').startsWith('Import'))).toBe(false);
    expect(findButton('Review selection').props['aria-describedby']).toBe('discogs-selection-count discogs-page-coverage discogs-partial-import');
    expect(content()).toContain('Later pages may contain alternate pressings.');

    await act(async () => findButton('Load next Discogs page').props.onClick());
    expect(findButton('Loading Discogs page 2…').props['aria-busy']).toBe(true);
    await act(async () => findButton('Cancel page load').props.onClick());
    expect(nextPageSignal?.aborted).toBe(true);
    expect(content()).toContain('Page load canceled. Your review is kept.');
    expect(releaseChoice(1).props.checked).toBe(true);
    expect(renderer.root.findByType('select').props.value).toBe('wishlist');
    expect(addAlbum).not.toHaveBeenCalled();

    await openImportReview();
    expect(content()).toContain('1 of 3 Discogs pages loaded');
    expect(content()).toContain('This import uses titles selected from the loaded pages.');
    expect(findButton('Import 1 title to Wishlist').props['aria-describedby']).toBe('discogs-signoff-count discogs-signoff-scope');
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => findButton('Import 1 title to Wishlist').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist']]);
    expect(findButton('Load next Discogs page')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('side-a:discogs-import-review:v1')!)).toMatchObject({
      choices: [], lastPage: 1, destination: 'wishlist',
    });
  });

  it('keeps selections across pages and lets the user choose only one pressing of the same title', async () => {
    const otherPressing = { ...albums[0], id: 4, discogsId: 4, year: 2014, pressing: { catalogNumber: 'TEST 2014' } };
    importDiscogsCollection.mockResolvedValueOnce({ albums: albums.slice(0, 2), count: 2, page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [otherPressing, albums[1]], count: 2, page: 2, totalPages: 2 });
    const checkbox = (label: string) => renderer.root.findByProps({ 'aria-label': label });
    const select = (label: string) => checkbox(label).props.onChange({ currentTarget: { checked: true } });
    await loadCollection();
    await act(async () => select('Select Dummy by Portishead'));
    await act(async () => findButton('Load next Discogs page').props.onClick());
    expect(releaseChoice(1).props.checked).toBe(true);
    expect(releaseChoice(1).props.type).toBe('radio');
    expect(releaseChoice(4).props.type).toBe('radio');
    expect(releaseChoice(4).props.name).toBe(releaseChoice(1).props.name);
    expect(releaseChoice(2).props.type).toBe('checkbox');
    expect(renderer.root.findByType('legend').children.join('')).toBe('Choose a pressing for Dummy by Portishead');
    expect(releaseChoice(4).props['aria-label']).toBe('TEST 2014 · 2014 · Discogs release 4 · Choose pressing');
    await act(async () => releaseChoice(4).props.onChange({ currentTarget: { checked: true } }));
    expect(releaseChoice(1).props.checked).toBe(false);
    await act(async () => select('Select Third by Portishead'));
    await act(async () => findButton('Clear pressing choice for Dummy by Portishead').props.onClick());
    expect(releaseChoice(1).props.checked).toBe(false);
    expect(releaseChoice(4).props.checked).toBe(false);
    expect(releaseChoice(2).props.checked).toBe(true);
    await act(async () => releaseChoice(2).props.onChange({ currentTarget: { checked: false } }));
    await act(async () => releaseChoice(4).props.onChange({ currentTarget: { checked: true } }));
    await openImportReview();
    await act(async () => findButton('Import 1 title to Collection').props.onClick());
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
    await act(async () => findButton('Load next Discogs page').props.onClick());
    await act(async () => select('Roseland NYC Live'));
    expect(content()).toContain('2 titles selected for Wishlist');

    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, { ...importerProps, open: false })); });
    expect(content()).toContain('Discogs review · 2 titles selected for Wishlist');
    expect(findButton('Open Discogs review')).toBeTruthy();
    await act(async () => renderer.update(createElement(DiscogsImporter, importerProps)));
    await act(async () => findButton('Resume review').props.onClick());
    expect(content()).toContain('Could not refresh your review. Your draft is kept. Try again.');
    expect(content()).toContain('Saved review · 2 titles selected for Wishlist');
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
    await openImportReview();
    await act(async () => findButton('Import 2 titles to Wishlist').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist'], [3, 'wishlist']]);
    expect(sessionStorage.getItem('side-a:discogs-import-review:v1')).toBeNull();
  });

  it('reconciles all reviewed pages before importing, retaining a moved release and flagging removed and saved titles', async () => {
    const laterPressing = { ...albums[2], id: 4, discogsId: 4 };
    const removedRelease = { id: 5, discogsId: 5, artist: 'Boards of Canada', album: 'Geogaddi' };
    importDiscogsCollection.mockResolvedValueOnce({ albums, page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [laterPressing, removedRelease], page: 2, totalPages: 2 })
      .mockResolvedValueOnce({ albums: [albums[1], albums[2], laterPressing], page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [albums[0]], page: 2, totalPages: 2 });
    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'collection'
      ? [{ discogs_id: 27, title: 'Third', artist_name: 'Portishead', status: 'collection' }] : [] }));
    await loadCollection();
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      findButton('Select all eligible titles (3 to add)').props.onClick();
    });
    await act(async () => findButton('Load next Discogs page').props.onClick());
    await act(async () => releaseChoice(5).props.onChange({ currentTarget: { checked: true } }));
    expect(findButton('Review selection').props.disabled).toBe(false);
    const coverage = renderer.root.findByProps({ id: 'discogs-page-coverage' });
    expect(coverage.parent?.parent?.findAllByType('button').map(node => node.children.join(''))).not.toContain('Refresh reviewed pages');
    await act(async () => findButton('Refresh reviewed pages').props.onClick());

    expect(importDiscogsCollection.mock.calls.map(([page]) => page)).toEqual([1, 2, 1, 2]);
    expect(getAlbums.mock.calls.map(([shelf, , cache]) => [shelf, cache])).toEqual([['collection', 'no-store'], ['wishlist', 'no-store']]);
    expect(releaseChoice(1).props.checked).toBe(true);
    expect(renderer.root.findAllByProps({ id: 'discogs-import-release-2' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ id: 'discogs-import-release-5' })).toHaveLength(0);
    expect(content()).toContain('Already in Collection.');
    expect(content()).toContain('Unavailable on the refreshed pages.');
    expect(renderer.root.findByProps({ 'aria-label': 'Review pressings for Roseland NYC Live by Portishead' })).toBeTruthy();
    const saved = JSON.parse(sessionStorage.getItem('side-a:discogs-import-review:v1')!);
    expect(saved.choices.map(({ discogsId }: { discogsId: number }) => discogsId)).toEqual([1]);
    expect(saved.notices.map(({ choice, cause }: { choice: { discogsId: number }; cause: string }) => [choice.discogsId, cause]))
      .toEqual([[3, 'competing'], [2, 'saved'], [5, 'unavailable']]);
    expect(saved.destination).toBe('wishlist');
    expect(addAlbum).not.toHaveBeenCalled();
    await openImportReview();
    await act(async () => findButton('Import 1 title to Wishlist').props.onClick());
    expect(addAlbum.mock.calls.map(([album]) => [album.discogsId, album.status])).toEqual([[1, 'wishlist']]);
  });

  it('keeps a failed refresh recoverable and blocks importing unverified selections until retry succeeds', async () => {
    const nextPage = { albums: [], page: 2, totalPages: 2 };
    const originalPage = { albums: [albums[0]], page: 1, totalPages: 2, nextPage: 2 };
    const changedPage = { ...originalPage, albums: [] };
    importDiscogsCollection.mockResolvedValueOnce(originalPage).mockResolvedValueOnce(nextPage)
      .mockResolvedValueOnce(changedPage).mockRejectedValueOnce(new ApiError('Unavailable', 503))
      .mockResolvedValueOnce(changedPage).mockResolvedValueOnce({ ...nextPage, albums: [albums[0]] });
    await loadCollection();
    await act(async () => releaseChoice(1).props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Load next Discogs page').props.onClick());
    await act(async () => findButton('Refresh reviewed pages').props.onClick());

    expect(content()).toContain('Could not verify the selected records. Your choices are kept. Retry the review before importing.');
    expect(releaseChoice(1).props.checked).toBe(true);
    const commit = findButton('Review selection');
    expect(commit.props.disabled).toBe(true);
    await act(async () => commit.props.onClick());
    expect(addAlbum).not.toHaveBeenCalled();

    await act(async () => findButton('Retry review').props.onClick());
    expect(releaseChoice(1).props.checked).toBe(true);
    expect(findButton('Review selection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('opens selected-only review from a deep choice and restores the card focus and scroll on Back', async () => {
    const longReview = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, discogsId: index + 1, artist: 'Fixture artist', album: `Album ${index + 1}` }));
    importDiscogsCollection.mockResolvedValueOnce({ albums: longReview, page: 1, totalPages: 1 });
    const reviewHeading = { focus: vi.fn() };
    const origin = { focus: vi.fn() };
    const panel = {
      scrollTop: 2000, clientTop: 1, clientHeight: 392, getBoundingClientRect: () => ({ top: 29 }),
      querySelector: vi.fn(selector => selector === '#discogs-import-review-link-30' ? origin : null),
    };
    await loadCollection({ createNodeMock: element => {
      if (element.props.className?.startsWith('rh-dialog-panel')) return panel;
      if (element.props.className?.startsWith('rh-dialog-header')) return { getBoundingClientRect: () => ({ height: 71 }) };
      if (element.props.id === 'discogs-selected-heading') return reviewHeading;
      return null;
    } });
    await act(async () => releaseChoice(30).props.onChange({ currentTarget: { checked: true } }));
    expect(reviewHeading.focus).not.toHaveBeenCalled();
    expect(panel.scrollTop).toBe(2000);
    const article = renderer.root.findAllByType('article').at(-1);
    const link = article?.findByProps({ href: '#discogs-import-choices' });
    expect(link?.children.join('')).toBe('Review import choices');
    await act(async () => link?.props.onClick({ preventDefault: vi.fn() }));
    expect(reviewHeading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(panel.scrollTop).toBe(0);
    expect(renderer.root.findByProps({ 'aria-label': 'Titles in this import' }).findAllByType('h4').map(node => node.children.join(''))).toEqual(['Album 30']);
    expect(findButton('Import 1 title to Collection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
    await act(async () => findButton('Back to selections').props.onClick());
    expect(panel.scrollTop).toBe(2000);
    expect(origin.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(releaseChoice(30).props.checked).toBe(true);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('removes a specific release from signoff and leaves the other choices ready for review', async () => {
    await loadCollection();
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await act(async () => findButton('Review selection').props.onClick());
    const remove = renderer.root.findByProps({ 'aria-label': 'Remove Dummy by Portishead from this import' });
    await act(async () => remove.props.onClick());
    expect(findButton('Import 2 titles to Collection').props.disabled).toBe(false);
    const selected = renderer.root.findByProps({ 'aria-label': 'Titles in this import' });
    expect(selected.findAllByType('h4')).toHaveLength(2);
    expect(selected.findAllByType('h4').some(heading => heading.children.join('') === 'Dummy')).toBe(false);
    await act(async () => findButton('Back to selections').props.onClick());
    expect(releaseChoice(1).props.checked).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('flags a title saved elsewhere and a missing release when resuming, then discards the review cleanly', async () => {
    importDiscogsCollection.mockResolvedValueOnce({ albums, page: 1, totalPages: 1 })
      .mockResolvedValueOnce({ albums: albums.slice(2), page: 1, totalPages: 1 });
    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'wishlist'
      ? [{ discogs_id: 7, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist' }] : [] }));
    await loadCollection();
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    await act(async () => findButton('Resume review').props.onClick());

    expect(content()).toContain('1 title needs your attention');
    const notes = renderer.root.findAllByType('li').map(node => node.findByType('p').children
      .map(child => typeof child === 'string' ? child : child.children.join('')).join('')).join('\n');
    expect(notes).toContain('Dummy by Portishead · Discogs 1. Already in Wishlist.');
    expect(notes).toContain('Third by Portishead · Discogs 2. Unavailable on the refreshed pages.');
    expect(findButton('Review selection').props.disabled).toBe(false);
    await act(async () => findButton('Discard review').props.onClick());
    expect(sessionStorage.getItem('side-a:discogs-import-review:v1')).not.toBeNull();
    expect(findButton('Review selection').props.disabled).toBe(true);
    await act(async () => findButton('Discard selection').props.onClick());
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
    const checkbox = (title: string) => renderer.root.findByProps({ 'aria-label': `Select ${title} by Portishead` });
    await act(async () => checkbox('Third').props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Select all eligible titles (1 to add)').props.onClick());
    expect(checkbox('Dummy').props.checked).toBe(true);
    await act(async () => findButton('Load next Discogs page').props.onClick());

    expect(releaseChoice(1).props.checked).toBe(false);
    expect(releaseChoice(4).props.checked).toBe(false);
    expect(releaseChoice(2).props.checked).toBe(true);
    expect(releaseChoice(5).props.checked).toBe(false);
    expect(content()).toContain('1 title needs your attention');
    expect(content()).toContain('4 Discogs listings across 2 titles');
    expect(content()).toContain('2 titles require an individual choice. Select all skips them.');
    expect(renderer.root.findAllByType('button').some(node => node.children.join('').startsWith('Select all eligible titles'))).toBe(false);
    expect(renderer.root.findByProps({ 'aria-label': 'Pressings of Dummy by Portishead' }).findAllByType('article')).toHaveLength(2);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('jumps from a changed selection to comparison evidence and opens non-writing signoff for the chosen release', async () => {
    const alternateDummy = { ...albums[0], id: 4, discogsId: 4, pressing: { catalogNumber: 'ALT 04' } };
    importDiscogsCollection.mockResolvedValueOnce({ albums, page: 1, totalPages: 2, nextPage: 2 })
      .mockResolvedValueOnce({ albums: [alternateDummy], page: 2, totalPages: 2 });
    const pressingHeading = { focus: vi.fn(), getBoundingClientRect: () => ({ top: 483, bottom: 503 }) };
    const selectionHeading = { focus: vi.fn() };
    const panel = {
      scrollTop: 0, clientTop: 1, clientHeight: 393, getBoundingClientRect: () => ({ top: 0 }),
      querySelector: vi.fn(selector => selector === '#discogs-import-pressings-1' ? pressingHeading : null),
    };
    await loadCollection({ createNodeMock: element => {
      if (element.props.className?.startsWith('rh-dialog-panel')) return panel;
      if (element.props.className?.startsWith('rh-dialog-header')) return { getBoundingClientRect: () => ({ height: 70 }) };
      if (element.props.id === 'discogs-selected-heading') return selectionHeading;
      return null;
    } });
    await act(async () => findButton('Select all eligible titles (3 to add)').props.onClick());
    await act(async () => findButton('Load next Discogs page').props.onClick());

    const reviewLink = renderer.root.findByProps({ 'aria-label': 'Review pressings for Dummy by Portishead' });
    expect(reviewLink.props.href).toBe('#discogs-import-pressings-1');
    expect(renderer.root.findByProps({ id: 'discogs-import-pressings-1' }).props.tabIndex).toBe(-1);
    await act(async () => reviewLink.props.onClick({ preventDefault: vi.fn() }));
    expect(pressingHeading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(panel.scrollTop).toBe(400);
    const scope = renderer.root.findByProps({ 'aria-label': 'Pressings of Dummy by Portishead' });
    expect(scope.findByType('summary').children.join('')).toBe('Compare listings');
    expect(scope.findByType('table').findAllByType('th').map(node => node.children.map(child =>
      typeof child === 'string' ? child : child.children.join('')).join(''))).toEqual(expect.arrayContaining(['Catalog number', 'Discogs 1', 'Discogs 4']));
    expect(releaseChoice(1).props.checked).toBe(false);
    expect(releaseChoice(4).props.checked).toBe(false);

    await act(async () => releaseChoice(4)
      .props.onChange({ currentTarget: { checked: true } }));
    const returnLink = renderer.root.findByProps({ href: '#discogs-import-choices' });
    await act(async () => returnLink.props.onClick({ preventDefault: vi.fn() }));
    expect(selectionHeading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    const selectedTitles = renderer.root.findByProps({ 'aria-label': 'Titles in this import' });
    expect(selectedTitles.findAllByType('h4').map(node => node.children.join(''))).toEqual(['Third', 'Roseland NYC Live', 'Dummy']);
    expect(selectedTitles.findAllByType('a').map(node => node.props.href)).toContain('https://www.discogs.com/release/4');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps an unconfirmed discard safe when canceled, closed or reloaded', async () => {
    const keepFocus = vi.fn();
    const discardFocus = vi.fn();
    const inPanel = (focus: () => void) => ({ focus, getBoundingClientRect: () => ({ top: 130, bottom: 174 }) });
    await loadCollection({ createNodeMock: element => {
      if (element.props.className?.startsWith('rh-dialog-panel')) return {
        scrollTop: 0, clientTop: 1, clientHeight: 393, getBoundingClientRect: () => ({ top: 0 }),
      };
      if (element.props.className?.startsWith('rh-dialog-header')) return { getBoundingClientRect: () => ({ height: 70 }) };
      if (element.props['aria-labelledby'] === 'discogs-discard-heading') return { getBoundingClientRect: () => ({ top: 100 }) };
      if (element.props.children === 'Keep review') return inPanel(keepFocus);
      if (element.props.children === 'Discard review') return inPanel(discardFocus);
      return null;
    } });
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      findButton('Select all eligible titles (3 to add)').props.onClick();
    });
    const savedReview = sessionStorage.getItem('side-a:discogs-import-review:v1');
    await act(async () => findButton('Discard review').props.onClick());
    expect(keepFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(renderer.root.findByProps({ id: 'discogs-discard-heading' }).children.join('')).toBe('Discard 3 selections for Wishlist?');
    await act(async () => renderer.root.findByType('dialog').props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(discardFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(findButton('Review selection').props.disabled).toBe(false);

    await act(async () => findButton('Discard review').props.onClick());
    await act(async () => findButton('Close Discogs import').props.onClick());
    expect(importerProps.onClose).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('side-a:discogs-import-review:v1')).toBe(savedReview);
    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, open: false })));
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    expect(content()).toContain('Saved review · 3 titles selected for Wishlist');
    expect(renderer.root.findAllByProps({ id: 'discogs-discard-heading' })).toHaveLength(0);
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
    await act(async () => findButton('Select all eligible titles (1 to add)').props.onClick());
    await act(async () => findButton('Load next Discogs page').props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    await act(async () => findButton('Resume review').props.onClick());

    expect(releaseChoice(1).props.checked).toBe(false);
    expect(releaseChoice(2).props.checked).toBe(true);
    expect(content()).toContain('1 title needs your attention');
    expect(findButton('Review selection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('restores an unresolved competing pressing through two reloads and clears it when explicitly chosen', async () => {
    const alternate = { ...albums[0], id: 4, discogsId: 4 };
    importDiscogsCollection.mockImplementation(async page => page === 1
      ? { albums: albums.slice(0, 2), page: 1, totalPages: 2, nextPage: 2 }
      : { albums: [alternate], page: 2, totalPages: 2 });
    await loadCollection();
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'wishlist' } });
      findButton('Select all eligible titles (2 to add)').props.onClick();
    });
    await act(async () => findButton('Load next Discogs page').props.onClick());
    const originalDraft = JSON.parse(sessionStorage.getItem('side-a:discogs-import-review:v1')!);
    expect(originalDraft.choices.map(({ discogsId }: { discogsId: number }) => discogsId)).toEqual([2]);
    expect(originalDraft.notices).toEqual([{ choice: { discogsId: 1, artist: 'Portishead', album: 'Dummy', source: 'bulk' }, cause: 'competing' }]);

    for (let reload = 0; reload < 2; reload++) {
      await act(async () => renderer.unmount());
      await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
      expect(content()).toContain('Saved review · 1 title selected for Wishlist · 1 needs attention');
      expect(renderer.root.findAllByProps({ 'aria-label': 'Review pressings for Dummy by Portishead' })).toHaveLength(0);
      await act(async () => findButton('Resume review').props.onClick());
      const reviewLink = renderer.root.findByProps({ 'aria-label': 'Review pressings for Dummy by Portishead' });
      expect(reviewLink.props.href).toBe('#discogs-import-pressings-1');
      expect(renderer.root.findByProps({ id: 'discogs-import-pressings-1' }).props.tabIndex).toBe(-1);
      expect(content()).toContain('Another pressing appeared.');
      expect(releaseChoice(1).props.checked).toBe(false);
      expect(renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.checked).toBe(true);
      expect(findButton('Review selection').props.disabled).toBe(false);
      expect(addAlbum).not.toHaveBeenCalled();
    }

    expect(importDiscogsCollection.mock.calls.map(([page]) => page)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(getAlbums.mock.calls.map(([shelf]) => shelf)).toEqual(['collection', 'wishlist', 'collection', 'wishlist']);
    await act(async () => releaseChoice(4)
      .props.onChange({ currentTarget: { checked: true } }));
    expect(JSON.parse(sessionStorage.getItem('side-a:discogs-import-review:v1')!).notices).toEqual([]);
    expect(findButton('Review selection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('offers a fresh alternate for a missing release and dismisses a persisted outcome when the title is already saved', async () => {
    sessionStorage.setItem('side-a:discogs-import-review:v1', JSON.stringify({ choices: [], lastPage: 2, destination: 'wishlist', notices: [{
      choice: { discogsId: 1, artist: 'Portishead', album: 'Dummy', source: 'bulk' }, cause: 'competing',
    }] }));
    const alternate = { ...albums[0], id: 4, discogsId: 4 };
    importDiscogsCollection.mockImplementation(async page => page === 1
      ? { albums: [albums[1]], page: 1, totalPages: 2, nextPage: 2 }
      : { albums: [alternate], page: 2, totalPages: 2 });
    const reload = async () => {
      await act(async () => renderer?.unmount());
      await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
      await act(async () => findButton('Resume review').props.onClick());
    };
    await reload();
    expect(content()).toContain('Unavailable on the refreshed pages.');
    expect(renderer.root.findByProps({ 'aria-label': 'Review pressing for Dummy by Portishead' }).props.href).toBe('#discogs-import-pressings-4');
    expect(findButton('Select all eligible titles (1 to add)')).toBeTruthy();

    getAlbums.mockImplementation(async shelf => ({ albums: shelf === 'collection'
      ? [{ discogs_id: 4, title: 'Dummy', artist_name: 'Portishead', status: 'collection' }] : [] }));
    await reload();
    expect(content()).toContain('Already in Collection.');
    expect(renderer.root.findAllByProps({ 'aria-label': 'Review pressing for Dummy by Portishead' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Select Dummy by Portishead' })).toHaveLength(0);
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    expect(content()).toContain('Saved review · 0 titles selected for Wishlist · 1 already saved');
    expect(content()).not.toContain('needs attention');
    await act(async () => findButton('Resume review').props.onClick());
    await act(async () => findButton('Dismiss review notice for Dummy by Portishead').props.onClick());
    await reload();
    expect(content()).not.toContain('Already in Collection.');
    expect(JSON.parse(sessionStorage.getItem('side-a:discogs-import-review:v1')!).notices).toEqual([]);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('resumes older drafts with the same session key and no notice field', async () => {
    sessionStorage.setItem('side-a:discogs-import-review:v1', JSON.stringify({
      choices: [{ discogsId: 2, artist: 'Portishead', album: 'Third', source: 'chosen' }],
      lastPage: 1,
      destination: 'wishlist',
    }));
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    await act(async () => findButton('Resume review').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.checked).toBe(true);
    expect(findButton('Review selection').props.disabled).toBe(false);
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps a pending pressing decision when an unrelated record imports', async () => {
    const alternate = { ...albums[0], id: 4, discogsId: 4 };
    importDiscogsCollection.mockImplementation(async page => page === 1
      ? { albums: albums.slice(0, 2), page: 1, totalPages: 2, nextPage: 2 }
      : { albums: [alternate], page: 2, totalPages: 2 });
    await loadCollection();
    await act(async () => findButton('Select all eligible titles (2 to add)').props.onClick());
    await act(async () => findButton('Load next Discogs page').props.onClick());
    await openImportReview();
    await act(async () => findButton('Import 1 title to Collection').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discogsId: 2 }), expect.any(AbortSignal));

    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(DiscogsImporter, importerProps)); });
    expect(content()).toContain('Saved review · 0 titles selected for Collection · 1 needs attention');
    await act(async () => findButton('Resume review').props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': 'Review pressings for Dummy by Portishead' })).toBeTruthy();
    expect(addAlbum).toHaveBeenCalledTimes(1);
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
      findButton('Select all eligible titles (3 to add)').props.onClick();
    });
    await openImportReview();
    await act(async () => {
      void findButton('Import 3 titles to Wishlist').props.onClick();
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
