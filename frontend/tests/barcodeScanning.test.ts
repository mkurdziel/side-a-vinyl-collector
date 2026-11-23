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
const result = { codeResult: { code: '0602537340436', decodedCodes: [{ error: 0.05 }] } };

function Camera({ callback, active = true }: { callback: (barcode: string) => void; active?: boolean }) {
  const { scannerRef, cameraId, setCameraId } = useBarcodeScanner(callback, active);
  return createElement('div', { ref: scannerRef }, createElement('select', {
    value: cameraId,
    onChange: (event: { target: { value: string } }) => setCameraId(event.target.value),
  }));
}

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => { renderer = create(element, { createNodeMock: () => ({}) }); });
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

describe('barcode lookup requests', () => {
  const props = { onClose: vi.fn(), onSuccess: vi.fn(), onSearchByName: vi.fn(), onMoveSaved: vi.fn(), onOpenSaved: vi.fn(), viewMode: 'collection' as const };

  it('sends one lookup when the camera reports repeated detections before the next render', async () => {
    let resolve!: (result: unknown) => void;
    scanBarcode.mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(createElement(BarcodeScanner, props));
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
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { value: '0602537340436' } }));
    const preventDefault = vi.fn();
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault }));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(scanBarcode).toHaveBeenCalledWith('0602537340436');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Dummy');
  });

  it('shows available camera labels and lets the user switch lenses', async () => {
    quagga.CameraAccess.enumerateVideoDevices.mockResolvedValue([
      { deviceId: 'rear-main', label: 'Back Camera' },
      { deviceId: 'rear-wide', label: 'Back Ultra Wide Camera' },
    ]);
    await mount(createElement(BarcodeScanner, props));
    expect(JSON.stringify(renderer!.toJSON())).toContain('Back Ultra Wide Camera');
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'rear-main' } }));
    expect(quagga.init.mock.calls.at(-1)![0].inputStream.constraints.deviceId).toEqual({ exact: 'rear-main' });
  });

  it('prefers the active shelf and saves one barcode match when both destinations are clicked', async () => {
    scanBarcode.mockResolvedValue({ artist: 'Portishead', album: 'Dummy', discogsId: 17 });
    const save = Promise.withResolvers<void>();
    addAlbum.mockReturnValueOnce(save.promise);
    await mount(createElement(BarcodeScanner, { ...props, viewMode: 'wishlist' }));
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
  });

  it('moves a wishlisted barcode match without adding a new record', async () => {
    scanBarcode.mockResolvedValue({
      artist: 'Portishead', album: 'Dummy', existingStatus: 'wishlist', existingAlbumId: 19,
    });
    await mount(createElement(BarcodeScanner, props));
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));

    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Move Dummy to Collection' }).props.onClick());
    expect(props.onMoveSaved).toHaveBeenCalledExactlyOnceWith(19, 'Dummy');
    expect(addAlbum).not.toHaveBeenCalled();
  });
});
