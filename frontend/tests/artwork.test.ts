import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Album } from '../src/services/api';

const { searchCoverArt, updateCoverArt } = vi.hoisted(() => ({ searchCoverArt: vi.fn(), updateCoverArt: vi.fn() }));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { searchCoverArt, updateCoverArt },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));

import { AlbumDetailModal } from '../src/components/AlbumDetailModal';

const album: Album = {
  id: 7, title: 'Dummy', artist_name: 'Portishead', status: 'collection', added_at: '2026-01-01T00:00:00Z',
  cover_image_url: '/art/current.jpg',
};
const alternative = { id: 11, source: 'Discogs', title: 'Dummy', year: 1994, url: '/art/alternative.jpg' };
let renderer: ReturnType<typeof create> | undefined;
const textOf = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => renderer!.root.findAllByType('button').find(node => textOf(node) === label)!;

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('previews same-title covers beside the current cover and can cancel without writing', async () => {
  const onRefresh = vi.fn();
  const previewFocus = vi.fn();
  const candidateFocus = vi.fn();
  const other = { ...alternative, id: 12, year: 1997, url: '/art/other.jpg' };
  searchCoverArt.mockResolvedValue({ results: [alternative, other] });
  await act(async () => {
    renderer = create(createElement(AlbumDetailModal, { album: { ...album, cover_image_url: undefined }, onClose: vi.fn(), onRefresh }), {
      createNodeMock: node => node.props.children === 'Compare artwork' ? { focus: previewFocus }
        : node.props['aria-label']?.endsWith('Release 11') ? { focus: candidateFocus } : null,
    });
  });
  await act(async () => button('Find different artwork').props.onClick());
  const cover = (url: string) => renderer!.root.findByProps({ src: url });
  await act(async () => {
    cover(alternative.url).props.onLoad({ currentTarget: { naturalWidth: 700, naturalHeight: 700 } });
    cover(other.url).props.onLoad({ currentTarget: { naturalWidth: 1000, naturalHeight: 950 } });
  });
  const older = renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994, 700 × 700 px, Release 11' });
  const newer = renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1997, 1000 × 950 px, Release 12' });
  expect(textOf(older)).toContain('700 × 700 px');
  expect(textOf(newer)).toContain('Release 12');
  await act(async () => older.props.onClick());
  expect(previewFocus).toHaveBeenCalledOnce();
  const figures = renderer!.root.findAllByType('figure');
  expect(figures.map(figure => figure.findByType('img').props.src)).toEqual(['/api/cover-art/7', alternative.url]);
  expect(figures.map(figure => figure.findByType('img').props.alt)).toEqual([
    'Cover currently saved for this album', 'Proposed replacement cover for this album',
  ]);
  await act(async () => figures[0].findByType('img').props.onLoad({ currentTarget: { naturalWidth: 280, naturalHeight: 280 } }));
  expect(textOf(figures[0])).toContain('Source unlisted · 280 × 280 px');
  expect(textOf(figures[0])).toContain('No artwork provider, artwork title, release year, or release link available.');
  expect(figures[0].findAllByType('a')).toHaveLength(0);
  expect(textOf(figures[1])).toContain('Release 11');
  expect(figures[1].findByType('a').props.href).toBe('https://www.discogs.com/release/11');
  expect(button('Apply artwork').props['aria-disabled']).toBe(false);
  expect(updateCoverArt).not.toHaveBeenCalled();
  await act(async () => button('Back to choices').props.onClick());
  expect(candidateFocus).toHaveBeenCalledOnce();
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994, 700 × 700 px, Release 11' }).props.onClick());
  await act(async () => button('Keep current artwork').props.onClick());
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(1);
  expect(updateCoverArt).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
});

it('names the empty search, lets the collector edit it, and retries the edited query after a provider failure', async () => {
  searchCoverArt.mockResolvedValueOnce({ results: [{ ...alternative, url: album.cover_image_url }] })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ results: [alternative] });
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() })); });
  await act(async () => button('Find different artwork').props.onClick());
  const notice = (action: string) => renderer!.root.findByProps({ id: button(action).props['aria-describedby'] });
  expect(textOf(notice('Edit artwork search'))).toBe('No different cover art found for “Dummy” by Portishead.');
  await act(async () => button('Edit artwork search').props.onClick());
  const artist = renderer!.root.findByProps({ name: 'artist' });
  const title = renderer!.root.findByProps({ name: 'title' });
  expect(artist.props.value).toBe('Portishead');
  expect(title.props.value).toBe('Dummy');
  await act(async () => {
    artist.props.onChange({ currentTarget: { value: '  Beth Gibbons ' } });
    title.props.onChange({ currentTarget: { value: 'Dummy UK' } });
  });
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  const retry = notice('Retry artwork search');
  expect(retry.props.role).toBe('alert');
  expect(textOf(retry)).toBe('Couldn’t search for artwork. Try again.');
  await act(async () => button('Retry artwork search').props.onClick());
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(2);
  expect(searchCoverArt.mock.calls).toEqual([[7],
    [7, { artist: 'Beth Gibbons', title: 'Dummy UK' }], [7, { artist: 'Beth Gibbons', title: 'Dummy UK' }],
  ]);
});

it('edits a successful search, keeps its results through a failed revision, and restores focus', async () => {
  const artistFocus = vi.fn();
  const editFocus = vi.fn();
  const chooserFocus = vi.fn();
  const revised = { ...alternative, id: 12, title: 'Dummy UK', url: '/art/revised.jpg' };
  searchCoverArt.mockResolvedValueOnce({ results: [alternative] })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ results: [revised] });
  await act(async () => {
    renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() }), {
      createNodeMock: node => node.props.name === 'artist' ? { focus: artistFocus }
        : node.props.children === 'Edit artwork search' ? { focus: editFocus }
          : node.props.children === 'Choose cover art' ? { focus: chooserFocus } : null,
    });
  });

  const picker = () => renderer!.root.findAllByType('dialog')[1];
  const input = (name: string) => picker().findByProps({ name });
  const initialPreview = () => picker().findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' });
  await act(async () => button('Find different artwork').props.onClick());
  expect(textOf(picker())).toContain('Results for “Dummy” by Portishead');
  await act(async () => button('Edit artwork search').props.onClick());
  expect(artistFocus).toHaveBeenCalledOnce();
  expect(input('artist').props.value).toBe('Portishead');
  expect(input('title').props.value).toBe('Dummy');
  await act(async () => input('title').props.onChange({ currentTarget: { value: 'Unused draft' } }));
  await act(async () => picker().props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
  expect(editFocus).toHaveBeenCalledOnce();
  expect(picker().findAllByType('form')).toHaveLength(0);
  expect(searchCoverArt).toHaveBeenCalledOnce();
  expect(initialPreview()).toBeDefined();

  await act(async () => button('Edit artwork search').props.onClick());
  expect(input('title').props.value).toBe('Dummy');
  await act(async () => input('title').props.onChange({ currentTarget: { value: ' Dummy UK ' } }));
  await act(async () => picker().findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(textOf(picker().findByProps({ role: 'alert' }))).toBe('Couldn’t search for “Dummy UK” by Portishead. Previous results are still available.');
  expect(textOf(picker())).toContain('Results for “Dummy” by Portishead');
  expect(initialPreview().props.disabled).toBe(false);
  await act(async () => button('Retry artwork search').props.onClick());
  expect(searchCoverArt.mock.calls).toEqual([[7], [7, { artist: 'Portishead', title: 'Dummy UK' }], [7, { artist: 'Portishead', title: 'Dummy UK' }]]);
  expect(textOf(picker())).toContain('Results for “Dummy UK” by Portishead');
  expect(chooserFocus).toHaveBeenCalledTimes(2);
  expect(updateCoverArt).not.toHaveBeenCalled();
});

it('keeps verified metadata across queries and restores the applied release on reopening', async () => {
  const mbid = '12345678-abcd-1234-abcd-123456789abc';
  const current = { ...album, cover_image_url: `https://coverartarchive.org/release/${mbid}/front` };
  const currentMatch = { id: mbid, title: 'Dummy Japan', source: 'MusicBrainz', year: 1995, url: current.cover_image_url };
  const onRefresh = vi.fn();
  const provenance = { releaseId: alternative.id, title: alternative.title, year: alternative.year };
  const saved: Album = { ...current, cover_image_url: alternative.url, cover_art_provenance: {
    ...provenance, source: 'Discogs', url: alternative.url,
  } };
  searchCoverArt.mockResolvedValueOnce({ results: [currentMatch, alternative] }).mockResolvedValueOnce({ results: [alternative] });
  updateCoverArt.mockResolvedValueOnce({ album: saved });
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album: current, onClose: vi.fn(), onRefresh })); });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => button('Edit artwork search').props.onClick());
  await act(async () => renderer!.root.findByProps({ name: 'title' }).props.onChange({ currentTarget: { value: 'Dummy UK' } }));
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' }).props.onClick());
  const [currentArt, selectedArt] = renderer!.root.findAllByType('figure');
  expect(textOf(currentArt)).toContain('Dummy Japan');
  expect(textOf(currentArt)).toContain('Release year 1995');
  expect(currentArt.findByType('a').props).toMatchObject({ href: `https://musicbrainz.org/release/${mbid}`, 'aria-label': `Release ${mbid} for current artwork (opens in a new tab)` });
  expect(textOf(selectedArt)).toContain('Release year 1994');
  expect(selectedArt.findByType('a').props.href).toBe('https://www.discogs.com/release/11');
  expect(updateCoverArt).not.toHaveBeenCalled();
  await act(async () => selectedArt.findByType('img').props.onLoad({ currentTarget: { naturalWidth: 700, naturalHeight: 700 } }));
  await act(async () => button('Apply artwork').props.onClick());
  expect(updateCoverArt).toHaveBeenCalledExactlyOnceWith(current.id, alternative.url, 'Discogs', provenance);
  expect(onRefresh).toHaveBeenCalledWith(saved);
  expect(textOf(renderer!.root.findByProps({ role: 'status' }))).toBe('Artwork updated.');

  const other = { ...alternative, id: 12, title: 'Dummy Deluxe', year: 1997, url: '/art/other.jpg' };
  searchCoverArt.mockResolvedValueOnce({ results: [other] });
  await act(async () => renderer!.unmount());
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album: saved, onClose: vi.fn(), onRefresh })); });
  expect(renderer!.root.findByProps({ 'aria-label': 'Release 11 for saved artwork (opens in a new tab)' }).props.href)
    .toBe('https://www.discogs.com/release/11');
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy Deluxe cover from Discogs, 1997' }).props.onClick());
  const [persistedArt] = renderer!.root.findAllByType('figure');
  expect(textOf(persistedArt.findByType('figcaption'))).toBe('Current artwork');
  expect(textOf(persistedArt)).toContain('DummyDiscogs · Release year 1994');
  expect(persistedArt.findByType('a').props.href).toBe('https://www.discogs.com/release/11');
  expect(updateCoverArt).toHaveBeenCalledOnce();
});

it('enlarges either image and restores the paired comparison, focus, and deliberate apply', async () => {
  const headingFocus = vi.fn();
  const currentFocus = vi.fn();
  const selectedFocus = vi.fn();
  searchCoverArt.mockResolvedValue({ results: [alternative] });
  await act(async () => {
    renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() }), {
      createNodeMock: node => node.props.children === 'Compare artwork' ? { focus: headingFocus }
        : node.props['aria-label'] === 'Enlarge current artwork' ? { focus: currentFocus, getClientRects: () => [{}] }
          : node.props['aria-label'] === 'Enlarge selected artwork' ? { focus: selectedFocus, getClientRects: () => [{}] } : null,
    });
  });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' }).props.onClick());
  await act(async () => renderer!.root.findByProps({ src: alternative.url }).props.onLoad({ currentTarget: { naturalWidth: 700, naturalHeight: 700 } }));
  const figures = () => renderer!.root.findAllByType('figure');
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Enlarge current artwork' }).props.onClick());
  expect(figures()).toHaveLength(1);
  expect(figures()[0].findByType('img').props.alt).toBe('Cover currently saved for this album');
  expect(headingFocus).toHaveBeenCalledTimes(2);
  expect(button('Apply artwork')).toBeUndefined();
  await act(async () => button('Back to comparison').props.onClick());
  expect(currentFocus).toHaveBeenCalledOnce();
  expect(figures()).toHaveLength(2);
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Enlarge selected artwork' }).props.onClick());
  expect(figures()).toHaveLength(1);
  expect(figures()[0].findByType('img').props.alt).toBe('Proposed replacement cover for this album');
  expect(figures()[0].findByType('a').props.href).toBe('https://www.discogs.com/release/11');
  await act(async () => renderer!.root.findAllByType('dialog')[1].props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
  expect(selectedFocus).toHaveBeenCalledOnce();
  expect(figures()).toHaveLength(2);
  expect(button('Apply artwork').props['aria-disabled']).toBe(false);
  expect(updateCoverArt).not.toHaveBeenCalled();
});

it('does not reopen a closed chooser when a revised search returns', async () => {
  const revision = Promise.withResolvers<{ results: typeof alternative[] }>();
  searchCoverArt.mockResolvedValueOnce({ results: [alternative] }).mockReturnValueOnce(revision.promise);
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() })); });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => button('Edit artwork search').props.onClick());
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  await act(async () => button('Keep current artwork').props.onClick());
  await act(async () => revision.resolve({ results: [{ ...alternative, url: '/art/late.jpg' }] }));
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(1);
  expect(button('Find different artwork')).toBeDefined();
  expect(updateCoverArt).not.toHaveBeenCalled();
});

it('keeps the chooser open with persistent feedback if a cover cannot be saved', async () => {
  searchCoverArt.mockResolvedValue({ results: [alternative] });
  updateCoverArt.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() })); });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' }).props.onClick());
  expect(button('Apply artwork').props['aria-disabled']).toBe(true);
  expect(updateCoverArt).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findByProps({ src: alternative.url }).props.onLoad({ currentTarget: { naturalWidth: 700, naturalHeight: 700 } }));
  await act(async () => button('Apply artwork').props.onClick());
  expect(updateCoverArt).toHaveBeenCalledExactlyOnceWith(album.id, alternative.url, 'Discogs', {
    releaseId: alternative.id, title: alternative.title, year: alternative.year,
  });
  expect(textOf(renderer!.root.findByProps({ role: 'alert' }))).toContain('Couldn’t update the artwork.');
  expect(button('Keep current artwork')).toBeDefined();
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(2);
});

it('returns focus to the artwork chooser when the selected image fails to load', async () => {
  const chooserFocus = vi.fn();
  searchCoverArt.mockResolvedValue({ results: [alternative] });
  await act(async () => {
    renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() }), {
      createNodeMock: node => node.props.children === 'Choose cover art' ? { focus: chooserFocus }
        : node.type === 'button' ? { disabled: node.props.disabled, focus: vi.fn() } : null,
    });
  });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' }).props.onClick());
  await act(async () => renderer!.root.findByProps({ src: alternative.url }).props.onError());
  expect(button('Apply artwork').props['aria-disabled']).toBe(true);
  await act(async () => renderer!.root.findAllByType('dialog')[1].props.onCancel({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
  expect(chooserFocus).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findByProps({ 'aria-label': 'Preview Dummy cover from Discogs, 1994' }).props.disabled).toBe(true);
});

it('ignores artwork results from the previous album after the detail view changes', async () => {
  const pending = Promise.withResolvers<{ results: typeof alternative[] }>();
  searchCoverArt.mockReturnValueOnce(pending.promise);
  const render = (value: Album) => createElement(AlbumDetailModal, { album: value, onClose: vi.fn(), onRefresh: vi.fn() });
  await act(async () => { renderer = create(render(album)); });
  await act(async () => { void button('Find different artwork').props.onClick(); });
  await act(async () => renderer!.update(render({ ...album, id: 8, title: 'Third' })));
  await act(async () => pending.resolve({ results: [alternative] }));
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(1);
  expect(button('Find different artwork')).toBeDefined();
  expect(textOf(renderer!.root.findByType('h3'))).toBe('Third');
});
