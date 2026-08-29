// How To Guide: comprehensive, scrollable modal documenting every feature
// of the TapIn School attendance system — kiosk, admin dashboard, modals,
// gate mode, visitor flow, and all sidebar pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './shared';
import {
  KioskIdleMockup,
  KioskSuccessMockup,
  KioskGuardianMockup,
  GateModeMockup,
  ManualCheckinPinMockup,
  ManualCheckinSearchMockup,
  VisitorRegisterMockup,
  CameraScannerMockup,
  AdminLoginMockup,
  AdminSidebarMockup,
  OverviewMockup,
  StudentsMockup,
  SectionsMockup,
  LogsMockup,
  VisitorsAdminMockup,
  GuardiansMockup,
  ReportsMockup,
  BadgesMockup,
  SmsOutboxMockup,
  AnnouncementsMockup,
  UsersMockup,
  SettingsMockup,
  ConnectDbMockup,
  VisitorQrMockup,
  GuardianDetailMockup,
  StudentQrMockup,
  CsvImportMockup,
} from './howto-mockups';

function Mockup({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="howto-mockup">
      {label && <div className="howto-mockup-label">📸 {label}</div>}
      {children}
    </div>
  );
}

interface Section {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'kiosk',
    icon: '🏫',
    title: 'Kiosk Screen (Main Gate)',
    content: (
      <>
        <Mockup label="Kiosk — Idle State">
          <KioskIdleMockup />
        </Mockup>
        <p>The Kiosk is the main screen shown at the school gate. Students present their QR code to the scanner, and the system records their attendance automatically.</p>
        <h4>What You See</h4>
        <ul>
          <li><b>Header:</b> School logo, school name, live clock, status indicators (Database, SMS, Sync), and quick-action buttons.</li>
          <li><b>Center Display:</b> Shows the QR prompt when idle, or the check-in/check-out result card after a scan.</li>
          <li><b>Right Panel:</b> Gate Mode controls, live activity feed, and gateway status.</li>
        </ul>
        <h4>How It Works</h4>
        <ol>
          <li>A student scans their QR code at the gate reader.</li>
          <li>The system looks up the student and records a CHECK-IN (IN) or CHECK-OUT (OUT) scan.</li>
          <li>The result card displays for 4 seconds (12 seconds for guardians), showing the student's name, photo, grade/section, scan time, and any flags (Late/Early).</li>
          <li>Parent SMS is queued automatically if a phone number is on file.</li>
          <li>The screen resets to idle for the next student.</li>
        </ol>
        <Mockup label="Kiosk — Successful Check-In">
          <KioskSuccessMockup />
        </Mockup>
        <h4>Result Types</h4>
        <ul>
          <li>✅ <b>SUCCESS:</b> Student checked in or out. Shows photo, name, section, time, badges, and SMS status.</li>
          <li>👤 <b>GUARDIAN:</b> Parent/guardian scans their own QR. Shows today's attendance report for all linked children.</li>
        </ul>
        <Mockup label="Kiosk — Guardian Day Report">
          <KioskGuardianMockup />
        </Mockup>
        <ul>
          <li>🧑‍🤝‍🧑 <b>VISITOR:</b> Registered visitor scans their VP QR pass. Shows visitor name, purpose, and host office.</li>
          <li>⛔ <b>BLOCKED:</b> Access restricted (e.g., student is inactive or not enrolled).</li>
          <li>❓ <b>UNRECOGNIZED:</b> QR code not found in the system.</li>
          <li>♻️ <b>DUPLICATE:</b> QR was already scanned within the debounce window.</li>
        </ul>
        <h4>Quick-Action Buttons (Header)</h4>
        <ul>
          <li>📇 <b>Manual Check-in:</b> Open the forgot-QR flow (staff PIN required).</li>
          <li>🧑‍🤝‍🧑 <b>Register Visitor:</b> Open the walk-in visitor registration form (staff PIN required).</li>
          <li>⚙ <b>Admin Dashboard:</b> Open the admin panel (login required). Shortcut: <code>Ctrl+Shift+A</code>.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'gate-mode',
    icon: '🚧',
    title: 'Gate Mode & Session Mode',
    content: (
      <>
        <Mockup label="Gate Mode Panel (Kiosk Right Side)">
          <GateModeMockup />
        </Mockup>
        <p>Gate Mode controls how scans are interpreted — whether they are CHECK-IN, CHECK-OUT, or automatic. Session Mode locks scans to AM or PM.</p>
        <h4>Gate Scan Direction (Right Panel)</h4>
        <ul>
          <li>↔ <b>Auto (default):</b> The system decides IN or OUT based on the student's last scan that day. First scan = IN, second = OUT.</li>
          <li>✓ <b>IN:</b> Force every scan to be recorded as CHECK-IN. Use this at the morning gate.</li>
          <li>⟲ <b>OUT:</b> Force every scan to be recorded as CHECK-OUT. Use this at the afternoon gate.</li>
        </ul>
        <h4>Session Mode (AM / PM)</h4>
        <ul>
          <li><b>AUTO:</b> The system picks AM or PM based on the current time vs. bell times.</li>
          <li><b>AM:</b> Locks scans to the AM session. Use when morning attendance is being taken.</li>
          <li><b>PM:</b> Locks scans to the PM session. Use when afternoon attendance is being taken.</li>
        </ul>
        <p>When you switch Gate Mode or Session Mode, a colored pill appears in the header bar showing the active mode. Always switch back to <b>Auto</b> when done.</p>
      </>
    ),
  },
  {
    id: 'manual-checkin',
    icon: '📇',
    title: 'Manual Check-in (Forgot QR)',
    content: (
      <>
        <Mockup label="Manual Check-In — Staff PIN Entry">
          <ManualCheckinPinMockup />
        </Mockup>
        <p>For students who forgot their QR code, staff can look them up manually.</p>
        <h4>How to Use</h4>
        <ol>
          <li>Click the 📇 button in the header (or the "Forgot your QR?" button on the idle screen).</li>
          <li>Enter the <b>staff PIN</b> (4–8 digits) to authenticate. Only authorized staff can use this feature.</li>
          <li>Search by <b>student name</b> or <b>student number</b>. Results appear as you type.</li>
        </ol>
        <Mockup label="Manual Check-In — Student Search">
          <ManualCheckinSearchMockup />
        </Mockup>
        <ol start={4}>
          <li>Tap the correct student from the search results.</li>
          <li>Click <b>Check In</b> to record the scan.</li>
        </ol>
        <p>The scan goes through the exact same pipeline as a QR scan — debounce, IN/OUT toggle, SMS alerts, and offline queue — so it appears identically in logs and reports. The source is tagged as "MANUAL" so you can distinguish it from QR scans.</p>
      </>
    ),
  },
  {
    id: 'camera-scanner',
    icon: '📷',
    title: 'Camera Scanner',
    content: (
      <>
        <Mockup label="Camera Scanner Overlay">
          <CameraScannerMockup />
        </Mockup>
        <p>If no physical QR reader is connected, you can use the computer's webcam to scan QR codes.</p>
        <h4>How to Use</h4>
        <ol>
          <li>Click the <b>📷 Camera Scanner</b> button on the idle screen (or the camera icon in the header).</li>
          <li>Allow camera access when prompted.</li>
          <li>Hold the student's QR code in front of the webcam.</li>
          <li>The system automatically detects and processes the QR code.</li>
        </ol>
        <p>This is primarily used in browser demo mode. In production, a physical USB/serial QR reader is recommended for speed and reliability.</p>
      </>
    ),
  },
  {
    id: 'visitor-register',
    icon: '🧑‍🤝‍🧑',
    title: 'Visitor Registration (Kiosk)',
    content: (
      <>
        <Mockup label="Visitor Registration Form">
          <VisitorRegisterMockup />
        </Mockup>
        <p>Walk-in visitors can be registered at the kiosk gate. Each visitor gets a reusable VP (Visitor Pass) QR code.</p>
        <h4>How to Use</h4>
        <ol>
          <li>Click the 🧑‍🤝‍🧑 button in the header (or "Register Visitor" on the idle screen).</li>
          <li>Enter the <b>staff PIN</b> to authenticate.</li>
          <li>Fill in the visitor details: <b>Full Name</b> (required), Contact Phone, Purpose of Visit, Host/Office, and ID Presented.</li>
          <li>Click <b>Register</b>.</li>
          <li>The visitor's QR pass is generated. You can print it by clicking the print button, or copy the QR hash to hand to the visitor.</li>
        </ol>
        <Mockup label="Visitor QR Pass Generated">
          <VisitorQrMockup />
        </Mockup>
        <ol start={6}>
          <li>When the visitor arrives at the gate, they scan their VP QR — the system records their CHECK-IN.</li>
          <li>When leaving, they scan again for CHECK-OUT.</li>
        </ol>
        <p>Visitor passes are reusable — the same QR code toggles between IN and OUT on repeated scans.</p>
      </>
    ),
  },
  {
    id: 'activity-feed',
    icon: '📡',
    title: 'Live Activity Feed',
    content: (
      <>
        <p>The right panel of the kiosk shows a real-time feed of today's scans.</p>
        <ul>
          <li>Each row shows the <b>student name</b>, <b>grade/section</b>, <b>scan time</b>, and an <b>IN/OUT chip</b>.</li>
          <li>If the scan was flagged (Late/Early), a colored pill appears next to it.</li>
          <li>SMS delivery status is shown (queued, sent, failed).</li>
          <li>The feed updates live as new scans come in — no refresh needed.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'admin-login',
    icon: '🔐',
    title: 'Admin Login',
    content: (
      <>
        <Mockup label="Admin Login Screen">
          <AdminLoginMockup />
        </Mockup>
        <p>The admin dashboard is protected by a login screen. Only authorized users can access it.</p>
        <h4>How to Access</h4>
        <ol>
          <li>Click the ⚙ button in the kiosk header, or press <code>Ctrl+Shift+A</code>.</li>
          <li>The login screen appears with the school logo and name.</li>
          <li>Enter your <b>username</b> and <b>password</b>.</li>
          <li>Click <b>Sign In</b> or press Enter.</li>
        </ol>
        <p>To return to the kiosk, click "← Back to Kiosk" in the admin sidebar, or "Log out" to end the session.</p>
      </>
    ),
  },
  {
    id: 'admin-sidebar',
    icon: '📋',
    title: 'Admin Dashboard Sidebar',
    content: (
      <>
        <Mockup label="Admin Dashboard Sidebar">
          <AdminSidebarMockup />
        </Mockup>
        <p>The admin dashboard has a left sidebar with navigation to all management pages:</p>
        <ul>
          <li>📊 <b>Overview:</b> Daily attendance stats, charts, and IN/OUT ratios.</li>
          <li>🧑‍🎓 <b>Students:</b> Manage the student roster — add, edit, import from CSV, generate QR codes.</li>
          <li>🧑‍🏫 <b>Sections:</b> Register grade/section combinations, assign advisers, manage enrollments.</li>
          <li>🕐 <b>Attendance Logs:</b> Search, filter, and export historical scan records.</li>
          <li>🧑‍🤝‍🧑 <b>Visitors:</b> Register, manage, and view QR passes for walk-in visitors.</li>
          <li>👪 <b>Guardians:</b> Register parents/guardians and link them to students.</li>
          <li>📄 <b>Reports:</b> Generate attendance reports (summary, daily register, per-student, per-section, absentee list, tardiness, SMS audit, trends, SF1).</li>
          <li>🏅 <b>Badges & Ranking:</b> View attendance badge leaderboard and student badge history.</li>
          <li>✉ <b>SMS Outbox:</b> View SMS delivery logs, retry failed messages.</li>
          <li>📢 <b>Announcements:</b> Create announcements shown on the kiosk idle screen.</li>
          <li>🧑‍💼 <b>Users & Roles:</b> Manage admin, staff, department head, and teacher accounts.</li>
          <li>⚙ <b>Settings:</b> Configure school info, bell times, SMS provider, email, and more.</li>
        </ul>
        <p>The sidebar also shows the school logo, school name, and the title bar has the Database status pill and School Year selector.</p>
      </>
    ),
  },
  {
    id: 'overview',
    icon: '📊',
    title: 'Overview Page',
    content: (
      <>
        <Mockup label="Overview Page">
          <OverviewMockup />
        </Mockup>
        <p>The Overview page shows today's attendance at a glance.</p>
        <h4>What You See</h4>
        <ul>
          <li><b>Stat cards:</b> Total students, total scans today, students present, students absent, late arrivals, early departures.</li>
          <li><b>Line chart:</b> Hourly scan distribution showing peak arrival and departure times.</li>
          <li><b>IN/OUT ratio:</b> Visual breakdown of how many scans were CHECK-IN vs CHECK-OUT.</li>
        </ul>
        <p>Charts update in real-time as scans come in throughout the day.</p>
      </>
    ),
  },
  {
    id: 'students',
    icon: '🧑‍🎓',
    title: 'Students Page',
    content: (
      <>
        <Mockup label="Students Page">
          <StudentsMockup />
        </Mockup>
        <p>Manage the complete student roster. Students are enrolled in sections per school year.</p>
        <h4>Features</h4>
        <ul>
          <li><b>Search:</b> Filter students by name, student number, or section.</li>
          <li><b>Add Student:</b> Click "+ Add Student" to open the form. Fill in name, gender, grade/section, student number, parent phone, LRN, and photo.</li>
          <li><b>Edit Student:</b> Click the edit icon on any row to modify details.</li>
          <li><b>QR Code:</b> Click the QR icon to view and print the student's QR code. Each QR encodes the student's unique hash payload.</li>
        </ul>
        <Mockup label="Student QR Code Modal">
          <StudentQrMockup />
        </Mockup>
        <Mockup label="CSV Import Modal">
          <CsvImportMockup />
        </Mockup>
        <ul>
          <li><b>CSV Import:</b> Click "Import CSV" to bulk-add students from a spreadsheet file.</li>
          <li><b>Photo Upload:</b> Upload a student photo (JPEG/PNG) — it's resized automatically and shown on the kiosk check-in card.</li>
          <li><b>Guardian Link:</b> Link a student to a registered guardian from the dropdown.</li>
          <li><b>Excuses:</b> Manage excuse records (medical, family, etc.) for individual students.</li>
          <li><b>Toggle Active:</b> Deactivate students who have left — they won't appear in scans.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'sections',
    icon: '🧑‍🏫',
    title: 'Sections Page',
    content: (
      <>
        <Mockup label="Sections Page">
          <SectionsMockup />
        </Mockup>
        <p>Manage grade/section combinations and enrollments per school year.</p>
        <h4>Features</h4>
        <ul>
          <li><b>Register Section:</b> Click "+ Add Section" and enter the grade and section name (e.g., Grade 7 - Section A).</li>
          <li><b>Assign Adviser:</b> Each section can have an adviser (name + email) who receives attendance reports via email.</li>
          <li><b>Enroll Students:</b> Click on a section to see its roster. Move students in/out from the unassigned pool.</li>
          <li><b>Bulk Enroll:</b> Select multiple students and enroll them into a section at once.</li>
          <li><b>Print Section QR:</b> Generate a printable QR list for all students in a section.</li>
          <li><b>Adviser Reports:</b> Enable automatic email reports to section advisers (daily, weekly, or monthly).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'logs',
    icon: '🕐',
    title: 'Attendance Logs Page',
    content: (
      <>
        <Mockup label="Attendance Logs Page">
          <LogsMockup />
        </Mockup>
        <p>View and export the complete historical record of all scans.</p>
        <h4>Filters</h4>
        <ul>
          <li><b>Search:</b> Filter by student name or number.</li>
          <li><b>Entry Type:</b> Show only IN scans, only OUT scans, or all.</li>
          <li><b>Session:</b> Filter by AM or PM scans.</li>
          <li><b>Date Range:</b> Set a from/to date range to narrow results.</li>
        </ul>
        <h4>Export</h4>
        <ul>
          <li><b>Download CSV:</b> Export the filtered logs as a CSV file for spreadsheets.</li>
        </ul>
        <p>Each log row shows the student name, grade/section, scan time, entry type (IN/OUT), any flags (Late/Early), and the source (scanner, webcam, or manual).</p>
      </>
    ),
  },
  {
    id: 'visitors-admin',
    icon: '🧑‍🤝‍🧑',
    title: 'Visitors Page (Admin)',
    content: (
      <>
        <Mockup label="Visitors Page (Admin)">
          <VisitorsAdminMockup />
        </Mockup>
        <p>Manage the visitor registry and view visitor activity logs.</p>
        <h4>Registry Tab</h4>
        <ul>
          <li><b>Add Visitor:</b> Register a walk-in visitor with name, phone, purpose, host office, and ID presented.</li>
          <li><b>QR Pass:</b> Click the QR icon to view, print, or copy the visitor's VP QR code.</li>
          <li><b>Edit/Block:</b> Edit visitor details or block access (deactivate the QR pass).</li>
          <li><b>Delete:</b> Permanently remove a visitor record.</li>
        </ul>
        <h4>Logs Tab</h4>
        <ul>
          <li>View all visitor IN/OUT scans with timestamps, entry types, and visit details.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'guardians',
    icon: '👪',
    title: 'Guardians Page',
    content: (
      <>
        <Mockup label="Guardians Page">
          <GuardiansMockup />
        </Mockup>
        <p>Manage the parent/guardian registry. Guardians are registered first, then linked to students.</p>
        <h4>How to Use</h4>
        <ol>
          <li><b>Register Guardian:</b> Click "+ Add Guardian" and fill in name, mobile number, and address.</li>
          <li><b>Link to Students:</b> Go to the Students page, edit a student, and select the guardian from the dropdown.</li>
          <li><b>Guardian QR:</b> Each guardian gets a unique QR code. When scanned at the kiosk, it shows today's attendance report for all their linked children.</li>
        </ol>
        <Mockup label="Guardian Detail — Linked Children">
          <GuardianDetailMockup />
        </Mockup>
        <ul>
          <li><b>Edit/Delete:</b> Update guardian info or remove a guardian. Linked students are unlinked but their records stay.</li>
        </ul>
        <p>If a guardian name already exists, the system asks whether to update the existing record or create a new one (for different households with the same name).</p>
      </>
    ),
  },
  {
    id: 'reports',
    icon: '📄',
    title: 'Reports Page',
    content: (
      <>
        <Mockup label="Reports Page">
          <ReportsMockup />
        </Mockup>
        <p>Generate detailed attendance reports for various time periods.</p>
        <h4>Report Types</h4>
        <ul>
          <li><b>Summary:</b> Headline numbers (total students, scans, attendance rate) and daily totals for the date range.</li>
          <li><b>Daily Register:</b> SF2-style matrix — student × day showing IN/OUT times, Late/Early flags, and Absent markers.</li>
          <li><b>Per-Student:</b> Individual attendance summary for each student in the range.</li>
          <li><b>Per-Section:</b> Rollup attendance rates by grade/section.</li>
          <li><b>Student Record:</b> One student's full day-by-day record with every scan detail.</li>
          <li><b>Absentee List:</b> Students who were absent, with parent phone numbers for follow-up.</li>
          <li><b>Tardiness:</b> Every flagged-late arrival with the number of minutes late.</li>
          <li><b>SMS Audit:</b> SMS delivery status per day — sent, failed, and pending.</li>
          <li><b>Trends:</b> Weekly, day-of-week, and gate-hour attendance patterns.</li>
          <li><b>SF1 (School Register):</b> DepEd School Form 1 — school-wide register of enrolled learners (no date range needed).</li>
        </ul>
        <h4>Actions</h4>
        <ul>
          <li><b>Export PDF:</b> Download the report as a styled PDF document.</li>
          <li><b>Export Excel:</b> Download as a formatted spreadsheet.</li>
          <li><b>Email Report:</b> Send the report as a PDF attachment to the configured email recipients.</li>
          <li><b>Send to Advisers:</b> Email each section adviser their own section's attendance report.</li>
          <li><b>Drilldown:</b> Click on stat cards (e.g., "Absent") to see the list of students in that category.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'badges',
    icon: '🏅',
    title: 'Badges & Ranking Page',
    content: (
      <>
        <Mockup label="Badges & Ranking Page">
          <BadgesMockup />
        </Mockup>
        <p>The badge system rewards students for perfect attendance and punctuality.</p>
        <h4>Badge Types</h4>
        <ul>
          <li><b>Attendance (🎖):</b> Earned for perfect attendance over weekly, monthly, quarterly, semester, or yearly periods.</li>
          <li><b>Punctuality (⏱):</b> Earned for no late arrivals over the same periods.</li>
        </ul>
        <h4>Badge Tiers</h4>
        <ul>
          <li>🥈 <b>Silver</b> — Entry level (weekly achievement).</li>
          <li>🥇 <b>Gold</b> — Sustained performance (monthly/quarterly).</li>
          <li>💎 <b>Diamond</b> — Long-term excellence (semester/yearly).</li>
        </ul>
        <h4>Features</h4>
        <ul>
          <li><b>Leaderboard:</b> Full school ranking by badge score. Filter by section. Top students shown with medal icons (🥇🥈🥉).</li>
          <li><b>Badge History:</b> Click a student to see their complete badge history, weekly progress, and current week streak.</li>
          <li><b>Badge Score:</b> Each badge earns points based on its tier and period — displayed next to each student.</li>
        </ul>
        <p>Badges are automatically recomputed by the background job system. Students see their badge status on the kiosk check-in card.</p>
      </>
    ),
  },
  {
    id: 'sms-outbox',
    icon: '✉',
    title: 'SMS Outbox Page',
    content: (
      <>
        <Mockup label="SMS Outbox Page">
          <SmsOutboxMockup />
        </Mockup>
        <p>Monitor SMS delivery to parents and manage failed messages.</p>
        <h4>Features</h4>
        <ul>
          <li><b>Message List:</b> All SMS messages with status (sent, pending, failed), recipient, message preview, and timestamp.</li>
          <li><b>Filters:</b> Filter by status (sent, pending, failed) and date range.</li>
          <li><b>Retry Failed:</b> Click the retry icon on a failed message to re-queue it.</li>
          <li><b>Resend All Failed:</b> Click "↻ Resend All Failed" to re-queue every failed message at once.</li>
          <li><b>Expand:</b> Click a row to see the full message text and delivery details.</li>
        </ul>
        <p>SMS messages are sent automatically after each scan (if a parent phone number is configured) or when absence detection runs.</p>
      </>
    ),
  },
  {
    id: 'announcements',
    icon: '📢',
    title: 'Announcements Page',
    content: (
      <>
        <Mockup label="Announcements Page">
          <AnnouncementsMockup />
        </Mockup>
        <p>Create announcements that appear on the kiosk idle screen as a rotating carousel.</p>
        <h4>Features</h4>
        <ul>
          <li><b>Add Announcement:</b> Create with a title (admin-only label), message text, and optional image or video.</li>
          <li><b>Media:</b> Upload images (PNG/JPEG/GIF/WEBP) or videos (MP4/WEBM). Media-only announcements display full-bleed.</li>
          <li><b>Active/Inactive:</b> Toggle announcements on/off without deleting them.</li>
          <li><b>Sort Order:</b> Control the carousel order by adjusting sort values.</li>
          <li><b>Edit/Delete:</b> Modify or remove announcements at any time.</li>
        </ul>
        <h4>How It Appears</h4>
        <p>After the kiosk is idle for the configured number of minutes, active announcements appear one by one in the center display. Image/text slides rotate every N seconds (configurable). Video slides play in full with audio and advance when finished.</p>
      </>
    ),
  },
  {
    id: 'users',
    icon: '🧑‍💼',
    title: 'Users & Roles Page',
    content: (
      <>
        <Mockup label="Users & Roles Page">
          <UsersMockup />
        </Mockup>
        <p>Manage all user accounts for the system.</p>
        <h4>User Roles</h4>
        <ul>
          <li><b>Admin:</b> Full access to all features. Login with username + password.</li>
          <li><b>Staff:</b> Gate staff with a 4–8 digit PIN for kiosk actions (manual check-in, visitor registration, database connect).</li>
          <li><b>Department Head:</b> Can log into the Teacher Companion portal. Assigned specific sections they manage.</li>
          <li><b>Teacher:</b> Created in the TapIn Teacher Companion app. Read-only in the admin dashboard. Can view their section's attendance.</li>
        </ul>
        <h4>Features</h4>
        <ul>
          <li><b>Add User:</b> Create new accounts with username, role, password (admin/dept_head/teacher), or PIN (staff).</li>
          <li><b>Edit User:</b> Change username, role, password/PIN, or section assignments.</li>
          <li><b>Section Assignment:</b> Department heads are assigned the sections they manage — this controls what they see in the Teacher Companion.</li>
          <li><b>Delete User:</b> Remove an account (except the primary admin).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'settings',
    icon: '⚙',
    title: 'Settings Page',
    content: (
      <>
        <Mockup label="Settings Page">
          <SettingsMockup />
        </Mockup>
        <p>Configure all global settings for the system.</p>
        <h4>School</h4>
        <ul>
          <li><b>School Name:</b> Used in SMS messages, the kiosk header, and the sidebar.</li>
          <li><b>School Logo:</b> Upload a JPEG/PNG logo — resized automatically. Shown in the sidebar, kiosk, and login screen.</li>
          <li><b>SMS Template:</b> Customize the parent SMS message. Use placeholders: <code>{'{{school}}'}</code>, <code>{'{{name}}'}</code>, <code>{'{{section}}'}</code>, <code>{'{{action}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{flag}}'}</code>.</li>
        </ul>
        <h4>School Years</h4>
        <ul>
          <li>Add, set current, or delete school years (e.g., 2026 - 2027).</li>
          <li>Students are enrolled per school year. The current year drives attendance and reports.</li>
        </ul>
        <h4>Bell Times & Absence Detection</h4>
        <ul>
          <li><b>AM/PM Times:</b> Set start (IN) and end (OUT) times for morning and afternoon sessions.</li>
          <li><b>Late Grace:</b> Minutes after the bell before a scan is flagged as LATE.</li>
          <li><b>Absence Detection:</b> Auto-records absent students after dismissal. Runs on weekdays only.</li>
          <li><b>Absence SMS:</b> Optionally send SMS to parents of absent students at a configured time.</li>
        </ul>
        <h4>Gate Behavior</h4>
        <ul>
          <li><b>Show Photos:</b> Toggle student photos on the kiosk check-in card.</li>
          <li><b>Photo Style:</b> Choose how photos display — whole photo, cropped to fill, or full-bleed.</li>
          <li><b>Debounce Timeout:</b> Seconds to wait before allowing another scan from the same student.</li>
        </ul>
        <h4>SMS Provider</h4>
        <ul>
          <li><b>Simulator:</b> For development/testing — no real SMS sent.</li>
          <li><b>GSM Module:</b> Connect SIM800L/SIM900A modems via serial. Supports multiple modems for parallel sending.</li>
          <li><b>Cloud SMS:</b> Use Semaphore, PhilSMS, MessageBird, or a generic HTTP API.</li>
        </ul>
        <h4>Email (Report Delivery)</h4>
        <ul>
          <li>Configure SMTP server (pre-configured for Gmail), port, SSL/TLS, username, and app password.</li>
          <li>Set report recipients for the "Email report" button in Reports.</li>
          <li>Send a test email to verify the configuration.</li>
        </ul>
        <h4>Automatic Adviser Reports</h4>
        <ul>
          <li>Enable automatic emails to section advisers with attendance data.</li>
          <li>Choose frequency: daily, weekly, or monthly.</li>
          <li>Set the send time (e.g., end of school day).</li>
        </ul>
        <h4>Scheduled Jobs (This Machine)</h4>
        <ul>
          <li>Toggle whether this computer runs background jobs (SMS sending, backups, absence detection, badge recompute).</li>
          <li>Only ONE computer in a multi-PC setup should have this enabled.</li>
        </ul>
        <h4>Teacher Portal</h4>
        <ul>
          <li>Enable teacher enrollment (let teachers manage students in their sections via the Companion app).</li>
          <li>Display the portal URL for teachers to connect from any browser on the same network.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'connect-db',
    icon: '🔌',
    title: 'Connect to Database',
    content: (
      <>
        <Mockup label="Connect to Database Dialog">
          <ConnectDbMockup />
        </Mockup>
        <p>If the database is offline, you can reconnect to a different server from the kiosk.</p>
        <h4>How to Use</h4>
        <ol>
          <li>Click the <b>Database status dot</b> in the kiosk header (shows red when offline).</li>
          <li>Enter the <b>staff PIN</b> to authenticate (this is a public kiosk, so PIN protection is required).</li>
          <li>The Connect to Database dialog opens.</li>
          <li>Enter the new server address (host:port) and credentials.</li>
          <li>Click <b>Connect</b>. The app reloads with the new database connection.</li>
        </ol>
        <p>The Database dot also appears in the admin title bar and can be clicked there without a PIN (the admin is already authenticated).</p>
      </>
    ),
  },
  {
    id: 'keyboard',
    icon: '⌨',
    title: 'Keyboard Shortcuts',
    content: (
      <>
        <ul>
          <li><code>Ctrl+Shift+A</code> — Toggle between Kiosk and Admin Dashboard.</li>
          <li><code>Escape</code> — Close open modals (Manual Check-in, Visitor Register, Camera Scanner, etc.).</li>
          <li><code>Enter</code> — Submit forms (login, PIN entry, student search, etc.).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'tips',
    icon: '💡',
    title: 'Tips & Best Practices',
    content: (
      <>
        <ul>
          <li>Always leave Gate Mode on <b>Auto</b> unless you're specifically forcing IN or OUT at a dedicated gate.</li>
          <li>Set up <b>SMS provider</b> early so parents receive real-time alerts.</li>
          <li>Upload <b>student photos</b> — they appear on the kiosk check-in card and help staff verify identity.</li>
          <li>Use <b>School Years</b> to archive past enrollments — don't delete old data.</li>
          <li>Configure <b>bell times</b> accurately — they drive the Late/Early flags and absence detection.</li>
          <li>Enable <b>Absence Detection</b> to automatically record students who didn't scan that day.</li>
          <li>Set up <b>Automatic Adviser Reports</b> so teachers get attendance data without manual effort.</li>
          <li>Use the <b>SMS Outbox</b> to monitor delivery and retry any failed messages.</li>
          <li>Regularly check the <b>Badges</b> page — the gamification motivates students to maintain perfect attendance.</li>
          <li>In a multi-PC setup, enable <b>Scheduled Jobs</b> on only ONE machine to avoid duplicate SMS sends.</li>
        </ul>
      </>
    ),
  },
];

export function HowToGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setShowBackToTop(false);
    }
  }, [open]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setShowBackToTop(el.scrollTop > 200);
  }, []);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!open) return null;

  return (
    <Modal title="📖 How To Use TapIn School" onClose={onClose} wide>
      <div className="howto-guide" ref={scrollRef} onScroll={onScroll}>
        <nav className="howto-toc">
          <h3>Quick Navigation</h3>
          <div className="howto-toc-grid">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#howto-${s.id}`}
                className="howto-toc-link"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`howto-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                <span className="howto-toc-icon">{s.icon}</span>
                <span className="howto-toc-label">{s.title}</span>
              </a>
            ))}
          </div>
        </nav>

        {SECTIONS.map((s) => (
          <section key={s.id} id={`howto-${s.id}`} className="howto-section">
            <h3 className="howto-section-title">
              <span className="howto-section-icon">{s.icon}</span>
              {s.title}
            </h3>
            <div className="howto-section-content">{s.content}</div>
          </section>
        ))}

        <div className="howto-footer">
          <p>TapIn School — Gate Attendance & Parent Alerts</p>
          <p className="text-dim">For support, contact your school administrator.</p>
        </div>

        {showBackToTop && (
          <button className="howto-back-to-top" onClick={scrollToTop} title="Back to top" aria-label="Back to top">
            ↑
          </button>
        )}
      </div>
    </Modal>
  );
}
