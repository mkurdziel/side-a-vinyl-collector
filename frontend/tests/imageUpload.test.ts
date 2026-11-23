import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { analyzeImage, addAlbum, updateStatus } = vi.hoisted(() => ({
  analyzeImage: vi.fn(), addAlbum: vi.fn(), updateStatus: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/services/api', () => ({ default: { analyzeImage, addAlbum, updateStatus } }));
import { ImageUploader } from '../src/components/ImageUploader';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const props = { onClose: vi.fn(), onSuccess: vi.fn(), viewMode: 'collection' as const };

beforeEach(() => {
  vi.resetAllMocks();
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

async function upload(file: { name: string; type: string; size: number }, viewMode: 'collection' | 'wishlist' = 'collection') {
  await act(async () => { renderer = create(createElement(ImageUploader, { ...props, viewMode })); });
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
        { id: 1, discogsId: 1, artist: 'Portishead', album: 'Dummy', inWishlist: true, existingAlbumId: 23 },
        { id: 2, discogsId: 2, artist: 'Portishead', album: 'Third', inWishlist: true },
        { id: 3, discogsId: 3, artist: 'Portishead', album: 'Roseland NYC Live', inCollection: true },
      ],
    });
    await upload({ name: 'cover.jpg', type: 'image/jpeg', size: 1024 });
    const labels = renderer!.root.findAllByType('button').map(button => button.props['aria-label']);
    expect(labels).toContain('Third is in Wishlist');
    expect(labels).toContain('Roseland NYC Live is in Collection');
    expect(labels.filter(label => label?.startsWith('Move '))).toEqual(['Move Dummy to Collection']);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Move Dummy to Collection' }).props.onClick());
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(23, 'collection');
    expect(addAlbum).not.toHaveBeenCalled();
  });
});
