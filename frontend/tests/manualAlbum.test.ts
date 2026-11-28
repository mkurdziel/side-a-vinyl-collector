import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album } from '../src/services/api';

const { addAlbum } = vi.hoisted(() => ({ addAlbum: vi.fn() }));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { addAlbum },
}));

import { AddMenu } from '../src/components/AddMenu';
import { ManualAlbumDialog } from '../src/components/ManualAlbumDialog';
import { ApiError } from '../src/services/api';
import { readManualAlbumDrafts, saveManualAlbumDraft } from '../src/services/manualAlbumDrafts';

let renderer: ReturnType<typeof create> | undefined;
let storage: Map<string, string>;
const textOf = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => renderer!.root.findAllByType('button').find(control => textOf(control) === label)!;
const field = (name: string) => renderer!.root.findByProps({ name });
const input = (name: string, value: string) => field(name).props.onChange({ target: { value } });
const shelf = (value: Album['status']) => renderer!.root.findByType('select').props.onChange({ target: { value } });
const submit = () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
const latestManualAlbumDraft = () => readManualAlbumDrafts()[0];

const manual = (overrides?: Partial<Parameters<typeof ManualAlbumDialog>[0]>) => createElement(ManualAlbumDialog, {
  draft: {}, initialShelf: 'collection', onClose: vi.fn(), onSaved: vi.fn(), onOpenSaved: vi.fn(), ...overrides,
});
const addMenu = (onResumeManualClick: Parameters<typeof AddMenu>[0]['onResumeManualClick']) => createElement(AddMenu, {
  onBarcodeClick: vi.fn(), onImageClick: vi.fn(), onSearchClick: vi.fn(), onCatalogNumberClick: vi.fn(),
  onManualClick: vi.fn(), onResumeManualClick, onImportClick: vi.fn(), onClose: vi.fn(),
  discogsConfigured: true, viewMode: 'collection',
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('manual album draft continuity', () => {
  it('keeps incomplete entry fields and their shelf before closing, and resumes them only on request', async () => {
    const onClose = vi.fn();
    await act(async () => { renderer = create(manual({ draft: { searchText: 'Dummy' }, onClose })); });
    await act(async () => {
      input('artist', 'Portishead');
      button('Use as title').props.onClick();
      shelf('wishlist');
    });
    expect(storage.size).toBe(1);
    const stored = latestManualAlbumDraft()!;
    expect(stored).toMatchObject({ artist: 'Portishead', album: 'Dummy', shelf: 'wishlist', searchText: 'Dummy' });

    await act(async () => button('Close and keep draft').props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer!.unmount());
    await act(async () => { renderer = create(manual({ draft: { artist: 'The Cure', album: 'Disintegration' } })); });
    expect(field('artist').props.value).toBe('The Cure');
    expect(field('album').props.value).toBe('Disintegration');
    expect(latestManualAlbumDraft()).toEqual(stored);

    await act(async () => renderer!.unmount());
    const onResume = vi.fn();
    await act(async () => { renderer = create(addMenu(onResume)); });
    const resume = renderer!.root.findByProps({ 'aria-label': 'Resume manual entry' });
    expect(textOf(resume)).toContain('Portishead · Dummy · Wishlist');
    await act(async () => resume.props.onClick());
    expect(onResume).toHaveBeenCalledExactlyOnceWith(stored);

    await act(async () => renderer!.unmount());
    await act(async () => { renderer = create(manual({ resumeDraft: stored, onClose })); });
    expect(field('artist').props.value).toBe('Portishead');
    expect(field('album').props.value).toBe('Dummy');
    expect(renderer!.root.findByType('select').props.value).toBe('wishlist');
    await act(async () => button('Discard draft').props.onClick());
    expect(storage.size).toBe(0);
    expect(latestManualAlbumDraft()).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('can resume an edited draft in the current tab if storage fails', async () => {
    vi.stubGlobal('localStorage', { length: 0, setItem: vi.fn(() => { throw new Error('Storage unavailable'); }), removeItem: vi.fn() });
    await act(async () => { renderer = create(manual()); });
    await act(async () => input('artist', 'Portishead'));
    expect(textOf(renderer!.root)).toContain('Draft available until you reload this tab.');
    const stored = latestManualAlbumDraft()!;
    expect(stored).toMatchObject({ artist: 'Portishead', inMemoryOnly: true });
    await act(async () => renderer!.unmount());
    await act(async () => { renderer = create(manual({ resumeDraft: stored })); });
    expect(textOf(renderer!.root)).toContain('Draft available until you reload this tab.');
    await act(async () => button('Discard draft').props.onClick());
    expect(latestManualAlbumDraft()).toBeUndefined();
  });

  it('lets collectors choose another saved draft without changing the most recent one', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(20);
    const older = saveManualAlbumDraft({ artist: 'Portishead', album: '', shelf: 'wishlist' });
    const recent = saveManualAlbumDraft({ artist: 'The Cure', album: 'Disintegration', shelf: 'collection' });
    clock.mockRestore();
    const onResume = vi.fn();
    await act(async () => { renderer = create(addMenu(onResume)); });
    expect(renderer!.root.findAllByType('summary').map(textOf)).toContain('Other manual drafts');
    await act(async () => button('Portishead · Wishlist').props.onClick());
    expect(onResume).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: older.id }));
    expect(latestManualAlbumDraft()?.id).toBe(recent.id);
  });
});

describe('manual album save', () => {
  it('shows a success receipt and starts another blank record on the same shelf', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const pending = Promise.withResolvers<{ album: Album }>();
    const saved: Album = { id: 42, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist' };
    const receiptFocus = vi.fn();
    const artistFocus = vi.fn();
    addAlbum.mockReturnValueOnce(pending.promise);
    await act(async () => {
      renderer = create(manual({ draft: { searchText: 'Dummy' }, initialShelf: 'wishlist', onSaved, onClose }), {
        createNodeMock: node => node.props.children === 'Add another record' ? { focus: receiptFocus }
          : node.props.name === 'artist' ? { focus: artistFocus } : null,
      });
    });
    await act(async () => {
      input('artist', 'Portishead');
      input('album', 'Dummy');
      void submit();
    });
    expect(storage.size).toBe(1);
    expect(button('Close and keep draft').props.disabled).toBe(true);
    await act(async () => pending.resolve({ album: saved }));
    expect(textOf(renderer!.root.findByProps({ role: 'status' }))).toBe('“Dummy” saved to Wishlist.');
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith({ artist: 'Portishead', album: 'Dummy', status: 'wishlist' });
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    expect(onClose).not.toHaveBeenCalled();
    expect(latestManualAlbumDraft()).toBeUndefined();
    expect(receiptFocus).toHaveBeenCalledOnce();

    await act(async () => button('Add another record').props.onClick());
    expect(field('artist').props.value).toBe('');
    expect(field('album').props.value).toBe('');
    expect(renderer!.root.findByType('select').props.value).toBe('wishlist');
    expect(button('Use as title')).toBeUndefined();
    expect(artistFocus).toHaveBeenCalledOnce();
    await act(async () => submit());
    expect(addAlbum).toHaveBeenCalledOnce();
  });

  it('keeps the duplicate response across shelf changes and opens the saved record with its opener', async () => {
    const onSaved = vi.fn();
    const onOpenSaved = vi.fn();
    addAlbum.mockRejectedValueOnce(new ApiError('Already saved', 409, 42));
    await act(async () => { renderer = create(manual({ draft: { artist: 'Portishead', album: 'Dummy' }, onSaved, onOpenSaved })); });
    await act(async () => submit());
    expect(textOf(renderer!.root.findByProps({ role: 'alert' }))).toBe('This album is already saved.');
    await act(async () => shelf('wishlist'));
    expect(button('Add to Wishlist')).toBeUndefined();
    const opener = {};
    await act(async () => button('Open saved album').props.onClick({ currentTarget: opener }));
    expect(onOpenSaved).toHaveBeenCalledExactlyOnceWith(42, opener);
    expect(onSaved).not.toHaveBeenCalled();
    expect(latestManualAlbumDraft()).toMatchObject({ artist: 'Portishead', album: 'Dummy', shelf: 'wishlist' });
  });
});
