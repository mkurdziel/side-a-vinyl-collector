import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { analyzeImage, addAlbum } = vi.hoisted(() => ({
  analyzeImage: vi.fn(), addAlbum: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { analyzeImage, addAlbum },
}));
import { ImageUploader } from '../src/components/ImageUploader';
import type { SavePressing } from '../src/components/PressingComparison';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const focused = vi.fn();
const props = { onClose: vi.fn(), onSuccess: vi.fn(), onSearchByName: vi.fn(), onManual: vi.fn(), onMoveSaved: vi.fn(), onOpenSaved: vi.fn(), viewMode: 'collection' as const };

beforeEach(() => {
  vi.resetAllMocks();
  props.onMoveSaved.mockResolvedValue(true);
  vi.stubGlobal('FileReader', class {
    result = 'data:application/octet-stream;base64,example';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  analyzeImage.mockResolvedValue({
    extractedText: { artist: 'Portishead', album: 'Dummy', confidence: 95 },
    discogsMatches: [{ id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy' }],
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function upload(file: { name: string; type: string; size: number }, viewMode: 'collection' | 'wishlist' = 'collection', onSavePressing?: SavePressing) {
  await act(async () => {
    renderer = create(createElement(ImageUploader, { ...props, viewMode, onSavePressing }), {
      createNodeMock: node => ({ focus: () => focused(node.props.children) }),
    });
  });
  await act(async () => renderer!.root.findByType('input').props.onChange({ target: { files: [file] } }));
}

describe('album image uploads', () => {
  it('accepts HEIC files when the browser supplies an empty MIME type', async () => {
    await upload({ name: 'cover.HEIC', type: '', size: 1024 });
    expect(analyzeImage).toHaveBeenCalledWith('data:application/octet-stream;base64,example');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Dummy');
  });

  it('removes matches together with their source image', async () => {
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Dummy');
    await act(async () => renderer!.root.findByProps({ title: 'Remove image' }).props.onClick());
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Dummy');
    expect(renderer!.root.findByType('input')).toBeDefined();
  });

  it('lets a cover match be saved to either shelf and puts the active shelf first', async () => {
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 }, 'wishlist');
    const addButtons = renderer!.root.findAllByType('button')
      .filter(button => button.props['aria-label']?.startsWith('Add Dummy to '));
    expect(addButtons.map(button => button.props['aria-label'])).toEqual([
      'Add Dummy to Wishlist', 'Add Dummy to Collection',
    ]);
    await act(async () => addButtons[1].props.onClick());
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discogsId: 1, status: 'collection' }));
    expect(props.onSuccess).toHaveBeenCalledOnce();
  });

  it('moves a wishlisted cover match only when its saved record ID is available', async () => {
    analyzeImage.mockResolvedValueOnce({
      extractedText: {},
      discogsMatches: [
        { id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy', inWishlist: true, existingAlbumId: 23, existingMatch: 'release' },
        { id: 2, discogsId: 2, artist: 'Portishead', album: 'Third', inWishlist: true, existingAlbumId: 24, existingMatch: 'title' },
        { id: 3, discogsId: 3, artist: 'Portishead', album: 'Roseland NYC Live', inCollection: true },
      ],
    });
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    const labels = renderer!.root.findAllByType('button').map(button => button.props['aria-label']);
    expect(renderer!.root.findByProps({ 'aria-label': 'Saved title matches for Third' })).toBeDefined();
    expect(renderer!.root.findByProps({ 'aria-label': 'Saved title matches for Roseland NYC Live' })).toBeDefined();
    expect(labels.filter(label => label?.startsWith('Move '))).toEqual(['Move Dummy to Collection']);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Move Dummy to Collection' }).props.onClick());
    expect(props.onMoveSaved).toHaveBeenCalledExactlyOnceWith(23, 'Dummy');
    expect(addAlbum).not.toHaveBeenCalled();
  });

  it('keeps the photo and candidate available while inspecting a saved pressing', async () => {
    analyzeImage.mockResolvedValueOnce({
      extractedText: { artist: 'Portishead', album: 'Dummy' },
      discogsMatches: [{
        id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy', inWishlist: true, existingMatch: 'title',
        titleMatches: [{ id: 23, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist', year: 1994, discogs_id: 20 }],
      }],
    });
    props.onOpenSaved.mockResolvedValueOnce('opened');
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Compare pressings for Dummy' }).props.onClick());
    const opener = { isConnected: true };
    const copy = renderer!.root.findByProps({ 'aria-label': 'Open saved album · Dummy by Portishead, Wishlist, 1994, Discogs release 20' });
    await act(async () => copy.props.onClick({ currentTarget: opener }));
    expect(props.onOpenSaved).toHaveBeenCalledExactlyOnceWith(23, opener, true);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Close pressing comparison' }).props.onClick());
    expect(renderer!.root.findByProps({ alt: 'Uploaded cover' })).toBeDefined();
    expect(renderer!.root.findByProps({ 'aria-label': 'Compare pressings for Dummy' })).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('confirms a specific photo candidate while keeping the photo and saved record context', async () => {
    const copy = { id: 23, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist' as const, discogs_id: null };
    const onSavePressing = vi.fn().mockResolvedValue({ album: { ...copy, discogs_id: 1 }, undoToken: 'undo-photo' });
    analyzeImage.mockResolvedValueOnce({ extractedText: { artist: 'Portishead', album: 'Dummy' }, discogsMatches: [{
      id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy', source: 'discogs', discogsListing: 'release',
      inWishlist: true, existingMatch: 'title', titleMatches: [copy],
    }] });
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 }, 'collection', onSavePressing);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Compare pressings for Dummy' }).props.onClick());
    const click = async (label: string) => act(async () => renderer!.root.findAllByType('button')
      .find(button => button.children.join('') === label)!.props.onClick());
    await click('Use this pressing');
    await click('Confirm pressing');
    expect(onSavePressing).toHaveBeenCalledExactlyOnceWith(copy, 1);
    expect(renderer!.root.findByProps({ alt: 'Uploaded cover' })).toBeDefined();
    expect(props.onSearchByName).not.toHaveBeenCalled();
  });

  it('labels confidence once and prefills name search when no albums match', async () => {
    analyzeImage.mockResolvedValueOnce({
      extractedText: { artist: 'Portishead', album: 'Dummy', confidence: 95 },
      discogsMatches: [],
    });
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    const copy = JSON.stringify(renderer!.toJSON());
    expect(copy).toContain('Text recognition confidence');
    expect(copy).not.toContain('% match');
    const search = renderer!.root.findAllByType('button').find(node => node.children.join('') === 'Search by name')!;
    await act(async () => search.props.onClick());
    expect(props.onSearchByName).toHaveBeenCalledExactlyOnceWith('Portishead Dummy', { artist: 'Portishead', album: 'Dummy' });
  });

  it('keeps a pending photo save open until it finishes', async () => {
    const pending = Promise.withResolvers<object>();
    addAlbum.mockReturnValueOnce(pending.promise);
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Add Dummy to Collection' }).props.onClick());
    const cancel = renderer!.root.findAllByType('button').find(node => node.children.join('') === 'Cancel')!;
    expect(cancel.props.disabled).toBe(true);
    await act(async () => renderer!.root.findByProps({ labelledBy: 'identify-cover-title' }).props.onClose());
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => pending.resolve({}));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('focuses the photo results and offers recovery even when candidates exist', async () => {
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    expect(focused).toHaveBeenCalledWith('1 possible match');
    expect(JSON.stringify(renderer!.toJSON())).toContain('None of these');
    const manual = renderer!.root.findAllByType('button').find(node => node.children.join('') === 'Add album manually')!;
    await act(async () => manual.props.onClick());
    expect(props.onManual).toHaveBeenCalledExactlyOnceWith({ artist: 'Portishead', album: 'Dummy' });
    expect(addAlbum).not.toHaveBeenCalled();
  });
});
