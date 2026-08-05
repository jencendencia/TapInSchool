// Small shared UI primitives used across the kiosk and admin screens.
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { SmsStatus } from '../../shared/types';

// ---- Formatting helpers -----------------------------------------------------
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function fmtTimeSec(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ---- Avatar (photo or initials fallback, PRD FR-7) ---------------------------
export function Avatar({
  name,
  photoUrl,
  showPhoto,
  size = 44,
}: {
  name: string;
  photoUrl?: string | null;
  showPhoto?: boolean;
  size?: number;
}) {
  if (showPhoto !== false && photoUrl) {
    return (
      <img
        className="avatar avatar-img"
        src={photoUrl}
        alt={name}
        style={{ width: size, height: size }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <div className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initialsOf(name)}
    </div>
  );
}

// ---- School logo (uploaded in Settings; shown in kiosk header, admin
// sidebar and login). Falls back to an emoji when none is set or the stored
// image fails to load. Sizing is handled by the parent tile (.kiosk-logo /
// .login-logo) plus the .logo-img rule, so the image never overflows. --------
export function SchoolLogo({
  logoUrl,
  fallback = '🎓',
  fallbackClassName,
}: {
  logoUrl?: string | null;
  fallback?: string;
  fallbackClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [logoUrl]);
  if (logoUrl && !broken) {
    return <img className="logo-img" src={logoUrl} alt="School logo" onError={() => setBroken(true)} />;
  }
  return <span className={fallbackClassName}>{fallback}</span>;
}

// ---- SMS status pill ---------------------------------------------------------
export function SmsStatusPill({ status }: { status: SmsStatus | null }) {
  if (status === null) return <span className="pill pill-dim">—</span>;
  const cls =
    status === 'SENT' ? 'pill pill-success' : status === 'FAILED' ? 'pill pill-danger' : 'pill pill-warn pill-pulse';
  const label = status === 'PENDING' ? 'QUEUED' : status;
  return <span className={cls}>{label}</span>;
}

// ---- IN/OUT chip ---------------------------------------------------------------
export function EntryChip({ type, large = false }: { type: 'IN' | 'OUT'; large?: boolean }) {
  return <span className={`entry-chip ${type === 'IN' ? 'in' : 'out'} ${large ? 'lg' : ''}`}>{type === 'IN' ? 'IN' : 'OUT'}</span>;
}

// ---- QR image -----------------------------------------------------------------
export function QrCodeImage({ text, size = 256, dark = false }: { text: string; size?: number; dark?: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, {
      width: size,
      margin: 1,
      color: dark ? { dark: '#020617', light: '#ffffff' } : { dark: '#0F172A', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [text, size, dark]);
  if (!url) return <div className="qr-placeholder" style={{ width: size, height: size }} />;
  return <img className="qr-img" src={url} width={size} height={size} alt="QR code" />;
}

// ---- Modal ---------------------------------------------------------------------
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeOnOverlay = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** When false, clicking the dimmed backdrop does NOT dismiss the modal. */
  closeOnOverlay?: boolean;
}) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---- Spinner --------------------------------------------------------------------
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <span className="text-dim">{label}</span>}
    </div>
  );
}

// ---- Toast -----------------------------------------------------------------------
export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'error' }) {
  return <div className={`toast ${tone === 'success' ? 'toast-success' : 'toast-error'}`}>{message}</div>;
}
