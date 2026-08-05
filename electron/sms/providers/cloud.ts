// Cloud SMS provider. Ships adapters for Semaphore (Philippines-native),
// MessageBird (global, Gravity-recommended), PhilSMS (Philippines) and a
// generic HTTP endpoint for any other provider. Configured in Admin > Settings.
//
// `verify()` performs a real, cheap key check against the provider (no SMS is
// sent) so the kiosk header reports the ACTUAL gateway state — including
// "MessageBird rejected the API key" when a key is invalid or not activated.
import type { Settings, SmsProviderId, ProviderStatus } from '../../../shared/types';
import type { SmsProvider } from './index';

interface Verification {
  key: string;
  at: number;
  status: ProviderStatus;
}

const VERIFY_TTL_MS = 60_000;
const VERIFY_TIMEOUT_MS = 8000;
// PhilSMS serves its API from dashboard.philsms.com (app.philsms.com rejects tokens).
const PHILSMS_BASE = 'https://dashboard.philsms.com/api/v3';

export class CloudProvider implements SmsProvider {
  readonly id: SmsProviderId = 'cloud';
  private lastVerify: Verification | null = null;

  /** Config-based status — instant, no network. */
  getStatus(settings: Settings): ProviderStatus {
    if (settings.cloud_provider === 'generic' && !settings.cloud_endpoint) {
      return { provider: 'cloud', online: false, detail: 'Cloud provider needs an endpoint (Settings)' };
    }
    if (!settings.cloud_api_key) {
      return { provider: 'cloud', online: false, detail: 'Cloud provider needs an API key (Settings)' };
    }
    if (settings.cloud_provider === 'philsms' && !settings.cloud_sender) {
      return {
        provider: 'cloud',
        online: true,
        detail: 'PhilSMS configured (sender ID will fall back to school name)',
      };
    }
    return { provider: 'cloud', online: true, detail: `${settings.cloud_provider} configured` };
  }

  /** Live key verification (cached 60s). Never sends an SMS. */
  async verify(settings: Settings): Promise<ProviderStatus> {
    const base = this.getStatus(settings);
    if (!base.online) return base;
    if (
      this.lastVerify &&
      this.lastVerify.key === settings.cloud_api_key &&
      Date.now() - this.lastVerify.at < VERIFY_TTL_MS
    ) {
      return this.lastVerify.status;
    }
    const status = await this.checkKey(settings);
    // Don't cache transient throttling (429) — the next poll should retry.
    if (!status.detail.includes('429')) {
      this.lastVerify = { key: settings.cloud_api_key, at: Date.now(), status };
    }
    return status;
  }

  private async checkKey(settings: Settings): Promise<ProviderStatus> {
    const timeout = new Promise<ProviderStatus>((resolve) =>
      setTimeout(() => resolve({ provider: 'cloud', online: false, detail: 'Key verification timed out' }), VERIFY_TIMEOUT_MS),
    );
    const probe: Promise<ProviderStatus> = (async (): Promise<ProviderStatus> => {
      try {
        if (settings.cloud_provider === 'messagebird') {
          return await this.verifyMessageBird(settings);
        }
        if (settings.cloud_provider === 'philsms') {
          return await this.verifyPhilSms(settings);
        }
        return await this.verifySemaphore(settings);
      } catch (err) {
        return { provider: 'cloud', online: false, detail: `Verification failed: ${(err as Error).message}` };
      }
    })();
    return Promise.race([probe, timeout]);
  }

  private async verifyMessageBird(settings: Settings): Promise<ProviderStatus> {
    const res = await fetch('https://rest.messagebird.com/balance', {
      headers: { Authorization: `AccessKey ${settings.cloud_api_key}` },
    });
    if (res.ok) return { provider: 'cloud', online: true, detail: 'MessageBird key verified — online' };
    if (res.status === 401) {
      return {
        provider: 'cloud',
        online: false,
        detail: 'MessageBird rejected the API key (401) — key must be active / account onboarding complete',
      };
    }
    return { provider: 'cloud', online: false, detail: `MessageBird HTTP ${res.status}` };
  }

  private async verifyPhilSms(settings: Settings): Promise<ProviderStatus> {
    const res = await fetch(`${PHILSMS_BASE}/balance`, {
      headers: {
        Authorization: `Bearer ${settings.cloud_api_key}`,
        Accept: 'application/json',
      },
    });
    // PhilSMS returns HTTP 200 with a JSON error body for auth failures, so the
    // body status below is the real signal; a non-200 is a transport/API error.
    if (res.status === 401) {
      return {
        provider: 'cloud',
        online: false,
        detail: 'PhilSMS rejected the API token (401) — check the API key in Settings',
      };
    }
    if (!res.ok) return { provider: 'cloud', online: false, detail: `PhilSMS HTTP ${res.status}` };
    let body: { status?: string; data?: { remaining_balance?: string; expired_on?: string }; message?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { provider: 'cloud', online: false, detail: 'PhilSMS verification failed (unexpected response)' };
    }
    if (body.status === 'success' && body.data) {
      const balance = body.data.remaining_balance ?? 'unknown';
      const credits = Number(String(balance).replace(/[^\d.]/g, '')) || 0;
      if (credits <= 0) {
        return {
          provider: 'cloud',
          online: true,
          detail: 'PhilSMS verified — no credits left, top up to send',
        };
      }
      return { provider: 'cloud', online: true, detail: `PhilSMS verified — balance ${balance}` };
    }
    return {
      provider: 'cloud',
      online: false,
      detail: `PhilSMS rejected the token: ${body.message ?? body.status ?? 'unknown error'}`,
    };
  }

  private async verifySemaphore(settings: Settings): Promise<ProviderStatus> {
    const res = await fetch(
      `https://api.semaphore.co/api/v4/account?apikey=${encodeURIComponent(settings.cloud_api_key)}`,
    );
    if (!res.ok) return { provider: 'cloud', online: false, detail: `Semaphore HTTP ${res.status}` };
    try {
      const acct = (await res.json()) as { status?: string; credit_balance?: number };
      const status = acct.status ?? 'unknown';
      const balance = acct.credit_balance ?? 0;
      const active = status.toLowerCase() === 'active';
      if (active && Number(balance) > 0) {
        return { provider: 'cloud', online: true, detail: `Semaphore verified — account ${status}, balance ₱${balance}` };
      }
      return {
        provider: 'cloud',
        online: false,
        detail: `Semaphore key OK, but account is ${status} with ₱${balance} balance — complete approval & load credits to send`,
      };
    } catch {
      return { provider: 'cloud', online: true, detail: 'Semaphore key verified — online' };
    }
  }

  async send(settings: Settings, phone: string, message: string): Promise<void> {
    if (settings.cloud_provider === 'semaphore') {
      await this.sendSemaphore(settings, phone, message);
    } else if (settings.cloud_provider === 'messagebird') {
      await this.sendMessageBird(settings, phone, message);
    } else if (settings.cloud_provider === 'philsms') {
      await this.sendPhilSms(settings, phone, message);
    } else {
      await this.sendGeneric(settings, phone, message);
    }
  }

  private async sendSemaphore(settings: Settings, phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({
      apikey: settings.cloud_api_key,
      number: phone,
      message,
    });
    if (settings.cloud_sender) body.set('sendername', settings.cloud_sender);
    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Semaphore HTTP ${res.status}: ${await res.text()}`);
  }

  private async sendPhilSms(settings: Settings, phone: string, message: string): Promise<void> {
    const res = await fetch(`${PHILSMS_BASE}/sms/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${settings.cloud_api_key}`,
      },
      body: JSON.stringify({
        recipient: toInternationalFormat(phone),
        sender_id: (settings.cloud_sender || settings.school_name || 'PhilSMS').slice(0, 11),
        // Use 'unicode' for non-GSM-7 chars (em dash, ñ, accents) so they aren't garbled.
        type: /[^\x00-\x7F]/.test(message) ? 'unicode' : 'plain',
        message,
      }),
    });
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
    // PhilSMS returns 200 (and sometimes 4xx/5xx) with a JSON error body, so the
    // body status is the real signal; surface its message instead of raw HTTP.
    if (!body || body.status !== 'success') {
      const reason = body?.message ?? body?.status ?? `HTTP ${res.status}`;
      throw new Error(`PhilSMS: ${reason}`);
    }
  }

  private async sendMessageBird(settings: Settings, phone: string, message: string): Promise<void> {
    const res = await fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `AccessKey ${settings.cloud_api_key}`,
      },
      body: JSON.stringify({
        originator: settings.cloud_sender || 'TapIn',
        recipients: [phone],
        body: message,
      }),
    });
    if (!res.ok) throw new Error(`MessageBird HTTP ${res.status}: ${await res.text()}`);
  }

  private async sendGeneric(settings: Settings, phone: string, message: string): Promise<void> {
    const res = await fetch(settings.cloud_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.cloud_api_key ? { Authorization: `Bearer ${settings.cloud_api_key}` } : {}),
      },
      body: JSON.stringify({ to: phone, message, sender: settings.cloud_sender }),
    });
    if (!res.ok) throw new Error(`Cloud API HTTP ${res.status}: ${await res.text()}`);
  }
}

/** Normalize a stored PH number (e.g. 09171234567) to international format (639171234567). */
function toInternationalFormat(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `63${digits.slice(1)}`;
  return digits;
}
