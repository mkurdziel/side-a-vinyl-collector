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
import { SaveDestinationActions } from '../src/components/SaveDestinationActions';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const album: Album = {
  id: 1, title: 'Dummy', artist_name: 'Portishead',
  added_at: '2026-01-01T00:00:00Z', status: 'collection',
};
const callbacks = { onClose: vi.fn(), onRefresh: vi.fn() };
const renderAlbum = (value: Album) => createElement(AlbumDetailModal, { ...callbacks, album: value });
const textOf = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const mediaFilter = () => {
  const label = renderer!.root.findAllByType('label').find(control => textOf(control) === 'Media')!;
  return renderer!.root.findByProps({ id: label.props.htmlFor });
};

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
    const preview = renderer!.root.findByProps({ 'aria-label': 'Preview Candidate cover from Discogs' });
    await act(async () => preview.props.onClick());
    await act(async () => renderer!.root.findByProps({ src: '/new.jpg' }).props.onLoad({ currentTarget: { naturalWidth: 600, naturalHeight: 600 } }));
    const apply = renderer!.root.findAllByType('button').find(button => button.children.includes('Apply artwork'));
    await act(async () => apply!.props.onClick());
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
  const evidenceTable = () => renderer!.root.findAllByType('table')
    .find(table => textOf(table.findByType('caption')).startsWith('Catalog evidence'))!;
  const values = (label: string) => evidenceTable().findByType('tbody').findAllByType('tr')
    .find(row => row.findByType('th').children[0] === label)!.findAllByType('td').map(textOf);
  const releaseStatuses = () => evidenceTable().findByType('thead').findAllByProps({ role: 'status' }).map(textOf);
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
    expect(evidenceTable()).toBeUndefined();
    await act(async () => button('Compare listings').props.onClick());
    expect(releaseStatuses()).toEqual(['Catalog listing: Checking Discogs…', 'Saved copy: Discogs has no additional details.']);
    expect(values('Catalog number')).toEqual(['SUMMARY-10', 'Unlisted']);
    expect(values('Label')).toEqual(['Checking…', 'Unlisted']);

    await act(async () => pending.reject(new Error('Offline')));
    expect(releaseStatuses()).toEqual(['Catalog listing: Discogs details couldn’t load.', 'Saved copy: Discogs has no additional details.']);
    expect(renderer!.root.findAllByType('summary').map(textOf)).toContain('Full pressing comparison · Details unavailable');
    expect(values('Label')).toEqual(['Unavailable', 'Unlisted']);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Retry details for catalog listing' }).props.onClick());
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410, 420, 410]);
    expect(values('Catalog number')).toEqual(['FETCHED-10', 'Unlisted']);
    expect(values('Format')).toEqual(['Vinyl', 'Unlisted']);
    expect(values('Release country')).toEqual(['UK', 'Unlisted']);
    expect(releaseStatuses()[0]).toBe('Catalog listing: Discogs details loaded.');
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
    expect(button('Compare listings')).toBeUndefined();
    await act(async () => button('Inspect listing evidence').props.onClick());
    expect(textOf(renderer!.root.findByType('thead'))).toBe('EvidenceCatalog listing 410');
    expect(evidenceTable()).toBeUndefined();

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
    await act(async () => button('Compare listings').props.onClick());
    expect(textOf(renderer!.root.findByType('table'))).toContain('Saved pressing 420');
    expect(textOf(renderer!.root)).toContain('Saved pressing evidence');
    expect(radio(410).props.checked).toBe(false);
    expect(radio(430).props.checked).toBe(false);
    expect(savedSelect.props.value).toBe(1);
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([420]);
    await act(async () => choose(430));
    expect(savedSelect.props.value).toBe(1);
    expect(values('Catalog number')).toEqual(['ALT-30', 'Checking…']);
    expect(values('Release year')).toEqual(['2017', 'Checking…']);
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
    await act(async () => button('Compare listings').props.onClick());
    const savedEvidence = renderer!.root.findAllByType('details').find(section => textOf(section).includes('Saved pressing evidence'))!;
    expect(textOf(savedEvidence)).toContain('Release countryUS');
    expect(textOf(savedEvidence)).toContain('S-5233 A-1');
    expect(textOf(renderer!.root)).toContain('Canada');
    expect(textOf(renderer!.root.findByType('table'))).toContain('Saved pressing 420');
    await act(async () => choose(430));
    const fields = evidenceTable().findByType('tbody').findAllByType('th').map(textOf);
    expect(fields.slice(0, 3)).toEqual(['Release countryDiffers', 'Release yearDiffers', 'Runout markingsDiffers']);
    expect(values('Runout markings')[0]).toContain('S-5233 A-2');
    expect(values('Runout markings')[1]).toContain('S-5233 A-1');
  });

  it('cancels pressing confirmation when a media filter excludes the selected release', async () => {
    getPressingDetails.mockResolvedValue({ pressing: null });
    const onSavePressing = vi.fn();
    const vinyl = { ...lookup, pressing: { format: 'Vinyl · LP' } };
    const otherMedia = [
      { ...alternate, pressing: { format: 'CD · Album' } },
      { ...alternate, releaseId: 450, pressing: { format: 'Cassette · Album' } },
      { ...alternate, releaseId: 460, pressing: { format: 'Vinyl · LP' } },
    ];
    await act(async () => {
      renderer = create(createComparison([{ ...album, discogs_id: 420 }], { lookup: vinyl, lookupChoices: otherMedia, onSavePressing }));
    });
    await act(async () => choose(410));
    await act(async () => button('Use this pressing').props.onClick());
    expect(button('Confirm pressing')).toBeDefined();
    await act(async () => button('Compare listings').props.onClick());
    await act(async () => mediaFilter().props.onChange({ target: { value: 'CD' } }));
    expect(button('Confirm pressing')).toBeUndefined();
    expect(button('Use this pressing')).toBeUndefined();
    expect(textOf(renderer!.root)).toContain('The selected pressing is outside the CD filter.');
    expect(onSavePressing).not.toHaveBeenCalled();
    await act(async () => button('Show selected pressing in All media').props.onClick());
    expect(radio(410).props.checked).toBe(true);
    expect(button('Use this pressing')).toBeDefined();
    expect(button('Confirm pressing')).toBeUndefined();
  });

  it('confirms a replacement, allows retry, and focuses the persisted saved outcome', async () => {
    const saved = { ...album, discogs_id: 420, year: 1994 };
    const updated = { ...saved, discogs_id: 430 };
    const pending = Promise.withResolvers<{ album: Album; undoToken: string }>();
    const expiresAt = '2026-11-27T20:10:00Z';
    const onSavePressing = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ album: updated, undoToken: 'previous-copy', expiresAt });
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
    const reviewEvidence = renderer!.root.findByProps({ 'aria-label': 'Pressing evidence' });
    const actions = renderer!.root.findByProps({ 'aria-label': 'Pressing actions' });
    expect(reviewEvidence.props.tabIndex).toBe(0);
    expect(reviewEvidence.parent).toBe(actions.parent);
    await act(async () => button('Compare listings').props.onClick());
    expect(evidenceTable()).toBeDefined();
    const selectionSummary = actions.findByType(PressingSelectionSummary);
    expect(selectionSummary.props).toMatchObject({ identityOnly: true, choice: { releaseId: 430 } });
    expect(textOf(selectionSummary)).toContain('Selected pressing');
    expect(button('Use this pressing').props['aria-describedby']).toBe(selectionSummary.props.id);
    expect(actions.findAllByType('button').map(textOf)).toContain('Keep current pressing');
    await act(async () => button('Use this pressing').props.onClick());
    const confirmation = actions.findByProps({ role: 'group' });
    expect(textOf(confirmation)).toContain('Replace the pressing for Dummy in Collection?');
    expect(textOf(confirmation)).toContain('This replaces Discogs release 420 with the selected release.');
    expect(confirmation.findByType(PressingSelectionSummary).props).toMatchObject({
      compact: true, choice: { releaseId: 430, pressing: { catalogNumber: 'ALT-30', format: 'Vinyl · LP' }, year: 2017 },
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
    expect(onSavePressing).toHaveBeenCalledTimes(2);
    expect(evidenceTable()).toBeUndefined();
    expect(textOf(renderer!.root.findByType('thead'))).toContain('Saved pressing selected 430');
    expect(textOf(renderer!.root)).toContain('Pressing updated. Saved in Collection · Discogs release 430');
    expect(renderer!.root.findByType('time').props.dateTime).toBe(expiresAt);
    expect(textOf(renderer!.root.findByType('time').parent!)).toContain('here or in Recent library changes.');
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
    expect(radio(410).props.checked).toBe(false);
    expect(button('Use this pressing')).toBeUndefined();
    await act(async () => choose(410));
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
    expect(button('Use this pressing')).toBeUndefined();
    await act(async () => choose(410));
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
    await act(async () => choose(410));
    await act(async () => button('Use this pressing').props.onClick());
    await act(async () => button('Confirm pressing').props.onClick());
    await act(async () => {
      renderer!.update(render(440));
      pending.reject(new Error('Saved pressing changed'));
    });
    expect(textOf(renderer!.root)).toContain('The saved pressing changed. Open the listing evidence before confirming again.');
    await act(async () => button('Compare listings').props.onClick());
    expect(values('Discogs release ID')).toEqual(['410', '440']);
    expect(button('Retry saving pressing')).toBeUndefined();
    await act(async () => button('Use this pressing').props.onClick());
    const actions = renderer!.root.findByProps({ 'aria-label': 'Pressing actions' });
    expect(textOf(actions.findByProps({ role: 'group' }))).toContain('This replaces Discogs release 440 with the selected release.');
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
    await act(async () => choose(410));
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
    await act(async () => choose(410));
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
    await act(async () => choose(410));
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

  it('requires an explicit choice for one pressing and keeps retry and album-only save available', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onSaveWithoutPressing = vi.fn();
    getPressingDetails.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ pressing: null });
    await act(async () => {
      renderer = create(createPicker({ album: releases[0], destination: 'wishlist', onSave, onSaveWithoutPressing }));
    });
    const candidate = renderer!.root.findByProps({ type: 'radio', value: 410 });
    const submit = () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    expect(candidate.props.checked).toBe(false);
    expect(button('Save pressing').props['aria-disabled']).toBe(true);
    expect(button('Save without pressing').props['aria-label']).toBe('Save without pressing to Wishlist');
    const footer = renderer!.root.findByType('footer');
    expect(textOf(footer)).toContain('Save to Wishlist');
    expect(textOf(footer.findByProps({ id: button('Save pressing').props['aria-describedby'] }))).toBe('Choose a pressing to save it.');
    await act(async () => submit());
    expect(onSave).not.toHaveBeenCalled();

    expect(button('Compare listings')).toBeUndefined();
    await act(async () => button('Inspect listing evidence').props.onClick());
    expect(textOf(renderer!.root.findByType('thead'))).toBe('EvidenceCatalog listing 410');
    await act(async () => button('Check runout marks').props.onClick());
    await act(async () => button('Retry runout markings').props.onClick());
    expect(getPressingDetails.mock.calls.map(([id]) => id)).toEqual([410, 410]);
    expect(textOf(renderer!.root)).toContain('Discogs lists no runout markings for release 410.');
    expect(button('Save without pressing').props['aria-disabled']).toBe(false);
    await act(async () => candidate.props.onChange());
    expect(button('Save pressing').props['aria-disabled']).toBe(false);
    await act(async () => submit());
    expect(onSave).toHaveBeenCalledExactlyOnceWith(releases[0]);
    expect(onSaveWithoutPressing).not.toHaveBeenCalled();
  });

  it('keeps enriched evidence beside Save pressing after the selected candidate leaves the page', async () => {
    getPressingDetails.mockImplementation(async releaseId => ({ pressing: releaseId === 410 ? { label: 'Go! Beat' } : null }));
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const focusedRadio = { matches: vi.fn().mockReturnValue(true), scrollIntoView: vi.fn() };
    const evidenceNode = { ownerDocument: { activeElement: focusedRadio }, contains: vi.fn().mockReturnValue(true) };
    await act(async () => {
      renderer = create(createPicker({ onSave, onClose }), {
        createNodeMock: node => node.props['aria-label'] === 'Pressing evidence' ? evidenceNode : null,
      });
    });
    expect(focusedRadio.scrollIntoView).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findAllByType('input').find(control => control.props.value === 410)!.props.onChange());
    expect(focusedRadio.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' });
    await act(async () => button('Compare listings').props.onClick());
    await act(async () => button('Check runout marks').props.onClick());
    await act(async () => button('More pressings').props.onClick());
    expect(renderer!.root.findAllByType('input').some(control => control.props.value === 410)).toBe(false);
    const commit = renderer!.root.findByProps({ 'aria-label': 'Save album' });
    const reviewEvidence = renderer!.root.findByProps({ 'aria-label': 'Pressing evidence' });
    expect(reviewEvidence.props.tabIndex).toBe(0);
    expect(reviewEvidence.parent).toBe(commit.parent);
    expect(textOf(commit)).toContain('Save to Collection');
    expect(commit.findByType(PressingSelectionSummary).props).toMatchObject({
      identityOnly: true, choice: { releaseId: 410, pressing: { catalogNumber: 'PL-410', label: 'Go! Beat', country: 'UK', format: 'Vinyl LP' } },
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
    await act(async () => button('Compare listings').props.onClick());
    await act(async () => button('Check runout marks').props.onClick());
    expect(textOf(renderer!.root)).toContain('Discogs lists no runout markings');
    const saveWithout = 'Save without pressing';
    const commit = renderer!.root.findByProps({ 'aria-label': 'Save album' });
    expect(commit.findAllByType('button').map(textOf)).toContain(saveWithout);
    expect(textOf(commit)).toContain('Save to Collection');
    await act(async () => button(saveWithout).props.onClick());
    expect(onSaveWithoutPressing).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('blocks form submission for a retained selection outside the active media filter', async () => {
    const choices = releases.map((release, index) => ({
      ...release, pressing: { ...release.pressing, format: index === 1 ? 'CD · Album' : 'Vinyl · LP' },
    }));
    const onSave = vi.fn().mockResolvedValue(true);
    const onSaveWithoutPressing = vi.fn();
    await act(async () => {
      renderer = create(createPicker({ album: { ...choices[0], pressingChoices: choices }, onSave, onSaveWithoutPressing }));
    });
    await act(async () => button('Compare listings').props.onClick());
    const select = mediaFilter();
    const submit = () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    await act(async () => renderer!.root.findByProps({ type: 'radio', value: 410 }).props.onChange());
    await act(async () => select.props.onChange({ target: { value: 'CD' } }));
    expect(button('Save pressing').props['aria-disabled']).toBe(true);
    expect(button('Save without pressing').props['aria-disabled']).toBe(false);
    await act(async () => submit());
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => button('Show selected pressing in All media').props.onClick());
    expect(button('Save pressing').props['aria-disabled']).toBe(false);
    await act(async () => submit());
    expect(onSave).toHaveBeenCalledExactlyOnceWith(choices[0]);
  });
});

describe('pressing choices on save results', () => {
  const catalogLabel = 'Dummy by Portishead, Discogs release 410';
  const description = (label: string) => {
    const action = renderer!.root.findByProps({ 'aria-label': label });
    return String(action.props['aria-describedby']).split(' ')
      .map(id => textOf(renderer!.root.findByProps({ id }))).join(' ');
  };

  it.each(['catalog', 'capture'] as const)('explains both new save outcomes and follows the selected shelf for %s results', async source => {
    const onReview = vi.fn();
    const onSelect = vi.fn();
    await act(async () => {
      renderer = create(createElement(SaveDestinationActions, {
        albumTitle: album.title, preferred: 'collection', onSelect,
        ...(source === 'catalog' ? { catalogLabel, onReviewPressings: onReview } : { onReviewNewPressings: onReview }),
      }));
    });
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'wishlist' } }));
    const action = `Save without pressing to Wishlist · ${source === 'catalog' ? catalogLabel : album.title}`;
    expect(description(action)).toBe('Save the album to Wishlist and identify its pressing later. Review to confirm an exact Discogs release.');
    await act(async () => renderer!.root.findByProps({ 'aria-label': action }).props.onClick());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('wishlist');
    expect(onReview).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'capture'] as const)('explains that confirming updates the existing shelf entry before reviewing a %s title match', async source => {
    const label = source === 'catalog' ? catalogLabel : undefined;
    await act(async () => {
      renderer = create(createElement(SaveDestinationActions, {
        albumTitle: album.title, catalogLabel: label, preferred: 'collection', existingStatus: 'wishlist',
        existingMatch: 'title', existingAlbumId: album.id, onOpenSaved: vi.fn(), onSavePressing: vi.fn(), onSelect: vi.fn(),
      }));
    });
    expect(description(`Compare with saved album · ${label ?? album.title}`))
      .toContain('Side A saves one entry per artist and title. Confirming a pressing updates your Wishlist entry.');
  });
});
