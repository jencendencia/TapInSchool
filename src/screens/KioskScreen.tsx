// Kiosk Terminal (PRD Screen A): header with clock + status, dynamic central
// display (idle / success / blocked / unrecognized), live activity feed,
// webcam fallback scanner, and 4-second auto-reset.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityItem, KioskPhotoStyle, ScanResult, Settings, SystemStatus } from '../../shared/types';
import { api, isElectron, mockPayload } from '../lib/api';
import { playAlert, playSuccess, playUnrecognized } from '../lib/audio';
import { useClock } from '../hooks/useClock';
import { ActivityFeed } from '../components/ActivityFeed';
import { CameraScanner } from '../components/CameraScanner';
import { WindowControls } from '../components/WindowControls';
import { Avatar, QrCodeImage, SchoolLogo, fmtTimeSec } from '../components/shared';

const AUTO_RESET_MS = 4000;
const DEMO_STUDENT_NOS = ['2024-0112', '2024-0113', '2024-0215', '2024-0318', '2024-0421', '2024-0524'];

type CenterState = { kind: 'idle' } | { kind: 'result'; result: ScanResult };

function StatusDot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <div className="status-dot" title={title}>
      <span className={`dot ${ok ? 'dot-ok' : 'dot-bad'}`} />
      <span className="text-dim">{label}</span>
    </div>
  );
}

function SuccessView({
  result,
  photoStyle,
  showPhoto,
}: {
  result: ScanResult;
  photoStyle: KioskPhotoStyle;
  showPhoto: boolean;
}) {
  const student = result.student!;
  const isIn = result.entryType === 'IN';
  const hasPhoto = showPhoto && !!student.photo_url;
  const bleed = photoStyle === 'fullbleed' && hasPhoto;

  const badge = (
    <div className="badge-row">
      <span className={`status-badge ${isIn ? 'badge-in' : 'badge-out'}`}>
        {isIn ? '✓ CHECKED IN' : '⟲ CHECKED OUT'}
      </span>
    </div>
  );

  // Layout variants (Settings → Kiosk photo style): full-bleed banner at the
  // top of the card, a large zoomed square, or the default round avatar.
  const photo = bleed ? (
    <div className="bleed-photo">
      <img className="bleed-photo-img" src={student.photo_url!} alt={student.full_name} />
      {badge}
    </div>
  ) : photoStyle === 'zoom' && hasPhoto ? (
    <div className="photo-zoom">
      <img
        className={`photo-zoom-img ${isIn ? 'zoom-in' : 'zoom-out'}`}
        src={student.photo_url!}
        alt={student.full_name}
      />
    </div>
  ) : (
    <Avatar
      name={student.full_name}
      photoUrl={student.photo_url}
      showPhoto={showPhoto}
      size={photoStyle === 'zoom' ? 360 : 312}
    />
  );

  return (
    <div className={`result-card ${bleed ? 'result-card-bleed ' : ''}${isIn ? 'success-in' : 'success-out'}`}>
      {photo}
      <div className={bleed ? 'bleed-body' : undefined}>
        {!bleed && badge}
        <h1 className="result-name">{student.full_name}</h1>
        <p className="result-details">
          {student.grade_section} <span className="sep">•</span> Student No. {student.student_no}
        </p>
        <p className="result-time">{fmtTimeSec(result.log?.scanned_at ?? new Date().toISOString())}</p>
        {result.log?.flag === 'LATE' && (
          <div className="result-flag flag-late">⚠ Arrived late</div>
        )}
        {result.log?.flag === 'EARLY' && (
          <div className="result-flag flag-early">⏱ Early departure</div>
        )}
        {result.queuedOffline ? (
          result.smsQueued ? (
            <div className="sms-toast">
              <span className="sms-toast-icon">⏳</span>
              Saved offline — will sync & notify parent when connection returns
            </div>
          ) : (
            <div className="sms-toast sms-toast-none">Saved offline — will sync when connection returns</div>
          )
        ) : result.smsQueued ? (
          <div className="sms-toast">
            <span className="sms-toast-icon">✉</span>
            Parent SMS queued to {result.parentPhoneMasked}
          </div>
        ) : (
          <div className="sms-toast sms-toast-none">No parent number on file — SMS skipped</div>
        )}
        </div>
    </div>
  );
}

function BlockedView({ result }: { result: ScanResult }) {
  return (
    <div className="result-card result-blocked">
      <div className="result-icon">⛔</div>
      <h1 className="result-name">Access Restricted</h1>
      <p className="result-msg">{result.message}</p>
      {result.student && <p className="result-details">{result.student.full_name} · {result.student.grade_section}</p>}
    </div>
  );
}

function UnknownView({ result }: { result: ScanResult }) {
  return (
    <div className="result-card result-unknown">
      <div className="result-icon">❓</div>
      <h1 className="result-name">Unrecognized QR</h1>
      <p className="result-msg">{result.message}</p>
    </div>
  );
}

function DuplicateView({ result }: { result: ScanResult }) {
  return (
    <div className="result-card result-duplicate">
      <div className="result-icon">♻️</div>
      <h1 className="result-name">QR Already Scanned</h1>
      <p className="result-msg">{result.message}</p>
      {result.student && <p className="result-details">{result.student.full_name} · {result.student.grade_section}</p>}
    </div>
  );
}

function IdleView({ onCamera, schoolName }: { onCamera: () => void; schoolName?: string | null }) {
  return (
    <div className="idle-view">
      <div className="qr-pulse-wrap">
        <div className="qr-pulse-ring" />
        <QrCodeImage text={`${schoolName || 'TAPIN SCHOOL'}\nPlease present your QR code`} size={208} dark />
      </div>
      <h2 className="idle-title">Please present your Student QR Code</h2>
      <p className="idle-sub">to the scanner at the gate</p>
      {!isElectron && (
        <p className="idle-hint">
          Browser demo mode — press <b>Simulate scan</b> below or use the Camera Scanner.
        </p>
      )}
      <button className="btn-ghost cam-btn" onClick={onCamera}>
        📷 Camera Scanner
      </button>
    </div>
  );
}

export function KioskScreen({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const clock = useClock();
  const [center, setCenter] = useState<CenterState>({ kind: 'idle' });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerKey = useRef(0);

  const showResult = useCallback((result: ScanResult) => {
    centerKey.current += 1;
    setCenter({ kind: 'result', result });
    // PRD: auto-reset to idle after 4s.
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCenter({ kind: 'idle' }), AUTO_RESET_MS);
  }, []);

  useEffect(() => {
    void api.getRecentActivity(5).then(setActivity);
    void api.getStatus().then(setStatus);
    void api.getSettings().then(setSettings);
    void api.setKioskMode(true);
    const offScan = api.onScanResult((r) => {
      if (r.kind === 'SUCCESS') playSuccess();
      else if (r.kind === 'BLOCKED') playAlert();
      else if (r.kind === 'UNRECOGNIZED') playUnrecognized();
      else if (r.kind === 'DUPLICATE') playUnrecognized();
      showResult(r);
    });
    const offActivity = api.onActivity(setActivity);
    const offStatus = api.onStatus(setStatus);
    return () => {
      offScan();
      offActivity();
      offStatus();
      void api.setKioskMode(false);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [showResult]);

  const handleCameraDecoded = (payload: string) => {
    setCamOpen(false);
    void api.processScan(payload, 'WEBCAM');
  };

  const simulateScan = () => {
    const no = DEMO_STUDENT_NOS[Math.floor(Math.random() * DEMO_STUDENT_NOS.length)];
    void api.processScan(mockPayload(no), 'SCANNER');
  };

  return (
    <div className="kiosk">
      {/* ---- Header (PRD: logo + name / clock / status) ---- */}
      <header className="kiosk-header">
        <div className="kiosk-brand">
          <div className="kiosk-logo">
            <SchoolLogo logoUrl={settings?.logo_url} />
          </div>
          <div>
            <div className="kiosk-name">{settings?.school_name || 'TapIn School'}</div>
            <div className="kiosk-tagline">Gate Attendance & Parent Alerts</div>
          </div>
        </div>
        <div className="kiosk-header-right">
          <div className="kiosk-clock">
            <div className="kiosk-time">{clock.time}</div>
            <div className="kiosk-date text-dim">{clock.date}</div>
          </div>
          <div className="kiosk-status">
            <StatusDot ok={status?.db.online ?? false} label="Database" title={status?.db.detail ?? ''} />
            <StatusDot ok={status?.sms.online ?? false} label={`SMS · ${status?.sms.provider ?? '…'}`} title={status?.sms.detail ?? ''} />
            <StatusDot
              ok={(status?.queue.pending ?? 0) === 0}
              label={`Sync · ${status?.queue.pending ?? 0}`}
              title="Offline scans waiting to sync with the database"
            />
            <button className="btn-icon admin-btn" onClick={onOpenAdmin} title="Open Admin Dashboard (Ctrl+Shift+A)">
              ⚙
            </button>
          </div>
          {isElectron && <WindowControls />}
        </div>
      </header>

      {/* ---- Main area ---- */}
      <main className="kiosk-main">
        <section className="kiosk-center">
          {center.kind === 'idle' && <IdleView onCamera={() => setCamOpen(true)} schoolName={settings?.school_name} />}
          {center.kind === 'result' && center.result.kind === 'SUCCESS' && (
            <div key={centerKey.current} className="center-enter">
              <SuccessView
                result={center.result}
                photoStyle={settings?.kiosk_photo_style ?? 'avatar'}
                showPhoto={settings?.show_photos ?? true}
              />
              <div className="countdown" aria-hidden>
                <svg width="46" height="46" viewBox="0 0 46 46">
                  <circle className="countdown-track" cx="23" cy="23" r="20" />
                  <circle
                    className="countdown-bar"
                    cx="23"
                    cy="23"
                    r="20"
                    style={{ animationDuration: `${AUTO_RESET_MS}ms` }}
                  />
                </svg>
              </div>
            </div>
          )}
          {center.kind === 'result' && center.result.kind === 'BLOCKED' && (
            <div key={centerKey.current} className="center-enter">
              <BlockedView result={center.result} />
            </div>
          )}
          {center.kind === 'result' && center.result.kind === 'DUPLICATE' && (
            <div key={centerKey.current} className="center-enter">
              <DuplicateView result={center.result} />
            </div>
          )}
          {center.kind === 'result' && center.result.kind === 'UNRECOGNIZED' && (
            <div key={centerKey.current} className="center-enter">
              <UnknownView result={center.result} />
            </div>
          )}
          {center.kind === 'result' &&
            (center.result.kind === 'OFFLINE' || center.result.kind === 'ERROR') && (
              <div key={centerKey.current} className="center-enter">
                <div className="result-card result-blocked">
                  <div className="result-icon">🛑</div>
                  <h1 className="result-name">
                    {center.result.kind === 'OFFLINE' ? 'System Offline' : 'Scan Error'}
                  </h1>
                  <p className="result-msg">{center.result.message}</p>
                </div>
              </div>
            )}
        </section>

        {/* ---- Right panel: live activity feed ---- */}
        <aside className="kiosk-side">
          <div className="side-card">
            <div className="side-card-head">
              <h3>Live Activity</h3>
              <span className="live-badge"><span className="live-dot" /> LIVE</span>
            </div>
            <ActivityFeed items={activity} />
          </div>
          <div className="side-card side-card-status">
            <div className="side-card-head"><h3>Gateway</h3></div>
            <div className="gateway-row">
              <span className="text-dim">DB</span>
              <span className={status?.db.online ? 'gw-ok' : 'gw-bad'}>{status?.db.online ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <div className="gateway-row">
              <span className="text-dim">SMS provider</span>
              <span className="gw-ok">{status?.sms.provider ?? '…'}</span>
            </div>
            <div className="gateway-row">
              <span className="text-dim">Queue</span>
              <span className="gw-ok">1s poll</span>
            </div>
          </div>
          {!isElectron && (
            <button className="btn-ghost simulate-btn" onClick={simulateScan}>
              🎲 Simulate scan (demo)
            </button>
          )}
        </aside>
      </main>

      {camOpen && (
        <CameraScanner
          open={camOpen}
          onDecoded={handleCameraDecoded}
          onClose={() => setCamOpen(false)}
        />
      )}
    </div>
  );
}
