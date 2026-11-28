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

it('uses year, dimensions, and release IDs to distinguish same-title covers and offers a no-change exit', async () => {
  const onRefresh = vi.fn();
  const other = { ...alternative, id: 12, year: 1997, url: '/art/other.jpg' };
  searchCoverArt.mockResolvedValue({ results: [alternative, other] });
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh })); });
  await act(async () => button('Find different artwork').props.onClick());
  const cover = (url: string) => renderer!.root.findByProps({ src: url });
  await act(async () => {
    cover(alternative.url).props.onLoad({ currentTarget: { naturalWidth: 700, naturalHeight: 700 } });
    cover(other.url).props.onLoad({ currentTarget: { naturalWidth: 1000, naturalHeight: 950 } });
  });
  const older = renderer!.root.findByProps({ 'aria-label': 'Use Dummy cover from Discogs, 1994, 700 × 700 px, Release 11' });
  const newer = renderer!.root.findByProps({ 'aria-label': 'Use Dummy cover from Discogs, 1997, 1000 × 950 px, Release 12' });
  expect(textOf(older)).toContain('700 × 700 px');
  expect(textOf(newer)).toContain('Release 12');
  await act(async () => button('Keep current artwork').props.onClick());
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(1);
  expect(updateCoverArt).not.toHaveBeenCalled();
  expect(onRefresh).not.toHaveBeenCalled();
});

it('describes empty and failed searches beside the retry action', async () => {
  searchCoverArt.mockResolvedValueOnce({ results: [{ ...alternative, url: album.cover_image_url }] })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ results: [alternative] });
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() })); });
  await act(async () => button('Find different artwork').props.onClick());
  const notice = () => renderer!.root.findByProps({ id: button('Retry artwork search').props['aria-describedby'] });
  expect(textOf(notice())).toBe('No different cover art found.');
  await act(async () => button('Retry artwork search').props.onClick());
  expect(notice().props.role).toBe('alert');
  expect(textOf(notice())).toBe('Couldn’t search for artwork. Try again.');
  await act(async () => button('Retry artwork search').props.onClick());
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(2);
  expect(searchCoverArt).toHaveBeenCalledTimes(3);
});

it('keeps the chooser open with persistent feedback if a cover cannot be saved', async () => {
  searchCoverArt.mockResolvedValue({ results: [alternative] });
  updateCoverArt.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { renderer = create(createElement(AlbumDetailModal, { album, onClose: vi.fn(), onRefresh: vi.fn() })); });
  await act(async () => button('Find different artwork').props.onClick());
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Use Dummy cover from Discogs, 1994' }).props.onClick());
  expect(textOf(renderer!.root.findByProps({ role: 'alert' }))).toContain('Couldn’t update the artwork.');
  expect(button('Keep current artwork')).toBeDefined();
  expect(renderer!.root.findAllByType('dialog')).toHaveLength(2);
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
