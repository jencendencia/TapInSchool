// Settings store persisted in the MySQL `settings` table with sensible
// defaults. Falls back to defaults when the DB is offline.
//
// IMPORTANT: defaults read process.env LAZILY (on first use), not at module
// import time — ES imports are hoisted, so env is only guaranteed to be loaded
// (main.ts calls loadEnv()) by the time any method is actually called.
import { db } from './connection';
import type { Settings } from '../../shared/types';

function buildDefaults(): Settings {
  return {
    school_name: process.env.SCHOOL_NAME || 'TapIn School',
    logo_url: null,
    show_photos: true,
    debounce_seconds: 120,
    sms_provider: (process.env.SMS_PROVIDER as Settings['sms_provider']) || 'simulator',
    gsm_com_port: process.env.GSM_SERIAL_COM_PORT || 'COM3',
    gsm_baud: 9600,
    gsm_auto_port: true,
    kiosk_photo_style: 'avatar',
    cloud_provider: (process.env.CLOUD_PROVIDER as Settings['cloud_provider']) || 'semaphore',
    cloud_api_key: process.env.CLOUD_API_KEY || '',
    cloud_sender: process.env.CLOUD_SENDER || '',
    cloud_endpoint: '',
    sms_template:
      '{{school}} Alert: {{name}} ({{section}}) {{action}} at {{time}}. Please advise. - {{school}}',
    bell_time_in: '07:00',
    bell_time_out: '16:00',
    bell_grace_minutes: 15,
    absence_detect: true,
    absence_sms: true,
    absence_last_run: '',
    // Pre-configured for Gmail (SMTP + STARTTLS on 587). The admin only needs
    // to enter their Gmail address in smtp_user and an App Password in
    // smtp_password — everything else is already correct for Gmail/Workspace.
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    smtp_password: '',
    smtp_allow_self_signed: false,
    email_from: '',
    email_recipient: '',
  };
}

const KEYS = [
  'school_name',
  'logo_url',
  'show_photos',
  'debounce_seconds',
  'sms_provider',
  'gsm_com_port',
  'gsm_baud',
  'gsm_auto_port',
  'kiosk_photo_style',
  'cloud_provider',
  'cloud_api_key',
  'cloud_sender',
  'cloud_endpoint',
  'sms_template',
  'bell_time_in',
  'bell_time_out',
  'bell_grace_minutes',
  'absence_detect',
  'absence_sms',
  'absence_last_run',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_user',
  'smtp_password',
  'smtp_allow_self_signed',
  'email_from',
  'email_recipient',
] as const;

function parseValue(key: (typeof KEYS)[number], raw: string): unknown {
  const def = buildDefaults()[key];
  if (typeof def === 'boolean') return raw === 'true' || raw === '1';
  if (typeof def === 'number') return Number(raw);
  return raw;
}

export class SettingsStore {
  private cache: Settings | null = null;

  private ensureCache(): Settings {
    if (!this.cache) this.cache = buildDefaults();
    return this.cache;
  }

  async start(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<Settings> {
    const next = buildDefaults();
    try {
      const rows = await db.query<{ setting_key: string; setting_value: string }[]>(
        'SELECT setting_key, setting_value FROM settings',
      );
      const nextAny = next as unknown as Record<string, unknown>;
      for (const row of rows) {
        const key = row.setting_key as (typeof KEYS)[number];
        if ((KEYS as readonly string[]).includes(key)) {
          nextAny[key] = parseValue(key, row.setting_value);
        }
      }
    } catch {
      // DB offline — keep defaults.
    }
    this.cache = next;
    return { ...next };
  }

  get(): Settings {
    return { ...this.ensureCache() };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    // Whitelist incoming keys so arbitrary IPC payloads can't pollute the cache.
    const clean: Partial<Settings> = {};
    const cleanAny = clean as Record<string, unknown>;
    for (const key of KEYS) {
      if (key in patch) cleanAny[key] = patch[key];
    }
    const next = { ...this.ensureCache(), ...clean };
    for (const key of KEYS) {
      if (!(key in clean)) continue;
      try {
        await db.execute(
          'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
          [key, String(next[key])],
        );
      } catch {
        // DB offline — settings just won't persist; keep them in memory.
      }
    }
    this.cache = next;
    return { ...this.cache };
  }
}

export const settingsStore = new SettingsStore();
