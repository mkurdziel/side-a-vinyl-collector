import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album, DiscogsAlbum, PressingDetails } from '../src/services/api';
import { ApiError } from '../src/services/api';

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
import { CatalogPressingPicker } from '../src/components/CatalogPressingPicker';
import { PressingSelectionSummary } from '../src/components/PressingCandidates';
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
    const saved = { ...album, discogs_id: 993, year: 1995, cover_image_url: 'https://i.discogs.com/cover.jpg' };
    getPressingDetails.mockResolvedValue({ pressing: { catalogNumber: '828 522-1', label: 'Go! Beat', format: 'Vinyl LP', country: 'UK', year: 1994 } });
    await act(async () => { renderer = create(renderAlbum(saved)); });
    const field = (label: string) => textOf(renderer!.root.findAllByType('dt').find(term => textOf(term) === label)!
      .parent!.findByType('dd'));
    const pressingSection = () => textOf(renderer!.root.findByType('section'));
    expect(pressingSection()).toContain('Discogs release 993');
    expect(pressingSection()).not.toContain('Unverified artwork');
    expect(field('Catalog number')).toBe('828 522-1');
    expect(field('Label')).toBe('Go! Beat');
    expect(field('Format')).toBe('Vinyl LP');
    expect(field('Country')).toBe('UK');
    expect(textOf(renderer!.root)).toContain('Saved year 1995');
    expect(field('Release year')).toBe('1994');
    expect(field('Cover image source')).toContain('Unverified artwork.');
    await act(async () => renderer!.update(renderAlbum({ ...saved, cover_art_fetched: true })));
    expect(pressingSection()).toContain('Discogs release 993');
    expect(field('Cover image source')).toBe('Discogs');
    expect(getPressingDetails).toHaveBeenCalledTimes(1);
  });

  it('retries saved pressing details and cancels a retry when the saved release changes', async () => {
    const pending = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    const saved = { ...album, discogs_id: 993 };
    getPressingDetails.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ pressing: null });
    await act(async () => { renderer = create(renderAlbum(saved)); });
    const status = () => textOf(renderer!.root.findByProps({ role: 'status' }));
    expect(status()).toBe('Couldn’t load saved pressing details.');
    const retry = renderer!.root.findAllByType('button').find(button => textOf(button) === 'Retry pressing details');
    await act(async () => retry!.props.onClick());
    expect(status()).toBe('Checking Discogs…');
    const retrySignal: AbortSignal = getPressingDetails.mock.calls[1][1];
    await act(async () => renderer!.update(renderAlbum({ ...saved, discogs_id: 994 })));
    expect(retrySignal.aborted).toBe(true);
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([993, 993, 994]);
    await act(async () => pending.resolve({ pressing: { catalogNumber: 'STALE-993' } }));
    expect(status()).toBe('Discogs has no pressing details for this release.');
    expect(textOf(renderer!.root.findByType('section'))).not.toContain('STALE-993');
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
  const releaseStatuses = () => renderer!.root.findByType('thead').findAllByProps({ role: 'status' }).map(textOf);
  const button = (label: string) => renderer!.root.findAllByType('button').find(control => textOf(control) === label)!;
  const radio = (releaseId: number) => renderer!.root.findAllByType('input').find(control =>
    control.props.type === 'radio' && Number(control.props.value) === releaseId)!;
  const choose = (releaseId: number) => radio(releaseId).props.onChange({ target: { value: String(releaseId), checked: true } });
  const escape = () => renderer!.root.findByType('dialog').props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

  it('keeps the same fields while loading and retries only the failed release', async () => {
    const pending = Promise.withResolvers<{ pressing: PressingDetails | null }>();
    getPressingDetails.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ pressing: null })
      .mockResolvedValueOnce({ pressing: { catalogNumber: 'FETCHED-10', country: 'UK' } });
    await act(async () => { renderer = create(createComparison([{ ...album, discogs_id: 420 }])); });
    expect(releaseStatuses()).toEqual(['Catalog match: Checking Discogs…', 'Saved copy: Discogs has no additional details.']);
    expect(values('Catalog number')).toEqual(['SUMMARY-10', '—']);
    expect(values('Label')).toEqual(['—', '—']);

    await act(async () => pending.reject(new Error('Offline')));
    expect(releaseStatuses()).toEqual(['Catalog match: Discogs details couldn’t load.', 'Saved copy: Discogs has no additional details.']);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Retry details for catalog match' }).props.onClick());
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410, 420, 410]);
    expect(values('Catalog number')).toEqual(['FETCHED-10', '—']);
    expect(values('Format')).toEqual(['Vinyl', '—']);
    expect(values('Country')).toEqual(['UK', '—']);
    expect(releaseStatuses()[0]).toBe('Catalog match: Dashes mark unlisted details.');
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
    expect(releaseStatuses()).toEqual(['Catalog match: Checking Discogs…', 'Saved copy: No pressing linked']);

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
    const savedSelect = renderer!.root.findByType('select');
    expect(renderer!.root.findAllByType('table')).toHaveLength(0);
    expect(textOf(renderer!.root)).toContain('Saved pressing evidence');
    expect(radio(410).props.checked).toBe(false);
    expect(radio(430).props.checked).toBe(false);
    expect(savedSelect.props.value).toBe(1);
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([420]);
    await act(async () => choose(430));
    expect(savedSelect.props.value).toBe(1);
    expect(values('Catalog number')).toEqual(['ALT-30', '—']);
    expect(values('Release year')).toEqual(['2017', '—']);
    expect(values('Discogs release ID')).toEqual(['430', '420']);
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([420, 430]);
    expect(getPressingDetails.mock.calls[0][1].aborted).toBe(false);
  });

  it('shows saved and catalog evidence separately before choice, then puts differences first in the comparison', async () => {
    const pressing = { catalogNumber: 'S-5233', label: 'Capitol Records', format: 'Vinyl LP' };
    const first = { ...lookup, year: 1976, pressing: { ...pressing, country: 'US' } };
    const second = { ...alternate, year: 1981, pressing: { ...pressing, country: 'Canada' } };
    getPressingDetails.mockImplementation(async id => ({ pressing: id === 420
      ? { ...first.pressing, year: 1976, matrixRunouts: [{ value: 'S-5233 A-1' }] }
      : { ...second.pressing, year: 1981, matrixRunouts: [{ value: 'S-5233 A-2', description: 'Side A' }] } }));
    await act(async () => {
      renderer = create(createComparison([{ ...album, discogs_id: 420 }], { lookup: first, lookupChoices: [second], searchedNumber: 'S-5233' }));
    });
    const savedEvidence = renderer!.root.findAllByType('section').find(section => textOf(section).includes('Saved pressing evidence'))!;
    expect(textOf(savedEvidence)).toContain('CountryUS');
    expect(textOf(savedEvidence)).toContain('S-5233 A-1');
    expect(textOf(renderer!.root)).toContain('Canada');
    expect(renderer!.root.findAllByType('table')).toHaveLength(0);
    await act(async () => choose(430));
    const fields = renderer!.root.findByType('tbody').findAllByType('th').map(textOf);
    expect(fields.slice(0, 3)).toEqual(['Country', 'Release year', 'Matrix / Runout']);
    expect(values('Matrix / Runout')[0]).toContain('S-5233 A-2');
    expect(values('Matrix / Runout')[1]).toContain('S-5233 A-1');
  });

  it('confirms a replacement, allows retry, and focuses the persisted saved outcome', async () => {
    const saved = { ...album, discogs_id: 420, year: 1994 };
    const updated = { ...saved, discogs_id: 430 };
    const pending = Promise.withResolvers<{ album: Album; undoToken: string }>();
    const onSavePressing = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ album: updated, undoToken: 'previous-copy' });
    const onUndoPressing = vi.fn().mockResolvedValue(saved);
    const onClose = vi.fn();
    const outcomeFocus = vi.fn();
    const triggerFocus = vi.fn();
    getPressingDetails.mockImplementation(async id => ({ pressing: id === 430 ? { format: 'Vinyl · LP' } : null }));
    await act(async () => {
      renderer = create(createComparison([saved], { lookupChoices: [alternate, { ...alternate, releaseId: 450 }, { ...alternate, releaseId: 460 }],
        onSavePressing, onUndoPressing, onClose }), {
        createNodeMock: node => {
          if (node.props.role === 'status' && !node.props.className) return { focus: outcomeFocus };
          if (node.props.children === 'Use this pressing') return { focus: triggerFocus };
          return null;
        },
      });
    });
    expect(button('Use this pressing')).toBeUndefined();
    await act(async () => choose(430));
    await act(async () => button('More pressings').props.onClick());
    expect(radio(430)).toBeUndefined();
    await act(async () => button('Use this pressing').props.onClick());
    const confirmation = renderer!.root.findByProps({ role: 'group' });
    expect(textOf(confirmation)).toContain('Replace the pressing for Dummy in Collection?');
    expect(textOf(confirmation)).toContain('Currently saved as Discogs release 420.');
    expect(confirmation.findByType(PressingSelectionSummary).props.choice).toMatchObject({
      releaseId: 430, pressing: { catalogNumber: 'ALT-30', format: 'Vinyl · LP' }, year: 2017,
    });
    expect(onSavePressing).not.toHaveBeenCalled();
    await act(async () => button('Cancel').props.onClick());
    expect(triggerFocus).toHaveBeenCalledOnce();
    expect(onSavePressing).not.toHaveBeenCalled();

    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    expect(onSavePressing).toHaveBeenCalledExactlyOnceWith(saved, 430);
    expect(button('Saving pressing…').props['aria-busy']).toBe(true);
    expect(renderer!.root.findByType('fieldset').props.disabled).toBe(true);
    await act(async () => {
      button('Saving pressing…').props.onClick();
      renderer!.root.findByProps({ 'aria-label': 'Close pressing review' }).props.onClick();
      escape();
    });
    expect(onSavePressing).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => pending.reject(new Error('Offline')));
    expect(textOf(renderer!.root.findByProps({ role: 'alert' }))).toContain('Couldn’t update this saved pressing');
    await act(async () => button('Retry saving pressing').props.onClick());
    expect(values('Release year')).toEqual(['2017', '2017']);
    expect(onSavePressing).toHaveBeenCalledTimes(2);
    expect(values('Discogs release ID')).toEqual(['430', '430']);
    expect(textOf(renderer!.root)).toContain('Pressing updated. Saved in Collection · Discogs release 430');
    expect(outcomeFocus).toHaveBeenCalledOnce();
    expect(button('Use this pressing')).toBeUndefined();
    await act(async () => button('Undo pressing change').props.onClick());
    expect(onUndoPressing).toHaveBeenCalledExactlyOnceWith(updated, 'previous-copy');
    expect(textOf(renderer!.root)).toContain('Pressing change undone. Saved in Collection · Discogs release 420');
    expect(values('Discogs release ID')).toEqual(['430', '420']);
    expect(outcomeFocus).toHaveBeenCalledTimes(2);
    expect(button('Undo pressing change')).toBeUndefined();
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

  it('uses the first Escape to cancel inline confirmation and the second to close the review', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSavePressing = vi.fn();
    const onClose = vi.fn();
    const triggerFocus = vi.fn();
    await act(async () => {
      renderer = create(createComparison([album], { onSavePressing, onClose }), {
        createNodeMock: node => node.props.children === 'Use this pressing' ? { focus: triggerFocus } : null,
      });
    });
    expect(textOf(renderer!.root.findByType('h2'))).toBe('Review pressings');
    await act(async () => button('Use this pressing').props.onClick());
    expect(button('Confirm pressing')).toBeDefined();
    await act(async () => escape());
    expect(button('Confirm pressing')).toBeUndefined();
    expect(button('Use this pressing')).toBeDefined();
    expect(triggerFocus).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSavePressing).not.toHaveBeenCalled();
    await act(async () => escape());
    expect(onClose).toHaveBeenCalledOnce();
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
    expect(textOf(renderer!.root.findByProps({ role: 'group' }))).toContain('Currently saved as Discogs release 440.');
    expect(onSavePressing).toHaveBeenCalledTimes(1);
  });

  it.each([
    { discogs_id: 420, label: 'Keep current pressing' },
    { discogs_id: null, label: 'Leave pressing unconfirmed' },
  ])('offers $label beside confirmation when Discogs has no details', async ({ discogs_id, label }) => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSavePressing = vi.fn();
    const onClose = vi.fn();
    await act(async () => { renderer = create(createComparison([{ ...album, discogs_id }], { onSavePressing, onClose })); });
    expect(button(label)).toBeDefined();
    await act(async () => button('Use this pressing').props.onClick());
    expect(renderer!.root.findByProps({ role: 'group' }).findAllByType('button').map(textOf)).toContain(label);
    await act(async () => button(label).props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSavePressing).not.toHaveBeenCalled();
  });

  it('removes a saved copy on a save 404 and focuses the remaining copy', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const survivor = { ...album, id: 2, status: 'wishlist' as const };
    const onSavePressing = vi.fn().mockRejectedValue(new ApiError('This album is no longer saved.', 404));
    const onSavedCopyRemoved = vi.fn();
    const outcomeFocus = vi.fn();
    await act(async () => {
      renderer = create(createComparison([album, survivor], { onSavePressing, onSavedCopyRemoved }), {
        createNodeMock: node => node.props.role === 'status' && !node.props.className ? { focus: outcomeFocus } : null,
      });
    });
    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    expect(onSavedCopyRemoved).toHaveBeenCalledExactlyOnceWith(album.id);
    expect(textOf(renderer!.root)).toContain('Showing a remaining copy.');
    expect(textOf(renderer!.root)).toContain('Saved in Wishlist');
    expect(outcomeFocus).toHaveBeenCalledOnce();
    expect(button('Retry saving pressing')).toBeUndefined();
  });

  it('offers and focuses a return action when Undo finds the only copy removed', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSavePressing = vi.fn().mockResolvedValue({ album: { ...album, discogs_id: 410 }, undoToken: 'previous-copy' });
    const onUndoPressing = vi.fn().mockRejectedValue(new ApiError('This album is no longer saved.', 404));
    const onSavedCopyRemoved = vi.fn();
    const onClose = vi.fn();
    const returnFocus = vi.fn();
    await act(async () => {
      renderer = create(createComparison([album], { onSavePressing, onUndoPressing, onSavedCopyRemoved, onClose }), {
        createNodeMock: node => node.props.children === 'Back to results' ? { focus: returnFocus } : null,
      });
    });
    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    await act(async () => button('Undo pressing change').props.onClick());
    expect(onSavedCopyRemoved).toHaveBeenCalledExactlyOnceWith(album.id);
    expect(button('Retry undo')).toBeUndefined();
    expect(returnFocus).toHaveBeenCalledOnce();
    await act(async () => button('Back to results').props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows loading, retry, and no matches when launched from a saved album', async () => {
    const onRetryLookup = vi.fn();
    const render = (lookupStatus: 'pending' | 'error' | 'ready') => createComparison([album], {
      lookup: undefined, lookupStatus, onRetryLookup, onOpenSaved: undefined, backLabel: 'Back to album',
    });
    await act(async () => { renderer = create(render('pending')); });
    expect(textOf(renderer!.root)).toContain('Finding matching pressings on Discogs');
    expect(button('Open saved album')).toBeUndefined();
    await act(async () => renderer!.update(render('error')));
    await act(async () => button('Retry catalog search').props.onClick());
    expect(onRetryLookup).toHaveBeenCalledOnce();
    await act(async () => renderer!.update(render('ready')));
    expect(textOf(renderer!.root)).toContain('No matching Discogs pressings found.');
    expect(button('Back to album')).toBeDefined();
  });
});

describe('saving a new catalog pressing', () => {
  const releases: DiscogsAlbum[] = [410, 420, 430, 440].map(id => ({
    id, discogsId: id, discogsListing: 'release', album: album.title, artist: album.artist_name, year: 1994,
    pressing: { catalogNumber: `PL-${id}`, country: 'UK', format: 'Vinyl LP' },
  }));
  const createPicker = (overrides: Partial<Parameters<typeof CatalogPressingPicker>[0]>) => createElement(CatalogPressingPicker, {
    album: { ...releases[0], pressingChoices: releases }, destination: 'collection',
    opener: { current: null }, fallback: { current: null }, onSave: vi.fn(), onClose: vi.fn(), ...overrides,
  });
  const button = (label: string) => renderer!.root.findAllByType('button').find(control => textOf(control) === label)!;

  it('keeps enriched evidence beside Save pressing after the selected candidate leaves the page', async () => {
    getPressingDetails.mockImplementation(async releaseId => ({ pressing: releaseId === 410 ? { label: 'Go! Beat' } : null }));
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    await act(async () => { renderer = create(createPicker({ onSave, onClose })); });
    await act(async () => renderer!.root.findAllByType('input').find(control => control.props.value === 410)!.props.onChange());
    await act(async () => button('Compare runout markings').props.onClick());
    await act(async () => button('More pressings').props.onClick());
    expect(renderer!.root.findAllByType('input').some(control => control.props.value === 410)).toBe(false);
    const commit = renderer!.root.findByProps({ 'aria-label': 'Save album' });
    expect(commit.findByType(PressingSelectionSummary).props.choice).toMatchObject({
      releaseId: 410, pressing: { catalogNumber: 'PL-410', label: 'Go! Beat', country: 'UK', format: 'Vinyl LP' },
    });
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(releases[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can save the album without a pressing after finding no runout evidence', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSaveWithoutPressing = vi.fn().mockResolvedValue(true);
    const onSave = vi.fn();
    const onClose = vi.fn();
    await act(async () => { renderer = create(createPicker({ onSave, onSaveWithoutPressing, onClose })); });
    await act(async () => button('Compare runout markings').props.onClick());
    expect(textOf(renderer!.root)).toContain('Discogs lists no runout markings');
    const saveWithout = 'Save without pressing to Collection';
    expect(renderer!.root.findByProps({ 'aria-label': 'Save album' }).findAllByType('button').map(textOf)).toContain(saveWithout);
    await act(async () => button(saveWithout).props.onClick());
    expect(onSaveWithoutPressing).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
