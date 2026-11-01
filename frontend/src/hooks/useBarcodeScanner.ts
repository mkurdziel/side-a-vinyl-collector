import { useEffect, useRef, useState } from 'react';
import Quagga, { type QuaggaJSConfigObject, type QuaggaJSResultObject } from '@ericblade/quagga2';

// Quagga owns one camera globally. Wait for asynchronous camera release before
// opening another lens, retrying, or mounting a new scanner.
let cameraRelease = Promise.resolve();

export const useBarcodeScanner = (onDetected: (barcode: string) => void, isActive: boolean) => {
  const scannerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!isActive || !scannerRef.current) return;
    let cancelled = false;

    const config: QuaggaJSConfigObject = {
      inputStream: {
        type: 'LiveStream',
        target: scannerRef.current,
        size: 1280,
        constraints: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // Safari can choose a lens that cannot focus close enough. An explicit
          // device must not also be constrained by facingMode.
          ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'environment' }),
        },
      },
      locator: {
        patchSize: 'small',
        halfSample: false,
      },
      frequency: 10,
      numOfWorkers: 0,
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'],
      },
      locate: true,
    };

    const handleDetected = (result: QuaggaJSResultObject) => {
      if (!cancelled && result?.codeResult?.code && result.codeResult.decodedCodes?.length) {
        const confidence = result.codeResult.decodedCodes
          .reduce((sum, code) => sum + (code.error || 0), 0) / result.codeResult.decodedCodes.length;

        if (confidence < 0.2) { // Higher confidence = lower error
          onDetectedRef.current(result.codeResult.code);
        }
      }
    };

    const initialization = cameraRelease.then(async () => {
      if (cancelled) return;
      setError(null);
      await new Promise<void>((resolve, reject) => {
        Quagga.init(config, err => err ? reject(err) : resolve());
      });
      if (cancelled) return;
      Quagga.onDetected(handleDetected);
      Quagga.start();

      // Permission has now been granted, so Safari can expose camera labels.
      void Quagga.CameraAccess.enumerateVideoDevices().then(devices => {
        if (!cancelled) setCameras(devices.filter(device => device.deviceId));
      }).catch(() => { /* Camera discovery must not interrupt scanning. */ });
    }).catch(() => {
      if (!cancelled) setError('Unable to start camera. Check camera permissions or try another camera.');
    });

    return () => {
      cancelled = true;
      Quagga.offDetected(handleDetected);
      cameraRelease = initialization.then(() => Quagga.stop()).catch(() => {
        console.warn('Unable to release barcode camera.');
      });
    };
  }, [isActive, cameraId]);

  return { scannerRef, error, cameras, cameraId, setCameraId };
};
