// Webcam QR scanner fallback (PRD §3.1) using html5-qrcode.
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

export function CameraScanner({
  open,
  onDecoded,
  onClose,
}: {
  open: boolean;
  onDecoded: (payload: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let decoded = false;
    setError(null);

    const scanner = new Html5Qrcode('qr-reader-region');
    ref.current = scanner;

    // html5-qrcode throws "Cannot stop, scanner is not running or paused."
    // when stop() is called before start() completes (e.g. the overlay is
    // closed while the camera-permission prompt is still up). Only stop when
    // the scanner is actually running, and always guard with try/catch so a
    // mid-transition teardown can never surface as an error.
    const teardown = async () => {
      const s = ref.current;
      ref.current = null;
      if (!s) return;
      try {
        const state = s.getState();
        if (
          state === Html5QrcodeScannerState.SCANNING ||
          state === Html5QrcodeScannerState.PAUSED
        ) {
          await s.stop();
        }
        s.clear();
      } catch {
        // Already stopped / never started — nothing left to tear down.
      }
    };

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          // Guard against a double decode of the same QR before React
          // processes the unmount — processScan must only fire once.
          if (disposed || decoded) return;
          decoded = true;
          void teardown();
          onDecoded(text);
        },
        () => undefined,
      )
      .then(() => {
        // Overlay closed while the permission prompt was up — stop the just-
        // started scanner so the camera stream isn't left running.
        if (disposed) void teardown();
      })
      .catch((err) => {
        if (disposed) return;
        void teardown();
        const msg = (err as Error)?.message ?? String(err);
        setError(
          /Permission|denied|NotFound|not found|NotReadable/i.test(msg)
            ? 'Camera unavailable — check camera permissions and that no other app is using it.'
            : msg,
        );
      });

    return () => {
      disposed = true;
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="cam-overlay">
      <div className="cam-card">
        <div className="cam-head">
          <h3>Camera Scanner</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close camera">
            ✕
          </button>
        </div>
        {error ? (
          <div className="cam-error">
            <span className="cam-error-icon">📷</span>
            <p>Something went wrong.</p>
            <p className="text-dim">{error}</p>
          </div>
        ) : (
          <>
            <div id="qr-reader-region" className="cam-region" />
            <p className="cam-hint">Point the camera at a student QR code.</p>
          </>
        )}
      </div>
    </div>
  );
}
