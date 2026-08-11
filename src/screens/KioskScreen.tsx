// Kiosk Terminal (PRD Screen A): header with clock + status, dynamic central
// display (idle / success / blocked / unrecognized), live activity feed,
// webcam fallback scanner, and 4-second auto-reset.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BADGE_INFO } from '../../shared/types';
import type {
  ActivityItem,
  Announcement,
  BadgeCode,
  KioskPhotoStyle,
  ScanMode,
  ScanResult,
  Settings,
  Student,
  StudentBadgeSummary,
  SystemStatus,
} from '../../shared/types';
import { api, isElectron, mockGuardianPayload, mockPayload } from '../lib/api';
import { playAlert, playSuccess, playUnrecognized } from '../lib/audio';
import { useClock } from '../hooks/useClock';
import { ActivityFeed } from '../components/ActivityFeed';
import { CameraScanner } from '../components/CameraScanner';
import { ManualCheckIn } from '../components/ManualCheckIn';
import { VisitorRegister } from '../components/VisitorRegister';
import { WindowControls } from '../components/WindowControls';
import { Avatar, QrCodeImage, SchoolLogo, Toast, fmtTimeSec } from '../components/shared';

const AUTO_RESET_MS = 4000;
// Guardians get extra time to read the day report before the kiosk resets.
const GUARDIAN_RESET_MS = 12000;
const DEMO_STUDENT_NOS = ['2024-0112', '2024-0113', '2024-0215', '2024-0318', '2024-0421', '2024-0524'];
// [guardian name, address] — Maria covers TWO children (Juan + Carlos);
// Luzviminda covers one (Ana). Mirrors the mock's demo roster.
const DEMO_GUARDIANS: Array<[string, string]> = [
  ['Maria Dela Cruz', '123 Mabini St., Barangay San Roque, Manila'],
  ['Luzviminda Reyes', '789 Bonifacio Rd., Pasig City'],
];

type CenterState = { kind: 'idle' } | { kind: 'result'; result: ScanResult };

// Gate-direction selector states shown on the kiosk side panel.
const SCAN_MODES: { value: ScanMode; label: string; title: string }[] = [
  { value: 'auto', label: '↔ Auto', title: 'Smart IN/OUT — the last scan of the day decides' },
  { value: 'in', label: '✓ IN', title: 'Force every scan to CHECK-IN' },
  { value: 'out', label: '⟲ OUT', title: 'Force every scan to CHECK-OUT' },
];

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
  badges,
}: {
  result: ScanResult;
  photoStyle: KioskPhotoStyle;
  showPhoto: boolean;
  badges?: StudentBadgeSummary | null;
}) {
  const student = result.student!;
  const isIn = result.entryType === 'IN';
  const hasPhoto = showPhoto && !!student.photo_url;
  // Two-panel check-in card: photo fills the left panel, details fill the
  // right. The photo style setting still frames the photo inside its panel —
  // 'avatar' letterboxes the whole photo (contain); 'zoom' crops it to fill;
  // 'fullbleed' crops it to fill AND blends into the details panel.
  const cover = photoStyle !== 'avatar' && hasPhoto;
  const seam = photoStyle === 'fullbleed' && cover;

  const badge = (
    <div className="badge-row">
      <span className={`status-badge ${isIn ? 'badge-in' : 'badge-out'}`}>
        {isIn ? '✓ CHECKED IN' : '⟲ CHECKED OUT'}
      </span>
    </div>
  );

  // Right panel: the check-in status, name, details, flags, badges and SMS
  // notice, stacked and centered.
  const details = (
    <div className="split-details">
      {badge}
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
      {badges?.currentWeek && (badges.currentWeek.requiredDays > 0 || badges.currentWeek.excusedDays > 0) && (
        <div className="kiosk-badges">
          {badges.currentWeek.requiredDays === 0 ? (
            <span className="kiosk-badge kiosk-badge-dim">
              {BADGE_INFO.ATT_W.icon} No class days recorded yet this week
            </span>
          ) : badges.currentWeek.attendanceComplete ? (
            <span className="kiosk-badge kiosk-badge-earned">
              {BADGE_INFO.ATT_W.icon} {BADGE_INFO.ATT_W.label}
            </span>
          ) : (
            <span className={`kiosk-badge${badges.currentWeek.attendanceMissed ? ' kiosk-badge-missed' : ''}`}>
              {badges.currentWeek.attendanceMissed
                ? `${BADGE_INFO.ATT_W.icon} Week missed — see you next week!`
                : `${BADGE_INFO.ATT_W.icon} ${badges.currentWeek.presentDays}/${badges.currentWeek.requiredDays} days this week`}
            </span>
          )}
          {badges.currentWeek.punctualityComplete && (
            <span className="kiosk-badge kiosk-badge-earned">
              {BADGE_INFO.PUNCT_W.icon} {BADGE_INFO.PUNCT_W.label}
            </span>
          )}
          {badges.currentWeek.excusedDays > 0 && (
            <span className="kiosk-badge kiosk-badge-dim">✓ {badges.currentWeek.excusedDays} excused</span>
          )}
        </div>
      )}
      {(() => {
        // Highest earned tier per family (Attendance / Punctuality) — e.g.
        // "🥈 Silver · Monthly" — so the card shows the student's top award.
        const earned = badges?.badges ?? [];
        if (!earned.length) return null;
        const bestOf = (fam: 'ATT' | 'PUNCT'): BadgeCode | null => {
          let acc: BadgeCode | null = null;
          for (const b of earned) {
            if (!b.badgeCode.startsWith(fam)) continue;
            if (!acc || BADGE_INFO[b.badgeCode].tier > BADGE_INFO[acc].tier) acc = b.badgeCode;
          }
          return acc;
        };
        const chips = (['ATT', 'PUNCT'] as const).map(bestOf).filter((c): c is BadgeCode => !!c);
        if (!chips.length) return null;
        return (
          <div className="kiosk-badges kiosk-badges-earned">
            {chips.map((code) => {
              const info = BADGE_INFO[code];
              return (
                <span
                  key={code}
                  className="kiosk-badge kiosk-badge-earned"
                  title={`${info.label} — ${info.metal} (${info.windowLabel})`}
                >
                  {info.icon} {info.metal} · {info.windowLabel}
                </span>
              );
            })}
          </div>
        );
      })()}
      {badges?.newlyEarned && (
        <div className="new-badge-pop">
          <span className="new-badge-icon">🏆</span>
          <div>
            <strong>NEW BADGE!</strong>
            <span>
              {BADGE_INFO[badges.newlyEarned.badgeCode].tierIcon}{' '}
              {BADGE_INFO[badges.newlyEarned.badgeCode].label} —{' '}
              {BADGE_INFO[badges.newlyEarned.badgeCode].windowLabel} 🎉
            </span>
          </div>
        </div>
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
  );

  // Left panel: the student photo. With a photo it fills the panel — cropped to
  // fill in zoom/fullbleed, letterboxed whole-photo in avatar mode; without one
  // the panel becomes a gradient tile with the student's initials.
  const photo = hasPhoto ? (
    <div className={`split-photo${!cover ? ' split-photo-contain' : ''}${seam ? ' split-photo-seam' : ''}`}>
      <img className="split-photo-img" src={student.photo_url!} alt={student.full_name} />
    </div>
  ) : (
    <div className="split-photo split-photo-noimg">
      <Avatar name={student.full_name} showPhoto={false} size={190} />
    </div>
  );

  return (
    <div className={`result-card result-card-fill split-card ${isIn ? 'success-in' : 'success-out'}`}>
      {photo}
      {details}
    </div>
  );
}

function VisitorView({ result }: { result: ScanResult }) {
  const visitor = result.visitor!;
  const isIn = result.entryType === 'IN';
  return (
    <div className={`result-card result-card-fill visitor-card ${isIn ? 'success-in' : 'success-out'}`}>
      <div className="visitor-badge-row">
        <span className={`status-badge ${isIn ? 'badge-in' : 'badge-out'}`}>
          {isIn ? '✓ VISITOR CHECKED IN' : '⟲ VISITOR CHECKED OUT'}
        </span>
      </div>
      <div className="visitor-avatar">
        <Avatar name={visitor.full_name} showPhoto={false} size={116} />
      </div>
      <h1 className="result-name">{visitor.full_name}</h1>
      {visitor.purpose && (
        <p className="visitor-line">
          <span className="visitor-line-icon">📋</span> {visitor.purpose}
        </p>
      )}
      {visitor.host_office && (
        <p className="visitor-line">
          <span className="visitor-line-icon">🏛</span> Visiting {visitor.host_office}
        </p>
      )}
      <p className="result-time">{fmtTimeSec(result.log?.scanned_at ?? new Date().toISOString())}</p>
      {result.queuedOffline ? (
        <div className="sms-toast sms-toast-none">Saved offline — will sync when connection returns</div>
      ) : (
        <div className="sms-toast sms-toast-none">Walk-in visitor · reusable VP QR pass</div>
      )}
    </div>
  );
}

function GuardianView({ result }: { result: ScanResult }) {
  const report = result.guardianReport!;
  return (
    <div className="result-card guardian-card">
      <div className="guardian-head">
        <div className="guardian-avatar">👤</div>
        <div>
          <h1 className="result-name">{report.guardianName || 'Guardian'}</h1>
          <p className="guardian-meta">
            Today's Attendance Report · {report.date} · {report.children.length} child{report.children.length === 1 ? '' : 'ren'}
          </p>
        </div>
      </div>
      <div className="guardian-report">
        {report.children.map((child) => (
          <div key={child.studentId} className="guardian-child">
            <div className="guardian-child-head">
              <div>
                <h3>{child.fullName}</h3>
                <p className="guardian-child-meta text-dim">
                  {child.gradeSection && <>{child.gradeSection} · </>}Student No. {child.studentNo}
                </p>
              </div>
              <span className={`pill ${child.present ? 'pill-success' : 'pill-warn'}`}>
                {child.present ? 'PRESENT' : 'NO SCANS YET'}
              </span>
            </div>
            {child.scans.length ? (
              <ul className="guardian-scans">
                {child.scans.map((sc, i) => (
                  <li key={i} className="guardian-scan-row">
                    <span className="guardian-scan-time">{sc.time}</span>
                    <span className={`pill ${sc.entryType === 'IN' ? 'pill-success' : 'pill-info'}`}>
                      {sc.entryType === 'IN' ? '✓ IN' : '⟲ OUT'}
                    </span>
                    {sc.flag === 'LATE' && <span className="guardian-flag flag-late">⚠ Late</span>}
                    {sc.flag === 'EARLY' && <span className="guardian-flag flag-early">⏱ Early out</span>}
                    <span className="text-dim guardian-source">
                      {sc.source === 'MANUAL' ? 'manual' : sc.source === 'WEBCAM' ? 'camera' : 'gate'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-dim guardian-empty">No scans recorded for this child yet today.</p>
            )}
          </div>
        ))}
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

function IdleView({
  onCamera,
  onManual,
  onRegister,
  schoolName,
}: {
  onCamera: () => void;
  onManual: () => void;
  onRegister: () => void;
  schoolName?: string | null;
}) {
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
      <div className="idle-actions">
        <button className="btn-ghost cam-btn" onClick={onCamera}>
          📷 Camera Scanner
        </button>
        <button className="btn-ghost cam-btn" onClick={onManual}>
          📇 Forgot your QR?
        </button>
        <button className="btn-ghost cam-btn" onClick={onRegister}>
          🧑‍🤝‍🧑 Register Visitor
        </button>
      </div>
    </div>
  );
}

function AnnouncementsView({
  announcement,
  onVideoEnded,
}: {
  announcement: Announcement;
  onVideoEnded: () => void;
}) {
  const isVideo = announcement.media_type === 'video' && !!announcement.media_url;
  const videoRef = useRef<HTMLVideoElement>(null);
  // Explicitly start playback once the video element mounts (autoplay can be
  // blocked or skipped in some Electron/Chromium versions, so calling play()
  // after the element is ready is the reliable path). Reloads on each slide
  // change because the element is keyed by the carousel index.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Play WITH audio: the announcement video's sound track should be heard
    // on the kiosk. Electron allows autoplay with sound by default, so this
    // works in the app; in a plain browser (demo mode) unmuted autoplay can
    // be blocked, so fall back to muted playback to keep the carousel moving.
    v.muted = false;
    v.volume = 1;
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        v.muted = true;
        void v.play().catch(() => undefined);
      });
    }
  }, [announcement.media_url]);
  return (
    <div className={`announcement-slide${announcement.media_url ? '' : ' announcement-text-only'}`}>
      {announcement.media_url && isVideo ? (
        <video
          ref={videoRef}
          className="announcement-media announcement-video"
          src={announcement.media_url}
          autoPlay
          playsInline
          onEnded={onVideoEnded}
        />
      ) : announcement.media_url ? (
        <img className="announcement-media announcement-image" src={announcement.media_url} alt={announcement.title} />
      ) : null}
      <div className="announcement-copy">
        {announcement.title && <h2 className="announcement-title">{announcement.title}</h2>}
        {announcement.content_text && <p className="announcement-text">{announcement.content_text}</p>}
      </div>
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
  const [manualOpen, setManualOpen] = useState(false);
  const [visitorRegOpen, setVisitorRegOpen] = useState(false);
  // "Visitor registered" announcement: fired when the registration modal
  // closes after a successful create (so it never shows behind the modal).
  const [visitorToast, setVisitorToast] = useState<string | null>(null);
  const [lastRegistered, setLastRegistered] = useState<string | null>(null);
  const visitorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announceIndex, setAnnounceIndex] = useState(0);
  const [badgeSummary, setBadgeSummary] = useState<StudentBadgeSummary | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('auto');
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerKey = useRef(0);
  // Set once the staff flips the gate mode — the mount-time getScanMode()
  // fetch must not clobber a quick interaction with a stale value.
  const scanModeDirty = useRef(false);
  // Holds the latest showResult so the mount effect (which must run exactly
  // once) can call it without being re-created on every settings change.
  const showResultRef = useRef<(r: ScanResult) => void>(() => undefined);

  // When idle (no announcements showing), start the countdown to show the
  // carousel after the configured number of minutes.
const armAnnounceIdle = useCallback(() => {
    if (announceIdleTimer.current) clearTimeout(announceIdleTimer.current);
    const minutes = Math.max(1, settings?.announcements_idle_minutes || 1);
    announceIdleTimer.current = setTimeout(() => {
      void api.listActiveAnnouncements().then((active) => {
        if (active.length) {
          setAnnouncements(active);
          setAnnounceIndex(0);
        }
      });
    }, minutes * 60 * 1000);
  }, [settings]);

  // Stop the carousel (clear slide timer + idle countdown) when a result shows.
  const stopAnnouncements = useCallback(() => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    if (announceIdleTimer.current) clearTimeout(announceIdleTimer.current);
    setAnnouncements([]);
  }, []);

  const showResult = useCallback((result: ScanResult) => {
    centerKey.current += 1;
    stopAnnouncements();
    setCenter({ kind: 'result', result });
    // Fetch the student's weekly badge status for the success card. Only the
    // latest result wins — a faster subsequent scan supersedes this one.
    if (result.kind === 'SUCCESS' && result.student) {
      const key = centerKey.current;
      void api
        .getStudentBadges(result.student.id)
        .then((summary) => {
          if (key === centerKey.current) setBadgeSummary(summary);
        })
        .catch(() => undefined);
    } else {
      setBadgeSummary(null);
    }
    // PRD: auto-reset to idle after 4s (guardians get longer to read the report).
    const duration = result.kind === 'GUARDIAN' ? GUARDIAN_RESET_MS : AUTO_RESET_MS;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      // Bump the key so any in-flight badge fetch for the finished result is
      // discarded (it must not re-set state after we've returned to idle).
      centerKey.current += 1;
      setCenter({ kind: 'idle' });
      setBadgeSummary(null);
      armAnnounceIdle();
    }, duration);
  }, [armAnnounceIdle, stopAnnouncements]);

  // Keep the latest showResult in a ref so the mount effect (below) can call
  // it without the effect being re-created each time settings change.
  showResultRef.current = showResult;

  // Gate-direction mode: sync from the main process (it resets to 'auto' on
  // app restart, so the renderer always asks first).
  const handleScanModeChange = useCallback((mode: ScanMode) => {
    scanModeDirty.current = true;
    setScanMode(mode);
    void api.setScanMode(mode);
  }, []);

  useEffect(() => {
    void api.getRecentActivity(5).then(setActivity);
    void api.getStatus().then(setStatus);
    void api.getSettings().then(setSettings);
    void api.getScanMode().then((m) => {
      if (!scanModeDirty.current) setScanMode(m);
    });
    void api.setKioskMode(true);
    const offScan = api.onScanResult((r) => {
      if (r.kind === 'SUCCESS') playSuccess();
      else if (r.kind === 'BLOCKED') playAlert();
      else if (r.kind === 'UNRECOGNIZED') playUnrecognized();
      else if (r.kind === 'DUPLICATE') playUnrecognized();
      else if (r.kind === 'GUARDIAN') playSuccess();
      else if (r.kind === 'VISITOR') playSuccess();
      showResultRef.current(r);
    });
    const offActivity = api.onActivity(setActivity);
    const offStatus = api.onStatus(setStatus);
    return () => {
      offScan();
      offActivity();
      offStatus();
      void api.setKioskMode(false);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (announceTimer.current) clearTimeout(announceTimer.current);
      if (announceIdleTimer.current) clearTimeout(announceIdleTimer.current);
      if (visitorToastTimer.current) clearTimeout(visitorToastTimer.current);
    };
    // Run exactly once on mount. Subscribers use showResultRef so they always
    // call the latest showResult without this effect re-running.
  }, []);

// Rotate the carousel while announcements are active. Non-media / image
  // slides advance on a fixed dwell time; VIDEO slides advance only when the
  // video finishes playing (onVideoEnded) so playback isn't cut off.
  const advanceAnnouncement = useCallback(() => {
    setAnnounceIndex((i) => (i + 1) % announcements.length);
  }, [announcements.length]);

  useEffect(() => {
    if (!announcements.length) return;
    const current = announcements[announceIndex % announcements.length];
    const isVideo = current.media_type === 'video' && !!current.media_url;
    // Video slides rely on onVideoEnded to advance — don't run the fixed timer.
    if (isVideo) {
      if (announceTimer.current) clearTimeout(announceTimer.current);
      return;
    }
if (announceTimer.current) clearTimeout(announceTimer.current);
    const secs = Math.max(1, settings?.announcement_slide_seconds || 8);
    announceTimer.current = setTimeout(advanceAnnouncement, secs * 1000);
    return () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    };
  }, [announcements, announceIndex, advanceAnnouncement, settings]);

  // Arm the idle countdown once settings are loaded and on any idle reset.
  useEffect(() => {
    if (center.kind === 'idle' && !announcements.length) armAnnounceIdle();
  }, [center.kind, announcements.length, armAnnounceIdle]);

  const handleCameraDecoded = (payload: string) => {
    setCamOpen(false);
    void api.processScan(payload, 'WEBCAM');
  };

  // Manual check-in (forgot-QR): record through the exact same scan pipeline
  // (debounce, IN/OUT toggle, SMS, offline queue) with source = 'MANUAL' so
  // reports/logs can distinguish it from a real QR scan.
  const handleManualCheckIn = (student: Student) => {
    setManualOpen(false);
    void api.processScan(student.qr_hash_payload, 'MANUAL');
  };

  const showVisitorToast = useCallback((msg: string) => {
    if (visitorToastTimer.current) clearTimeout(visitorToastTimer.current);
    setVisitorToast(msg);
    visitorToastTimer.current = setTimeout(() => setVisitorToast(null), 3500);
  }, []);

  // Closes the registration modal, then announces the newly registered visitor
  // (only when one was actually created in this session — cancelling the PIN
  // or the form shows no toast).
  const closeVisitorRegister = useCallback(() => {
    setVisitorRegOpen(false);
    if (lastRegistered) {
      showVisitorToast(`✅ ${lastRegistered} registered — QR pass issued`);
      setLastRegistered(null);
    }
  }, [lastRegistered, showVisitorToast]);

  const simulateScan = () => {
    const no = DEMO_STUDENT_NOS[Math.floor(Math.random() * DEMO_STUDENT_NOS.length)];
    void api.processScan(mockPayload(no), 'SCANNER');
  };

  const simulateGuardianScan = () => {
    const [name, address] = DEMO_GUARDIANS[Math.floor(Math.random() * DEMO_GUARDIANS.length)];
    void api.processScan(mockGuardianPayload(name, address), 'SCANNER');
  };

  const simulateVisitorScan = () => {
    // Pick the first active registered visitor so the kiosk demo drives the
    // same VP QR the admin prints (IN/OUT toggles on repeated clicks).
    void api.listVisitors().then((list) => {
      const v = list.find((x) => x.is_active) ?? list[0];
      if (v) void api.processScan(v.qr_hash_payload, 'SCANNER');
    });
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
            {scanMode !== 'auto' && (
              <span
                className={`kiosk-gate-pill ${scanMode === 'in' ? 'gate-pill-in' : 'gate-pill-out'}`}
                title={scanMode === 'in' ? 'Gate set to CHECK-IN — every scan records IN' : 'Gate set to CHECK-OUT — every scan records OUT'}
              >
                {scanMode === 'in' ? '✓ GATE: CHECK-IN' : '⟲ GATE: CHECK-OUT'}
              </span>
            )}
            <button
              className="btn-icon admin-btn"
              onClick={() => setManualOpen(true)}
              title="Manual check-in for students who forgot their QR code"
            >
              📇
            </button>
            <button
              className="btn-icon admin-btn"
              onClick={() => setVisitorRegOpen(true)}
              title="Register a walk-in visitor (staff PIN)"
            >
              🧑‍🤝‍🧑
            </button>
            <button className="btn-icon admin-btn" onClick={onOpenAdmin} title="Open Admin Dashboard (Ctrl+Shift+A)">
              ⚙
            </button>
          </div>
          {isElectron && <WindowControls />}
        </div>
      </header>

      {/* ---- Main area ---- */}
      {/* Check-in mode: the student check-in card and the guardian day-report
          card take over the whole main area (left and right panels) — the side
          panel is hidden only for successful scans, so the card spans the full
          width. Error/blocked results keep the side panel so staff can watch
          the live feed. */}
<main
        className={`kiosk-main${center.kind === 'result' && (center.result.kind === 'SUCCESS' || center.result.kind === 'GUARDIAN' || center.result.kind === 'VISITOR') ? ' kiosk-main-full' : ''}`}
      >
        <section className="kiosk-center">
          {center.kind === 'idle' && announcements.length > 0 && (
            <div key={announceIndex} className="center-enter announcement-carousel">
<AnnouncementsView
                announcement={announcements[announceIndex % announcements.length]}
                onVideoEnded={advanceAnnouncement}
              />
              {announcements.length > 1 && (
                <div className="announcement-dots">
                  {announcements.map((a, i) => (
                    <span key={a.id} className={`dot ${i === announceIndex % announcements.length ? 'dot-on' : ''}`} />
                  ))}
                </div>
              )}
            </div>
          )}
          {center.kind === 'idle' && announcements.length === 0 && (
            <IdleView
              onCamera={() => setCamOpen(true)}
              onManual={() => setManualOpen(true)}
              onRegister={() => setVisitorRegOpen(true)}
              schoolName={settings?.school_name}
            />
          )}
          {center.kind === 'result' && center.result.kind === 'SUCCESS' && (
            <div key={centerKey.current} className="center-enter">
              <SuccessView
                result={center.result}
                photoStyle={settings?.kiosk_photo_style ?? 'avatar'}
                showPhoto={settings?.show_photos ?? true}
                badges={badgeSummary}
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
          {center.kind === 'result' && center.result.kind === 'GUARDIAN' && (
            <div key={centerKey.current} className="center-enter">
              <GuardianView result={center.result} />
              <div className="countdown" aria-hidden>
                <svg width="46" height="46" viewBox="0 0 46 46">
                  <circle className="countdown-track" cx="23" cy="23" r="20" />
                  <circle
                    className="countdown-bar"
                    cx="23"
                    cy="23"
                    r="20"
                    style={{ animationDuration: `${GUARDIAN_RESET_MS}ms` }}
                  />
                </svg>
              </div>
            </div>
          )}
          {center.kind === 'result' && center.result.kind === 'VISITOR' && (
            <div key={centerKey.current} className="center-enter">
              <VisitorView result={center.result} />
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
          <div className="side-card gate-mode-card">
            <div className="side-card-head">
              <h3>Gate Mode</h3>
              {scanMode !== 'auto' && (
                <span className={`gate-mode-chip ${scanMode === 'in' ? 'chip-in' : 'chip-out'}`}>
                  {scanMode === 'in' ? 'FORCE IN' : 'FORCE OUT'}
                </span>
              )}
            </div>
            <div className="gate-mode-seg" role="radiogroup" aria-label="Gate scan direction">
              {SCAN_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={scanMode === m.value}
                  title={m.title}
                  className={`gate-mode-btn ${scanMode === m.value ? `gate-mode-on-${m.value}` : ''}`}
                  onClick={() => handleScanModeChange(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="gate-mode-hint">
              {scanMode === 'in'
                ? 'Every scan is recorded as CHECK-IN. Switch back to Auto after the morning rush.'
                : scanMode === 'out'
                  ? 'Every scan is recorded as CHECK-OUT — ideal when a student forgot their morning swipe.'
                  : 'Auto: the last scan of the day decides IN/OUT. Use IN/OUT to override for students who forgot to swipe.'}
            </p>
          </div>
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
            <div className="simulate-row">
              <button className="btn-ghost simulate-btn" onClick={simulateScan}>
                🎲 Simulate scan (demo)
              </button>
              <button className="btn-ghost simulate-btn" onClick={simulateGuardianScan}>
                🧑‍👧 Simulate guardian (demo)
              </button>
              <button className="btn-ghost simulate-btn" onClick={() => void simulateVisitorScan()}>
                🧑‍🤝‍🧑 Simulate visitor (demo)
              </button>
            </div>
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

      <ManualCheckIn
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCheckIn={handleManualCheckIn}
      />

      <VisitorRegister
        open={visitorRegOpen}
        onClose={closeVisitorRegister}
        onRegistered={(v) => setLastRegistered(v.full_name)}
      />

      {visitorToast && <Toast message={visitorToast} />}
    </div>
  );
}
