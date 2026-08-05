// GSM serial SMS provider (SIM800L / SIM900A over USB/RS232).
//
// Uses node-serialport. Because serialport ships native bindings that must be
// rebuilt for the Electron ABI, it is loaded lazily: if the module is missing
// or the port cannot be opened, the provider reports offline with a helpful
// message instead of crashing the kiosk.
//
// Automatic port detection (default):
//   With `gsm_auto_port` enabled, the provider ignores the manual COM port and
//   locates the modem itself: it enumerates the serial ports and probes each
//   with an AT command (a real modem answers "OK"). The first modem found is
//   cached, opened, and persisted back into settings so the admin UI shows the
//   live port. When no modem is present, a throttled background probe (every
//   PROBE_COOLDOWN_MS) keeps looking — so plugging the modem in while the app
//   is running is picked up within seconds, and the next SMS send probes
//   immediately. Unplugging the modem tears the port down so status returns to
//   offline and re-detection resumes.
import type { Settings, SmsProviderId, ProviderStatus } from '../../../shared/types';
import type { SmsProvider } from './index';
import { settingsStore } from '../../db/settings';

interface SerialPortLike {
  on(event: string, cb: (...args: any[]) => void): void;
  removeListener(event: string, cb: (...args: any[]) => void): void;
  write(data: string | Uint8Array, cb?: (err: Error | null) => void): void;
  close(cb?: () => void): void;
  isOpen: boolean;
}

interface SerialPortModule {
  SerialPort: new (options: { path: string; baudRate: number }) => SerialPortLike;
  list(): Promise<{ path: string }[]>;
}

function tryLoadSerialport(): SerialPortModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('serialport') as SerialPortModule;
  } catch {
    return null;
  }
}

/** Common GSM bauds tried when probing (in addition to the configured one). */
const PROBE_BAUDS = [9600, 115200];
const PROBE_COOLDOWN_MS = 15000;

function waitOpen(port: SerialPortLike, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.removeListener('open', onOpen);
      port.removeListener('error', onError);
      fn();
    };
    const onOpen = done(resolve);
    const onError = (err: Error) => done(() => reject(err))();
    const timer = setTimeout(() => done(() => reject(new Error('port open timeout')))() , timeoutMs);
    port.on('open', onOpen);
    port.on('error', onError);
  });
}

async function closePort(port: SerialPortLike | null): Promise<void> {
  if (!port) return;
  if (port.isOpen) {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

/** Opens a port and sends AT — true only if the device answers OK (a modem). */
async function probePortAtBaud(mod: SerialPortModule, path: string, baud: number): Promise<boolean> {
  const port = new mod.SerialPort({ path, baudRate: baud });
  try {
    await waitOpen(port, 2000);
    const ok = await new Promise<boolean>((resolve) => {
      let buf = '';
      const cleanup = () => port.removeListener('data', onData);
      const onData = (chunk: Buffer | string) => {
        buf += chunk.toString();
        if (/(^|\r\n)OK(\r\n|$)/.test(buf)) {
          cleanup();
          resolve(true);
        } else if (buf.includes('ERROR')) {
          cleanup();
          resolve(false);
        }
      };
      port.on('data', onData);
      port.write('AT\r', () => undefined);
      // Bounded wait so a non-modem device can't stall the detection loop
      // (and so slow modules have time to answer on first power-up).
      setTimeout(() => {
        cleanup();
        resolve(false);
      }, 1500);
    });
    await closePort(port);
    return ok;
  } catch {
    await closePort(port);
    return false;
  }
}

export class GsmSerialProvider implements SmsProvider {
  readonly id: SmsProviderId = 'gsm';

  private port: SerialPortLike | null = null;
  private portPath = '';
  private buffer = '';
  private lastError = 'Not initialized';
  // Serialize send() calls (queue worker + manual testSms) so only one AT
  // session runs at a time — prevents double port opens and interleaved writes.
  private sendQueue: Promise<void> = Promise.resolve();
  // Auto-detection state.
  private detectedPort = '';
  private detectedBaud = 0;
  private lastProbeAt = 0;

  getStatus(settings: Settings): ProviderStatus {
    if (!tryLoadSerialport()) {
      return {
        provider: 'gsm',
        online: false,
        detail: 'serialport not rebuilt for Electron — run: npm run rebuild:serial',
      };
    }
    const expected = settings.gsm_auto_port ? this.detectedPort : settings.gsm_com_port;
    if (this.port && this.port.isOpen && this.portPath === expected && expected) {
      return { provider: 'gsm', online: true, detail: `GSM ready on ${this.portPath}` };
    }
    if (settings.gsm_auto_port) {
      return {
        provider: 'gsm',
        online: false,
        detail: this.detectedPort
          ? `GSM modem on ${this.detectedPort} is not responding — check the USB connection`
          : 'GSM modem not detected — plug in the modem',
      };
    }
    return { provider: 'gsm', online: false, detail: this.lastError || `GSM offline on ${settings.gsm_com_port}` };
  }

  async verify(settings: Settings): Promise<ProviderStatus> {
    // Background detection: when the modem is missing, schedule a throttled
    // probe (serialized with sends) so plugging it in is noticed without
    // waiting for an SMS to be sent. The next send also probes immediately.
    if (
      settings.gsm_auto_port &&
      !this.isOpenOnDetected() &&
      Date.now() - this.lastProbeAt >= PROBE_COOLDOWN_MS
    ) {
      const run = this.sendQueue.then(() => this.backgroundProbe(settings));
      this.sendQueue = run.catch(() => undefined);
    }
    return this.getStatus(settings);
  }

  private isOpenOnDetected(): boolean {
    return (
      !!this.detectedPort &&
      !!this.port &&
      this.port.isOpen &&
      this.portPath === this.detectedPort
    );
  }

  private async backgroundProbe(settings: Settings): Promise<void> {
    this.lastProbeAt = Date.now();
    try {
      if (this.isOpenOnDetected()) return;
      await this.open(settings);
    } catch (err) {
      // Modem still absent — status stays offline until the next probe.
      this.lastError = (err as Error).message;
    }
  }

  /** Resolves the port to use: manual setting, or the auto-detected modem. */
  private async resolvePort(settings: Settings): Promise<{ path: string; baud: number }> {
    const mod = tryLoadSerialport();
    if (!mod) throw new Error('serialport module unavailable');
    if (!settings.gsm_auto_port) return { path: settings.gsm_com_port, baud: settings.gsm_baud };

    // Fast path: the cached modem is still enumerated — reuse it.
    if (this.detectedPort) {
      const list = await mod.list();
      if (list.some((p) => p.path === this.detectedPort)) {
        return { path: this.detectedPort, baud: this.detectedBaud || settings.gsm_baud };
      }
      this.detectedPort = '';
      this.detectedBaud = 0;
    }
    return this.findModemPort(mod, settings);
  }

  /** Probes candidate ports until one answers AT. Throws if none do. */
  private async findModemPort(mod: SerialPortModule, settings: Settings): Promise<{ path: string; baud: number }> {
    const ports = await mod.list();
    const bauds = [settings.gsm_baud, ...PROBE_BAUDS.filter((b) => b !== settings.gsm_baud)];
    for (const p of ports) {
      for (const baud of bauds) {
        if (await probePortAtBaud(mod, p.path, baud)) {
          this.detectedPort = p.path;
          this.detectedBaud = baud;
          // Persist so the admin UI and status show the live port/baud.
          // Best-effort: settingsStore.update swallows DB-offline errors.
          void settingsStore.update({ gsm_com_port: p.path, gsm_baud: baud }).catch(() => undefined);
          return { path: p.path, baud };
        }
      }
    }
    throw new Error('GSM modem not found — check the USB connection and drivers');
  }

  private async open(settings: Settings): Promise<void> {
    const mod = tryLoadSerialport();
    if (!mod) throw new Error('serialport module unavailable');

    const { path, baud } = await this.resolvePort(settings);
    if (this.port && this.port.isOpen && this.portPath === path) return;

    await this.close();
    this.portPath = path;
    this.buffer = '';

    const port = new mod.SerialPort({ path, baudRate: baud });
    this.port = port;
    port.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
    });
    // Unplug / disconnect handling: tear down so status goes offline and the
    // next probe cycle re-detects the modem.
    port.on('error', (err: Error) => {
      this.lastError = `GSM port error: ${err.message}`;
      if (this.port === port) void this.close();
    });
    port.on('close', () => {
      if (this.port === port) this.port = null;
    });

    try {
      await waitOpen(port, 5000);
      // Initialize module: text mode, then verify with a ping.
      await this.atCommand('AT', 3000, 'OK');
      await this.atCommand('AT+CMGF=1', 3000, 'OK');
      this.lastError = '';
    } catch (err) {
      // If the cached port stopped being a modem (device swapped), drop the
      // detection cache so the next attempt re-probes from scratch.
      if (settings.gsm_auto_port) {
        this.detectedPort = '';
        this.detectedBaud = 0;
      }
      this.lastError = (err as Error).message;
      await this.close();
      throw err;
    }
  }

  private async atCommand(cmd: string, timeoutMs: number, expect: string): Promise<void> {
    if (!this.port) throw new Error('GSM port not open');
    this.buffer = '';
    const deadline = Date.now() + timeoutMs;
    await new Promise<void>((resolve, reject) => {
      this.port!.write(cmd + '\r', (err) => {
        if (err) reject(err);
      });
      const poll = () => {
        if (this.bufferHas(expect)) return resolve();
        if (this.buffer.includes('ERROR')) return reject(new Error(`AT error: ${this.buffer.trim()}`));
        if (Date.now() > deadline) return reject(new Error(`AT timeout: ${this.buffer.trim()}`));
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  async send(settings: Settings, phone: string, message: string): Promise<void> {
    const run = this.sendQueue.then(() => this.doSend(settings, phone, message));
    this.sendQueue = run.catch(() => undefined);
    return run;
  }

  private async doSend(settings: Settings, phone: string, message: string): Promise<void> {
    await this.open(settings);
    this.buffer = '';
    const deadline = Date.now() + 8000;

    // 1. AT+CMGS prompts with ">"
    this.port!.write(`AT+CMGS="${phone}"\r`);
    await new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (this.buffer.includes('>')) return resolve();
        if (Date.now() > deadline) return reject(new Error('GSM did not prompt for message (>)'));
        setTimeout(poll, 50);
      };
      poll();
    });

    // 2. Message body + Ctrl+Z (0x1A) to send.
    this.buffer = '';
    this.port!.write(Buffer.concat([Buffer.from(message, 'utf8'), Buffer.from([0x1a])]));
    await new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (this.bufferHas('OK') || this.bufferHas('CMGS')) return resolve();
        if (this.buffer.includes('ERROR')) return reject(new Error(`GSM send error: ${this.buffer.trim()}`));
        if (Date.now() > deadline) return reject(new Error('GSM send timeout'));
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  /** Match terminal responses without false-positives from echoed message text. */
  private bufferHas(expect: string): boolean {
    if (expect === 'OK') return /(^|\r\n)OK(\r\n|$)/.test(this.buffer);
    if (expect === 'CMGS') return /\+CMGS:\s*\d+/.test(this.buffer);
    return this.buffer.includes(expect);
  }

  async close(): Promise<void> {
    const p = this.port;
    this.port = null;
    if (p && p.isOpen) {
      await new Promise<void>((resolve) => p.close(() => resolve()));
    }
  }
}
