// Reports (P1 6.1 + REPORTS_PLAN.md Tier 1): date-range attendance reports for
// eight types — summary, SF2-style daily register, per-student, per-section,
// absentee list, tardiness, SMS audit and trends — each exportable as PDF,
// styled Excel, or emailed as a PDF attachment.
import React, { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AdviserSendResult,
  ExportResult,
  GateHourTrend,
  RegisterRow,
  ReportData,
  ReportDrilldownMetric,
  ReportDrilldownRow,
  ReportType,
  SchoolRegisterSection,
  Student,
} from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, Spinner, Toast } from '../../components/shared';
import { useSchoolYear } from './schoolYear';

function fmtDayOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TYPE_LABELS: Record<ReportType, string> = {
  summary: 'Summary',
  register: 'Daily register',
  'per-student': 'Per-student',
  'per-section': 'Per-section',
  absentee: 'Absentee list',
  tardiness: 'Tardiness',
  'sms-audit': 'SMS audit',
  trends: 'Trends',
  student: 'Student record',
  sf1: 'School Register (SF1)',
};

const TYPE_OPTIONS: { value: ReportType; hint: string }[] = [
  { value: 'summary', hint: 'Headline numbers + daily totals' },
  { value: 'register', hint: 'SF2-style matrix: student × day (IN/OUT/LATE/ABSENT)' },
  { value: 'per-student', hint: 'Per-student attendance summary' },
  { value: 'per-section', hint: 'Rollup per grade/section' },
  { value: 'student', hint: "One student's full day-by-day record (every scan)" },
  { value: 'absentee', hint: 'Who was absent, with parent phones' },
  { value: 'tardiness', hint: 'Every flagged-late arrival with minutes late' },
  { value: 'sms-audit', hint: 'SMS delivery per day + failures' },
  { value: 'trends', hint: 'Weekly / day-of-week / gate-hour patterns' },
  { value: 'sf1', hint: "DepEd School Form 1 — the school-wide register of enrolled learners (no date range)" },
];

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  accent,
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  accent: string;
  hint?: string;
  /** When set, the card becomes a button that opens the metric's drilldown. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="stat-label text-dim">{label}</div>
      <div className="stat-value" style={{ color: accent }}>{value}</div>
      {onClick && <div className="stat-view">View students ↗</div>}
    </>
  );
  if (!onClick) {
    return (
      <div className="stat-card" title={hint}>
        {body}
      </div>
    );
  }
  return (
    <button className="stat-card stat-card-clickable" title={hint} onClick={onClick}>
      {body}
    </button>
  );
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-dim">—</span>;
  const ok = rate >= 80;
  return (
    <div className="rate-bar-wrap" title={`${rate.toFixed(1)}% attendance`}>
      <div className="rate-bar" style={{ width: `${Math.min(100, rate)}%`, background: ok ? 'var(--emerald)' : 'var(--amber)' }} />
    </div>
  );
}

// ---- Summary-card drilldowns (click a stat card → who is behind it?) --------

const DRILL_META: Record<ReportDrilldownMetric, { title: string; subtitle: string }> = {
  scans: { title: 'All scans by student', subtitle: 'Scan totals per student — IN / OUT breakdown' },
  in: { title: 'Checked-in students', subtitle: 'Students with at least one IN scan' },
  out: { title: 'Checked-out students', subtitle: 'Students with at least one OUT scan' },
  late: { title: 'Late arrivals', subtitle: 'Students with flagged-late IN scans (after the late cutoff)' },
  early: { title: 'Early departures', subtitle: 'Students with flagged-early OUT scans (before dismissal)' },
  absent: { title: 'Absent students', subtitle: 'Active students with zero scans on school days in the range' },
  present: { title: 'Students present', subtitle: 'Students with at least one scan in the range' },
  sms: { title: 'Students with SMS alerts', subtitle: 'Parent-alert texts sent per student in the range' },
  attendance: { title: 'Attendance rate per student', subtitle: 'Present vs absent school days — the rate denominator is school days in range' },
  onTime: { title: 'On-time arrivals', subtitle: 'Students with at least one IN scan at/before the late cutoff' },
  atRisk: { title: 'At-risk students (<80%)', subtitle: 'Active students below the DepEd 80% attendance threshold, worst first' },
  ada: { title: 'Average daily attendance — day by day', subtitle: 'Per-day presence driving the ADA figure' },
};

/** Column spec per metric — the backend fills value/value2/value3/time and the
 *  UI decides what each column means, so semantics live in exactly one place. */
const DRILL_COLUMNS: Record<
  ReportDrilldownMetric,
  { label: string; className?: string; render: (r: ReportDrilldownRow) => ReactNode }[]
> = {
  scans: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'IN', className: 'num', render: (r) => <span style={{ color: '#34D399' }}>{r.value2}</span> },
    { label: 'OUT', className: 'num', render: (r) => <span style={{ color: '#A5B4FC' }}>{r.value3}</span> },
    { label: 'Total', className: 'num', render: (r) => <b>{r.value}</b> },
  ],
  in: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'IN scans', className: 'num', render: (r) => <span style={{ color: '#34D399' }}>{r.value}</span> },
    { label: 'Last IN', className: 'mono', render: (r) => r.time ?? '—' },
  ],
  out: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'OUT scans', className: 'num', render: (r) => <span style={{ color: '#A5B4FC' }}>{r.value}</span> },
    { label: 'Last OUT', className: 'mono', render: (r) => r.time ?? '—' },
  ],
  late: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Times late', className: 'num', render: (r) => <span style={{ color: '#F59E0B' }}>{r.value}</span> },
    { label: 'Min late', className: 'num', render: (r) => r.value2 ?? 0 },
    { label: 'Phone', className: 'mono', render: (r) => r.parentPhone || '—' },
  ],
  early: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Times early', className: 'num', render: (r) => <span style={{ color: '#38BDF8' }}>{r.value}</span> },
    { label: 'Phone', className: 'mono', render: (r) => r.parentPhone || '—' },
  ],
  absent: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Days absent', className: 'num', render: (r) => <span style={{ color: '#F43F5E' }}>{r.value}</span> },
    { label: 'Phone', className: 'mono', render: (r) => r.parentPhone || '—' },
  ],
  present: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Present days', className: 'num', render: (r) => <span style={{ color: '#34D399' }}>{r.value}</span> },
    { label: 'Rate', render: (r) => (r.value2 === undefined ? '—' : <RateBar rate={r.value2} />) },
  ],
  sms: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'SMS alerts', className: 'num', render: (r) => <span style={{ color: '#A5B4FC' }}>{r.value}</span> },
    { label: 'Phone', className: 'mono', render: (r) => r.parentPhone || '—' },
  ],
  attendance: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Present', className: 'num', render: (r) => <span style={{ color: '#34D399' }}>{r.value}</span> },
    { label: 'Absent', className: 'num', render: (r) => <span style={{ color: '#FB7185' }}>{r.value2}</span> },
    { label: 'Rate', render: (r) => (r.value3 === undefined ? '—' : <RateBar rate={r.value3} />) },
  ],
  onTime: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'On-time IN', className: 'num', render: (r) => <span style={{ color: '#A3E635' }}>{r.value}</span> },
  ],
  atRisk: [
    { label: 'Student', render: (r) => <StudentCell row={r} /> },
    { label: 'Section', render: (r) => r.gradeSection || '—' },
    { label: 'Rate', className: 'num', render: (r) => <span style={{ color: '#FB7185' }}>{pct(r.value)}</span> },
    { label: 'Absent days', className: 'num', render: (r) => r.value2 ?? 0 },
    { label: 'Phone', className: 'mono', render: (r) => r.parentPhone || '—' },
  ],
  ada: [],
};

function StudentCell({ row }: { row: ReportDrilldownRow }) {
  return (
    <>
      <div className="reg-name">{row.fullName}</div>
      <div className="reg-sub mono">{row.studentNo}</div>
    </>
  );
}

/** Per-day presence table behind the "Avg daily attendance" card. */
function DailyDrillTable({ report }: { report: ReportData }) {
  const s = report.summary;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Day</th><th>Scans</th><th>IN</th><th>OUT</th><th>Present</th><th>Absent</th><th>Day rate</th></tr>
        </thead>
        <tbody>
          {report.daily.map((d) => {
            const rate = d.scans > 0 && s.activeStudents > 0 ? (d.present / s.activeStudents) * 100 : null;
            return (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="num">{d.scans}</td>
                <td className="num" style={{ color: '#34D399' }}>{d.in}</td>
                <td className="num" style={{ color: '#A5B4FC' }}>{d.out}</td>
                <td className="num">{d.present}</td>
                <td className="num" style={{ color: '#FB7185' }}>{d.absent}</td>
                <td>{rate === null ? '—' : pct(rate)}</td>
              </tr>
            );
          })}
          {report.daily.length === 0 && (
            <tr><td colSpan={7} className="empty-cell">No data in the selected range.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- Per-type views --------------------------------------------------------

function SummaryView({ report, onCardClick }: { report: ReportData; onCardClick: (m: ReportDrilldownMetric) => void }) {
  const s = report.summary;
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Scans" value={s.scans} accent="#E2E8F0" onClick={() => onCardClick('scans')} />
        <StatCard label="Checked IN" value={s.in} accent="#10B981" onClick={() => onCardClick('in')} />
        <StatCard label="Checked OUT" value={s.out} accent="#6366F1" onClick={() => onCardClick('out')} />
        <StatCard label="Late arrivals" value={s.late} accent="#F59E0B" onClick={() => onCardClick('late')} />
        <StatCard label="Early departures" value={s.early} accent="#38BDF8" onClick={() => onCardClick('early')} />
        <StatCard label="Absent (records)" value={s.absent} accent="#F43F5E" onClick={() => onCardClick('absent')} />
        <StatCard label="Students present" value={s.present} accent="#34D399" onClick={() => onCardClick('present')} />
        <StatCard label="SMS sent" value={s.smsSent} accent="#A5B4FC" onClick={() => onCardClick('sms')} />
        <StatCard label="Attendance rate" value={pct(s.attendanceRate)} accent="#34D399" hint="Σ daily present ÷ (active students × school days)" onClick={() => onCardClick('attendance')} />
        <StatCard label="Avg daily attendance" value={s.ada === null ? '—' : s.ada.toFixed(1)} accent="#2DD4BF" onClick={() => onCardClick('ada')} />
        <StatCard label="On-time IN" value={`${s.onTime} (${pct(s.onTimePct)})`} accent="#A3E635" onClick={() => onCardClick('onTime')} />
        <StatCard label="Late IN" value={`${s.late} (${pct(s.latePct)})`} accent="#F59E0B" hint="% of IN scans after the late cutoff" onClick={() => onCardClick('late')} />
        <StatCard label="At-risk (<80%)" value={s.atRiskCount} accent={s.atRiskCount > 0 ? '#FB7185' : '#A5B4FC'} hint="Active students below the 80% attendance threshold" onClick={() => onCardClick('atRisk')} />
      </div>
      <p className="field-hint" style={{ marginTop: 8 }}>
        {s.schoolDays} school day{s.schoolDays === 1 ? '' : 's'} (gate used) · {s.activeStudents} active student{s.activeStudents === 1 ? '' : 's'} — denominators for the rates above.
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th rowSpan={2}>Day</th>
              <th rowSpan={2}>Scans</th>
              <th colSpan={2} className="reg-sub-hdr am">Morning</th>
              <th colSpan={2} className="reg-sub-hdr pm">Afternoon</th>
              <th colSpan={2} className="reg-sub-hdr am">AM</th>
              <th colSpan={2} className="reg-sub-hdr pm">PM</th>
              <th colSpan={2} className="reg-sub-hdr" style={{ color: '#FB7185' }}>Absent</th>
              <th rowSpan={2}>Present</th>
            </tr>
            <tr>
              <th className="reg-sub-hdr am">IN</th>
              <th className="reg-sub-hdr am">OUT</th>
              <th className="reg-sub-hdr pm">IN</th>
              <th className="reg-sub-hdr pm">OUT</th>
              <th className="reg-sub-hdr am">Late</th>
              <th className="reg-sub-hdr am">Early</th>
              <th className="reg-sub-hdr pm">Late</th>
              <th className="reg-sub-hdr pm">Early</th>
              <th className="reg-sub-hdr" style={{ color: '#FB7185' }}>AM</th>
              <th className="reg-sub-hdr" style={{ color: '#FB7185' }}>PM</th>
            </tr>
          </thead>
          <tbody>
            {report.daily.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="num">{d.scans}</td>
                <td className="num" style={{ color: '#34D399' }}>{d.morningIn}</td>
                <td className="num" style={{ color: '#A5B4FC' }}>{d.morningOut}</td>
                <td className="num" style={{ color: '#34D399' }}>{d.afternoonIn}</td>
                <td className="num" style={{ color: '#A5B4FC' }}>{d.afternoonOut}</td>
                <td className="num" style={{ color: '#FBBF24' }}>{d.amLate}</td>
                <td className="num" style={{ color: '#38BDF8' }}>{d.amEarly}</td>
                <td className="num" style={{ color: '#FBBF24' }}>{d.pmLate}</td>
                <td className="num" style={{ color: '#38BDF8' }}>{d.pmEarly}</td>
                <td className="num" style={{ color: '#FB7185' }}>{d.amAbsent}</td>
                <td className="num" style={{ color: '#FB7185' }}>{d.pmAbsent}</td>
                <td className="num" style={{ color: '#94A3B8' }}>{d.present}</td>
              </tr>
            ))}
            {report.daily.length === 0 && (
              <tr><td colSpan={14} className="empty-cell">No data in the selected range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RegisterView({ report }: { report: ReportData }) {
  const { register } = report;
  const dayLabel = (day: string) => (day || '—').slice(5).replace('-', '/');
  const byKey = new Map(register.rows.map((r) => [`${r.studentId}:${r.day}`, r] as const));

  /** Render a single time cell: morning IN/OUT or afternoon IN/OUT. */
  const timeCell = (time: string | null, isLate = false) => (
    <span className={`reg-cell ${isLate ? 'late' : ''}`}>
      {time ?? '—'}
    </span>
  );

  /** Render the full 4-cell block for one student × one day. */
  const dayCells = (row: RegisterRow | undefined) => {
    if (!row) {
      return (
        <>
          <td><span className="reg-cell absent">A</span></td>
          <td><span className="reg-cell absent">A</span></td>
          <td><span className="reg-cell absent">A</span></td>
          <td><span className="reg-cell absent">A</span></td>
        </>
      );
    }
    return (
      <>
        <td>{timeCell(row.morningIn, row.amLate)}</td>
        <td>{timeCell(row.morningOut, row.amEarly)}</td>
        <td>{timeCell(row.afternoonIn, row.pmLate)}</td>
        <td>{timeCell(row.afternoonOut, row.pmEarly)}</td>
      </>
    );
  };

  return (
    <>
      <p className="field-hint" style={{ marginTop: 0 }}>
        Window: {register.windowFrom} → {register.windowTo}
        {register.capped && ' — the matrix is capped at the last 35 days; narrow the date range to see more.'}
        {' '}Cells = AM IN · AM OUT · PM IN · PM OUT · ⚠ AM/PM late/early · A absent.
      </p>
      {register.days.length === 0 ? (
        <div className="report-empty">No scans in the selected window.</div>
      ) : (
        <div className="table-wrap register-wrap">
          <table className="table register-table">
            <thead>
              <tr>
                <th className="reg-sticky" rowSpan={2}>Student</th>
                {register.days.map((d) => (
                  <th key={d} className="reg-day" colSpan={4} title={d}>{dayLabel(d)}</th>
                ))}
              </tr>
              <tr>
                {register.days.map((d) => (
                  <React.Fragment key={d}>
                    <th className="reg-sub-hdr am">AM IN</th>
                    <th className="reg-sub-hdr am">AM OUT</th>
                    <th className="reg-sub-hdr pm">PM IN</th>
                    <th className="reg-sub-hdr pm">PM OUT</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {register.students.map((st) => (
                <tr key={st.studentId}>
                  <td className="reg-sticky">
                    <div className="reg-name">{st.fullName}</div>
                    <div className="reg-sub">{st.studentNo} · {st.gradeSection}</div>
                  </td>
                  {register.days.map((d) => (
                    <React.Fragment key={d}>{dayCells(byKey.get(`${st.studentId}:${d}`))}</React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PerStudentView({ report }: { report: ReportData }) {
  return (
    <div className="table-wrap">
      <table className="table per-student-table">
        <thead>
          <tr>
            <th rowSpan={2}>Student</th><th rowSpan={2}>Section</th><th rowSpan={2}>Present</th>
            <th colSpan={2} className="reg-sub-hdr am">Late</th>
            <th colSpan={2} className="reg-sub-hdr">Absent</th>
            <th rowSpan={2}>Rate</th>
            <th colSpan={2} className="reg-sub-hdr am">IN</th>
            <th colSpan={2} className="reg-sub-hdr pm">OUT</th>
            <th colSpan={2} className="reg-sub-hdr" style={{ color: '#FBBF24' }}>Min late</th><th rowSpan={2}>SMS</th><th rowSpan={2}>Last SMS</th><th rowSpan={2}>Phone</th>
          </tr>
          <tr>
            <th className="reg-sub-hdr am">AM</th><th className="reg-sub-hdr pm">PM</th>
            <th className="reg-sub-hdr am">AM</th><th className="reg-sub-hdr pm">PM</th>
            <th className="reg-sub-hdr am">AM</th><th className="reg-sub-hdr pm">PM</th>
            <th className="reg-sub-hdr am">AM</th><th className="reg-sub-hdr pm">PM</th>
            <th className="reg-sub-hdr am">AM</th><th className="reg-sub-hdr pm">PM</th>
          </tr>
        </thead>
        <tbody>
          {report.perStudent.map((r) => (
            <tr key={r.studentId}>
              <td>{r.fullName}</td>
              <td>{r.gradeSection}</td>
              <td className="num">{r.daysPresent}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.daysLateAm}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.daysLatePm}</td>
              <td className="num" style={{ color: '#FB7185' }}>{r.daysAbsentAm}</td>
              <td className="num" style={{ color: '#FB7185' }}>{r.daysAbsentPm}</td>
              <td><RateBar rate={r.attendanceRate} /></td>
              <td className="num" style={{ color: '#34D399' }}>{r.totalInAm}</td>
              <td className="num" style={{ color: '#34D399' }}>{r.totalInPm}</td>
              <td className="num" style={{ color: '#A5B4FC' }}>{r.totalOutAm}</td>
              <td className="num" style={{ color: '#A5B4FC' }}>{r.totalOutPm}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.totalMinutesLateAm}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.totalMinutesLatePm}</td>
              <td className="num">{r.smsCount}</td>
              <td>
                {r.lastSmsStatus === 'SENT' && <span className="badge ok">SENT</span>}
                {r.lastSmsStatus === 'PENDING' && <span className="badge warn">PENDING</span>}
                {r.lastSmsStatus === 'FAILED' && <span className="badge err">FAILED</span>}
                {!r.lastSmsStatus && <span className="text-dim">—</span>}
              </td>
              <td className="mono">{r.parentPhone}</td>
            </tr>
          ))}
          {report.perStudent.length === 0 && (
            <tr><td colSpan={17} className="empty-cell">No active students{report.section ? ` in ${report.section}` : ''}.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PerSectionView({ report }: { report: ReportData }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th rowSpan={2}>Section</th>
            <th rowSpan={2}>Enrolled</th>
            <th colSpan={2}>Present</th>
            <th colSpan={2}>Absent</th>
            <th colSpan={2}>Late</th>
            <th colSpan={2}>Early</th>
            <th rowSpan={2}>Rate</th>
            <th colSpan={2}>IN</th>
            <th colSpan={2}>OUT</th>
          </tr>
          <tr>
            <th>AM</th><th>PM</th>
            <th>AM</th><th>PM</th>
            <th>AM</th><th>PM</th>
            <th>AM</th><th>PM</th>
            <th>AM</th><th>PM</th>
            <th>AM</th><th>PM</th>
          </tr>
        </thead>
        <tbody>
          {report.perSection.map((r) => (
            <tr key={r.gradeSection}>
              <td>{r.gradeSection}</td>
              <td className="num">{r.enrolled}</td>
              <td className="num" style={{ color: '#34D399' }}>{r.presentAm}</td>
              <td className="num" style={{ color: '#34D399' }}>{r.presentPm}</td>
              <td className="num" style={{ color: '#FB7185' }}>{r.absentAm}</td>
              <td className="num" style={{ color: '#FB7185' }}>{r.absentPm}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.lateAm}</td>
              <td className="num" style={{ color: '#FBBF24' }}>{r.latePm}</td>
              <td className="num" style={{ color: '#7DD3FC' }}>{r.earlyAm}</td>
              <td className="num" style={{ color: '#7DD3FC' }}>{r.earlyPm}</td>
              <td><RateBar rate={r.attendanceRate} /></td>
              <td className="num">{r.totalInAm}</td>
              <td className="num">{r.totalInPm}</td>
              <td className="num">{r.totalOutAm}</td>
              <td className="num">{r.totalOutPm}</td>
            </tr>
          ))}
          {report.perSection.length === 0 && (
            <tr><td colSpan={14} className="empty-cell">No sections found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AbsenteeView({ report }: { report: ReportData }) {
  return (
    <>
      <h3 className="report-section-title">Absent days per student</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Student</th><th>Section</th><th>Absent AM</th><th>Absent PM</th><th>Phone</th></tr>
          </thead>
          <tbody>
            {report.absenteeTotals.map((r) => (
              <tr key={r.studentId}>
                <td>{r.fullName}</td>
                <td>{r.gradeSection}</td>
                <td className="num" style={{ color: r.daysAbsentAm >= 3 ? '#F43F5E' : '#FBBF24' }}>{r.daysAbsentAm}</td>
                <td className="num" style={{ color: r.daysAbsentPm >= 3 ? '#F43F5E' : '#FBBF24' }}>{r.daysAbsentPm}</td>
                <td className="mono">{r.parentPhone}</td>
              </tr>
            ))}
            {report.absenteeTotals.length === 0 && (
              <tr><td colSpan={5} className="empty-cell">No absences recorded in the range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <h3 className="report-section-title">Absence records (day by day)</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Day</th><th>Student</th><th>Section</th><th>Session</th><th>Phone</th><th>SMS sent</th></tr>
          </thead>
          <tbody>
            {report.absentee.map((r, i) => (
              <tr key={`${r.studentId}-${r.day}-${i}`}>
                <td className="mono">{r.day}</td>
                <td>{r.fullName}</td>
                <td>{r.gradeSection}</td>
                <td>
                  <span className="badge" style={{ color: r.session === 'AM' ? '#FBBF24' : r.session === 'PM' ? '#7DD3FC' : '#FB7185' }}>
                    {r.session === 'FULL' ? 'FULL DAY' : r.session === 'AM' ? 'AM' : 'PM'}
                  </span>
                </td>
                <td className="mono">{r.parentPhone}</td>
                <td>{r.smsSent ? <span className="badge ok">SENT</span> : <span className="badge muted">—</span>}</td>
              </tr>
            ))}
            {report.absentee.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No absence records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TardinessView({ report }: { report: ReportData }) {
  const [minLate, setMinLate] = useState(1);
  const frequent = report.tardinessFrequency.filter((r) => r.lateCount >= minLate);
  return (
    <>
      <h3 className="report-section-title">Late frequency (students late ≥ <select
        className="freq-filter"
        value={minLate}
        onChange={(e) => setMinLate(Number(e.target.value))}
        title="Only show students late at least this many times"
      >
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select> times)</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Student</th><th>Section</th><th>Times late</th></tr>
          </thead>
          <tbody>
            {frequent.map((r) => (
              <tr key={r.studentId}>
                <td>{r.fullName}</td>
                <td>{r.gradeSection}</td>
                <td className="num" style={{ color: '#F59E0B' }}>{r.lateCount}</td>
              </tr>
            ))}
            {frequent.length === 0 && (
              <tr><td colSpan={3} className="empty-cell">No students late {minLate} or more times.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <h3 className="report-section-title">Tardiness records (every flagged-late arrival)</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Day</th><th>Time</th><th>Student</th><th>Section</th><th>Minutes late</th><th>Phone</th></tr>
          </thead>
          <tbody>
            {report.tardiness.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.day}</td>
                <td className="mono">{r.scannedTime}</td>
                <td>{r.fullName}</td>
                <td>{r.gradeSection}</td>
                <td className="num" style={{ color: '#F59E0B' }}>{r.minutesLate}</td>
                <td className="mono">{r.parentPhone}</td>
              </tr>
            ))}
            {report.tardiness.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No late arrivals (check that a bell time is configured in Settings).</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SmsAuditView({ report }: { report: ReportData }) {
  return (
    <>
      <h3 className="report-section-title">Daily delivery</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Day</th><th>Sent</th><th>Pending</th><th>Failed</th><th>Total</th></tr>
          </thead>
          <tbody>
            {report.smsAudit.daily.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="num" style={{ color: '#34D399' }}>{d.sent}</td>
                <td className="num" style={{ color: '#FBBF24' }}>{d.pending}</td>
                <td className="num" style={{ color: '#FB7185' }}>{d.failed}</td>
                <td className="num">{d.total}</td>
              </tr>
            ))}
            {report.smsAudit.daily.length === 0 && (
              <tr><td colSpan={5} className="empty-cell">No SMS activity in the range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <h3 className="report-section-title">Failed messages</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Sent at</th><th>Student</th><th>Phone</th><th>Provider</th><th>Attempts</th><th>Error</th></tr>
          </thead>
          <tbody>
            {report.smsAudit.failures.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.createdAt}</td>
                <td>{f.fullName ?? '—'}</td>
                <td className="mono">{f.parentPhone}</td>
                <td>{f.provider ?? '—'}</td>
                <td className="num">{f.attempts}</td>
                <td className="err-cell">{f.error ?? '—'}</td>
              </tr>
            ))}
            {report.smsAudit.failures.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No failed messages.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HourBar({ h, max }: { h: GateHourTrend; max: number }) {
  const inW = max > 0 ? (h.in / max) * 100 : 0;
  const outW = max > 0 ? (h.out / max) * 100 : 0;
  return (
    <div className="hour-row">
      <span className="hour-label">{String(h.hour).padStart(2, '0')}h</span>
      <div className="hour-bars">
        <div className="hour-track"><div className="hour-bar in" style={{ width: `${inW}%` }} title={`${h.in} IN`} /></div>
        <div className="hour-track"><div className="hour-bar out" style={{ width: `${outW}%` }} title={`${h.out} OUT`} /></div>
      </div>
    </div>
  );
}

function StudentView({ report }: { report: ReportData }) {
  const rec = report.studentRecord;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!rec) {
    return <div className="report-empty">Select a student from the toolbar to see their full attendance record.</div>;
  }
  const s = rec.summary;
  const flatScans = rec.days.flatMap((d) => d.scans.map((sc) => ({ day: d.day, sc })));
  return (
    <>
      <div className="student-record-head">
        <div>
          <div className="student-record-name">{rec.fullName}</div>
          <div className="text-dim">{rec.studentNo} · {rec.gradeSection} · {rec.parentPhone}</div>
        </div>
        <div className="student-record-rate">
          <span className="text-dim">Attendance</span>
          <RateBar rate={s.attendanceRate} />
        </div>
      </div>
      <div className="stat-grid">
        <StatCard label="Present days" value={s.daysPresent} accent="#34D399" />
        <StatCard label="Late AM" value={s.daysLateAm} accent="#F59E0B" />
        <StatCard label="Late PM" value={s.daysLatePm} accent="#F59E0B" />
        <StatCard label="Absent AM" value={s.daysAbsentAm} accent={s.daysAbsentAm > 0 ? '#FB7185' : '#94A3B8'} />
        <StatCard label="Absent PM" value={s.daysAbsentPm} accent={s.daysAbsentPm > 0 ? '#FB7185' : '#94A3B8'} />
        <StatCard label="Attendance rate" value={pct(s.attendanceRate)} accent="#34D399" />
        <StatCard label="IN AM" value={s.totalInAm} accent="#34D399" />
        <StatCard label="IN PM" value={s.totalInPm} accent="#34D399" />
        <StatCard label="OUT AM" value={s.totalOutAm} accent="#A5B4FC" />
        <StatCard label="OUT PM" value={s.totalOutPm} accent="#A5B4FC" />
        <StatCard label="Min late AM" value={s.totalMinutesLateAm} accent={s.totalMinutesLateAm > 0 ? '#FBBF24' : '#94A3B8'} />
        <StatCard label="Min late PM" value={s.totalMinutesLatePm} accent={s.totalMinutesLatePm > 0 ? '#FBBF24' : '#94A3B8'} />
        <StatCard label="SMS sent" value={s.smsCount} accent="#2DD4BF" hint="Parent alert texts sent for this student in the range" />
        <StatCard label="Last SMS" value={s.lastSmsStatus ?? '—'} accent="#A5B4FC" hint="Status of the student's most recent parent alert in the range" />
      </div>

      <h3 className="report-section-title">Day by day</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th rowSpan={2}>Day</th>
              <th rowSpan={2}>Weekday</th>
              <th rowSpan={2}>Status</th>
              <th colSpan={2} className="reg-sub-hdr am">Morning</th>
              <th colSpan={2} className="reg-sub-hdr pm">Afternoon</th>
              <th rowSpan={2}>AM Late</th>
              <th rowSpan={2}>PM Late</th>
              <th rowSpan={2}>AM Early</th>
              <th rowSpan={2}>PM Early</th>
              <th rowSpan={2}>Scans</th>
            </tr>
            <tr>
              <th className="reg-sub-hdr am">IN</th>
              <th className="reg-sub-hdr am">OUT</th>
              <th className="reg-sub-hdr pm">IN</th>
              <th className="reg-sub-hdr pm">OUT</th>
            </tr>
          </thead>
          <tbody>
            {rec.days.map((d) => {
              const absent = !d.present && d.schoolDay;
              const amAbsent = d.schoolDay && !d.amPresent;
              const pmAbsent = d.schoolDay && !d.pmPresent;
              return (
                <tr key={d.day} className={absent ? 'row-absent' : d.late ? 'row-late' : undefined}>
                  <td className="mono">{d.day}</td>
                  <td>{dow[new Date(d.day + 'T00:00:00').getDay()]}</td>
                  <td>
                    {absent && <span className="badge err">ABSENT</span>}
                    {!absent && amAbsent && <span className="badge warn">AM ABSENT</span>}
                    {!absent && !amAbsent && pmAbsent && <span className="badge warn">PM ABSENT</span>}
                    {!absent && !amAbsent && !pmAbsent && d.late && <span className="badge warn">LATE</span>}
                    {!absent && !amAbsent && !pmAbsent && !d.late && <span className="badge ok">PRESENT</span>}
                    {!d.schoolDay && <span className="text-dim">—</span>}
                  </td>
                  <td className="mono">{d.morningIn ?? '—'}</td>
                  <td className="mono">{d.morningOut ?? '—'}</td>
                  <td className="mono">{d.afternoonIn ?? '—'}</td>
                  <td className="mono">{d.afternoonOut ?? '—'}</td>
                  <td className="num">{d.amLate ? <span className="pill pill-late">LATE</span> : '—'}</td>
                  <td className="num">{d.pmLate ? <span className="pill pill-late">LATE</span> : '—'}</td>
                  <td className="num">{d.amEarly ? <span className="pill pill-early">EARLY</span> : '—'}</td>
                  <td className="num">{d.pmEarly ? <span className="pill pill-early">EARLY</span> : '—'}</td>
                  <td className="num">{d.scans.length}</td>
                </tr>
              );
            })}
            {rec.days.length === 0 && (
              <tr><td colSpan={13} className="empty-cell">No days in the selected range.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="report-section-title">All scans</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Time</th><th>Type</th><th>Flag</th><th>Source</th></tr>
          </thead>
          <tbody>
            {flatScans.map(({ day, sc }) => (
              <tr key={sc.id}>
                <td className="mono">{day}</td>
                <td className="mono">{sc.time}</td>
                <td>{sc.entryType}</td>
                <td>
                  {sc.flag === 'LATE' && <span className="badge warn">LATE</span>}
                  {sc.flag === 'EARLY' && <span className="badge info">EARLY</span>}
                  {!sc.flag && <span className="text-dim">—</span>}
                </td>
                <td>{sc.source}</td>
              </tr>
            ))}
            {flatScans.length === 0 && (
              <tr><td colSpan={5} className="empty-cell">No scans in the selected range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TrendsView({ report }: { report: ReportData }) {
  const maxHour = Math.max(1, ...report.trends.gateHours.map((h) => Math.max(h.in, h.out)));
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <>
      <h3 className="report-section-title">Weekly attendance</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Week (Mon)</th><th>Days</th><th>Present-days</th><th>Rate</th></tr></thead>
          <tbody>
            {report.trends.weekly.map((w) => (
              <tr key={w.weekStart}>
                <td className="mono">{w.weekStart}</td>
                <td className="num">{w.days}</td>
                <td className="num">{w.presentDays}</td>
                <td><RateBar rate={w.attendanceRate} /></td>
              </tr>
            ))}
            {report.trends.weekly.length === 0 && (
              <tr><td colSpan={4} className="empty-cell">No data in the range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <h3 className="report-section-title">Day of week</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Day</th><th>Days</th><th>Rate</th></tr></thead>
          <tbody>
            {report.trends.dayOfWeek.map((d) => (
              <tr key={d.weekday}>
                <td>{dowNames[d.weekday]}</td>
                <td className="num">{d.days}</td>
                <td><RateBar rate={d.attendanceRate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="report-section-title">Scans by hour (gate load)</h3>
      <div className="hours-grid">
        {report.trends.gateHours.map((h) => <HourBar key={h.hour} h={h} max={maxHour} />)}
      </div>
    </>
  );
}

function Sf1View({ report }: { report: ReportData }) {
  const grandMale = report.schoolRegister.reduce((a, g) => a + g.male, 0);
  const grandFemale = report.schoolRegister.reduce((a, g) => a + g.female, 0);
  return (
    <>
      <p className="field-hint" style={{ marginTop: 0 }}>
        DepEd School Form 1 (SF1) — School Register. Every active learner for the selected school year,
        grouped by section. No date range: it's a snapshot of who is enrolled.
      </p>
      {report.schoolRegister.length === 0 ? (
        <div className="report-empty">No active students{report.section ? ` in ${report.section}` : ''}.</div>
      ) : (
        <>
          {report.schoolRegister.map((g) => <Sf1SectionTable key={g.gradeSection} group={g} />)}
          <div className="sf1-summary">
            <div className="sf1-summary-cell"><span className="text-dim">MALE</span> <b>{grandMale}</b></div>
            <div className="sf1-summary-cell"><span className="text-dim">FEMALE</span> <b>{grandFemale}</b></div>
            <div className="sf1-summary-cell"><span className="text-dim">TOTAL</span> <b>{grandMale + grandFemale}</b></div>
          </div>
        </>
      )}
    </>
  );
}

function Sf1SectionTable({ group }: { group: SchoolRegisterSection }) {
  const total = group.male + group.female;
  return (
    <div className="sf1-section">
      <h3 className="report-section-title">Grade Level &amp; Section: {group.gradeSection}
        <span className="text-dim" style={{ fontWeight: 400, marginLeft: 10 }}>MALE {group.male} · FEMALE {group.female} · TOTAL {total}</span>
      </h3>
      <div className="table-wrap">
        <table className="table sf1-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>LRN</th>
              <th>Learner's Name <span className="sub-hint">(Last Name, First Name, Middle Name)</span></th>
              <th>Sex</th>
              <th>Birthdate</th>
              <th>Address (Home)</th>
              <th>Guardian</th>
              <th>Contact No.</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r, i) => (
              <tr key={r.studentId}>
                <td className="num">{i + 1}</td>
                <td className="mono">{r.lrn || r.studentNo}</td>
                <td>{r.fullName}</td>
                <td>{r.sex}</td>
                <td className="text-dim">—</td>
                <td>{r.address || '—'}</td>
                <td>{r.guardian || '—'}</td>
                <td className="mono">{r.contact || '—'}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export function ReportsPage() {
  // The GLOBALLY selected school year scopes the report's section groupings.
  const { year } = useSchoolYear();
  const [from, setFrom] = useState(fmtDayOffset(6));
  const [to, setTo] = useState(fmtDayOffset(0));
  const [type, setType] = useState<ReportType>('summary');
  const [section, setSection] = useState('');
  const [studentId, setStudentId] = useState('');
  const [maskPhones, setMaskPhones] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | 'email' | 'advisers' | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [sendResult, setSendResult] = useState<AdviserSendResult | null>(null);

  // Summary stat-card drilldown (click a card → who is behind this number?).
  const [drill, setDrill] = useState<ReportDrilldownMetric | null>(null);
  const [drillRows, setDrillRows] = useState<ReportDrilldownRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const openDrilldown = useCallback(
    (metric: ReportDrilldownMetric) => {
      setDrill(metric);
      setDrillRows(null);
      setDrillError(null);
      // The ADA card reads straight from the already-loaded daily table.
      if (metric === 'ada') return;
      setDrillLoading(true);
      api
        .getReportDrilldown({ metric, from, to, section, schoolYear: year, maskPhones })
        .then((r) => setDrillRows(r.rows))
        .catch((err) => setDrillError((err as Error).message || 'Could not load the details.'))
        .finally(() => setDrillLoading(false));
    },
    [from, to, section, year, maskPhones],
  );

  // Student picker for the 'student' record report — all students, with their
  // section resolved from the selected school year's enrollments (falling back
  // to the live section, same as the report loader).
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollMap, setEnrollMap] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    void api.listStudents().then(setStudents).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!year) {
      setEnrollMap(new Map());
      return;
    }
    void api.listEnrollments(year).then((rows) => setEnrollMap(new Map(rows.map((r) => [r.studentId, r.gradeSection])))).catch(() => undefined);
  }, [year]);
  const sectionOf = (id: number) => enrollMap.get(id) ?? students.find((s) => s.id === id)?.grade_section ?? '';
  const pickableStudents = students
    .filter((s) => !section || sectionOf(s.id) === section)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getReport({ from, to, type, section, maskPhones, schoolYear: year, studentId: studentId ? Number(studentId) : undefined })
      .then(setReport)
      .catch((err) => setError((err as Error).message || 'Could not load the report.'))
      .finally(() => setLoading(false));
  }, [from, to, type, section, maskPhones, year, studentId]);

  // A section from a previous school year won't exist in the new one — reset
  // the filter whenever the globally selected year changes.
  useEffect(() => {
    setSection('');
  }, [year]);

  // Keep the picked student inside the current section filter.
  useEffect(() => {
    if (studentId && section && sectionOf(Number(studentId)) !== section) setStudentId('');
  }, [studentId, section, enrollMap, students]);

  useEffect(load, [load]);

  const notify = (m: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message: m, tone });
    setTimeout(() => setToast(null), 4000);
  };

  const handleExport = async (kind: 'pdf' | 'xlsx') => {
    if (!report || busy) return;
    setBusy(kind);
    try {
      const res: ExportResult =
        kind === 'pdf' ? await api.exportReportPdf(report) : await api.exportReportXlsx(report);
      if (res.ok) notify(res.filePath ? `Report saved: ${res.filePath}` : 'Report exported.');
      // ok:false without an error means the user cancelled the save dialog.
      else if (res.error) notify(`Export failed: ${res.error}`);
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async () => {
    if (!report || busy) return;
    setBusy('email');
    try {
      const res = await api.sendReportEmail(report);
      if (res.ok) notify(res.message || 'Report emailed.');
      else if (res.error) notify(`Email failed: ${res.error}`, 'error');
    } catch (err) {
      notify(`Email failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleSendToAdvisers = async () => {
    if (!report || busy) return;
    setBusy('advisers');
    try {
      const res = await api.sendReportToAdvisers(report.from, report.to, year);
      if (res.failed > 0) {
        // Open the per-adviser breakdown so the admin can see who failed and why.
        setSendResult(res);
      } else {
        notify(res.message || 'Reports sent to advisers.', res.ok ? 'success' : 'error');
      }
    } catch (err) {
      notify(`Send failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const s = report?.summary;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p className="text-dim">
            {TYPE_LABELS[type]} — {TYPE_OPTIONS.find((o) => o.value === type)?.hint}
            {year ? ` · School year: ${year}` : ''}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" disabled={!report || busy !== null} onClick={() => void handleExport('pdf')}>
            {busy === 'pdf' ? 'Preparing…' : '⬇ Export PDF'}
          </button>
          <button className="btn-ghost" disabled={!report || busy !== null} onClick={() => void handleExport('xlsx')}>
            {busy === 'xlsx' ? 'Preparing…' : '⬇ Export Excel'}
          </button>
          <button
            className="btn-primary"
            disabled={!report || busy !== null}
            onClick={() => void handleEmail()}
            title="Email the report (PDF attachment) to the recipient(s) set in Settings"
          >
            {busy === 'email' ? 'Sending…' : '✉ Email report'}
          </button>
          <button
            className="btn-ghost"
            disabled={!report || busy !== null}
            onClick={() => void handleSendToAdvisers()}
            title="Email each section adviser their section's per-student report (advisers & emails managed in the Sections tab)"
          >
            {busy === 'advisers' ? 'Sending…' : '👥 Send to advisers'}
          </button>
        </div>
      </div>

      <div className="toolbar">
        {type !== 'sf1' && (
          <>
            <label className="report-range-label text-dim">
              From
              <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); }} />
            </label>
            <label className="report-range-label text-dim">
              To
              <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); }} />
            </label>
            <button className="btn-ghost" onClick={() => { setFrom(fmtDayOffset(6)); setTo(fmtDayOffset(0)); }} title="Reset to last 7 days">
              ↺ Last 7 days
            </button>
            <span className="toolbar-divider" />
          </>
        )}
        <label className="report-range-label text-dim">
          Report
          <select value={type} onChange={(e) => setType(e.target.value as ReportType)}>
            {(Object.keys(TYPE_LABELS) as ReportType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="report-range-label text-dim">
          Section
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {report?.sections.map((s2) => (
              <option key={s2} value={s2}>{s2}</option>
            ))}
          </select>
        </label>
        {type === 'student' && (
          <label className="report-range-label text-dim">
            Student
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">— Select a student —</option>
              {pickableStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name} · {sectionOf(s.id) || 'No section'}</option>
              ))}
            </select>
          </label>
        )}
        <label className="switch-row report-mask">
          <span className="text-dim">Mask phones</span>
          <span className={`switch ${maskPhones ? 'on' : ''}`} onClick={() => setMaskPhones(!maskPhones)}>
            <span className="switch-knob" />
          </span>
        </label>
      </div>

      {error && <div className="report-error">⚠ {error}</div>}

      {!report && loading && <Spinner label="Building report…" />}

      {report && s && (
        <div className={loading ? 'report-loading' : undefined}>
          {type === 'summary' && <SummaryView report={report} onCardClick={openDrilldown} />}
          {type === 'register' && <RegisterView report={report} />}
          {type === 'per-student' && <PerStudentView report={report} />}
          {type === 'per-section' && <PerSectionView report={report} />}
          {type === 'student' && <StudentView report={report} />}
          {type === 'absentee' && <AbsenteeView report={report} />}
          {type === 'tardiness' && <TardinessView report={report} />}
          {type === 'sms-audit' && <SmsAuditView report={report} />}
          {type === 'trends' && <TrendsView report={report} />}
          {type === 'sf1' && <Sf1View report={report} />}
        </div>
      )}

      {drill && report && (
        <Modal title={DRILL_META[drill].title} onClose={() => setDrill(null)} wide>
          <p className="text-dim" style={{ marginTop: 0 }}>
            {DRILL_META[drill].subtitle} · {report.from} → {report.to}
            {section ? ` · ${section}` : ''}
            {year ? ` · ${year}` : ''}
          </p>
          {drill === 'ada' ? (
            <DailyDrillTable report={report} />
          ) : drillLoading ? (
            <Spinner label="Loading…" />
          ) : drillError ? (
            <div className="report-error">⚠ {drillError}</div>
          ) : drillRows && drillRows.length === 0 ? (
            <div className="report-empty">
              No students for this metric in the selected range.{' '}
              Try widening the date range or clearing the section filter.
            </div>
          ) : drillRows ? (
            <>
              <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                {drillRows.length} student{drillRows.length === 1 ? '' : 's'}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {DRILL_COLUMNS[drill].map((c) => (
                        <th key={c.label} className={c.className}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drillRows.map((r) => (
                      <tr key={r.studentId}>
                        {DRILL_COLUMNS[drill].map((c, i) => (
                          <td key={i} className={c.className}>{c.render(r)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </Modal>
      )}

      {sendResult && (
        <Modal title="Adviser report delivery" onClose={() => setSendResult(null)} wide>
          <p className="text-dim">{sendResult.message}</p>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>Section</th><th>Adviser</th><th>Email</th><th>Result</th></tr>
              </thead>
              <tbody>
                {sendResult.details.map((d) => (
                  <tr key={d.gradeSection}>
                    <td>{d.gradeSection}</td>
                    <td>{d.adviserName || '—'}</td>
                    <td className="mono">{d.email}</td>
                    <td>
                      {d.ok ? (
                        <span className="pill pill-success">SENT</span>
                      ) : (
                        <span className="pill pill-danger">FAILED</span>
                      )}
                      <span className="text-dim" style={{ marginLeft: 8, wordBreak: 'break-word' }}>{d.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ marginTop: 14 }}>
            <button className="btn-primary" onClick={() => setSendResult(null)}>Close</button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
