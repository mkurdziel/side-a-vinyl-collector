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
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
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
  const alternate = { artist: album.artist_name, releaseId: 430, year: 2017, pressing: { catalogNumber: 'ALT-30', format: 'Vinyl LP' } };
  const createComparison = (matches: Album[], overrides?: Partial<Parameters<typeof PressingComparison>[0]>) => createElement(PressingComparison, {
    title: album.title, lookup, matches, onClose: vi.fn(), onOpenSaved: vi.fn(),
    returnFocusTo: { current: null }, fallbackFocusTo: { current: null }, ...overrides,
  });
  const values = (label: string) => renderer!.root.findByType('tbody').findAllByType('tr')
    .find(row => textOf(row.findByType('th')) === label)!.findAllByType('td').map(textOf);
  const releaseStatuses = () => renderer!.root.findByType('tbody').findAllByProps({ role: 'status' }).map(textOf);
  const button = (label: string) => renderer!.root.findAllByType('button').find(control => textOf(control) === label)!;

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

  it('compares the selected catalog alternative while retaining the selected saved copy', async () => {
    getPressingDetails.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      renderer = create(createComparison([{ ...album, discogs_id: 420 }, { ...album, id: 2 }], {
        lookupChoices: [lookup, alternate],
      }));
    });
    const [catalogSelect, savedSelect] = renderer!.root.findAllByType('select');
    expect(catalogSelect.props.value).toBe(410);
    expect(catalogSelect.findAllByType('option').map(textOf)).toEqual([
      'SUMMARY-10 · Vinyl · Discogs release 410', 'ALT-30 · Vinyl LP · 2017 · Discogs release 430',
    ]);
    expect(savedSelect.props.value).toBe(1);
    await act(async () => catalogSelect.props.onChange({ target: { value: '430' } }));
    expect(savedSelect.props.value).toBe(1);
    expect(values('Catalog number')).toEqual(['ALT-30', '—']);
    expect(values('Release year')).toEqual(['2017', '—']);
    expect(values('Discogs release ID')).toEqual(['430', '420']);
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410, 420, 430]);
    expect(getPressingDetails.mock.calls[0][1].aborted).toBe(true);
    expect(getPressingDetails.mock.calls[1][1].aborted).toBe(false);
  });

  it('confirms a replacement, allows retry, and focuses the persisted saved outcome', async () => {
    const saved = { ...album, discogs_id: 420, year: 1994 };
    const pending = Promise.withResolvers<Album>();
    const onSavePressing = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ ...saved, discogs_id: 430 });
    const onClose = vi.fn();
    const outcomeFocus = vi.fn();
    const triggerFocus = vi.fn();
    getPressingDetails.mockResolvedValue({ pressing: null });
    await act(async () => {
      renderer = create(createComparison([saved], { lookupChoices: [alternate], onSavePressing, onClose }), {
        createNodeMock: node => {
          if (node.props.className === 'rh-comparison-outcome mt-2') return { focus: outcomeFocus };
          if (node.props.children === 'Use this pressing') return { focus: triggerFocus };
          return null;
        },
      });
    });
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: '430' } }));
    await act(async () => button('Use this pressing').props.onClick());
    const confirmation = renderer!.root.findByProps({ role: 'group' });
    expect(textOf(confirmation)).toContain('ALT-30 · Vinyl LP · 2017 · Discogs release 430 for Dummy in Collection');
    expect(textOf(confirmation)).toContain('This will replace Discogs release 420');
    expect(onSavePressing).not.toHaveBeenCalled();
    await act(async () => button('Cancel').props.onClick());
    expect(triggerFocus).toHaveBeenCalledOnce();
    expect(onSavePressing).not.toHaveBeenCalled();

    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    expect(onSavePressing).toHaveBeenCalledExactlyOnceWith(saved, 430);
    expect(button('Saving pressing…').props['aria-busy']).toBe(true);
    expect(renderer!.root.findByType('select').props.disabled).toBe(true);
    await act(async () => {
      button('Saving pressing…').props.onClick();
      renderer!.root.findByProps({ 'aria-label': 'Close pressing comparison' }).props.onClick();
    });
    expect(onSavePressing).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => pending.reject(new Error('Offline')));
    expect(textOf(renderer!.root.findByProps({ role: 'alert' }))).toContain('Couldn’t update this saved pressing');
    await act(async () => button('Retry saving pressing').props.onClick());
    expect(values('Release year')).toEqual(['2017', '2017']);
    expect(onSavePressing).toHaveBeenCalledTimes(2);
    expect(values('Discogs release ID')).toEqual(['430', '430']);
    expect(textOf(renderer!.root.findByProps({ 'aria-live': 'polite' }))).toContain('Pressing updated. Saved in Collection · Discogs release 430');
    expect(outcomeFocus).toHaveBeenCalledOnce();
    expect(button('Use this pressing')).toBeUndefined();
  });

  it('omits saving for an already matched release and drops confirmation when the copy changes', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const saved = { ...album, discogs_id: 410 };
    const otherCopy = { ...album, id: 2, status: 'wishlist' as const };
    const onSavePressing = vi.fn();
    await act(async () => { renderer = create(createComparison([saved, otherCopy], { onSavePressing })); });
    expect(textOf(renderer!.root)).toContain('This pressing is already saved.');
    expect(button('Use this pressing')).toBeUndefined();
    const select = renderer!.root.findByType('select');
    await act(async () => select.props.onChange({ target: { value: '2' } }));
    await act(async () => button('Use this pressing').props.onClick());
    expect(textOf(renderer!.root.findByProps({ role: 'group' }))).toContain('Wishlist, saved record 2');
    await act(async () => select.props.onChange({ target: { value: '1' } }));
    expect(button('Confirm pressing')).toBeUndefined();
    expect(onSavePressing).not.toHaveBeenCalled();
  });

  it('requires a fresh confirmation when a failed save surfaces a newer saved pressing', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const pending = Promise.withResolvers<Album>();
    const onSavePressing = vi.fn().mockReturnValueOnce(pending.promise);
    const render = (discogs_id: number) => createComparison([{ ...album, discogs_id }], { onSavePressing });
    await act(async () => { renderer = create(render(420)); });
    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    await act(async () => {
      renderer!.update(render(440));
      pending.reject(new Error('Saved pressing changed'));
    });
    expect(values('Discogs release ID')).toEqual(['410', '440']);
    expect(textOf(renderer!.root)).toContain('The saved pressing changed. Check the updated evidence before confirming again.');
    expect(button('Retry saving pressing')).toBeUndefined();
    await act(async () => button('Use this pressing').props.onClick());
    expect(textOf(renderer!.root.findByProps({ role: 'group' }))).toContain('This will replace Discogs release 440');
    expect(onSavePressing).toHaveBeenCalledTimes(1);
  });
});
