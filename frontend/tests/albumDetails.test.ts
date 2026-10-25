import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Album } from '../src/services/api';

const { searchCoverArt, updateCoverArt } = vi.hoisted(() => ({
  searchCoverArt: vi.fn(), updateCoverArt: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/api', () => ({
  default: { searchCoverArt, updateCoverArt },
  getCoverArtUrl: (id: number) => `/api/cover-art/${id}`,
}));
import { AlbumDetailModal } from '../src/components/AlbumDetailModal';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const album: Album = {
  id: 1, title: 'Dummy', artist_name: 'Portishead',
  added_at: '2026-01-01T00:00:00Z', status: 'collection',
};
const callbacks = { onClose: vi.fn(), onRefresh: vi.fn() };
const renderAlbum = (value: Album) => createElement(AlbumDetailModal, { ...callbacks, album: value });

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
    expect(renderer!.root.findByType('img').props.alt).toBe('Third');
    await act(async () => renderer!.update(renderAlbum(album)));
    expect(renderer!.root.findByType('h3').children).toEqual(['Dummy']);
  });

  it('keeps a local artwork update until a new album prop arrives', async () => {
    vi.useFakeTimers();
    searchCoverArt.mockResolvedValue({ results: [{ source: 'Discogs', id: 1, title: 'Candidate', url: '/new.jpg' }] });
    updateCoverArt.mockResolvedValue({ album: { ...album, cover_image_url: '/new.jpg' } });
    await act(async () => { renderer = create(renderAlbum(album)); });
    const search = renderer!.root.findAllByType('button').find(button => !button.props.disabled && button.props.onClick.name === 'handleSearchArtwork');
    await act(async () => search!.props.onClick());
    await act(async () => renderer!.root.findByProps({ className: 'group cursor-pointer relative' }).props.onClick());
    await act(async () => renderer!.update(renderAlbum(album)));
    expect(JSON.stringify(renderer!.toJSON())).toContain('/new.jpg');
    await act(async () => renderer!.update(renderAlbum({ ...album, cover_image_url: '/parent.jpg' })));
    expect(JSON.stringify(renderer!.toJSON())).toContain('/parent.jpg');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('/new.jpg');
  });
});
