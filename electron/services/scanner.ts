// USB QR scanner listener. USB scanners act as HID keyboards: they type the
// payload at high speed and finish with Enter (Carriage Return). We listen on
// `before-input-event`, accumulate a burst of printable characters, and only
// dispatch when Enter arrives. Manual human typing in the admin UI is never
// intercepted because interception is only active in kiosk mode.
import type { WebContents } from 'electron';
import type { ScanSource } from '../../shared/types';

interface ScannerCallbacks {
  onScan(payload: string, source: ScanSource): void;
}

export class UsbScanner {
  private buffer = '';
  private clearTimer: NodeJS.Timeout | null = null;
  private kioskMode = false;
  private readonly minPayloadLength = 6;

  constructor(private readonly webContents: WebContents, private readonly cb: ScannerCallbacks) {}

  setKioskMode(active: boolean): void {
    this.kioskMode = active;
    if (!active) this.reset();
  }

  reset(): void {
    this.buffer = '';
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = null;
  }

  /** Attach to the renderer's input pipeline. Call once from main. */
  attach(): void {
    this.webContents.on('before-input-event', (event, input) => {
      if (!this.kioskMode) return;
      if (input.type !== 'keyDown') return;

      if (input.key === 'Enter' || input.key === '\u000d' || input.key === '\u000a') {
        if (this.buffer.length >= this.minPayloadLength) {
          event.preventDefault();
          const payload = this.buffer;
          this.reset();
          this.cb.onScan(payload, 'SCANNER');
        } else {
          // Stray Enter in kiosk mode (e.g. from a manual keyboard) — ignore.
          this.reset();
        }
        return;
      }

      if (input.key.length === 1 && !input.control && !input.meta) {
        // Guard against IME/process keys on Windows.
        if (input.key === '\u0000') return;
        this.buffer += input.key;
        if (this.clearTimer) clearTimeout(this.clearTimer);
        // If a burst stalls without Enter, clear it — it was manual typing.
        this.clearTimer = setTimeout(() => this.reset(), 400);
      }
    });
  }

  detach(): void {
    this.webContents.removeAllListeners('before-input-event');
  }
}
