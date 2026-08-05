// Settings: global toggles, debounce timeout, SMS provider + port selection,
// school years, and SMTP email config for report delivery.
import { useEffect, useRef, useState } from 'react';
import type { SchoolYear, Settings } from '../../../shared/types';
import { api } from '../../lib/api';
import { Spinner, Toast } from '../../components/shared';
import { UpdatePanel } from '../../components/UpdatePanel';
import { useSchoolYear } from './schoolYear';

// Reads an image file, downscales it to a small thumbnail and returns it as a
// JPEG data URI (same pattern as the Students photo upload). Works in Electron
// and browser mock mode alike — no external storage/upload server needed.
function fileToResizedDataUrl(file: File, maxSize = 320, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported in this environment'));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          reject(new Error('Could not process the image'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function SettingsPage({ onSettingsSaved }: { onSettingsSaved?: () => void }) {
  const { refresh: refreshYears } = useSchoolYear();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [newYear, setNewYear] = useState('');
  const [yearBusy, setYearBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings);
    void api.listSchoolYears().then(setSchoolYears);
  }, []);

  const addSchoolYear = async () => {
    const name = newYear.trim();
    if (!name) {
      setToast('Enter a school year first — e.g. 2027 - 2028.');
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setYearBusy(true);
    try {
      const sy = await api.saveSchoolYear(name);
      setSchoolYears(await api.listSchoolYears());
      void refreshYears();
      setNewYear('');
      setToast(`School year ${sy.name} added.`);
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setYearBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const setCurrentYear = async (name: string) => {
    if (!window.confirm(`Set ${name} as the current school year?\n\nStudents' current sections will be cleared for the new year unless it already has enrollments. Past years are kept as history.`)) return;
    setYearBusy(true);
    try {
      await api.setCurrentSchoolYear(name);
      setSchoolYears(await api.listSchoolYears());
      void refreshYears();
      setToast(`${name} is now the current school year.`);
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setYearBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const deleteYear = async (name: string) => {
    if (!window.confirm(`Delete school year ${name}? Its enrollment records will be removed.`)) return;
    setYearBusy(true);
    try {
      await api.deleteSchoolYear(name);
      setSchoolYears(await api.listSchoolYears());
      void refreshYears();
      setToast(`School year ${name} deleted.`);
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setYearBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const pickLogo = (file?: File | null) => {
    if (!file) return;
    fileToResizedDataUrl(file)
      .then((dataUrl) => {
        set('logo_url', dataUrl);
        setLogoError(null);
      })
      .catch((err) => setLogoError((err as Error).message));
  };

  if (!settings) return <Spinner label="Loading settings…" />;

  const save = async () => {
    // Use the returned settings: in Electron the logo data URI is persisted to
    // a file on disk and logo_url comes back as the tapin-logo:// URL.
    const saved = await api.updateSettings(settings);
    setSettings(saved);
    setToast('Settings saved');
    onSettingsSaved?.();
    setTimeout(() => setToast(null), 3000);
  };

  const testEmail = async () => {
    const to =
      settings.email_recipient.split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0] ||
      settings.email_from ||
      settings.smtp_user;
    if (!to) {
      setToast('Enter an SMTP username or report recipient first.');
      setTimeout(() => setToast(null), 3500);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setToast('That is not a valid email address — check the recipient field.');
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setTestingEmail(true);
    try {
      const res = await api.testEmail(to);
      setToast(res.ok ? res.message || 'Test email sent.' : `Test failed: ${res.error}`);
    } catch (err) {
      setToast(`Test failed: ${(err as Error).message}`);
    } finally {
      setTestingEmail(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p className="text-dim">Global kiosk configuration</p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => void save()}>💾 Save Settings</button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <h3>School</h3>
          <div className="field">
            <label>School name (used in SMS)</label>
            <input value={settings.school_name} onChange={(e) => set('school_name', e.target.value)} />
          </div>
          <div className="field">
            <label>School logo (sidebar, kiosk &amp; login)</label>
            <div className="photo-upload">
              <div className="logo-upload-preview">
                {settings.logo_url ? (
                  <img className="logo-upload-img" src={settings.logo_url} alt="School logo" />
                ) : (
                  <span className="logo-upload-fallback">🎓</span>
                )}
              </div>
              <div className="photo-actions">
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    pickLogo(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <div className="photo-btn-row">
                  <button type="button" className="btn-ghost" onClick={() => logoRef.current?.click()}>
                    📷 Upload logo
                  </button>
                  {settings.logo_url && (
                    <button type="button" className="btn-ghost" onClick={() => set('logo_url', null)}>
                      ✕ Remove
                    </button>
                  )}
                </div>
                {logoError ? (
                  <p className="field-hint sms-error">{logoError}</p>
                ) : (
                  <p className="field-hint">Pick a JPEG/PNG — it is resized automatically, stored as a file on this PC, and shown in the sidebar, kiosk header, and login screen.</p>
                )}
              </div>
            </div>
          </div>
          <div className="field">
            <label>SMS message template</label>
            <textarea
              rows={3}
              value={settings.sms_template}
              onChange={(e) => set('sms_template', e.target.value)}
            />
            <p className="field-hint">
              Placeholders: {'{{school}} {{name}} {{section}} {{action}} {{time}} {{flag}}'}
              {' '}— <code>{'{{flag}}'}</code> shows LATE / EARLY for flagged scans (leave it out for plain alerts).
            </p>
          </div>
        </div>          <div className="settings-card">
            <h3>School years</h3>
            <p className="field-hint" style={{ marginTop: -6 }}>
              Students are enrolled in sections per school year (e.g. 2026 - 2027). The current year's roster drives attendance &amp; reports.
            </p>
            {schoolYears.map((y) => (
              <div key={y.name} className="school-year-row">
                <span className="mono">{y.name}</span>
                {y.is_current ? (
                  <span className="pill pill-success">CURRENT</span>
                ) : (
                  <div className="photo-btn-row">
                    <button type="button" className="btn-ghost" disabled={yearBusy} onClick={() => void setCurrentYear(y.name)}>
                      Set current
                    </button>
                    <button type="button" className="btn-icon danger" disabled={yearBusy} title="Delete year" onClick={() => void deleteYear(y.name)}>
                      🗑
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="field">
              <label>Add school year</label>
              <div className="field-row">
                <input value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="2027 - 2028" />
                <button type="button" className="btn-ghost" disabled={yearBusy} onClick={() => void addSchoolYear()} style={{ whiteSpace: 'nowrap' }}>
                  + Add year
                </button>
              </div>
              <p className="field-hint">Example format: 2026 - 2027. Setting a year as current clears students' sections for the new year (past rosters are kept).</p>
            </div>
          </div>

          <div className="settings-card">
          <h3>Bell times &amp; absence detection</h3>
          <div className="field-row">
            <div className="field">
              <label>School start time</label>
              <input type="time" value={settings.bell_time_in} onChange={(e) => set('bell_time_in', e.target.value)} />
              <p className="field-hint">IN scans after this + grace are marked <b>LATE</b>.</p>
            </div>
            <div className="field">
              <label>Dismissal time</label>
              <input type="time" value={settings.bell_time_out} onChange={(e) => set('bell_time_out', e.target.value)} />
              <p className="field-hint">OUT scans before this are marked <b>EARLY</b>.</p>
            </div>
          </div>
          <div className="field">
            <label>Late grace period (minutes)</label>
            <input
              type="number"
              min={0}
              max={120}
              value={settings.bell_grace_minutes}
              onChange={(e) => set('bell_grace_minutes', Number(e.target.value))}
            />
          </div>
          <label className="switch-row">
            <span>Automated absence detection</span>
            <span className={`switch ${settings.absence_detect ? 'on' : ''}`} onClick={() => set('absence_detect', !settings.absence_detect)}>
              <span className="switch-knob" />
            </span>
          </label>
          <p className="field-hint">
            After dismissal, students with no scan that day are recorded as absent, and late-first-IN students as late.
            Runs on weekdays when the gate is used (skips holidays/weekends automatically).
          </p>
          <label className="switch-row">
            <span>Send SMS to parents of absent students</span>
            <span className={`switch ${settings.absence_sms ? 'on' : ''}`} onClick={() => set('absence_sms', !settings.absence_sms)}>
              <span className="switch-knob" />
            </span>
          </label>
<p className="field-hint">One message per student per day, using the template above with “was marked absent today”.</p>
        </div>

        <div className="settings-card">
          <h3>App updates</h3>
          <UpdatePanel />
        </div>

        <div className="settings-card">
          <h3>Gate behavior</h3>
          <label className="switch-row">
            <span>Show student photos on the kiosk</span>
            <span className={`switch ${settings.show_photos ? 'on' : ''}`} onClick={() => set('show_photos', !settings.show_photos)}>
              <span className="switch-knob" />
            </span>
          </label>
          <div className="field">
            <label>Kiosk photo style</label>
            <select
              value={settings.kiosk_photo_style}
              onChange={(e) => set('kiosk_photo_style', e.target.value as Settings['kiosk_photo_style'])}
            >
              <option value="avatar">Round photo (default)</option>
              <option value="zoom">Zoomed square photo</option>
              <option value="fullbleed">Full-bleed banner photo</option>
            </select>
            <p className="field-hint">How the student photo appears on the kiosk after a scan. Students without a photo always fall back to their initials.</p>
          </div>
          <div className="field">
            <label>Debounce timeout (seconds, FR-5)</label>
            <input
              type="number"
              min={0}
              max={3600}
              value={settings.debounce_seconds}
              onChange={(e) => set('debounce_seconds', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="settings-card">
          <h3>SMS provider</h3>
          <div className="field">
            <label>Delivery channel</label>
            <select value={settings.sms_provider} onChange={(e) => set('sms_provider', e.target.value as Settings['sms_provider'])}>
              <option value="simulator">Simulator (no hardware — dev/testing)</option>
              <option value="gsm">GSM module (SIM800L/SIM900A serial)</option>
              <option value="cloud">Cloud SMS API (internet required)</option>
            </select>
          </div>
          {settings.sms_provider === 'gsm' && (
            <>
              <label className="switch-row">
                <span>Auto-detect GSM modem port</span>
                <span className={`switch ${settings.gsm_auto_port ? 'on' : ''}`} onClick={() => set('gsm_auto_port', !settings.gsm_auto_port)}>
                  <span className="switch-knob" />
                </span>
              </label>
              {settings.gsm_auto_port ? (
                <div className="field">
                  <label>Detected modem</label>
                  <input
                    value={settings.gsm_com_port || ''}
                    readOnly
                    placeholder="Plug in the modem — port detected automatically"
                  />
                  <p className="field-hint">
                    The app probes each serial port with an AT command and uses the first modem found,
                    updating this field automatically. Plugging the modem in while the app is running is
                    picked up within seconds.
                  </p>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>Serial COM port</label>
                    <input value={settings.gsm_com_port} onChange={(e) => set('gsm_com_port', e.target.value)} placeholder="COM3 or /dev/ttyUSB0" />
                  </div>
                  <div className="field">
                    <label>Baud rate</label>
                    <select value={settings.gsm_baud} onChange={(e) => set('gsm_baud', Number(e.target.value))}>
                      <option value={9600}>9600</option>
                      <option value={115200}>115200</option>
                    </select>
                  </div>
                </>
              )}
              <p className="field-hint">
                Requires the serialport native module rebuilt for Electron: <code>npm run rebuild:serial</code>
              </p>
            </>
          )}
          {settings.sms_provider === 'cloud' && (
            <>
              <div className="field">
                <label>Cloud provider</label>
                <select value={settings.cloud_provider} onChange={(e) => set('cloud_provider', e.target.value as Settings['cloud_provider'])}>
                  <option value="semaphore">Semaphore (Philippines)</option>
                  <option value="philsms">PhilSMS (Philippines)</option>
                  <option value="messagebird">MessageBird (global)</option>
                  <option value="generic">Generic HTTP API</option>
                </select>
              </div>
              <div className="field">
                <label>API key</label>
                <input type="password" value={settings.cloud_api_key} onChange={(e) => set('cloud_api_key', e.target.value)} placeholder="••••••••" />
              </div>
              <div className="field">
                <label>Sender name / ID {settings.cloud_provider === 'philsms' ? '(required by PhilSMS)' : '(optional)'}</label>
                <input value={settings.cloud_sender} onChange={(e) => set('cloud_sender', e.target.value)} placeholder="TapIn" />
                {settings.cloud_provider === 'philsms' && (
                  <p className="field-hint">
                    PhilSMS requires a sender ID — up to 11 characters (falls back to the school name if empty).
                  </p>
                )}
              </div>
              {settings.cloud_provider === 'generic' && (
                <div className="field">
                  <label>Endpoint URL</label>
                  <input value={settings.cloud_endpoint} onChange={(e) => set('cloud_endpoint', e.target.value)} placeholder="https://api.example.com/sms" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="settings-card">
          <h3>Email (report delivery)</h3>
          <div className="field">
            <label>SMTP server</label>
            <input value={settings.smtp_host} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.smtp_port}
                onChange={(e) => set('smtp_port', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <label className="switch-row">
                <span>Secure (SSL/TLS)</span>
                <span
                  className={`switch ${settings.smtp_secure ? 'on' : ''}`}
                  onClick={() => set('smtp_secure', !settings.smtp_secure)}
                >
                  <span className="switch-knob" />
                </span>
              </label>
            </div>
          </div>
          <p className="field-hint">
            Port <b>587</b> with the secure toggle <b>off</b> (STARTTLS) is the most common — Gmail / Office 365.
            Turn it <b>on</b> for implicit TLS on port <b>465</b>.
          </p>
          <div className="field">
            <label>Username</label>
            <input value={settings.smtp_user} onChange={(e) => set('smtp_user', e.target.value)} placeholder="you@school.edu.ph" />
          </div>
          <div className="field">
            <label>Password / app password</label>
            <input
              type="password"
              value={settings.smtp_password}
              onChange={(e) => set('smtp_password', e.target.value)}
              placeholder="••••••••"
            />
            <p className="field-hint">
              Gmail / Google Workspace need an <b>app password</b> (enable 2-Step Verification → App passwords).
              The password is stored in this PC's settings table, like the cloud SMS API key.
            </p>
          </div>
          <label className="switch-row">
            <span>Allow self-signed certificates</span>
            <span
              className={`switch ${settings.smtp_allow_self_signed ? 'on' : ''}`}
              onClick={() => set('smtp_allow_self_signed', !settings.smtp_allow_self_signed)}
            >
              <span className="switch-knob" />
            </span>
          </label>
          <p className="field-hint">
            Turn on only if the school's own mail server uses a self-signed certificate — otherwise keep it off.
          </p>
          <div className="field">
            <label>From address (optional — defaults to the username)</label>
            <input value={settings.email_from} onChange={(e) => set('email_from', e.target.value)} placeholder="you@school.edu.ph" />
          </div>
          <div className="field">
            <label>Report recipient(s)</label>
            <input
              value={settings.email_recipient}
              onChange={(e) => set('email_recipient', e.target.value)}
              placeholder="admin@school.edu.ph"
            />
            <p className="field-hint">Separate multiple addresses with commas. Used by the “Email report” button in Reports.</p>
          </div>
          <div className="page-actions" style={{ marginTop: 4 }}>
            <button className="btn-ghost" disabled={testingEmail} onClick={() => void testEmail()}>
              {testingEmail ? 'Sending…' : '✉ Send test email'}
            </button>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
