import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AddMenu } from '../src/components/AddMenu';

let renderer: ReturnType<typeof create> | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it('focuses name search, keeps manual entry beside it, and groups the record lookups', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', { length: 0 });
  const callbacks = {
    onSearchClick: vi.fn(), onManualClick: vi.fn(), onBarcodeClick: vi.fn(), onCatalogNumberClick: vi.fn(),
    onImageClick: vi.fn(), onImportClick: vi.fn(), onClose: vi.fn(),
  };
  const focusSearch = vi.fn();
  await act(async () => {
    renderer = create(createElement(AddMenu, { ...callbacks, discogsConfigured: true, viewMode: 'collection' }), {
      createNodeMock: node => node.props['aria-label'] === 'Search by name' ? { focus: focusSearch } : null,
    });
  });
  const root = renderer!.root;
  const search = root.findByProps({ 'aria-label': 'Search by name' });
  const manual = root.findByProps({ 'aria-label': 'Add album manually' });
  const description = root.findByProps({ id: search.props['aria-describedby'] });
  expect(description.children.join('')).toBe('Search your shelves and online catalogs');
  expect(search.parent).toBe(manual.parent);
  expect(focusSearch).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });

  const clues = root.findByType('section');
  expect(clues.findByType('h3').children.join('')).toBe('Have a clue on the record?');
  const clueButtons = clues.findAllByType('button');
  expect(clueButtons.map(control => control.props['aria-label'])).toEqual([
    'Look up a catalog number', 'Look up a barcode', 'Identify a cover',
  ]);
  const importButton = root.findAllByType('button').find(control => control.children.join('') === 'Import from Discogs')!;
  expect(clueButtons).not.toContain(importButton);

  await act(async () => {
    search.props.onClick();
    manual.props.onClick();
    clueButtons.forEach(control => control.props.onClick());
    importButton.props.onClick();
  });
  expect(callbacks.onSearchClick).toHaveBeenCalledOnce();
  expect(callbacks.onManualClick).toHaveBeenCalledOnce();
  expect(callbacks.onCatalogNumberClick).toHaveBeenCalledOnce();
  expect(callbacks.onBarcodeClick).toHaveBeenCalledOnce();
  expect(callbacks.onImageClick).toHaveBeenCalledOnce();
  expect(callbacks.onImportClick).toHaveBeenCalledOnce();
});
