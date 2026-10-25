import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { quagga, scanBarcode } = vi.hoisted(() => ({
  quagga: {
    init: vi.fn(), start: vi.fn(), stop: vi.fn(), onDetected: vi.fn(), offDetected: vi.fn(),
  },
  scanBarcode: vi.fn(),
}));
vi.mock('@ericblade/quagga2', () => ({ default: quagga }));
vi.mock('react-hot-toast', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/api', () => ({ default: { scanBarcode } }));

import { useBarcodeScanner } from '../src/hooks/useBarcodeScanner';
import { BarcodeScanner } from '../src/components/BarcodeScanner';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReturnType<typeof create> | undefined;
const result = { codeResult: { code: '0602537340436', decodedCodes: [{ error: 0.05 }] } };

function Camera({ callback, active = true }: { callback: (barcode: string) => void; active?: boolean }) {
  const { scannerRef } = useBarcodeScanner(callback, active);
  return createElement('div', { ref: scannerRef });
}

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => { renderer = create(element, { createNodeMock: () => ({}) }); });
}

beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('barcode camera lifecycle', () => {
  it('keeps the camera running across renders and dispatches to the latest callback', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    await mount(createElement(Camera, { callback: first }));
    quagga.init.mock.calls[0]![1](null);
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
    await mount(createElement(Camera, { callback }));
    const initialize = quagga.init.mock.calls[0]![1];
    const detected = quagga.onDetected.mock.calls[0]![0];
    await act(async () => renderer!.update(createElement(Camera, { callback, active: false })));
    initialize(null);
    detected(result);

    expect(quagga.stop).toHaveBeenCalledOnce();
    expect(quagga.offDetected).toHaveBeenCalledWith(detected);
    expect(quagga.start).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
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
  const props = { onClose: vi.fn(), onSuccess: vi.fn(), viewMode: 'collection' as const };

  it('sends one lookup when the camera reports repeated detections before the next render', async () => {
    let resolve!: (result: unknown) => void;
    scanBarcode.mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(createElement(BarcodeScanner, props));
    const detect = quagga.onDetected.mock.calls[0]![0];
    await act(async () => { detect(result); detect(result); detect(result); });
    expect(scanBarcode).toHaveBeenCalledOnce();
    await act(async () => resolve({ artist: 'Portishead', album: 'Dummy' }));
  });

  it('restarts scanning and permits a retry after a failed lookup', async () => {
    scanBarcode.mockRejectedValue(new Error('Lookup unavailable'));
    await mount(createElement(BarcodeScanner, props));
    await act(async () => quagga.onDetected.mock.calls[0]![0](result));
    const retryDetection = quagga.onDetected.mock.calls.at(-1)![0];
    await act(async () => retryDetection(result));
    expect(scanBarcode).toHaveBeenCalledTimes(2);
  });
});
