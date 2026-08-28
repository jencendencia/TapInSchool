// GSM serial SMS provider (SIM800L / SIM900A / SIM800C over USB/RS232).
//
// Supports multi-modem pools: when gsm_modems contains entries, each enabled
// modem is opened as a separate AT session and sends are dispatched round-robin
// for parallel throughput.  Falls back to the legacy single gsm_com_port when
// the pool is empty.
//
// Uses node-serialport (loaded lazily — rebuilt for the Electron ABI).  When
// the module is missing or a port cannot be opened, the provider reports
// offline with a helpful message.
import type { Settings, SmsProviderId, ProviderStatus, GsmModem } from '../../../shared/types';
import type { SmsProvider } from './index';
import { settingsStore } from '../../db/settings';

// ---------------------------------------------------------------------------
// Serialport lazy-load (same pattern as before)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROBE_BAUDS = [9600, 115200];
const PROBE_COOLDOWN_MS = 15_000;

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
    const timer = setTimeout(() => done(() => reject(new Error('port open timeout')))(), timeoutMs);
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

async function probePortAtBaud(mod: SerialPortModule, path: string, baud: number): Promise<boolean> {
  const port = new mod.SerialPort({ path, baudRate: baud });
  try {
    await waitOpen(port, 2000);
    const ok = await new Promise<boolean>((resolve) => {
      let buf = '';
      const cleanup = () => port.removeListener('data', onData);
      const onData = (chunk: Buffer | string) => {
        buf += chunk.toString();
        if (/(^|\r\n)OK(\r\n|$)/.test(buf)) { cleanup(); resolve(true); }
        else if (buf.includes('ERROR')) { cleanup(); resolve(false); }
      };
      port.on('data', onData);
      port.write('AT\r', () => undefined);
      setTimeout(() => { cleanup(); resolve(false); }, 1500);
    });
    await closePort(port);
    return ok;
  } catch {
    await closePort(port);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Single-modem instance — one serial port, one AT session
// ---------------------------------------------------------------------------

class ModemInstance {
  port: SerialPortLike | null = null;
  portPath = '';
  baud = 9600;
  buffer = '';
  lastError = '';
  label: string;
  /** Serializes send() calls so only one AT session runs at a time. */
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(label: string) {
    this.label = label;
  }

  get isOpen(): boolean {
    return !!this.port && this.port.isOpen;
  }

  async open(path: string, baudRate: number): Promise<void> {
    const mod = tryLoadSerialport();
    if (!mod) throw new Error('serialport module unavailable');
    if (this.port && this.port.isOpen && this.portPath === path) return;
    await this.close();
    this.portPath = path;
    this.baud = baudRate;
    this.buffer = '';

    const port = new mod.SerialPort({ path, baudRate });
    this.port = port;
    port.on('data', (chunk: Buffer | string) => { this.buffer += chunk.toString(); });
    port.on('error', (err: Error) => {
      this.lastError = `GSM port error: ${err.message}`;
      if (this.port === port) void this.close();
    });
    port.on('close', () => { if (this.port === port) this.port = null; });

    try {
      await waitOpen(port, 5000);
      await this.atCommand('AT', 3000, 'OK');
      await this.atCommand('AT+CMGF=1', 3000, 'OK');
      this.lastError = '';
    } catch (err) {
      this.lastError = (err as Error).message;
      await this.close();
      throw err;
    }
  }

  async close(): Promise<void> {
    const p = this.port;
    this.port = null;
    if (p && p.isOpen) {
      await new Promise<void>((resolve) => p.close(() => resolve()));
    }
  }

  async send(phone: string, message: string): Promise<void> {
    const run = this.sendQueue.then(() => this.doSend(phone, message));
    this.sendQueue = run.catch(() => undefined);
    return run;
  }

  private async doSend(phone: string, message: string): Promise<void> {
    if (!this.port || !this.port.isOpen) throw new Error(`${this.label}: port not open`);
    this.buffer = '';
    const deadline = Date.now() + 8000;

    // AT+CMGS prompts with ">"
    this.port.write(`AT+CMGS="${phone}"\r`);
    await new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (this.buffer.includes('>')) return resolve();
        if (Date.now() > deadline) return reject(new Error(`${this.label}: GSM did not prompt for message (>)`));
        setTimeout(poll, 50);
      };
      poll();
    });

    // Message body + Ctrl+Z (0x1A)
    this.buffer = '';
    this.port.write(Buffer.concat([Buffer.from(message, 'utf8'), Buffer.from([0x1a])]));
    await new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (this.bufferHas('OK') || this.bufferHas('CMGS')) return resolve();
        if (this.buffer.includes('ERROR')) return reject(new Error(`${this.label}: GSM send error: ${this.buffer.trim()}`));
        if (Date.now() > deadline) return reject(new Error(`${this.label}: GSM send timeout`));
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  private atCommand(cmd: string, timeoutMs: number, expect: string): Promise<void> {
    if (!this.port) throw new Error(`${this.label}: port not open`);
    this.buffer = '';
    const deadline = Date.now() + timeoutMs;
    return new Promise<void>((resolve, reject) => {
      this.port!.write(cmd + '\r', (err) => { if (err) reject(err); });
      const poll = () => {
        if (this.bufferHas(expect)) return resolve();
        if (this.buffer.includes('ERROR')) return reject(new Error(`AT error: ${this.buffer.trim()}`));
        if (Date.now() > deadline) return reject(new Error(`AT timeout: ${this.buffer.trim()}`));
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  private bufferHas(expect: string): boolean {
    if (expect === 'OK') return /(^|\r\n)OK(\r\n|$)/.test(this.buffer);
    if (expect === 'CMGS') return /\+CMGS:\s*\d+/.test(this.buffer);
    return this.buffer.includes(expect);
  }
}

// ---------------------------------------------------------------------------
// Main provider — manages the pool
// ---------------------------------------------------------------------------

export class GsmSerialProvider implements SmsProvider {
  readonly id: SmsProviderId = 'gsm';

  /** Pool of modem instances keyed by port path. */
  private pool = new Map<string, ModemInstance>();
  /** Round-robin index for the send pool. */
  private nextIdx = 0;
  /** Auto-detection state (for legacy single-modem fallback). */
  private detectedPort = '';
  private detectedBaud = 0;
  private lastProbeAt = 0;

  // ---- Status ---------------------------------------------------------------

  getStatus(settings: Settings): ProviderStatus {
    if (!tryLoadSerialport()) {
      return { provider: 'gsm', online: false, detail: 'serialport not rebuilt for Electron — run: npm run rebuild:serial' };
    }
    const modems = this.getEnabledModems(settings);
    if (modems.length > 0) {
      const open = modems.filter((m) => this.pool.get(m.port)?.isOpen);
      if (open.length === modems.length) {
        return { provider: 'gsm', online: true, detail: `GSM pool ready — ${open.length} modem(s): ${open.map((m) => m.label).join(', ')}` };
      }
      if (open.length > 0) {
        return { provider: 'gsm', online: true, detail: `GSM partial — ${open.length}/${modems.length} modem(s) online` };
      }
      return { provider: 'gsm', online: false, detail: `GSM pool configured (${modems.length} modem(s)) — none responding` };
    }
    // Legacy single-modem fallback
    const expected = settings.gsm_auto_port ? this.detectedPort : settings.gsm_com_port;
    const inst = this.pool.get(expected);
    if (inst?.isOpen && inst.portPath === expected && expected) {
      return { provider: 'gsm', online: true, detail: `GSM ready on ${inst.portPath}` };
    }
    if (settings.gsm_auto_port) {
      return {
        provider: 'gsm', online: false,
        detail: this.detectedPort
          ? `GSM modem on ${this.detectedPort} is not responding — check the USB connection`
          : 'GSM modem not detected — plug in the modem',
      };
    }
    return { provider: 'gsm', online: false, detail: `GSM offline on ${settings.gsm_com_port}` };
  }

  async verify(settings: Settings): Promise<ProviderStatus> {
    const modems = this.getEnabledModems(settings);
    if (modems.length > 0) {
      // Probe each configured modem
      for (const m of modems) {
        if (!this.pool.get(m.port)?.isOpen) {
          try { await this.openModem(m.port, m.baud, m.label); } catch { /* best effort */ }
        }
      }
    } else {
      // Legacy single-modem probe
      if (
        settings.gsm_auto_port &&
        !this.isOpenOnDetected() &&
        Date.now() - this.lastProbeAt >= PROBE_COOLDOWN_MS
      ) {
        this.lastProbeAt = Date.now();
        try { await this.openDetected(settings); } catch { /* best effort */ }
      }
    }
    return this.getStatus(settings);
  }

  // ---- Send -----------------------------------------------------------------

  async send(settings: Settings, phone: string, message: string): Promise<void> {
    const modems = this.getEnabledModems(settings);
    if (modems.length > 0) {
      // Round-robin across enabled modems; skip closed ones.
      const start = this.nextIdx;
      for (let i = 0; i < modems.length; i++) {
        const idx = (start + i) % modems.length;
        this.nextIdx = (idx + 1) % modems.length;
        const m = modems[idx];
        let inst = this.pool.get(m.port);
        if (!inst?.isOpen) {
          try { await this.openModem(m.port, m.baud, m.label); inst = this.pool.get(m.port); } catch { continue; }
        }
        if (inst?.isOpen) {
          await inst.send(phone, message);
          return;
        }
      }
      throw new Error('No GSM modem available in the pool');
    }
    // Legacy single-modem send
    await this.open(settings);
    const inst = this.pool.get(this.detectedPort || settings.gsm_com_port);
    if (!inst?.isOpen) throw new Error('GSM modem not open');
    await inst.send(phone, message);
  }

  // ---- Pool management ------------------------------------------------------

  private getEnabledModems(settings: Settings): GsmModem[] {
    try {
      const parsed = JSON.parse(settings.gsm_modems || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((m: GsmModem) => m.enabled && m.port);
      }
    } catch { /* ignore malformed JSON */ }
    return [];
  }

  private async openModem(port: string, baud: number, label: string): Promise<void> {
    const mod = tryLoadSerialport();
    if (!mod) throw new Error('serialport module unavailable');
    let inst = this.pool.get(port);
    if (!inst) {
      inst = new ModemInstance(label);
      this.pool.set(port, inst);
    }
    await inst.open(port, baud);
  }

  // ---- Legacy single-modem helpers ------------------------------------------

  private isOpenOnDetected(): boolean {
    if (!this.detectedPort) return false;
    const inst = this.pool.get(this.detectedPort);
    return !!inst && inst.isOpen && inst.portPath === this.detectedPort;
  }

  private async openDetected(settings: Settings): Promise<void> {
    const mod = tryLoadSerialport();
    if (!mod) throw new Error('serialport module unavailable');
    if (this.detectedPort) {
      const list = await mod.list();
      if (list.some((p) => p.path === this.detectedPort)) {
        await this.openModem(this.detectedPort, this.detectedBaud || settings.gsm_baud, 'Modem');
        return;
      }
      this.detectedPort = '';
      this.detectedBaud = 0;
    }
    // Probe all ports
    const ports = await mod.list();
    const bauds = [settings.gsm_baud, ...PROBE_BAUDS.filter((b) => b !== settings.gsm_baud)];
    for (const p of ports) {
      for (const baud of bauds) {
        if (await probePortAtBaud(mod, p.path, baud)) {
          this.detectedPort = p.path;
          this.detectedBaud = baud;
          void settingsStore.update({ gsm_com_port: p.path, gsm_baud: baud }).catch(() => undefined);
          await this.openModem(p.path, baud, 'Modem');
          return;
        }
      }
    }
    throw new Error('GSM modem not found — check the USB connection and drivers');
  }

  private async open(settings: Settings): Promise<void> {
    if (settings.gsm_auto_port) {
      await this.openDetected(settings);
    } else {
      await this.openModem(settings.gsm_com_port, settings.gsm_baud, 'Modem');
    }
  }

  async close(): Promise<void> {
    for (const inst of this.pool.values()) {
      await inst.close();
    }
  }
}
