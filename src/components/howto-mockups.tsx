// SVG wireframe mockups for the How To guide — each component renders a
// miniature, stylised representation of a real app screen or modal so
// the user can visually recognise it. Dark-theme palette matches the app.
// Uses dangerouslySetInnerHTML because the SVG content is built as strings.
import type { CSSProperties } from 'react';

const W = 520;
const H = 300;

const svgStyle: CSSProperties = {
  width: '100%',
  maxWidth: W,
  height: 'auto',
  borderRadius: 12,
  border: '1px solid #1e293b',
  background: '#0b1226',
  display: 'block',
};

const svg = (inner: string, w = W, h = H) => (
  <svg
    viewBox={`0 0 ${w} ${h}`}
    style={svgStyle}
    xmlns="http://www.w3.org/2000/svg"
    dangerouslySetInnerHTML={{ __html: inner }}
  />
);

/* ================================================================
   KIOSK SCREEN — IDLE
   ================================================================ */
export function KioskIdleMockup() {
  return svg(`
    <!-- Header -->
    <rect x="0" y="0" width="${W}" height="42" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="24" cy="21" r="14" fill="#10b981" opacity="0.8"/>
    <text x="44" y="18" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">TapIn School</text>
    <text x="44" y="30" fill="#64748b" font-size="8" font-family="system-ui">Gate Attendance &amp; Parent Alerts</text>
    <text x="${W - 140}" y="26" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui" text-anchor="middle">08:32 AM</text>
    <text x="${W - 140}" y="36" fill="#64748b" font-size="8" font-family="system-ui" text-anchor="middle">August 29, 2026</text>
    <circle cx="${W - 100}" cy="21" r="4" fill="#10b981"/>
    <text x="${W - 90}" y="25" fill="#64748b" font-size="8" font-family="system-ui">DB</text>
    <circle cx="${W - 65}" cy="21" r="4" fill="#10b981"/>
    <text x="${W - 55}" y="25" fill="#64748b" font-size="8" font-family="system-ui">SMS</text>
    <circle cx="${W - 30}" cy="21" r="4" fill="#10b981"/>
    <text x="${W - 20}" y="25" fill="#64748b" font-size="8" font-family="system-ui">0</text>

    <!-- Center: QR code prompt -->
    <rect x="170" y="70" width="140" height="140" rx="14" fill="#111c33" stroke="#1e293b"/>
    <rect x="185" y="85" width="110" height="110" rx="4" fill="#0b1226" stroke="#1e293b"/>
    <rect x="195" y="95" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="265" y="95" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="195" y="165" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="220" y="120" width="60" height="40" rx="2" fill="#64748b" opacity="0.4"/>
    <rect x="265" y="165" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="162" y="62" width="156" height="156" rx="18" fill="none" stroke="#10b981" stroke-width="1.5" opacity="0.3"/>

    <text x="${W / 2}" y="230" fill="#e2e8f0" font-size="13" font-weight="700" font-family="system-ui" text-anchor="middle">Please present your Student QR Code</text>
    <text x="${W / 2}" y="248" fill="#64748b" font-size="10" font-family="system-ui" text-anchor="middle">to the scanner at the gate</text>

    <rect x="120" y="260" width="100" height="28" rx="8" fill="none" stroke="#1e293b"/>
    <text x="170" y="278" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">📷 Camera</text>
    <rect x="230" y="260" width="100" height="28" rx="8" fill="none" stroke="#1e293b"/>
    <text x="280" y="278" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">📇 Forgot QR</text>
    <rect x="340" y="260" width="100" height="28" rx="8" fill="none" stroke="#1e293b"/>
    <text x="390" y="278" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">🧑‍🤝‍🧑 Visitor</text>
  `);
}

/* ================================================================
   KIOSK SCREEN — SUCCESS CHECK-IN
   ================================================================ */
export function KioskSuccessMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="42" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="24" cy="21" r="14" fill="#10b981" opacity="0.8"/>
    <text x="44" y="18" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">TapIn School</text>
    <text x="44" y="30" fill="#64748b" font-size="8" font-family="system-ui">Gate Attendance</text>
    <text x="${W - 60}" y="26" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">08:32 AM</text>

    <!-- Left panel: student photo -->
    <rect x="0" y="44" width="240" height="256" fill="#0b1226"/>
    <circle cx="120" cy="140" r="55" fill="#111c33" stroke="#1e293b" stroke-width="2"/>
    <text x="120" y="148" fill="#e2e8f0" font-size="28" font-weight="700" font-family="system-ui" text-anchor="middle">JD</text>
    <text x="120" y="220" fill="#64748b" font-size="11" font-family="system-ui" text-anchor="middle">Juan Dela Cruz</text>

    <!-- Right panel: details -->
    <rect x="240" y="44" width="${W - 240}" height="256" fill="#0f172a"/>
    <rect x="310" y="64" width="110" height="18" rx="9" fill="rgba(16,185,129,0.15)"/>
    <text x="317" y="77" fill="#34d399" font-size="9" font-weight="800" font-family="system-ui">✓ CHECKED IN</text>
    <text x="${(240 + W) / 2}" y="110" fill="#e2e8f0" font-size="18" font-weight="780" font-family="system-ui" text-anchor="middle">Juan Dela Cruz</text>
    <text x="${(240 + W) / 2}" y="128" fill="#64748b" font-size="10" font-family="system-ui" text-anchor="middle">Grade 7 - Section A · Student No. 2024-0112</text>
    <text x="${(240 + W) / 2}" y="148" fill="#64748b" font-size="10" font-family="system-ui" text-anchor="middle">08:32:14 AM</text>
    <rect x="330" y="165" width="130" height="18" rx="9" fill="rgba(245,158,11,0.12)"/>
    <text x="337" y="178" fill="#fbbf24" font-size="9" font-weight="600" font-family="system-ui">🎖 3/5 days this week</text>
    <rect x="310" y="195" width="160" height="18" rx="9" fill="rgba(16,185,129,0.1)"/>
    <text x="317" y="208" fill="#6ee7b7" font-size="9" font-weight="600" font-family="system-ui">✉ Parent SMS queued to 0917***4567</text>

    <!-- Countdown ring -->
    <circle cx="${W - 30}" cy="60" r="14" fill="none" stroke="#1e293b" stroke-width="2"/>
    <circle cx="${W - 30}" cy="60" r="14" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="88" stroke-dashoffset="44" opacity="0.6"/>
  `);
}

/* ================================================================
   KIOSK SCREEN — GUARDIAN REPORT
   ================================================================ */
export function KioskGuardianMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="42" fill="#0f172a" stroke="#1e293b"/>
    <text x="20" y="18" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">TapIn School</text>
    <text x="20" y="30" fill="#64748b" font-size="8" font-family="system-ui">Gate Attendance</text>
    <text x="${W - 60}" y="26" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">08:32 AM</text>

    <rect x="20" y="54" width="${W - 40}" height="236" rx="12" fill="#0f172a" stroke="#1e293b"/>
    <text x="40" y="80" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">👤 Maria Dela Cruz</text>
    <text x="40" y="95" fill="#64748b" font-size="9" font-family="system-ui">Today's Attendance Report · Aug 29 · 2 children</text>
    <line x1="40" y1="105" x2="${W - 40}" y2="105" stroke="#1e293b"/>

    <text x="40" y="125" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">Juan Dela Cruz</text>
    <text x="40" y="138" fill="#64748b" font-size="8" font-family="system-ui">Grade 7 - Section A · Student No. 2024-0112</text>
    <rect x="${W - 120}" y="117" width="60" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="${W - 113}" y="129" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">PRESENT</text>
    <text x="55" y="158" fill="#64748b" font-size="9" font-family="system-ui">07:42 AM  ✓ IN  camera</text>
    <text x="55" y="172" fill="#64748b" font-size="9" font-family="system-ui">12:05 PM  ⟲ OUT  gate</text>
    <line x1="40" y1="182" x2="${W - 40}" y2="182" stroke="#1e293b" stroke-dasharray="4"/>

    <text x="40" y="200" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">Carlos Dela Cruz</text>
    <text x="40" y="213" fill="#64748b" font-size="8" font-family="system-ui">Grade 5 - Section B · Student No. 2024-0215</text>
    <rect x="${W - 120}" y="192" width="60" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="${W - 113}" y="204" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">PRESENT</text>
    <text x="55" y="233" fill="#64748b" font-size="9" font-family="system-ui">07:38 AM  ✓ IN  gate</text>
    <text x="55" y="247" fill="#fbbf24" font-size="9" font-family="system-ui">⚠ Late arrival (+2 min)</text>

    <circle cx="${W - 35}" cy="68" r="12" fill="none" stroke="#1e293b" stroke-width="2"/>
  `);
}

/* ================================================================
   GATE MODE PANEL
   ================================================================ */
export function GateModeMockup() {
  return svg(`
    <rect x="0" y="0" width="240" height="240" rx="12" fill="#0f172a" stroke="#1e293b"/>
    <text x="14" y="28" fill="#e2e8f0" font-size="13" font-weight="700" font-family="system-ui">Gate Mode</text>
    <rect x="180" y="15" width="56" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="187" y="27" fill="#34d399" font-size="8" font-weight="800" font-family="system-ui">FORCE IN</text>

    <rect x="14" y="40" width="212" height="28" rx="8" fill="#0b1226" stroke="#1e293b"/>
    <rect x="16" y="42" width="68" height="24" rx="6" fill="rgba(16,185,129,0.2)"/>
    <text x="36" y="58" fill="#10b981" font-size="10" font-weight="800" font-family="system-ui">AUTO</text>
    <text x="100" y="58" fill="#64748b" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">AM</text>
    <text x="170" y="58" fill="#64748b" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">PM</text>

    <rect x="14" y="76" width="212" height="28" rx="8" fill="#0b1226" stroke="#1e293b"/>
    <rect x="16" y="78" width="68" height="24" rx="6" fill="rgba(16,185,129,0.25)"/>
    <text x="30" y="94" fill="#10b981" font-size="10" font-weight="800" font-family="system-ui">↔ Auto</text>
    <text x="100" y="94" fill="#64748b" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">✓ IN</text>
    <text x="170" y="94" fill="#64748b" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">⟲ OUT</text>

    <text x="14" y="120" fill="#64748b" font-size="9" font-family="system-ui">Auto: the last scan decides IN/OUT.</text>
    <text x="14" y="134" fill="#64748b" font-size="9" font-family="system-ui">Switch to Auto when done.</text>

    <line x1="14" y1="148" x2="226" y2="148" stroke="#1e293b"/>
    <text x="14" y="168" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">Live Activity</text>
    <text x="180" y="168" fill="#10b981" font-size="8" font-weight="800" font-family="system-ui">● LIVE</text>

    <rect x="14" y="178" width="212" height="24" rx="6" fill="#0b1226"/>
    <circle cx="30" cy="190" r="9" fill="#111c33" stroke="#1e293b"/>
    <text x="44" y="188" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">Ana Santos</text>
    <text x="44" y="198" fill="#64748b" font-size="7" font-family="system-ui">Gr 7-A · 08:30 AM</text>
    <rect x="172" y="180" width="22" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="176" y="192" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">IN</text>

    <rect x="14" y="206" width="212" height="24" rx="6" fill="#0b1226"/>
    <circle cx="30" cy="218" r="9" fill="#111c33" stroke="#1e293b"/>
    <text x="44" y="216" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">Luis Reyes</text>
    <text x="44" y="226" fill="#64748b" font-size="7" font-family="system-ui">Gr 6-B · 08:28 AM</text>
    <rect x="168" y="208" width="32" height="16" rx="8" fill="rgba(245,158,11,0.12)"/>
    <text x="172" y="220" fill="#fbbf24" font-size="8" font-weight="700" font-family="system-ui">LATE</text>
    <rect x="202" y="208" width="22" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="206" y="220" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">IN</text>
  `);
}

/* ================================================================
   MANUAL CHECK-IN — PIN STEP
   ================================================================ */
export function ManualCheckinPinMockup() {
  const keypad = [1,2,3,4,5,6,7,8,9].map((n, i) => {
    const col = i % 3; const row = Math.floor(i / 3);
    const kx = 185 + col * 42; const ky = 130 + row * 34;
    return `<rect x="${kx}" y="${ky}" width="36" height="28" rx="7" fill="#111c33" stroke="#1e293b"/>
    <text x="${kx + 18}" y="${ky + 19}" fill="#e2e8f0" font-size="13" font-weight="650" font-family="system-ui" text-anchor="middle">${n}</text>`;
  }).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="80" y="20" width="360" height="260" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="100" y="52" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Staff PIN required</text>
    <text x="380" y="52" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <text x="${W / 2}" y="80" fill="#64748b" font-size="10" font-family="system-ui" text-anchor="middle">Enter the gate staff PIN to check in a student</text>

    <circle cx="200" cy="105" r="7" fill="#10b981"/>
    <circle cx="220" cy="105" r="7" fill="#10b981"/>
    <circle cx="240" cy="105" r="7" fill="#10b981"/>
    <circle cx="260" cy="105" r="7" fill="none" stroke="#1e293b"/>

    ${keypad}
    <rect x="227" y="232" width="36" height="28" rx="7" fill="#111c33" stroke="#1e293b"/>
    <text x="245" y="251" fill="#e2e8f0" font-size="13" font-weight="650" font-family="system-ui" text-anchor="middle">0</text>

    <rect x="160" y="270" width="80" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="200" y="286" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Cancel</text>
    <rect x="250" y="270" width="80" height="24" rx="6" fill="#10b981"/>
    <text x="290" y="286" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">Unlock</text>
  `);
}

/* ================================================================
   MANUAL CHECK-IN — SEARCH STEP
   ================================================================ */
export function ManualCheckinSearchMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="80" y="20" width="360" height="260" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="100" y="52" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Manual check-in</text>
    <text x="380" y="52" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <rect x="100" y="66" width="320" height="32" rx="8" fill="#111c33" stroke="#10b981" stroke-width="1.5"/>
    <text x="112" y="87" fill="#64748b" font-size="11" font-family="system-ui">Search by name or student no...</text>

    <rect x="100" y="108" width="320" height="36" rx="8" fill="#0b1226" stroke="#1e293b"/>
    <circle cx="118" cy="126" r="10" fill="#111c33" stroke="#1e293b"/>
    <text x="134" y="124" fill="#e2e8f0" font-size="11" font-weight="650" font-family="system-ui">Juan Dela Cruz</text>
    <text x="134" y="136" fill="#64748b" font-size="8" font-family="system-ui">Grade 7 - Section A · 2024-0112</text>
    <text x="406" y="130" fill="#64748b" font-size="12" font-family="system-ui" text-anchor="middle">›</text>

    <rect x="100" y="150" width="320" height="36" rx="8" fill="#0b1226" stroke="#1e293b"/>
    <circle cx="118" cy="168" r="10" fill="#111c33" stroke="#1e293b"/>
    <text x="134" y="166" fill="#e2e8f0" font-size="11" font-weight="650" font-family="system-ui">Juan Santos</text>
    <text x="134" y="178" fill="#64748b" font-size="8" font-family="system-ui">Grade 6 - Section B · 2024-0318</text>
    <text x="406" y="172" fill="#64748b" font-size="12" font-family="system-ui" text-anchor="middle">›</text>

    <rect x="100" y="192" width="320" height="36" rx="8" fill="#0b1226" stroke="#1e293b"/>
    <circle cx="118" cy="210" r="10" fill="#111c33" stroke="#1e293b"/>
    <text x="134" y="208" fill="#e2e8f0" font-size="11" font-weight="650" font-family="system-ui">Carlos De La Fuente</text>
    <text x="134" y="220" fill="#64748b" font-size="8" font-family="system-ui">Grade 5 - Section B · 2024-0215</text>
    <text x="406" y="214" fill="#64748b" font-size="12" font-family="system-ui" text-anchor="middle">›</text>

    <rect x="160" y="265" width="200" height="30" rx="8" fill="#10b981"/>
    <text x="260" y="284" fill="#022c22" font-size="11" font-weight="700" font-family="system-ui" text-anchor="middle">✓ Check In Juan Dela Cruz</text>
  `);
}

/* ================================================================
   VISITOR REGISTER — FORM
   ================================================================ */
export function VisitorRegisterMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="80" y="10" width="360" height="280" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="100" y="42" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Register Visitor</text>
    <text x="380" y="42" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <text x="100" y="62" fill="#64748b" font-size="9" font-family="system-ui">Walk-in visitor registration (staff PIN required)</text>

    <text x="100" y="84" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Full Name *</text>
    <rect x="100" y="88" width="320" height="26" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="110" y="105" fill="#64748b" font-size="10" font-family="system-ui">Ramon Bautista</text>

    <text x="100" y="130" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Contact Phone</text>
    <rect x="100" y="134" width="155" height="26" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="110" y="151" fill="#64748b" font-size="10" font-family="system-ui">09171234567</text>

    <text x="265" y="130" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">ID Presented</text>
    <rect x="265" y="134" width="155" height="26" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="275" y="151" fill="#64748b" font-size="10" font-family="system-ui">Driver's License</text>

    <text x="100" y="176" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Purpose of Visit</text>
    <rect x="100" y="180" width="320" height="26" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="110" y="197" fill="#64748b" font-size="10" font-family="system-ui">Parent meeting</text>

    <text x="100" y="222" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Host / Office</text>
    <rect x="100" y="226" width="320" height="26" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="110" y="243" fill="#64748b" font-size="10" font-family="system-ui">Principal's Office</text>

    <rect x="230" y="264" width="70" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="265" y="280" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Cancel</text>
    <rect x="310" y="264" width="90" height="24" rx="6" fill="#10b981"/>
    <text x="355" y="280" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">Register</text>
  `);
}

/* ================================================================
   CAMERA SCANNER OVERLAY
   ================================================================ */
export function CameraScannerMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="80" y="30" width="360" height="240" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="100" y="60" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Camera Scanner</text>
    <text x="380" y="60" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <rect x="100" y="74" width="320" height="170" rx="10" fill="#0b1226" stroke="#1e293b"/>
    <line x1="240" y1="120" x2="240" y2="200" stroke="#10b981" stroke-width="1" opacity="0.5"/>
    <line x1="160" y1="160" x2="320" y2="160" stroke="#10b981" stroke-width="1" opacity="0.5"/>
    <rect x="190" y="110" width="100" height="100" rx="4" fill="none" stroke="#10b981" stroke-width="1.5" opacity="0.6"/>

    <text x="${W / 2}" y="260" fill="#64748b" font-size="10" font-family="system-ui" text-anchor="middle">Hold the QR code in front of the webcam</text>
  `);
}

/* ================================================================
   ADMIN LOGIN
   ================================================================ */
export function AdminLoginMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <rect x="130" y="30" width="260" height="240" rx="14" fill="#0f172a" stroke="#1e293b"/>

    <circle cx="${W / 2}" cy="70" r="22" fill="#1e293b" stroke="#1e293b"/>
    <text x="${W / 2}" y="76" fill="#e2e8f0" font-size="18" font-weight="700" font-family="system-ui" text-anchor="middle">🔒</text>
    <text x="${W / 2}" y="108" fill="#e2e8f0" font-size="15" font-weight="750" font-family="system-ui" text-anchor="middle">TapIn School</text>
    <text x="${W / 2}" y="122" fill="#64748b" font-size="9" font-family="system-ui" text-anchor="middle">Admin Dashboard · Restricted Access</text>
    <line x1="160" y1="130" x2="360" y2="130" stroke="#1e293b"/>

    <rect x="155" y="140" width="210" height="30" rx="7" fill="#111c33" stroke="#1e293b"/>
    <text x="167" y="159" fill="#64748b" font-size="10" font-family="system-ui">👤  admin</text>

    <rect x="155" y="178" width="210" height="30" rx="7" fill="#111c33" stroke="#1e293b"/>
    <text x="167" y="197" fill="#64748b" font-size="10" font-family="system-ui">🔑  ••••••••</text>

    <rect x="155" y="220" width="210" height="32" rx="8" fill="#10b981"/>
    <text x="${W / 2}" y="240" fill="#022c22" font-size="12" font-weight="700" font-family="system-ui" text-anchor="middle">Sign In</text>
  `);
}

/* ================================================================
   ADMIN DASHBOARD — SIDEBAR
   ================================================================ */
export function AdminSidebarMockup() {
  const items = [
    { icon: '📊', label: 'Overview', active: true },
    { icon: '🧑‍🎓', label: 'Students', active: false },
    { icon: '🧑‍🏫', label: 'Sections', active: false },
    { icon: '🕐', label: 'Attendance Logs', active: false },
    { icon: '🧑‍🤝‍🧑', label: 'Visitors', active: false },
    { icon: '👪', label: 'Guardians', active: false },
    { icon: '📄', label: 'Reports', active: false },
    { icon: '🏅', label: 'Badges &amp; Ranking', active: false },
    { icon: '✉', label: 'SMS Outbox', active: false },
    { icon: '📢', label: 'Announcements', active: false },
    { icon: '🧑‍💼', label: 'Users &amp; Roles', active: false },
    { icon: '⚙', label: 'Settings', active: false },
  ];

  const navItems = items.map((item, i) => {
    const y = 54 + i * 18;
    const bg = item.active ? 'rgba(16,185,129,0.14)' : 'transparent';
    const bar = item.active ? `<rect x="0" y="${y - 1}" width="3" height="18" fill="#10b981"/>` : '';
    const fw = item.active ? '700' : '600';
    const fc = item.active ? '#e2e8f0' : '#64748b';
    return `${bar}<rect x="6" y="${y}" width="158" height="17" rx="5" fill="${bg}"/><text x="20" y="${y + 12}" fill="${fc}" font-size="9" font-weight="${fw}" font-family="system-ui">${item.icon} ${item.label}</text>`;
  }).join('');

  return svg(`
    <rect x="0" y="0" width="170" height="${H}" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="24" cy="28" r="14" fill="#10b981" opacity="0.8"/>
    <text x="44" y="25" fill="#e2e8f0" font-size="10" font-weight="700" font-family="system-ui">TapIn School</text>
    <text x="44" y="36" fill="#64748b" font-size="7" font-family="system-ui">Admin Dashboard</text>
    <line x1="10" y1="46" x2="160" y2="46" stroke="#1e293b"/>

    ${navItems}

    <line x1="10" y1="${H - 40}" x2="160" y2="${H - 40}" stroke="#1e293b"/>
    <text x="40" y="${H - 24}" fill="#64748b" font-size="9" font-family="system-ui">🔒 Log out</text>
    <rect x="20" y="${H - 18}" width="130" height="14" rx="5" fill="rgba(16,185,129,0.2)"/>
    <text x="85" y="${H - 8}" fill="#10b981" font-size="8" font-weight="700" font-family="system-ui" text-anchor="middle">← Back to Kiosk</text>
  `, 170, H);
}

/* ================================================================
   OVERVIEW PAGE
   ================================================================ */
export function OverviewMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="30" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Overview</text>
    <text x="20" y="44" fill="#64748b" font-size="9" font-family="system-ui">Today's attendance at a glance</text>

    <rect x="20" y="56" width="112" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="30" y="72" fill="#64748b" font-size="8" font-family="system-ui">Total Students</text>
    <text x="30" y="94" fill="#e2e8f0" font-size="22" font-weight="780" font-family="system-ui">248</text>

    <rect x="140" y="56" width="112" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="150" y="72" fill="#64748b" font-size="8" font-family="system-ui">Scans Today</text>
    <text x="150" y="94" fill="#10b981" font-size="22" font-weight="780" font-family="system-ui">412</text>

    <rect x="260" y="56" width="112" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="270" y="72" fill="#64748b" font-size="8" font-family="system-ui">Present</text>
    <text x="270" y="94" fill="#10b981" font-size="22" font-weight="780" font-family="system-ui">231</text>

    <rect x="380" y="56" width="112" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="390" y="72" fill="#64748b" font-size="8" font-family="system-ui">Absent</text>
    <text x="390" y="94" fill="#f43f5e" font-size="22" font-weight="780" font-family="system-ui">17</text>

    <rect x="20" y="124" width="340" height="160" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="146" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui">Hourly Scan Distribution</text>
    <polyline points="40,240 80,220 120,190 160,170 200,160 240,180 280,210 320,230 340,240" fill="none" stroke="#10b981" stroke-width="2"/>
    <text x="40" y="264" fill="#64748b" font-size="7" font-family="system-ui">7AM</text>
    <text x="140" y="264" fill="#64748b" font-size="7" font-family="system-ui">9AM</text>
    <text x="240" y="264" fill="#64748b" font-size="7" font-family="system-ui">12PM</text>
    <text x="320" y="264" fill="#64748b" font-size="7" font-family="system-ui">3PM</text>

    <rect x="374" y="124" width="130" height="160" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="439" y="146" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">IN / OUT Ratio</text>
    <circle cx="439" cy="200" r="35" fill="none" stroke="#10b981" stroke-width="10" stroke-dasharray="154 66" stroke-dashoffset="0"/>
    <circle cx="439" cy="200" r="35" fill="none" stroke="#6366f1" stroke-width="10" stroke-dasharray="66 154" stroke-dashoffset="-154"/>
    <text x="439" y="204" fill="#e2e8f0" font-size="14" font-weight="780" font-family="system-ui" text-anchor="middle">70%</text>
    <text x="410" y="250" fill="#10b981" font-size="8" font-family="system-ui">● IN 70%</text>
    <text x="460" y="250" fill="#6366f1" font-size="8" font-family="system-ui">● OUT 30%</text>
  `);
}

/* ================================================================
   STUDENTS PAGE
   ================================================================ */
export function StudentsMockup() {
  const rows = [
    { no: '2024-0112', name: 'Juan Dela Cruz', sec: 'Grade 7 - A', phone: '0917***4567', y: 116 },
    { no: '2024-0113', name: 'Ana Santos', sec: 'Grade 7 - A', phone: '0918***8901', y: 138 },
    { no: '2024-0215', name: 'Carlos Reyes', sec: 'Grade 6 - B', phone: '0920***2345', y: 160 },
    { no: '2024-0318', name: 'Maria Garcia', sec: 'Grade 5 - A', phone: '0912***6789', y: 182 },
    { no: '2024-0421', name: 'Luis Mendoza', sec: 'Grade 5 - B', phone: '0915***0123', y: 204 },
    { no: '2024-0524', name: 'Sofia Cruz', sec: 'Grade 7 - B', phone: '0921***4567', y: 226 },
  ].map(r => `
    <text x="30" y="${r.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${r.no}</text>
    <text x="120" y="${r.y + 12}" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">${r.name}</text>
    <text x="260" y="${r.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${r.sec}</text>
    <text x="370" y="${r.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${r.phone}</text>
    <text x="460" y="${r.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">✎  ◻  ▣</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Students</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">248 students enrolled</text>
    <rect x="${W - 130}" y="14" width="110" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 75}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add Student</text>

    <rect x="20" y="50" width="280" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="67" fill="#64748b" font-size="10" font-family="system-ui">Search students...</text>
    <rect x="310" y="50" width="80" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="330" y="67" fill="#64748b" font-size="10" font-family="system-ui">Import CSV</text>
    <rect x="400" y="50" width="100" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="420" y="67" fill="#64748b" font-size="10" font-family="system-ui">Grade ▾</text>

    <rect x="20" y="84" width="${W - 40}" height="206" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="84" width="${W - 40}" height="24" rx="8" fill="#111c33"/>
    <text x="30" y="100" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STUDENT NO</text>
    <text x="120" y="100" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">NAME</text>
    <text x="260" y="100" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SECTION</text>
    <text x="370" y="100" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">PHONE</text>
    <text x="460" y="100" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">ACTIONS</text>
    ${rows}
  `);
}

/* ================================================================
   SECTIONS PAGE
   ================================================================ */
export function SectionsMockup() {
  const groups = [
    { grade: 'Grade 7', sections: 'Section A, Section B', adviser: 'Mr. Santos', students: 48, y: 54 },
    { grade: 'Grade 6', sections: 'Section A, Section B', adviser: 'Ms. Reyes', students: 52, y: 140 },
    { grade: 'Grade 5', sections: 'Section A, Section B', adviser: 'Mr. Cruz', students: 46, y: 226 },
  ].map(g => `
    <rect x="20" y="${g.y}" width="${W - 40}" height="76" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="36" y="${g.y + 22}" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">${g.grade}</text>
    <text x="36" y="${g.y + 38}" fill="#64748b" font-size="9" font-family="system-ui">Adviser: ${g.adviser}</text>
    <text x="36" y="${g.y + 54}" fill="#64748b" font-size="9" font-family="system-ui">👥 ${g.students} students enrolled</text>
    <text x="${W - 40}" y="${g.y + 22}" fill="#10b981" font-size="9" font-weight="600" font-family="system-ui" text-anchor="end">Sections: ${g.sections}</text>
    <rect x="${W - 100}" y="${g.y + 40}" width="70" height="22" rx="6" fill="none" stroke="#1e293b"/>
    <text x="${W - 65}" y="${g.y + 55}" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">Manage</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Sections</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Manage grade/section combinations and enrollments</text>
    <rect x="${W - 120}" y="14" width="100" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 70}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add Section</text>
    ${groups}
  `);
}

/* ================================================================
   ATTENDANCE LOGS PAGE
   ================================================================ */
export function LogsMockup() {
  const rows = [
    { time: '08:32 AM', name: 'Juan Dela Cruz', sec: 'Grade 7-A', type: 'IN', flag: '', src: 'gate', y: 118 },
    { time: '08:30 AM', name: 'Ana Santos', sec: 'Grade 7-A', type: 'IN', flag: '', src: 'camera', y: 138 },
    { time: '08:28 AM', name: 'Luis Reyes', sec: 'Grade 6-B', type: 'IN', flag: 'LATE', src: 'gate', y: 158 },
    { time: '08:25 AM', name: 'Carlos Dela Cruz', sec: 'Grade 5-B', type: 'IN', flag: '', src: 'manual', y: 178 },
    { time: '12:05 PM', name: 'Maria Garcia', sec: 'Grade 5-A', type: 'OUT', flag: '', src: 'gate', y: 198 },
    { time: '12:01 PM', name: 'Juan Dela Cruz', sec: 'Grade 7-A', type: 'OUT', flag: 'EARLY', src: 'gate', y: 218 },
    { time: '11:58 AM', name: 'Ana Santos', sec: 'Grade 7-A', type: 'OUT', flag: '', src: 'gate', y: 238 },
    { time: '11:55 AM', name: 'Sofia Cruz', sec: 'Grade 7-B', type: 'OUT', flag: '', src: 'camera', y: 258 },
  ].map(r => {
    const tc = r.type === 'IN' ? '#10b981' : '#6366f1';
    const flagEl = r.flag ? `<text x="410" y="${r.y + 11}" fill="${r.flag === 'LATE' ? '#f59e0b' : '#7dd3fc'}" font-size="9" font-weight="700" font-family="system-ui">${r.flag}</text>` : '';
    return `
    <text x="30" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.time}</text>
    <text x="110" y="${r.y + 11}" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">${r.name}</text>
    <text x="240" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.sec}</text>
    <text x="350" y="${r.y + 11}" fill="${tc}" font-size="9" font-weight="700" font-family="system-ui">${r.type}</text>
    ${flagEl}
    <text x="470" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.src}</text>`;
  }).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Attendance Logs</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">1,247 records</text>
    <rect x="${W - 90}" y="14" width="70" height="26" rx="7" fill="none" stroke="#1e293b"/>
    <text x="${W - 55}" y="31" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Export</text>

    <rect x="20" y="52" width="180" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="69" fill="#64748b" font-size="10" font-family="system-ui">Search logs...</text>
    <rect x="210" y="52" width="80" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="224" y="69" fill="#64748b" font-size="10" font-family="system-ui">Type ▾</text>
    <rect x="300" y="52" width="70" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="316" y="69" fill="#64748b" font-size="10" font-family="system-ui">AM/PM ▾</text>
    <rect x="380" y="52" width="60" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="392" y="69" fill="#64748b" font-size="10" font-family="system-ui">From</text>
    <rect x="450" y="52" width="50" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="460" y="69" fill="#64748b" font-size="10" font-family="system-ui">To</text>

    <rect x="20" y="86" width="${W - 40}" height="200" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="86" width="${W - 40}" height="22" rx="8" fill="#111c33"/>
    <text x="30" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">TIME</text>
    <text x="110" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STUDENT</text>
    <text x="240" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SECTION</text>
    <text x="350" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">TYPE</text>
    <text x="410" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">FLAG</text>
    <text x="470" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SOURCE</text>
    ${rows}
  `);
}

/* ================================================================
   VISITORS PAGE (ADMIN)
   ================================================================ */
export function VisitorsAdminMockup() {
  const rows = [
    { name: 'Ramon Bautista', purpose: 'Parent meeting', host: "Principal's Office", active: true, y: 114 },
    { name: 'Elena Villanueva', purpose: 'Delivery', host: 'Supply Room', active: true, y: 140 },
    { name: 'Pedro Garcia', purpose: 'Inspection', host: 'Admin Office', active: false, y: 166 },
    { name: 'Ana Morales', purpose: 'Guest lecture', host: 'Grade 7 Room', active: true, y: 192 },
    { name: 'Roberto Tan', purpose: 'Medical checkup', host: 'Clinic', active: true, y: 218 },
  ].map(v => {
    const statusEl = v.active
      ? `<rect x="440" y="${v.y + 2}" width="42" height="14" rx="7" fill="rgba(16,185,129,0.15)"/><text x="447" y="${v.y + 12}" fill="#34d399" font-size="7" font-weight="700" font-family="system-ui">ACTIVE</text>`
      : `<rect x="440" y="${v.y + 2}" width="52" height="14" rx="7" fill="rgba(244,63,94,0.12)"/><text x="447" y="${v.y + 12}" fill="#fb7185" font-size="7" font-weight="700" font-family="system-ui">BLOCKED</text>`;
    return `
    <text x="30" y="${v.y + 12}" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">${v.name}</text>
    <text x="180" y="${v.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${v.purpose}</text>
    <text x="320" y="${v.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${v.host}</text>
    ${statusEl}
    <text x="${W - 50}" y="${v.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">QR  ✎  🗑</text>`;
  }).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Visitors</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Walk-in gate passes &amp; visit log</text>
    <rect x="${W - 110}" y="14" width="90" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 65}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add Visitor</text>

    <rect x="20" y="52" width="80" height="22" rx="6" fill="rgba(16,185,129,0.2)"/>
    <text x="36" y="67" fill="#10b981" font-size="10" font-weight="700" font-family="system-ui">Registry</text>
    <rect x="108" y="52" width="50" height="22" rx="6" fill="none"/>
    <text x="120" y="67" fill="#64748b" font-size="10" font-family="system-ui">Logs</text>

    <rect x="20" y="82" width="${W - 40}" height="204" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="82" width="${W - 40}" height="22" rx="8" fill="#111c33"/>
    <text x="30" y="97" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">NAME</text>
    <text x="180" y="97" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">PURPOSE</text>
    <text x="320" y="97" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">HOST</text>
    <text x="440" y="97" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STATUS</text>
    ${rows}
  `);
}

/* ================================================================
   GUARDIANS PAGE
   ================================================================ */
export function GuardiansMockup() {
  const rows = [
    { name: 'Maria Dela Cruz', phone: '09171234567', addr: '123 Mabini St., Manila', children: 2, y: 100 },
    { name: 'Luzviminda Reyes', phone: '09189876543', addr: '789 Bonifacio Rd., Pasig', children: 1, y: 140 },
    { name: 'Roberto Santos', phone: '09201234567', addr: '456 Rizal Ave., Makati', children: 3, y: 180 },
    { name: 'Elena Garcia', phone: '09123456789', addr: '321 Boni Blvd., Mandaluyong', children: 1, y: 220 },
  ].map(g => `
    <circle cx="46" cy="${g.y + 16}" r="10" fill="#111c33" stroke="#1e293b"/>
    <text x="62" y="${g.y + 14}" fill="#e2e8f0" font-size="10" font-weight="650" font-family="system-ui">${g.name}</text>
    <text x="62" y="${g.y + 26}" fill="#64748b" font-size="8" font-family="system-ui">${g.phone} · ${g.addr}</text>
    <text x="${W - 120}" y="${g.y + 20}" fill="#64748b" font-size="9" font-family="system-ui" text-anchor="middle">${g.children} child${g.children > 1 ? 'ren' : ''}</text>
    <text x="${W - 50}" y="${g.y + 16}" fill="#64748b" font-size="9" font-family="system-ui">QR  ✎  🗑</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Guardians</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Parents &amp; guardians registered first, then linked to students</text>
    <rect x="${W - 120}" y="14" width="100" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 70}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add Guardian</text>

    <rect x="20" y="52" width="300" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="69" fill="#64748b" font-size="10" font-family="system-ui">Search guardians...</text>

    <rect x="20" y="86" width="${W - 40}" height="200" rx="8" fill="#0f172a" stroke="#1e293b"/>
    ${rows}
  `);
}

/* ================================================================
   REPORTS PAGE
   ================================================================ */
export function ReportsMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Reports</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Attendance reports for the selected date range</text>

    <rect x="20" y="52" width="${W - 40}" height="36" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="30" y="56" width="48" height="28" rx="6" fill="rgba(16,185,129,0.2)"/>
    <text x="38" y="74" fill="#10b981" font-size="8" font-weight="700" font-family="system-ui">Summary</text>
    <text x="86" y="74" fill="#64748b" font-size="8" font-family="system-ui">Register</text>
    <text x="142" y="74" fill="#64748b" font-size="8" font-family="system-ui">Per-Student</text>
    <text x="210" y="74" fill="#64748b" font-size="8" font-family="system-ui">Per-Section</text>
    <text x="280" y="74" fill="#64748b" font-size="8" font-family="system-ui">Absentee</text>
    <text x="338" y="74" fill="#64748b" font-size="8" font-family="system-ui">Tardiness</text>
    <text x="396" y="74" fill="#64748b" font-size="8" font-family="system-ui">SMS</text>
    <text x="430" y="74" fill="#64748b" font-size="8" font-family="system-ui">Trends</text>
    <text x="470" y="74" fill="#64748b" font-size="8" font-family="system-ui">SF1</text>

    <text x="20" y="106" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">From</text>
    <rect x="52" y="96" width="90" height="22" rx="6" fill="#0f172a" stroke="#1e293b"/>
    <text x="62" y="112" fill="#64748b" font-size="9" font-family="system-ui">2026-08-25</text>
    <text x="152" y="106" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">To</text>
    <rect x="172" y="96" width="90" height="22" rx="6" fill="#0f172a" stroke="#1e293b"/>
    <text x="182" y="112" fill="#64748b" font-size="9" font-family="system-ui">2026-08-29</text>
    <rect x="272" y="96" width="60" height="22" rx="6" fill="#10b981"/>
    <text x="302" y="112" fill="#022c22" font-size="9" font-weight="700" font-family="system-ui" text-anchor="middle">Generate</text>

    <rect x="20" y="128" width="112" height="50" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="30" y="144" fill="#64748b" font-size="8" font-family="system-ui">Present</text>
    <text x="30" y="166" fill="#10b981" font-size="20" font-weight="780" font-family="system-ui">92.4%</text>

    <rect x="140" y="128" width="112" height="50" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="150" y="144" fill="#64748b" font-size="8" font-family="system-ui">Absent</text>
    <text x="150" y="166" fill="#f43f5e" font-size="20" font-weight="780" font-family="system-ui">7.6%</text>

    <rect x="260" y="128" width="112" height="50" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="270" y="144" fill="#64748b" font-size="8" font-family="system-ui">Late</text>
    <text x="270" y="166" fill="#f59e0b" font-size="20" font-weight="780" font-family="system-ui">12.1%</text>

    <rect x="380" y="128" width="112" height="50" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="390" y="144" fill="#64748b" font-size="8" font-family="system-ui">Early Out</text>
    <text x="390" y="166" fill="#7dd3fc" font-size="20" font-weight="780" font-family="system-ui">3.2%</text>

    <rect x="20" y="192" width="80" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="60" y="208" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">Export PDF</text>
    <rect x="110" y="192" width="80" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="150" y="208" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">Export Excel</text>
    <rect x="200" y="192" width="80" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="240" y="208" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">Email Report</text>
    <rect x="290" y="192" width="100" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="340" y="208" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">Send to Advisers</text>

    <rect x="20" y="224" width="${W - 40}" height="64" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="242" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui">Daily Attendance Trend</text>
    <polyline points="32,268 80,258 128,252 176,260 224,248 272,254 320,246 368,250 416,244 464,248" fill="none" stroke="#10b981" stroke-width="1.5"/>
  `);
}

/* ================================================================
   BADGES & RANKING PAGE
   ================================================================ */
export function BadgesMockup() {
  const rows = [
    { rank: '🥇', name: 'Ana Santos', sec: 'Grade 7-A', badges: '🎖 ⏱', score: '145 pts', y: 142 },
    { rank: '🥈', name: 'Juan Dela Cruz', sec: 'Grade 7-A', badges: '🎖', score: '120 pts', y: 164 },
    { rank: '🥉', name: 'Carlos Reyes', sec: 'Grade 6-B', badges: '⏱', score: '98 pts', y: 186 },
    { rank: '#4', name: 'Sofia Cruz', sec: 'Grade 7-B', badges: '🎖 ⏱', score: '85 pts', y: 208 },
    { rank: '#5', name: 'Luis Mendoza', sec: 'Grade 5-B', badges: '🎖', score: '72 pts', y: 230 },
    { rank: '#6', name: 'Maria Garcia', sec: 'Grade 5-A', badges: '—', score: '60 pts', y: 252 },
  ].map(r => `
    <text x="36" y="${r.y + 12}" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui" text-anchor="middle">${r.rank}</text>
    <text x="70" y="${r.y + 12}" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui">${r.name}</text>
    <text x="220" y="${r.y + 12}" fill="#64748b" font-size="9" font-family="system-ui">${r.sec}</text>
    <text x="340" y="${r.y + 12}" fill="#e2e8f0" font-size="10" font-family="system-ui">${r.badges}</text>
    <text x="460" y="${r.y + 12}" fill="#10b981" font-size="10" font-weight="700" font-family="system-ui">${r.score}</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Badges &amp; Ranking</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Attendance badge leaderboard — School Year 2026-2027</text>

    <rect x="20" y="52" width="148" height="48" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="30" y="68" fill="#64748b" font-size="8" font-family="system-ui">Students with badges</text>
    <text x="30" y="86" fill="#10b981" font-size="20" font-weight="780" font-family="system-ui">186</text>

    <rect x="180" y="52" width="148" height="48" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="190" y="68" fill="#64748b" font-size="8" font-family="system-ui">Total badges earned</text>
    <text x="190" y="86" fill="#f59e0b" font-size="20" font-weight="780" font-family="system-ui">542</text>

    <rect x="340" y="52" width="148" height="48" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="350" y="68" fill="#64748b" font-size="8" font-family="system-ui">Weekly streak leaders</text>
    <text x="350" y="86" fill="#6366f1" font-size="20" font-weight="780" font-family="system-ui">23</text>

    <rect x="20" y="112" width="${W - 40}" height="174" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="112" width="${W - 40}" height="22" rx="8" fill="#111c33"/>
    <text x="30" y="127" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">RANK</text>
    <text x="70" y="127" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STUDENT</text>
    <text x="220" y="127" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SECTION</text>
    <text x="340" y="127" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">BADGES</text>
    <text x="460" y="127" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SCORE</text>
    ${rows}
  `);
}

/* ================================================================
   SMS OUTBOX PAGE
   ================================================================ */
export function SmsOutboxMockup() {
  const rows = [
    { time: '08:32 AM', to: '0917***4567', msg: 'Juan Dela Cruz checked IN at 08:32 AM...', status: 'SENT', color: '#10b981', y: 116 },
    { time: '08:30 AM', to: '0918***8901', msg: 'Ana Santos checked IN at 08:30 AM...', status: 'SENT', color: '#10b981', y: 138 },
    { time: '08:28 AM', to: '0920***2345', msg: 'Carlos Reyes was marked LATE...', status: 'FAILED', color: '#f43f5e', y: 160 },
    { time: '08:25 AM', to: '0912***6789', msg: 'Maria Garcia checked IN at 08:25 AM...', status: 'SENT', color: '#10b981', y: 182 },
    { time: '08:23 AM', to: '0915***0123', msg: 'Luis Mendoza checked IN at 08:23 AM...', status: 'PENDING', color: '#f59e0b', y: 204 },
    { time: '08:20 AM', to: '0921***4567', msg: 'Sofia Cruz checked IN at 08:20 AM...', status: 'SENT', color: '#10b981', y: 226 },
  ].map(r => `
    <text x="30" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.time}</text>
    <text x="110" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.to}</text>
    <text x="210" y="${r.y + 11}" fill="#64748b" font-size="9" font-family="system-ui">${r.msg}</text>
    <rect x="420" y="${r.y + 2}" width="48" height="14" rx="7" fill="${r.color}22"/>
    <text x="428" y="${r.y + 12}" fill="${r.color}" font-size="7" font-weight="700" font-family="system-ui">${r.status}</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">SMS Outbox</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">327 messages</text>
    <rect x="${W - 130}" y="14" width="110" height="26" rx="7" fill="none" stroke="#1e293b"/>
    <text x="${W - 75}" y="31" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">↻ Resend Failed</text>

    <rect x="20" y="52" width="80" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="69" fill="#64748b" font-size="10" font-family="system-ui">Status ▾</text>
    <rect x="110" y="52" width="80" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="122" y="69" fill="#64748b" font-size="10" font-family="system-ui">From ▾</text>
    <rect x="200" y="52" width="70" height="26" rx="7" fill="#0f172a" stroke="#1e293b"/>
    <text x="212" y="69" fill="#64748b" font-size="10" font-family="system-ui">To ▾</text>

    <rect x="20" y="86" width="${W - 40}" height="200" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="86" width="${W - 40}" height="22" rx="8" fill="#111c33"/>
    <text x="30" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">TIME</text>
    <text x="110" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">RECIPIENT</text>
    <text x="210" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">MESSAGE</text>
    <text x="420" y="101" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STATUS</text>
    ${rows}
  `);
}

/* ================================================================
   ANNOUNCEMENTS PAGE
   ================================================================ */
export function AnnouncementsMockup() {
  const items = [
    { title: 'Welcome Back!', msg: 'Classes begin Monday.', media: '🖼', active: true, y: 56 },
    { title: 'PTA Meeting', msg: 'Join us Friday at 3PM.', media: '▶', active: true, y: 120 },
    { title: 'Sports Festival', msg: 'Annual sports fest next week.', media: '📝', active: false, y: 184 },
  ].map(a => {
    const statusEl = a.active
      ? `<rect x="${W - 160}" y="${a.y + 18}" width="42" height="16" rx="8" fill="rgba(16,185,129,0.15)"/><text x="${W - 153}" y="${a.y + 30}" fill="#34d399" font-size="7" font-weight="700" font-family="system-ui">ACTIVE</text>`
      : `<rect x="${W - 160}" y="${a.y + 18}" width="54" height="16" rx="8" fill="rgba(148,163,184,0.1)"/><text x="${W - 153}" y="${a.y + 30}" fill="#64748b" font-size="7" font-weight="700" font-family="system-ui">INACTIVE</text>`;
    return `
    <rect x="20" y="${a.y}" width="${W - 40}" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <rect x="30" y="${a.y + 8}" width="56" height="40" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="58" y="${a.y + 32}" fill="#e2e8f0" font-size="14" font-family="system-ui" text-anchor="middle">${a.media}</text>
    <text x="96" y="${a.y + 22}" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">${a.title}</text>
    <text x="96" y="${a.y + 38}" fill="#64748b" font-size="9" font-family="system-ui">${a.msg}</text>
    ${statusEl}
    <text x="${W - 60}" y="${a.y + 30}" fill="#64748b" font-size="10" font-family="system-ui">✎  🗑</text>`;
  }).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Announcements</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Manage the kiosk idle slideshow</text>
    <rect x="${W - 120}" y="14" width="100" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 70}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add New</text>
    ${items}
    <rect x="20" y="252" width="${W - 40}" height="36" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="274" fill="#64748b" font-size="10" font-family="system-ui">⏱ Show announcements after</text>
    <rect x="230" y="260" width="50" height="22" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="255" y="276" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">5</text>
    <text x="290" y="274" fill="#64748b" font-size="10" font-family="system-ui">minutes idle</text>
  `);
}

/* ================================================================
   USERS & ROLES PAGE
   ================================================================ */
export function UsersMockup() {
  const rows = [
    { user: 'admin', role: 'ADMIN', rc: '#10b981', sec: 'All', status: 'Password', y: 82 },
    { user: 'gate_staff_1', role: 'STAFF', rc: '#64748b', sec: 'All', status: 'PIN: ****', y: 106 },
    { user: 'gate_staff_2', role: 'STAFF', rc: '#64748b', sec: 'All', status: 'PIN: ****', y: 130 },
    { user: 'dept_head_martinez', role: 'DEPT HEAD', rc: '#f59e0b', sec: 'Gr 7-A, Gr 7-B', status: 'Password', y: 154 },
    { user: 'mr_santos', role: 'TEACHER', rc: '#7dd3fc', sec: 'Gr 7-A', status: 'Companion', y: 178 },
    { user: 'ms_reyes', role: 'TEACHER', rc: '#7dd3fc', sec: 'Gr 6-A, Gr 6-B', status: 'Companion', y: 202 },
    { user: 'mr_cruz', role: 'TEACHER', rc: '#7dd3fc', sec: 'Gr 5-A, Gr 5-B', status: 'Companion', y: 226 },
    { user: 'mr_garcia', role: 'DEPT HEAD', rc: '#f59e0b', sec: 'Gr 5-A, 5-B, 6-A', status: 'Password', y: 250 },
  ].map(u => `
    <text x="30" y="${u.y + 14}" fill="#e2e8f0" font-size="10" font-weight="650" font-family="system-ui">${u.user}</text>
    <rect x="160" y="${u.y + 4}" width="64" height="16" rx="8" fill="${u.rc}22"/>
    <text x="168" y="${u.y + 15}" fill="${u.rc}" font-size="8" font-weight="700" font-family="system-ui">${u.role}</text>
    <text x="260" y="${u.y + 14}" fill="#64748b" font-size="9" font-family="system-ui">${u.sec}</text>
    <text x="400" y="${u.y + 14}" fill="#64748b" font-size="9" font-family="system-ui">${u.status}</text>
    <text x="${W - 50}" y="${u.y + 14}" fill="#64748b" font-size="9" font-family="system-ui">✎  🗑</text>
  `).join('');

  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Users &amp; Roles</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Dashboard accounts, staff PINs, dept heads, and teachers</text>
    <rect x="${W - 110}" y="14" width="90" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 65}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">+ Add User</text>

    <rect x="20" y="52" width="${W - 40}" height="234" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <rect x="20" y="52" width="${W - 40}" height="22" rx="8" fill="#111c33"/>
    <text x="30" y="67" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">USERNAME</text>
    <text x="160" y="67" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">ROLE</text>
    <text x="260" y="67" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">SECTIONS</text>
    <text x="400" y="67" fill="#64748b" font-size="8" font-weight="700" font-family="system-ui">STATUS</text>
    ${rows}
  `);
}

/* ================================================================
   SETTINGS PAGE
   ================================================================ */
export function SettingsMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Settings</text>
    <text x="20" y="42" fill="#64748b" font-size="9" font-family="system-ui">Global kiosk configuration</text>
    <rect x="${W - 180}" y="14" width="70" height="26" rx="7" fill="none" stroke="#1e293b"/>
    <text x="${W - 145}" y="31" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">📖 How To</text>
    <rect x="${W - 100}" y="14" width="80" height="26" rx="7" fill="#10b981"/>
    <text x="${W - 60}" y="31" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">💾 Save</text>

    <rect x="20" y="54" width="244" height="100" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="74" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">🏫 School</text>
    <text x="32" y="92" fill="#64748b" font-size="8" font-family="system-ui">School name</text>
    <rect x="32" y="96" width="220" height="18" rx="5" fill="#111c33" stroke="#1e293b"/>
    <text x="40" y="109" fill="#64748b" font-size="9" font-family="system-ui">TapIn School</text>
    <text x="32" y="124" fill="#64748b" font-size="8" font-family="system-ui">SMS message template</text>
    <rect x="32" y="128" width="220" height="18" rx="5" fill="#111c33" stroke="#1e293b"/>
    <text x="40" y="141" fill="#64748b" font-size="9" font-family="system-ui">{{school}}: {{name}} {{action}}...</text>

    <rect x="274" y="54" width="226" height="100" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="286" y="74" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">📅 School Years</text>
    <text x="286" y="94" fill="#64748b" font-size="9" font-family="system-ui">2026 - 2027</text>
    <rect x="410" y="84" width="52" height="14" rx="7" fill="rgba(16,185,129,0.15)"/>
    <text x="418" y="95" fill="#34d399" font-size="7" font-weight="700" font-family="system-ui">CURRENT</text>
    <text x="286" y="114" fill="#64748b" font-size="9" font-family="system-ui">2025 - 2026</text>
    <text x="410" y="114" fill="#10b981" font-size="9" font-family="system-ui">Set current</text>
    <rect x="286" y="128" width="140" height="18" rx="5" fill="#111c33" stroke="#1e293b"/>
    <text x="294" y="141" fill="#64748b" font-size="9" font-family="system-ui">2027 - 2028</text>
    <rect x="436" y="128" width="52" height="18" rx="5" fill="none" stroke="#1e293b"/>
    <text x="462" y="141" fill="#e2e8f0" font-size="8" font-weight="600" font-family="system-ui" text-anchor="middle">+ Add</text>

    <rect x="20" y="162" width="244" height="90" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="182" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">🔔 Bell Times</text>
    <text x="32" y="200" fill="#64748b" font-size="8" font-family="system-ui">AM IN</text>
    <rect x="32" y="204" width="70" height="16" rx="4" fill="#111c33" stroke="#1e293b"/>
    <text x="42" y="216" fill="#64748b" font-size="9" font-family="system-ui">07:30</text>
    <text x="112" y="200" fill="#64748b" font-size="8" font-family="system-ui">AM OUT</text>
    <rect x="112" y="204" width="70" height="16" rx="4" fill="#111c33" stroke="#1e293b"/>
    <text x="122" y="216" fill="#64748b" font-size="9" font-family="system-ui">12:00</text>

    <rect x="274" y="162" width="226" height="90" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="286" y="182" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">✉ SMS Provider</text>
    <text x="286" y="200" fill="#64748b" font-size="8" font-family="system-ui">Delivery channel</text>
    <rect x="286" y="204" width="206" height="18" rx="5" fill="#111c33" stroke="#1e293b"/>
    <text x="296" y="217" fill="#64748b" font-size="9" font-family="system-ui">Cloud SMS API (internet)</text>

    <rect x="20" y="260" width="480" height="36" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <text x="32" y="282" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">📧 Email (Report Delivery)</text>
    <rect x="340" y="268" width="80" height="20" rx="6" fill="none" stroke="#1e293b"/>
    <text x="380" y="282" fill="#e2e8f0" font-size="9" font-weight="600" font-family="system-ui" text-anchor="middle">✉ Test Email</text>
  `);
}

/* ================================================================
   CONNECT TO DATABASE DIALOG
   ================================================================ */
export function ConnectDbMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="100" y="30" width="320" height="240" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="120" y="60" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Connect to database</text>
    <text x="360" y="60" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <rect x="120" y="72" width="280" height="28" rx="8" fill="#111c33" stroke="#1e293b"/>
    <text x="130" y="90" fill="#64748b" font-size="9" font-family="system-ui">Enter the server address and credentials to reconnect.</text>

    <text x="120" y="116" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Host</text>
    <rect x="120" y="120" width="200" height="24" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="130" y="136" fill="#64748b" font-size="9" font-family="system-ui">192.168.1.100</text>

    <text x="330" y="116" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Port</text>
    <rect x="330" y="120" width="70" height="24" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="340" y="136" fill="#64748b" font-size="9" font-family="system-ui">3306</text>

    <text x="120" y="158" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Database</text>
    <rect x="120" y="162" width="280" height="24" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="130" y="178" fill="#64748b" font-size="9" font-family="system-ui">tapin_school</text>

    <text x="120" y="200" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Username</text>
    <rect x="120" y="204" width="130" height="24" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="130" y="220" fill="#64748b" font-size="9" font-family="system-ui">root</text>

    <text x="260" y="200" fill="#64748b" font-size="9" font-weight="650" font-family="system-ui">Password</text>
    <rect x="260" y="204" width="140" height="24" rx="6" fill="#111c33" stroke="#1e293b"/>
    <text x="270" y="220" fill="#64748b" font-size="9" font-family="system-ui">••••••••</text>

    <rect x="200" y="240" width="70" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="235" y="256" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Cancel</text>
    <rect x="280" y="240" width="120" height="24" rx="6" fill="#10b981"/>
    <text x="340" y="256" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">🔌 Connect</text>
  `);
}

/* ================================================================
   VISITOR QR PASS
   ================================================================ */
export function VisitorQrMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="100" y="20" width="320" height="260" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="120" y="50" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Visitor QR Pass</text>
    <text x="360" y="50" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <text x="${W / 2}" y="76" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui" text-anchor="middle">Ramon Bautista</text>
    <text x="${W / 2}" y="92" fill="#64748b" font-size="9" font-family="system-ui" text-anchor="middle">📋 Parent meeting · 🏛 Principal's Office</text>

    <rect x="180" y="102" width="120" height="120" rx="10" fill="#0b1226" stroke="#1e293b"/>
    <rect x="192" y="114" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="268" y="114" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="192" y="190" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="268" y="190" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="218" y="140" width="44" height="40" rx="2" fill="#64748b" opacity="0.4"/>

    <text x="${W / 2}" y="240" fill="#64748b" font-size="8" font-family="system-ui" text-anchor="middle">VP-QR-HASH-PAYLOAD-HERE</text>

    <rect x="190" y="252" width="100" height="22" rx="6" fill="#10b981"/>
    <text x="240" y="267" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">🖨 Print Pass</text>
  `);
}

/* ================================================================
   GUARDIAN DAY REPORT — DETAIL VIEW
   ================================================================ */
export function GuardianDetailMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1226"/>
    <text x="20" y="28" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">Guardian Detail</text>

    <rect x="20" y="40" width="${W - 40}" height="44" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="46" cy="62" r="14" fill="#111c33" stroke="#1e293b"/>
    <text x="68" y="56" fill="#e2e8f0" font-size="12" font-weight="700" font-family="system-ui">Maria Dela Cruz</text>
    <text x="68" y="72" fill="#64748b" font-size="9" font-family="system-ui">📱 0917***4567 · 📍 123 Mabini St., Manila</text>

    <text x="20" y="104" fill="#e2e8f0" font-size="11" font-weight="700" font-family="system-ui">Linked Children (2)</text>

    <rect x="20" y="114" width="${W - 40}" height="72" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="46" cy="140" r="14" fill="#111c33" stroke="#1e293b"/>
    <text x="68" y="134" fill="#e2e8f0" font-size="10" font-weight="650" font-family="system-ui">Juan Dela Cruz</text>
    <text x="68" y="148" fill="#64748b" font-size="8" font-family="system-ui">Grade 7 - Section A · Student No. 2024-0112</text>
    <rect x="${W - 120}" y="126" width="60" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="${W - 113}" y="138" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">PRESENT</text>
    <text x="68" y="168" fill="#64748b" font-size="8" font-family="system-ui">07:42 AM ✓ IN (camera) · 12:05 PM ⟲ OUT (gate)</text>
    <text x="68" y="180" fill="#fbbf24" font-size="8" font-family="system-ui">⚠ Late arrival (+2 min)</text>

    <rect x="20" y="194" width="${W - 40}" height="56" rx="10" fill="#0f172a" stroke="#1e293b"/>
    <circle cx="46" cy="212" r="14" fill="#111c33" stroke="#1e293b"/>
    <text x="68" y="210" fill="#e2e8f0" font-size="10" font-weight="650" font-family="system-ui">Carlos Dela Cruz</text>
    <text x="68" y="224" fill="#64748b" font-size="8" font-family="system-ui">Grade 5 - Section B · Student No. 2024-0215</text>
    <rect x="${W - 120}" y="202" width="60" height="16" rx="8" fill="rgba(16,185,129,0.15)"/>
    <text x="${W - 113}" y="214" fill="#34d399" font-size="8" font-weight="700" font-family="system-ui">PRESENT</text>
    <text x="68" y="242" fill="#64748b" font-size="8" font-family="system-ui">07:38 AM ✓ IN (gate)</text>

    <text x="${W / 2}" y="274" fill="#64748b" font-size="9" font-family="system-ui" text-anchor="middle">Report for August 29, 2026 · Auto-reset in 12 seconds</text>
  `);
}

/* ================================================================
   STUDENT QR CODE MODAL
   ================================================================ */
export function StudentQrMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="120" y="15" width="280" height="270" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="140" y="45" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">QR Code — Juan Dela Cruz</text>
    <text x="340" y="45" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <rect x="180" y="60" width="120" height="120" rx="10" fill="#0b1226" stroke="#1e293b"/>
    <rect x="192" y="72" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="268" y="72" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="192" y="148" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="268" y="148" width="20" height="20" rx="2" fill="#e2e8f0"/>
    <rect x="218" y="98" width="44" height="40" rx="2" fill="#64748b" opacity="0.4"/>

    <text x="${W / 2}" y="200" fill="#e2e8f0" font-size="10" font-weight="650" font-family="system-ui" text-anchor="middle">Juan Dela Cruz</text>
    <text x="${W / 2}" y="214" fill="#64748b" font-size="8" font-family="system-ui" text-anchor="middle">Grade 7 - Section A · Student No. 2024-0112</text>
    <text x="${W / 2}" y="228" fill="#64748b" font-size="8" font-family="system-ui" text-anchor="middle">QR payload: TAPIN-JD-20240112-HASH</text>

    <rect x="160" y="244" width="80" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="200" y="260" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Copy</text>
    <rect x="250" y="244" width="80" height="24" rx="6" fill="#10b981"/>
    <text x="290" y="260" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">🖨 Print</text>
  `);
}

/* ================================================================
   CSV IMPORT MODAL
   ================================================================ */
export function CsvImportMockup() {
  return svg(`
    <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(2,6,23,0.85)"/>
    <rect x="100" y="30" width="320" height="240" rx="14" fill="#0f172a" stroke="#1e293b"/>
    <text x="120" y="60" fill="#e2e8f0" font-size="14" font-weight="700" font-family="system-ui">Import Students from CSV</text>
    <text x="360" y="60" fill="#64748b" font-size="14" font-family="system-ui" text-anchor="middle">✕</text>

    <text x="120" y="82" fill="#64748b" font-size="9" font-family="system-ui">Upload a CSV file with student data. Required columns:</text>
    <text x="120" y="98" fill="#e2e8f0" font-size="9" font-family="system-ui">student_no, full_name, grade_section</text>
    <text x="120" y="114" fill="#64748b" font-size="9" font-family="system-ui">Optional: gender, parent_phone, lrn, is_active</text>

    <rect x="120" y="128" width="280" height="60" rx="10" fill="#111c33" stroke="#1e293b" stroke-dasharray="6"/>
    <text x="${W / 2}" y="158" fill="#64748b" font-size="11" font-family="system-ui" text-anchor="middle">📁 Drop CSV here or click to browse</text>
    <text x="${W / 2}" y="174" fill="#64748b" font-size="9" font-family="system-ui" text-anchor="middle">Supports .csv files up to 5MB</text>

    <text x="120" y="210" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui">Expected format preview:</text>
    <rect x="120" y="218" width="280" height="40" rx="6" fill="#0b1226" stroke="#1e293b"/>
    <text x="130" y="234" fill="#10b981" font-size="8" font-family="system-ui">student_no, full_name, gender, grade_section, parent_phone</text>
    <text x="130" y="248" fill="#64748b" font-size="8" font-family="system-ui">2024-0112, Juan Dela Cruz, Male, Grade 7 - A, 09171234567</text>

    <rect x="200" y="270" width="70" height="24" rx="6" fill="none" stroke="#1e293b"/>
    <text x="235" y="286" fill="#e2e8f0" font-size="10" font-weight="600" font-family="system-ui" text-anchor="middle">Cancel</text>
    <rect x="280" y="270" width="120" height="24" rx="6" fill="#10b981"/>
    <text x="340" y="286" fill="#022c22" font-size="10" font-weight="700" font-family="system-ui" text-anchor="middle">Import Students</text>
  `);
}
