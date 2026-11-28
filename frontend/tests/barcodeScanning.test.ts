import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { quagga, scanBarcode, addAlbum, updateStatus } = vi.hoisted(() => ({
  quagga: {
    init: vi.fn(), start: vi.fn(), stop: vi.fn(), onDetected: vi.fn(), offDetected: vi.fn(),
    CameraAccess: { enumerateVideoDevices: vi.fn() },
  },
  scanBarcode: vi.fn(),
  addAlbum: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock('@ericblade/quagga2', () => ({ default: quagga }));
vi.mock('react-hot-toast', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/api')>(),
  default: { scanBarcode, addAlbum, updateStatus },
}));

import { useBarcodeScanner } from '../src/hooks/useBarcodeScanner';
import { BarcodeScanner } from '../src/components/BarcodeScanner';
import { ApiError } from '../src/services/api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const focused = vi.fn();
const result = { codeResult: { code: '0602537340436', decodedCodes: [{ error: 0.05 }] } };

function Camera({ callback, active = true }: { callback: (barcode: string) => void; active?: boolean }) {
  const { scannerRef, cameraId, setCameraId } = useBarcodeScanner(callback, active);
  return createElement('div', { ref: scannerRef }, createElement('select', {
    value: cameraId,
    onChange: (event: { target: { value: string } }) => setCameraId(event.target.value),
  }));
}

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => {
    renderer = create(element, { createNodeMock: node => ({ focus: () => focused(node.props.id ?? node.props.children) }) });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  quagga.init.mockImplementation((_config, callback) => callback(null));
  quagga.stop.mockResolvedValue(undefined);
  quagga.CameraAccess.enumerateVideoDevices.mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('barcode camera lifecycle', () => {
  it('keeps the camera running across renders and dispatches to the latest callback', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    await mount(createElement(Camera, { callback: first }));
    await act(async () => renderer!.update(createElement(Camera, { callback: latest })));

    expect(quagga.init).toHaveBeenCalledOnce();
    expect(quagga.start).toHaveBeenCalledOnce();
    expect(quagga.stop).not.toHaveBeenCalled();
    quagga.onDetected.mock.calls[0]![0](result);
    expect(latest).toHaveBeenCalledWith('0602537340436');
    expect(first).not.toHaveBeenCalled();
  });

  it('does not start a camera or emit detections after scanning has stopped', async () => {
    const callback = vi.fn();
    quagga.init.mockImplementationOnce(() => {});
    await mount(createElement(Camera, { callback }));
    const initialize = quagga.init.mock.calls[0]![1];
    await act(async () => renderer!.update(createElement(Camera, { callback, active: false })));
    await act(async () => initialize(null));

    expect(quagga.stop).toHaveBeenCalledOnce();
    expect(quagga.onDetected).not.toHaveBeenCalled();
    expect(quagga.start).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('releases the old camera before starting a selected lens and ignores stale detections', async () => {
    const callback = vi.fn();
    let release!: () => void;
    quagga.stop.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    await mount(createElement(Camera, { callback }));
    const detected = quagga.onDetected.mock.calls[0]![0];
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'rear-main' } }));

    expect(quagga.init).toHaveBeenCalledOnce();
    expect(quagga.stop).toHaveBeenCalledOnce();
    detected(result);
    expect(callback).not.toHaveBeenCalled();
    await act(async () => release());

    expect(quagga.init).toHaveBeenCalledTimes(2);
    const constraints = quagga.init.mock.calls[1]![0].inputStream.constraints;
    expect(constraints.deviceId).toEqual({ exact: 'rear-main' });
    expect(constraints).not.toHaveProperty('facingMode');
    expect(quagga.start).toHaveBeenCalledTimes(2);
    quagga.onDetected.mock.calls[1]![0](result);
    expect(callback).toHaveBeenCalledWith('0602537340436');
  });

  it('keeps scanning when camera enumeration is unavailable', async () => {
    quagga.CameraAccess.enumerateVideoDevices.mockRejectedValue(new Error('Not supported'));
    const callback = vi.fn();
    await mount(createElement(Camera, { callback }));
    quagga.onDetected.mock.calls[0]![0](result);
    expect(callback).toHaveBeenCalledWith('0602537340436');
  });

  it('ignores incomplete decoder results', async () => {
    const callback = vi.fn();
    await mount(createElement(Camera, { callback }));
    const detected = quagga.onDetected.mock.calls[0]![0];
    expect(() => detected({})).not.toThrow();
    detected({ codeResult: { code: '0602537340436', decodedCodes: [] } });
    expect(callback).not.toHaveBeenCalled();
  });
});


async function startBarcodeCamera() {
  const start = renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Scan with camera')!;
  await act(async () => start.props.onClick());
}

describe('barcode lookup requests', () => {
  const props = {
    onClose: vi.fn(), onSuccess: vi.fn(), onSearchByName: vi.fn(), onManual: vi.fn(),
    onMoveSaved: vi.fn(), onUndoMove: vi.fn(), onOpenSaved: vi.fn(), viewMode: 'collection' as const,
  };

  it('sends one lookup when the camera reports repeated detections before the next render', async () => {
    let resolve!: (result: unknown) => void;
    scanBarcode.mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    const detect = quagga.onDetected.mock.calls[0]![0];
    await act(async () => { detect(result); detect(result); detect(result); });
    expect(scanBarcode).toHaveBeenCalledOnce();
    await act(async () => resolve({ artist: 'Portishead', album: 'Dummy' }));
  });

  it.each([new ApiError('Discogs is busy', 503), new TypeError('Network request failed')])(
    'pauses automatic scanning and preserves the code for an explicit retry after %s',
    async error => {
      scanBarcode.mockRejectedValueOnce(error).mockResolvedValueOnce({ artist: 'Portishead', album: 'Dummy' });
      await mount(createElement(BarcodeScanner, props));
      await startBarcodeCamera();
      const detect = quagga.onDetected.mock.calls[0]![0];
      await act(async () => detect(result));
      expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain(
        'Barcode lookup is unavailable right now. Retry or search by name.',
      );
      expect(renderer!.root.findByType('input').props.value).toBe('0602537340436');
      await act(async () => detect(result));
      expect(scanBarcode).toHaveBeenCalledOnce();
      const retry = renderer!.root.findByProps({ type: 'submit' });
      expect(retry.children).toContain('Retry lookup');
      await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
      expect(scanBarcode).toHaveBeenCalledTimes(2);
      expect(scanBarcode).toHaveBeenLastCalledWith('0602537340436');
      expect(JSON.stringify(renderer!.toJSON())).toContain('Dummy');
    },
  );

  it('offers an editable barcode, camera restart, and name search after a genuine miss', async () => {
    scanBarcode.mockRejectedValueOnce(new ApiError('No album found for this barcode', 404));
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain(
      'No release matched this barcode. Check the digits or search by name.',
    );
    expect(renderer!.root.findByType('input').props.value).toBe('0602537340436');
    const buttons = renderer!.root.findAllByType('button');
    await act(async () => buttons.find(button => button.children.includes('Search by name'))!.props.onClick());
    expect(props.onSearchByName).toHaveBeenCalledOnce();
    await act(async () => buttons.find(button => button.children.includes('Scan again'))!.props.onClick());
    expect(quagga.start).toHaveBeenCalledTimes(2);
  });

  it('explains invalid manual input before making a lookup request', async () => {
    await mount(createElement(BarcodeScanner, props));
    expect(quagga.init).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { value: '123z' } }));
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(scanBarcode).not.toHaveBeenCalled();
    expect(renderer!.root.findByType('input').props['aria-invalid']).toBe(true);
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain(
      'Enter the 8, 12, 13, or 14 digits printed below the barcode.',
    );
  });

  it('announces camera failures and lets the user retry the camera', async () => {
    quagga.init.mockImplementationOnce((_config, callback) => callback(new Error('Camera unavailable')));
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    expect(renderer!.root.findByProps({ role: 'alert' }).children[0]).toMatch(/Unable to start camera/);
    const retry = renderer!.root.findAllByType('button').find(button => button.children.includes('Retry camera'));
    await act(async () => retry!.props.onClick());
    expect(quagga.init).toHaveBeenCalledTimes(2);
    expect(quagga.start).toHaveBeenCalledOnce();
  });

  it('looks up a manually entered barcode even when the camera fails, preserving leading zeroes', async () => {
    quagga.init.mockImplementationOnce((_config, callback) => callback(new Error('Camera unavailable')));
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy' });
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { value: '0602537340436' } }));
    const preventDefault = vi.fn();
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault }));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(scanBarcode).toHaveBeenCalledWith('0602537340436');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Dummy');
  });

  it('keeps manual entry active on Scan next without initializing the camera', async () => {
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy', discogsId: 19 });
    addAlbum.mockResolvedValue({});
    await mount(createElement(BarcodeScanner, props));
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { value: '0602537340436' } }));
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Add Dummy to Collection' }).props.onClick());
    const next = renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Scan next')!;
    await act(async () => next.props.onClick());
    expect(quagga.init).not.toHaveBeenCalled();
    expect(focused).toHaveBeenLastCalledWith('manual-barcode');
  });

  it('shows available camera labels and lets the user switch lenses', async () => {
    quagga.CameraAccess.enumerateVideoDevices.mockResolvedValue([
      { deviceId: 'rear-main', label: 'Back Camera' },
      { deviceId: 'rear-wide', label: 'Back Ultra Wide Camera' },
    ]);
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    expect(JSON.stringify(renderer!.toJSON())).toContain('Back Ultra Wide Camera');
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'rear-main' } }));
    expect(quagga.init.mock.calls.at(-1)![0].inputStream.constraints.deviceId).toEqual({ exact: 'rear-main' });
  });

  it('prefers the active shelf and saves one barcode match when both destinations are clicked', async () => {
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy', discogsId: 17 });
    const save = Promise.withResolvers<void>();
    addAlbum.mockReturnValueOnce(save.promise);
    await mount(createElement(BarcodeScanner, { ...props, viewMode: 'wishlist' }));
    await startBarcodeCamera();
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));

    const addButtons = renderer!.root.findAllByType('button')
      .filter(button => button.props['aria-label']?.startsWith('Add Dummy to '));
    expect(addButtons.map(button => button.props['aria-label'])).toEqual([
      'Add Dummy to Wishlist', 'Add Dummy to Collection',
    ]);
    await act(async () => {
      addButtons[0].props.onClick();
      addButtons[1].props.onClick();
    });
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      barcode: '0602537340436', discogsId: 17, status: 'wishlist',
    }));
    expect(renderer!.root.findByProps({ 'aria-label': 'Close barcode lookup' }).props.disabled).toBe(true);
    await act(async () => renderer!.root.findByProps({ labelledBy: 'barcode-title' }).props.onClose());
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => save.resolve());
    expect(props.onSuccess).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(focused).toHaveBeenCalledWith('Dummy');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Saved to Wishlist');
    const next = renderer!.root.findAllByType('button').find(node => node.children.join('') === 'Scan next')!;
    await act(async () => next.props.onClick());

    const detectNext = quagga.onDetected.mock.calls.at(-1)![0];
    await act(async () => detectNext(result));
    expect(scanBarcode).toHaveBeenCalledOnce();
    await act(async () => detectNext({ codeResult: { code: '012345678905', decodedCodes: [{ error: 0.05 }] } }));
    expect(scanBarcode).toHaveBeenLastCalledWith('012345678905');
  });

  it('moves and undoes a wishlisted barcode match inside the open scanner', async () => {
    scanBarcode.mockResolvedValue({
      artist: 'Portishead', album: 'Dummy', existingStatus: 'wishlist', existingAlbumId: 19, existingMatch: 'release',
    });
    props.onMoveSaved.mockResolvedValueOnce(true);
    props.onUndoMove.mockResolvedValueOnce(true);
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));

    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Move Dummy to Collection' }).props.onClick());
    expect(props.onMoveSaved).toHaveBeenCalledExactlyOnceWith(19, 'Dummy');
    expect(addAlbum).not.toHaveBeenCalled();
    const undo = renderer!.root.findAllByType('button').find(node => node.children.join('') === 'Undo move')!;
    await act(async () => undo.props.onClick());
    expect(props.onUndoMove).toHaveBeenCalledExactlyOnceWith(19);
    expect(JSON.stringify(renderer!.toJSON())).toContain('Moved back to Wishlist');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('requires reviewing a saved record before moving a title-only barcode match', async () => {
    scanBarcode.mockResolvedValue({
      artist: 'Portishead', album: 'Dummy', discogsId: 18, existingStatus: 'wishlist', existingMatch: 'title',
      existingAlbumId: 19,
      titleMatches: [{ id: 19, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist', discogs_id: 20 }],
    });
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Move Dummy to Collection' })).toHaveLength(0);
    expect(renderer!.root.findAllByType('summary').filter(node => node.children.includes('None of these'))).toHaveLength(0);
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Compare pressings for Dummy' }).props.onClick());
    expect(JSON.stringify(renderer!.toJSON())).toContain('Where to check your record');
    const open = renderer!.root.findByProps({ 'aria-label': 'Open saved album · Dummy by Portishead, Wishlist, Discogs release 20' });
    const opener = { isConnected: true };
    props.onOpenSaved.mockResolvedValueOnce('opened');
    await act(async () => open.props.onClick({ currentTarget: opener }));
    expect(props.onOpenSaved).toHaveBeenCalledExactlyOnceWith(19, opener, true);
    expect(props.onMoveSaved).not.toHaveBeenCalled();
  });

  it('confirms a specific barcode match without leaving the scan', async () => {
    const copy = { id: 19, title: 'Dummy', artist_name: 'Portishead', status: 'wishlist' as const, discogs_id: null };
    const onSavePressing = vi.fn().mockResolvedValue({ album: { ...copy, discogs_id: 18 }, undoToken: 'undo-scan' });
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy', discogsId: 18, existingStatus: 'wishlist',
      existingMatch: 'title', existingAlbumId: 19, titleMatches: [copy] });
    await mount(createElement(BarcodeScanner, { ...props, onSavePressing }));
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { value: '0602537340436' } }));
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Compare pressings for Dummy' }).props.onClick());
    const click = async (label: string) => act(async () => renderer!.root.findAllByType('button')
      .find(button => button.children.join('') === label)!.props.onClick());
    await click('Use this pressing');
    await click('Confirm pressing');
    expect(onSavePressing).toHaveBeenCalledExactlyOnceWith(copy, 18);
    expect(props.onSearchByName).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('offers manual and name-search recovery after a barcode result', async () => {
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy', discogsId: 17 });
    await mount(createElement(BarcodeScanner, props));
    await startBarcodeCamera();
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));
    const controls = renderer!.root.findAllByType('details').find(node => node.findByType('summary').children.join('') === 'None of these')!;
    expect(JSON.stringify(renderer!.toJSON())).toContain('None of these');
    const manual = controls.findAllByType('button').find(node => node.children.join('') === 'Add album manually')!;
    await act(async () => manual.props.onClick());
    expect(props.onManual).toHaveBeenCalledExactlyOnceWith({ artist: 'Portishead', album: 'Dummy' });
  });
});
