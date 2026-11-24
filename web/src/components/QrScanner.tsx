import { CameraOff } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useId, useRef, useState } from 'react';

function cameraMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/permission|notallowed|denied/i.test(raw)) {
    return 'Camera access was blocked. Allow it in your browser settings, or type the code below.';
  }
  if (/notfound|no camera|devices/i.test(raw)) {
    return 'No camera found on this device. Type the ticket code below.';
  }
  if (/secure|https/i.test(raw)) {
    return 'The camera needs HTTPS. Type the ticket code below instead.';
  }
  return 'The camera could not start. Type the ticket code below.';
}

export function QrScanner({ onDecode }: { onDecode: (text: string) => void }) {
  const regionId = `qr-${useId().replace(/:/g, '')}`;
  const callback = useRef(onDecode);
  callback.current = onDecode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(regionId, { verbose: false });
    let cancelled = false;

    const started = scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (width, height) => {
            const edge = Math.floor(Math.min(width, height) * 0.72);
            return { width: edge, height: edge };
          },
        },
        (text) => callback.current(text),
        () => {},
      )
      .then(() => true)
      .catch((err) => {
        if (!cancelled) setError(cameraMessage(err));
        return false;
      });

    return () => {
      cancelled = true;
      void started.then((running) => {
        if (!running) return;
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      });
    };
  }, [regionId]);

  if (error) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center">
        <div>
          <CameraOff className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return <div id={regionId} className="qr-region aspect-square w-full" />;
}
