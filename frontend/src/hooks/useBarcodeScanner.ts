import { useEffect, useRef, useState } from 'react';
import Quagga from '@ericblade/quagga2';

export const useBarcodeScanner = (onDetected: (barcode: string) => void, isActive: boolean) => {
  const scannerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive || !scannerRef.current) return;

    const config: any = {
      inputStream: {
        type: 'LiveStream',
        target: scannerRef.current,
        constraints: {
          width: 640,
          height: 480,
          facingMode: 'environment',
        },
      },
      locator: {
        patchSize: 'medium',
        halfSample: true,
      },
      numOfWorkers: 2,
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'],
      },
      locate: true,
    };

    Quagga.init(config, (err) => {
      if (err) {
        console.error('Quagga initialization error:', err);
        setError('Failed to access camera. Please check permissions.');
        return;
      }
      Quagga.start();
    });

    const handleDetected = (result: any) => {
      if (result.codeResult.code) {
        const confidence = result.codeResult.decodedCodes
          .reduce((sum: number, code: any) => sum + (code.error || 0), 0) / result.codeResult.decodedCodes.length;

        if (confidence < 0.2) { // Higher confidence = lower error
          onDetected(result.codeResult.code);
        }
      }
    };

    Quagga.onDetected(handleDetected);

    return () => {
      Quagga.stop();
      Quagga.offDetected(handleDetected);
    };
  }, [isActive, onDetected]);

  return { scannerRef, error };
};
