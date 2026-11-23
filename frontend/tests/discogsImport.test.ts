import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { importDiscogsCollection, addAlbum } = vi.hoisted(() => ({
  importDiscogsCollection: vi.fn(),
  addAlbum: vi.fn(),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { importDiscogsCollection, addAlbum },
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
  vi.resetAllMocks();
  importDiscogsCollection.mockResolvedValue({ albums, count: albums.length });
  addAlbum.mockResolvedValue({});
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

    expect(content()).toContain('1 imported · 1 already in your library · 1 failed');
    expect(content()).toContain('Imported to Collection');
    expect(content()).toContain('Import to Collection failed');
    expect(findButton('Retry import of Roseland NYC Live').props.disabled).toBe(false);
    expect(importerProps.onSuccess).toHaveBeenCalledOnce();

    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, open: false })));
    expect(renderer.toJSON()).toBeNull();
    await act(async () => renderer.update(createElement(DiscogsImporter, { ...importerProps, viewMode: 'wishlist' })));

    expect(content()).toContain('1 imported · 1 already in your library · 1 failed');
    expect(content()).toContain('New imports go to Wishlist.');
    await act(async () => findButton('Retry failed (1)').props.onClick());
    expect(addAlbum).toHaveBeenCalledTimes(4);
    expect(addAlbum).toHaveBeenLastCalledWith(expect.objectContaining({ discogsId: 3, status: 'collection' }));
    expect(content()).toContain('2 imported · 1 already in your library');
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
    expect(renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.disabled).toBe(true);

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
    expect(content()).toContain('3 imported');
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
    expect(findButton('Import 2 records to Collection').props.disabled).toBe(false);
  });

  it('imports only the checked subset', async () => {
    await loadCollection();
    expect(findButton('Import selected records').props.disabled).toBe(true);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select Third by Portishead' }).props.onChange({ currentTarget: { checked: true } }));
    await act(async () => findButton('Import 1 record to Collection').props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discogsId: 2, status: 'collection' }));
    expect(content()).toContain('1 imported');
    expect(renderer.root.findByProps({ 'aria-label': 'Select Dummy by Portishead' }).props.checked).toBe(false);
  });

  it('gives server setup instructions only when configuration is missing', async () => {
    const props = {
      onBarcodeClick: vi.fn(), onImageClick: vi.fn(), onSearchClick: vi.fn(),
      onImportClick: vi.fn(), onClose: vi.fn(), viewMode: 'collection' as const,
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
