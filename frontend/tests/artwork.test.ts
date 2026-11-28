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
    renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh }), {
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
  expect(textOf(figures[1])).toContain('Release 11');
  expect(button('Apply artwork').props['aria-disabled']).toBe(false);
  expect(updateCoverArt).not.toHaveBeenCalled();
  await act(async () => button('Back to artwork choices').props.onClick());
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
  expect(updateCoverArt).toHaveBeenCalledExactlyOnceWith(album.id, alternative.url, 'Discogs');
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
  expect(chooserFocus).toHaveBeenCalledOnce();
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
