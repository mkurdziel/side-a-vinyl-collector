import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { analyzeImage } = vi.hoisted(() => ({ analyzeImage: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/services/api', () => ({ default: { analyzeImage } }));
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

async function upload(file: { name: string; type: string; size: number }) {
  await act(async () => { renderer = create(createElement(ImageUploader, props)); });
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
});
