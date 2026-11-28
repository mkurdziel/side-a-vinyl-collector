import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album, PressingDetails } from '../src/services/api';

const { getPressingDetails, searchCoverArt, updateCoverArt } = vi.hoisted(() => ({
  getPressingDetails: vi.fn(), searchCoverArt: vi.fn(), updateCoverArt: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/api', () => ({
  default: { getPressingDetails, searchCoverArt, updateCoverArt },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));
import { AlbumDetailModal } from '../src/components/AlbumDetailModal';
import { PressingComparison } from '../src/components/PressingComparison';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const album: Album = {
  id: 1, title: 'Dummy', artist_name: 'Portishead',
  added_at: '2026-01-01T00:00:00Z', status: 'collection',
};
const callbacks = { onClose: vi.fn(), onRefresh: vi.fn() };
const renderAlbum = (value: Album) => createElement(AlbumDetailModal, { ...callbacks, album: value });
const textOf = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('album details state', () => {
  it('updates immediately when the parent supplies another album', async () => {
    await act(async () => { renderer = create(renderAlbum(album)); });
    const replacement = { ...album, id: 2, title: 'Third' };
    await act(async () => renderer!.update(renderAlbum(replacement)));
    expect(renderer!.root.findByType('h3').children).toEqual(['Third']);
    expect(renderer!.root.findByType('img').props.src).toBe('/api/cover-art/2');
    await act(async () => renderer!.update(renderAlbum(album)));
    expect(renderer!.root.findByType('h3').children).toEqual(['Dummy']);
  });

  it('keeps a local artwork update until a new album prop arrives', async () => {
    vi.useFakeTimers();
    searchCoverArt.mockResolvedValue({ results: [{ source: 'Discogs', id: 1, title: 'Candidate', url: '/new.jpg' }] });
    updateCoverArt.mockResolvedValue({ album: { id: album.id, cover_image_url: '/new.jpg', local_cover_path: '1_new.jpg' } });
    await act(async () => { renderer = create(renderAlbum(album)); });
    const search = renderer!.root.findAllByType('button').find(button => button.children.includes('Find different artwork'));
    await act(async () => search!.props.onClick());
    const useCover = renderer!.root.findByProps({ 'aria-label': 'Use Candidate cover from Discogs' });
    await act(async () => useCover.props.onClick());
    await act(async () => renderer!.update(renderAlbum(album)));
    expect(renderer!.root.findByType('img').props.src).toBe('/api/cover-art/1?v=1_new.jpg');
    expect(callbacks.onRefresh).toHaveBeenCalledWith({ ...album, cover_image_url: '/new.jpg', local_cover_path: '1_new.jpg' });
    await act(async () => renderer!.update(renderAlbum({ ...album, local_cover_path: '1_parent.jpg' })));
    expect(renderer!.root.findByType('img').props.src).toBe('/api/cover-art/1?v=1_parent.jpg');
  });

  it('shows an unverified cover separately from a known saved pressing', async () => {
    const saved = { ...album, discogs_id: 993, cover_image_url: 'https://i.discogs.com/cover.jpg' };
    await act(async () => { renderer = create(renderAlbum(saved)); });
    const field = (label: string) => textOf(renderer!.root.findAllByType('dt').find(term => textOf(term) === label)!
      .parent!.findByType('dd'));
    expect(field('Saved pressing')).toContain('Discogs release 993');
    expect(field('Saved pressing')).not.toContain('Unverified artwork');
    expect(field('Cover image source')).toContain('Unverified artwork.');
    await act(async () => renderer!.update(renderAlbum({ ...saved, cover_art_fetched: true })));
    expect(field('Saved pressing')).toContain('Discogs release 993');
    expect(field('Cover image source')).toBe('Discogs');
  });
});

describe('pressing comparison evidence', () => {
  const lookup = { artist: album.artist_name, releaseId: 410, pressing: { catalogNumber: 'SUMMARY-10', format: 'Vinyl' } };
  const createComparison = (matches: Album[]) => createElement(PressingComparison, {
    title: album.title, lookup, matches, onClose: vi.fn(), onOpenSaved: vi.fn(),
    returnFocusTo: { current: null }, fallbackFocusTo: { current: null },
  });
  const values = (label: string) => renderer!.root.findByType('tbody').findAllByType('tr')
    .find(row => textOf(row.findByType('th')) === label)!.findAllByType('td').map(textOf);
  const releaseStatuses = () => renderer!.root.findByType('tbody').findAllByProps({ role: 'status' }).map(textOf);

  it('keeps the same fields while loading and retries only the failed release', async () => {
    const pending = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    getPressingDetails.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ pressing: null })
      .mockResolvedValueOnce({ pressing: { catalogNumber: 'FETCHED-10', country: 'UK' } });
    await act(async () => { renderer = create(createComparison([{ ...album, discogs_id: 420 }])); });
    expect(releaseStatuses()).toEqual(['Catalog match: Checking Discogs…', 'Saved copy: No details returned']);
    expect(values('Catalog number')).toEqual(['SUMMARY-10', '—']);
    expect(values('Label')).toEqual(['—', '—']);

    await act(async () => pending.reject(new Error('Offline')));
    expect(releaseStatuses()).toEqual(['Catalog match: Couldn’t load details', 'Saved copy: No details returned']);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Retry details for catalog match' }).props.onClick());
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410, 420, 410]);
    expect(values('Catalog number')).toEqual(['FETCHED-10', '—']);
    expect(values('Format')).toEqual(['Vinyl', '—']);
    expect(values('Country')).toEqual(['UK', '—']);
  });

  it('deduplicates a shared release and cancels a request for a copy that is no longer selected', async () => {
    getPressingDetails.mockImplementation(() => new Promise(() => {}));
    const matches = [
      { ...album, discogs_id: 410 }, { ...album, id: 2, discogs_id: 420 }, { ...album, id: 3 },
    ];
    await act(async () => { renderer = create(createComparison(matches)); });
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410]);

    const select = renderer!.root.findByType('select');
    await act(async () => select.props.onChange({ target: { value: '2' } }));
    const lookupSignal: AbortSignal = getPressingDetails.mock.calls[0][1];
    const oldSavedSignal: AbortSignal = getPressingDetails.mock.calls[1][1];
    await act(async () => select.props.onChange({ target: { value: '3' } }));
    expect(lookupSignal.aborted).toBe(false);
    expect(oldSavedSignal.aborted).toBe(true);
    expect(releaseStatuses()).toEqual(['Catalog match: Checking Discogs…', 'Saved copy: No specific release']);

    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(lookupSignal.aborted).toBe(true);
  });
});
