// Settings: global toggles, debounce timeout, SMS provider + port selection,
// school years, and SMTP email config for report delivery.
import { useEffect, useRef, useState } from 'react';
import type { GsmModem, JobsConfig, SchoolYear, Settings } from '../../../shared/types';
import { api } from '../../lib/api';
import { Spinner, Toast } from '../../components/shared';
import { UpdatePanel } from '../../components/UpdatePanel';
import jeLogo from '../../../JE_logo.png';
import { ActivationPanel } from '../../components/ActivationPanel';
import { HowToGuide } from '../../components/HowToGuide';
import { useSchoolYear } from './schoolYear';

// Reads an image file, downscales it to a small thumbnail and returns it as a
// data URI. JPEG is used when the image is fully opaque (smaller files); PNG
// when it has any transparency — JPEG has no alpha channel, so a transparent
// logo would otherwise come out with BLACK where it should be see-through.
// Works in Electron and browser mock mode alike.
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
          // Check for any semi-transparent pixel — if found, keep PNG so the
          // transparency survives; otherwise JPEG keeps the file small.
          let hasAlpha = false;
          try {
            const data = ctx.getImageData(0, 0, w, h).data;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] < 255) {
                hasAlpha = true;
                break;
              }
            }
          } catch {
            hasAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
          }
          resolve(hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality));
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
  const [howToOpen, setHowToOpen] = useState(false);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [newYear, setNewYear] = useState('');
  const [yearBusy, setYearBusy] = useState(false);
  /** The TapIn Teacher portal addresses on this machine, shown to admins to hand to teachers. */
  const [portalUrls, setPortalUrls] = useState<string[]>([]);
  /** B5: per-machine scheduled-jobs flag (this machine runs the background jobs). */
  const [jobsConfig, setJobsConfig] = useState<JobsConfig>({ runScheduledJobs: true });
  const [jobsBusy, setJobsBusy] = useState(false);
  /** Snapshot of the last saved/loaded settings, diffed against current to show an unsaved notice. */
  const savedRef = useRef<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  /** Latest settings each render, so the leave-page auto-save sees fresh values. */
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;
  const savingRef = useRef(false);

  useEffect(() => {
    void api.getSettings().then((s) => {
      savedRef.current = s;
      setSettings(s);
    });
    void api.listSchoolYears().then(setSchoolYears);
    void api.getJobsConfig().then(setJobsConfig);
    void api.getStatus().then((st) => setPortalUrls(st.portal.urls));
  }, []);

  // Recompute the unsaved flag by diffing against the last saved snapshot, so
  // reverting a field back to its saved value clears the notice (no stale flag).
  useEffect(() => {
    const base = savedRef.current;
    setDirty(!!base && !!settings && JSON.stringify(settings) !== JSON.stringify(base));
  }, [settings]);

  // Persist any pending changes when leaving the page — sidebar tab switch,
  // log out, back to kiosk, or window close — so edits are never silently lost.
  // savingRef guards against racing a manual Save that is still in flight.
  const saveIfDirty = () => {
    const current = settingsRef.current;
    const base = savedRef.current;
    if (!current || !base || JSON.stringify(current) === JSON.stringify(base) || savingRef.current) return;
    savingRef.current = true;
    void api
      .updateSettings(current)
      .then((saved) => {
        savedRef.current = saved;
      })
      .finally(() => {
        savingRef.current = false;
      });
  };

  useEffect(() => {
    // beforeunload covers closing the Electron window / browser tab, where
    // React unmount cleanup is not guaranteed to run.
    window.addEventListener('beforeunload', saveIfDirty);
    return () => {
      window.removeEventListener('beforeunload', saveIfDirty);
      saveIfDirty();
    };
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
    setSettings((s) => {
      if (!s) return s;
      return { ...s, [key]: value };
    });

  // B5: flip THIS machine's scheduled-jobs role. Takes effect immediately (the
  // main process starts/stops the services) and is remembered per machine — it
  // is NOT shared with the other computers.
  const toggleJobsWorker = async () => {
    if (jobsBusy) return;
    setJobsBusy(true);
    try {
      const next = await api.setRunScheduledJobs(!jobsConfig.runScheduledJobs);
      setJobsConfig(next);
      setToast(
        next.runScheduledJobs
          ? 'Scheduled jobs enabled on this machine.'
          : 'Scheduled jobs disabled on this machine (passive kiosk).',
      );
    } catch (err) {
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setJobsBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

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
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const current = settingsRef.current;
      if (!current) return;
      // Use the returned settings: in Electron the logo data URI is persisted to
      // a file on disk and logo_url comes back as the tapin-logo:// URL.
      const saved = await api.updateSettings(current);
      savedRef.current = saved;
      setSettings(saved);
      setToast('Settings saved');
      onSettingsSaved?.();
      setTimeout(() => setToast(null), 3000);
    } finally {
      savingRef.current = false;
    }
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
      const res = await api.testEmail(to, settings);
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
        </div>        <div className="page-actions">
          <button className="btn-ghost" onClick={() => setHowToOpen(true)}>📖 How To</button>
          <button className="btn-primary" disabled={!dirty} onClick={() => void save()}>💾 Save Settings</button>
        </div>
      </div>

      {dirty && (
        <div className="settings-unsaved">
          <span className="settings-unsaved-dot" />
          <span>
            You have <b>unsaved changes</b> — they will be saved automatically when you leave this page, or click <b>💾 Save Settings</b> now.
          </span>
        </div>
      )}

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

          <div className="settings-row" style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div className="settings-card">
          <h3>Bell times &amp; absence detection</h3>
          <div className="settings-grid">
            <div className="field">
              <label>☀️ AM start time (IN)</label>
              <input type="time" value={settings.am_time_in} onChange={(e) => set('am_time_in', e.target.value)} />
              <p className="field-hint">AM IN scans after this + grace are marked <b>LATE</b>.</p>
            </div>
            <div className="field">
              <label>☀️ AM end time (OUT)</label>
              <input type="time" value={settings.am_time_out} onChange={(e) => set('am_time_out', e.target.value)} />
              <p className="field-hint">AM OUT scans before this are marked <b>EARLY</b>.</p>
            </div>
            <div className="field">
              <label>🌙 PM start time (IN)</label>
              <input type="time" value={settings.pm_time_in} onChange={(e) => set('pm_time_in', e.target.value)} />
              <p className="field-hint">PM IN scans after this + grace are marked <b>LATE</b>.</p>
            </div>
            <div className="field">
              <label>🌙 PM end time (OUT)</label>
              <input type="time" value={settings.pm_time_out} onChange={(e) => set('pm_time_out', e.target.value)} />
              <p className="field-hint">PM OUT scans before this are marked <b>EARLY</b>.</p>
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
          {settings.absence_sms && (
            <div className="field">
              <label>Absence SMS send time</label>
              <input type="time" value={settings.absence_sms_time} onChange={(e) => set('absence_sms_time', e.target.value)} />
              <p className="field-hint">Absence detection runs after dismissal, but SMS to parents is only sent at this time (e.g. 18:00). Absence records are still created immediately.</p>
            </div>
          )}
<p className="field-hint">One message per student per day, using the template above with "was marked absent today".</p>
        </div>

        <div className="settings-card">
          <h3>Email (report delivery)</h3>
          <div className="field">
            <label>SMTP server</label>
            <input value={settings.smtp_host} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
            <p className="field-hint">
              Pre-configured for <b>Gmail</b> — just enter your Gmail address and App Password below.
            </p>
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

        <div className="settings-card">
          <h3>App activation</h3>
          <ActivationPanel />
        </div>

        <div className="settings-card">
          <h3>Scheduled jobs (this machine)</h3>
          <label className="switch-row">
            <span>Run scheduled jobs on this machine</span>
            <span
              className={`switch ${jobsConfig.runScheduledJobs ? 'on' : ''}`}
              onClick={() => void toggleJobsWorker()}
            >
              <span className="switch-knob" />
            </span>
          </label>
          <p className="field-hint">
            With several computers sharing one database, the background jobs — SMS sending, DB backups, absence
            detection, adviser reports, badge recompute — only need to run on <b>one</b> machine. Leave this ON on
            the computer that should do that work and turn it OFF on the kiosks. Takes effect immediately; this
            setting is per machine (not shared). Applies on every launch.
          </p>
        </div>

        <div className="settings-card">
          <h3>Teacher portal (companion)</h3>
          <label className="switch-row">
            <span>Let teachers enroll students</span>
            <span
              className={`switch ${settings.teacher_enrollment_enabled ? 'on' : ''}`}
              onClick={() => set('teacher_enrollment_enabled', !settings.teacher_enrollment_enabled)}
            >
              <span className="switch-knob" />
            </span>
          </label>
          <p className="field-hint">
            When ON, teachers and department heads can add, edit, and remove students in their own
            sections from the TapIn Teacher portal. Turn it OFF to keep the admin dashboard the only place
            students are managed.
          </p>
          {portalUrls.length > 0 && (
            <div className="portal-address">
              <span className="portal-address-label">🌐 Teachers connect to:</span>
              {portalUrls.map((u) => (
                <span key={u} className="portal-address-url">
                  <code>{u}</code>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(u);
                      setToast('Portal address copied');
                    }}
                  >
                    Copy
                  </button>
                </span>
              ))}
              <p className="field-hint">
                Open this address in a browser on any computer on the same network — teachers and department
                heads sign in there, no install needed.
              </p>
            </div>
          )}
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
              <option value="avatar">Whole photo (default)</option>
              <option value="zoom">Cropped to fill the panel</option>
              <option value="fullbleed">Full-bleed fill + blend</option>
            </select>
            <p className="field-hint">How the student photo fills the left panel of the check-in card after a scan. Students without a photo always fall back to their initials.</p>
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
            <GsmModemSettings settings={settings} set={set} />
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
          <h3>About</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src={jeLogo} alt="JE Logo" className="about-logo" title="Joel M. Encendencia — Developer" />
              <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                TapIn — School Attendance Kiosk
              </p>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-dim, #888)', margin: 0, lineHeight: 1.5 }}>
              A modern biometric-free attendance system for schools. TapIn uses RFID card scanning to track student
              check-in/check-out, sends real-time SMS alerts to parents, detects late arrivals and early dismissals,
              generates attendance reports, and supports multi-kiosk setups across campus.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>Developer:</span> Joel M. Encendencia
              </div>
              <div style={{ fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>Email:</span>{' '}
                <a href="mailto:jencendencia@gmail.com" style={{ color: 'var(--accent, #4a90d9)' }}>jencendencia@gmail.com</a>
              </div>
              <div style={{ fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>Contact:</span> 09108904115
              </div>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <h3>App updates</h3>
          <UpdatePanel />
        </div>

        <div className="settings-card">
          <h3>Automatic adviser reports</h3>
          <label className="switch-row">
            <span>Email advisers automatically</span>
            <span
              className={`switch ${settings.adviser_report_enabled ? 'on' : ''}`}
              onClick={() => set('adviser_report_enabled', !settings.adviser_report_enabled)}
            >
              <span className="switch-knob" />
            </span>
          </label>
          <div className="field-row">
            <div className="field">
              <label>Report frequency</label>
              <select
                value={settings.adviser_report_frequency}
                onChange={(e) => set('adviser_report_frequency', e.target.value as Settings['adviser_report_frequency'])}
              >
                <option value="daily">Daily — today's attendance</option>
                <option value="weekly">Weekly — this week (Mon → send time)</option>
                <option value="monthly">Monthly — this month (1st → send time)</option>
              </select>
            </div>
            <div className="field">
              <label>Send time</label>
              <input type="time" value={settings.adviser_report_time} onChange={(e) => set('adviser_report_time', e.target.value)} />
            </div>
          </div>
          <p className="field-hint">
            Each adviser gets their section's per-student attendance report covering the current period
            up to the send time (day / week / month). Periods with no gate activity are skipped.
            Changing the frequency restarts the schedule for the new period.
          </p>
          <p className="field-hint">
            Requires a working SMTP setup above and adviser emails in the Sections tab. If the app
            was off at the send time, the report goes out on the next start.
          </p>
        </div>
      </div>

      {toast && <Toast message={toast} />}
      <HowToGuide open={howToOpen} onClose={() => setHowToOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// GSM multi-modem settings sub-panel
// ---------------------------------------------------------------------------

function GsmModemSettings({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  let modems: GsmModem[] = [];
  try { modems = JSON.parse(settings.gsm_modems || '[]'); } catch { modems = []; }
  if (!Array.isArray(modems)) modems = [];

  const updateModems = (next: GsmModem[]) => set('gsm_modems', JSON.stringify(next));

  const addModem = () => {
    const label = `Modem ${modems.length + 1}`;
    updateModems([...modems, { port: 'COM' + (modems.length + 3), baud: 9600, label, enabled: true }]);
  };

  const removeModem = (idx: number) => {
    updateModems(modems.filter((_, i) => i !== idx));
  };

  const toggleModem = (idx: number) => {
    const next = modems.map((m, i) => i === idx ? { ...m, enabled: !m.enabled } : m);
    updateModems(next);
  };

  const updateField = (idx: number, field: keyof GsmModem, value: string | number | boolean) => {
    const next = modems.map((m, i) => i === idx ? { ...m, [field]: value } : m);
    updateModems(next);
  };

  return (
    <>
      <p className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
        Connect multiple GSM modems (e.g. 2× SIM800C) for parallel SMS sending.
        The queue worker dispatches messages across all enabled modems simultaneously.
      </p>
      {modems.map((m, idx) => (
        <div key={idx} className="gsm-modem-row">
          <div className="gsm-modem-header">
            <span style={{ fontWeight: 600 }}>{m.label || `Modem ${idx + 1}`}</span>
            <span className={`switch ${m.enabled ? 'on' : ''}`} onClick={() => toggleModem(idx)}>
              <span className="switch-knob" />
            </span>
          </div>
          {m.enabled && (
            <div className="gsm-modem-fields">
              <div className="field">
                <label>Label</label>
                <input value={m.label} onChange={(e) => updateField(idx, 'label', e.target.value)} placeholder="Modem 1" />
              </div>
              <div className="field">
                <label>COM port</label>
                <input value={m.port} onChange={(e) => updateField(idx, 'port', e.target.value)} placeholder="COM3" />
              </div>
              <div className="field">
                <label>Baud rate</label>
                <select value={m.baud} onChange={(e) => updateField(idx, 'baud', Number(e.target.value))}>
                  <option value={9600}>9600</option>
                  <option value={115200}>115200</option>
                </select>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-icon danger" title="Remove modem" onClick={() => removeModem(idx)} style={{ marginTop: 4 }}>
              🗑
            </button>
          </div>
        </div>
      ))}
      <div className="page-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn-ghost" onClick={addModem}>
          + Add modem
        </button>
      </div>
      <p className="field-hint" style={{ marginTop: 8 }}>
        Requires the serialport native module rebuilt for Electron: <code>npm run rebuild:serial</code>
      </p>
    </>
  );
}
