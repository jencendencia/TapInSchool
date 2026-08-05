// Self-contained HTML document for the attendance report. Used by the Electron
// main process (hidden-window printToPDF) and the browser-demo mock (iframe
// print). Deliberately dependency-free and styled inline so the printed output
// never depends on the app's CSS or media queries.
import type { ReportData, RegisterRow } from './types';

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

function stdTable(headers: string[], rows: string[][], alignFirstLeft = true): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map(
      (r, i) =>
        `<tr class="${i % 2 === 1 ? 'alt' : ''}">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table class="${alignFirstLeft ? 'left1' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Renders the SF2-style register matrix (rows = students, cols = days). */
function registerTable(report: ReportData): string {
  const { register, cutoffs } = report;
  if (!register.days.length) {
    return '<table><tbody><tr><td class="empty">No scans in the selected window.</td></tr></tbody></table>';
  }
  const lateCutoff = cutoffs.late;
  const dayLabel = (day: string) => (day || '—').slice(5).replace('-', '/'); // MM/DD
  const cellFor = (row: RegisterRow | undefined): string => {
    if (!row) return '<td class="abs">A</td>';
    const late = lateCutoff && row.firstIn ? row.firstIn > lateCutoff : false;
    const inTxt = row.firstIn ? (late ? `${esc(row.firstIn)}*` : esc(row.firstIn)) : '—';
    const outTxt = row.lastOut ? esc(row.lastOut) : '—';
    return `<td class="${late ? 'late' : ''}">${inTxt}/${outTxt}</td>`;
  };
  const byKey = new Map(register.rows.map((r) => [`${r.studentId}:${r.day}`, r] as const));
  const body = register.students
    .map((s) => {
      const cells = register.days.map((d) => cellFor(byKey.get(`${s.studentId}:${d}`))).join('');
      return `<tr><td class="name">${esc(s.fullName)}<br><span class="sub">${esc(s.studentNo)} · ${esc(s.gradeSection)}</span></td>${cells}</tr>`;
    })
    .join('');
  const head = `<th class="name">Student</th>${register.days.map((d) => `<th class="day">${dayLabel(d)}</th>`).join('')}`;
  return `<table class="register left1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const TYPE_TITLES: Record<ReportData['type'], string> = {
  summary: 'Attendance Summary',
  register: 'Daily Register (SF2-style)',
  'per-student': 'Per-Student Summary',
  'per-section': 'Per-Section Rollup',
  absentee: 'Absentee List',
  tardiness: 'Tardiness Detail',
  'sms-audit': 'SMS Audit',
  trends: 'Attendance Trends',
  student: 'Student Attendance Record',
};

export function buildReportHtml(report: ReportData): string {
  const s = report.summary;
  const landscape = report.type === 'register';
  const pageSize = landscape ? 'A4 landscape' : 'A4';
  const margin = landscape ? '9mm 8mm' : '14mm 12mm';
  const sectionNote = report.section ? ` · Section: ${esc(report.section)}` : '';
  const yearNote = report.schoolYear ? ` · School year: ${esc(report.schoolYear)}` : '';
  const phoneNote = report.maskPhones ? ' · Phones masked' : '';

  let body = '';
  if (report.type === 'summary') {
    const rows = report.daily.map(
      (d) =>
        `<tr><td>${esc(d.day)}</td><td>${d.scans}</td><td>${d.in}</td><td>${d.out}</td><td>${d.late}</td><td>${d.early}</td><td>${d.absent}</td><td>${d.present}</td></tr>`,
    );
    const totals =
      report.daily.length > 0
        ? `<tr class="total"><td>TOTAL</td><td>${s.scans}</td><td>${s.in}</td><td>${s.out}</td><td>${s.late}</td><td>${s.early}</td><td>${s.absent}</td><td></td></tr>`
        : '';
    const empty = report.daily.length === 0 ? '<tr><td colspan="8" class="empty">No data in the selected range.</td></tr>' : '';
    body = `
  <table class="summary">
    <tr><td>Total scans</td><td>${s.scans}</td><td>Checked IN</td><td>${s.in}</td><td>Checked OUT</td><td>${s.out}</td></tr>
    <tr><td>Late arrivals</td><td>${s.late}</td><td>Early departures</td><td>${s.early}</td><td>Absent (records)</td><td>${s.absent}</td></tr>
    <tr><td>Students present</td><td>${s.present}</td><td>SMS sent</td><td>${s.smsSent}</td><td>Days</td><td>${s.days}</td></tr>
  </table>
  <table class="summary">
    <tr><td>School days (gate used)</td><td>${s.schoolDays}</td><td>Active students</td><td>${s.activeStudents}</td><td>Attendance rate</td><td>${pct(s.attendanceRate)}</td></tr>
    <tr><td>Average daily attendance</td><td>${s.ada === null ? '—' : s.ada.toFixed(1)}</td><td>On-time IN</td><td>${s.onTime} (${pct(s.onTimePct)})</td><td>Late IN</td><td>${s.late} (${pct(s.latePct)})</td></tr>
    <tr><td>At-risk students (&lt;80%)</td><td>${s.atRiskCount}</td><td colspan="4"></td></tr>
  </table>
  <table class="left1">
    <thead><tr><th>Day</th><th>Scans</th><th>IN</th><th>OUT</th><th>Late</th><th>Early</th><th>Absent</th><th>Present</th></tr></thead>
    <tbody>${rows}${totals}${empty}</tbody>
  </table>`;
  } else if (report.type === 'per-student') {
    const rows = report.perStudent.map((r) => [
      esc(r.fullName),
      esc(r.gradeSection),
      String(r.daysPresent),
      String(r.daysLate),
      String(r.daysAbsent),
      pct(r.attendanceRate),
      String(r.totalIn),
      String(r.totalOut),
      String(r.totalMinutesLate),
      String(r.smsCount),
      r.lastSmsStatus ?? '—',
      esc(r.parentPhone),
    ]);
    body = stdTable(
      ['Student', 'Section', 'Present', 'Late', 'Absent', 'Rate', 'IN', 'OUT', 'Min late', 'SMS', 'Last SMS', 'Phone'],
      rows,
    );
  } else if (report.type === 'per-section') {
    const rows = report.perSection.map((r) => [
      esc(r.gradeSection),
      String(r.enrolled),
      String(r.present),
      String(r.absent),
      String(r.late),
      String(r.early),
      pct(r.attendanceRate),
    ]);
    body = stdTable(['Section', 'Enrolled', 'Present', 'Absent', 'Late', 'Early', 'Rate'], rows);
  } else if (report.type === 'register') {
    body = registerTable(report);
    body += `<p class="legend">* = late arrival · A = absent (no scan) · IN/OUT times shown as HH:MM. ` +
      `Window: ${report.register.windowFrom} → ${report.register.windowTo}${report.register.capped ? ' (capped at 35 days)' : ''}.</p>`;
  } else if (report.type === 'absentee') {
    const totalRows = report.absenteeTotals.map((r) => [
      esc(r.fullName),
      esc(r.gradeSection),
      String(r.daysAbsent),
      esc(r.parentPhone),
    ]);
    const rows = report.absentee.map((r) => [
      esc(r.day),
      esc(r.fullName),
      esc(r.gradeSection),
      esc(r.parentPhone),
      r.smsSent ? 'Yes' : 'No',
    ]);
    body =
      `<h3>Absent days per student</h3>` +
      stdTable(['Student', 'Section', 'Days absent', 'Phone'], totalRows) +
      `<h3>Absence records (day by day)</h3>` +
      stdTable(['Day', 'Student', 'Section', 'Phone', 'SMS sent'], rows);
  } else if (report.type === 'tardiness') {
    const freqRows = report.tardinessFrequency.map((r) => [
      esc(r.fullName),
      esc(r.gradeSection),
      String(r.lateCount),
    ]);
    const rows = report.tardiness.map((r) => [
      esc(r.day),
      esc(r.scannedTime),
      esc(r.fullName),
      esc(r.gradeSection),
      `${r.minutesLate} min`,
      esc(r.parentPhone),
    ]);
    body =
      `<h3>Late frequency (per student)</h3>` +
      stdTable(['Student', 'Section', 'Times late'], freqRows) +
      `<h3>Tardiness records (every flagged-late arrival)</h3>` +
      stdTable(['Day', 'Time', 'Student', 'Section', 'Minutes late', 'Phone'], rows);
  } else if (report.type === 'sms-audit') {
    const dailyRows = report.smsAudit.daily.map((d) => [
      esc(d.day),
      String(d.sent),
      String(d.pending),
      String(d.failed),
      String(d.total),
    ]);
    const failureRows = report.smsAudit.failures.map((f) => [
      esc(f.createdAt),
      esc(f.fullName ?? '—'),
      esc(f.parentPhone),
      esc(f.provider ?? '—'),
      String(f.attempts),
      esc(f.error ?? '—'),
    ]);
    body =
      `<h3>Daily delivery</h3>` +
      stdTable(['Day', 'Sent', 'Pending', 'Failed', 'Total'], dailyRows) +
      `<h3>Failed messages (most recent)</h3>` +
      stdTable(['Sent at', 'Student', 'Phone', 'Provider', 'Attempts', 'Error'], failureRows);
  } else if (report.type === 'student') {
    const rec = report.studentRecord;
    if (!rec) {
      body = '<p class="empty">No student selected — pick one from the report toolbar to generate their record.</p>';
    } else {
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      body =
        `<table class="summary">` +
        `<tr><td>Student</td><td>${esc(rec.fullName)}</td><td>Student No</td><td>${esc(rec.studentNo)}</td></tr>` +
        `<tr><td>Section</td><td>${esc(rec.gradeSection)}</td><td>Phone</td><td>${esc(rec.parentPhone)}</td></tr>` +
        `</table>` +
        `<table class="summary">` +
        `<tr><td>Present days</td><td>${rec.summary.daysPresent}</td><td>Late days</td><td>${rec.summary.daysLate}</td><td>Absent days</td><td>${rec.summary.daysAbsent}</td></tr>` +
        `<tr><td>Attendance rate</td><td>${pct(rec.summary.attendanceRate)}</td><td>Total IN</td><td>${rec.summary.totalIn}</td><td>Total OUT</td><td>${rec.summary.totalOut}</td></tr>` +
        `<tr><td>Minutes late</td><td>${rec.summary.totalMinutesLate}</td><td>SMS sent</td><td>${rec.summary.smsCount}</td><td>Last SMS</td><td>${esc(rec.summary.lastSmsStatus ?? '—')}</td></tr>` +
        `</table>` +
        `<h3>Day by day</h3>` +
        `<table class="left1">` +
        `<thead><tr><th>Day</th><th>Weekday</th><th>Status</th><th>IN</th><th>OUT</th><th>Late</th><th>Early</th><th>Scans</th></tr></thead>` +
        `<tbody>` +
        rec.days
          .map((d, i) => {
            const status = !d.present
              ? d.schoolDay
                ? 'ABSENT'
                : '—'
              : d.late
                ? 'LATE'
                : 'PRESENT';
            const cls = d.present && d.late ? 'late' : !d.present && d.schoolDay ? 'abs' : i % 2 === 1 ? 'alt' : '';
            return `<tr class="${cls}"><td>${esc(d.day)}</td><td>${dow[new Date(d.day + 'T00:00:00').getDay()]}</td>` +
              `<td>${status}</td><td>${esc(d.firstIn ?? '—')}</td><td>${esc(d.lastOut ?? '—')}</td>` +
              `<td>${d.late ? '✓' : '—'}</td><td>${d.early ? '✓' : '—'}</td><td>${d.scans.length}</td></tr>`;
          })
          .join('') +
        `</tbody></table>`;
      const scanRows = rec.days.flatMap((d) =>
        d.scans.map((s) => [esc(d.day), esc(s.time), esc(s.entryType), s.flag === 'LATE' || s.flag === 'EARLY' ? esc(s.flag) : '—', esc(s.source)]),
      );
      body +=
        `<h3>All scans</h3>` +
        stdTable(['Date', 'Time', 'Type', 'Flag', 'Source'], scanRows, true);
    }
  } else if (report.type === 'trends') {
    const weeklyRows = report.trends.weekly.map((w) => [
      esc(w.weekStart),
      String(w.days),
      String(w.presentDays),
      pct(w.attendanceRate),
    ]);
    const dowRows = report.trends.dayOfWeek.map((d) => [
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday],
      String(d.days),
      pct(d.attendanceRate),
    ]);
    const hourRows = report.trends.gateHours.map((h) => [
      `${String(h.hour).padStart(2, '0')}:00`,
      String(h.in),
      String(h.out),
    ]);
    body =
      `<h3>Weekly attendance</h3>` +
      stdTable(['Week (Mon)', 'Days', 'Present-days', 'Rate'], weeklyRows) +
      `<h3>Day of week</h3>` +
      stdTable(['Day', 'Days', 'Rate'], dowRows) +
      `<h3>Scans by hour</h3>` +
      stdTable(['Hour', 'IN', 'OUT'], hourRows);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(report.schoolName)} — ${esc(TYPE_TITLES[report.type])}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; }
  @page { size: ${pageSize}; margin: ${margin}; }
  .banner { background: #0f172a; color: #fff; padding: 20px 24px; border-radius: 6px; }
  .banner h1 { margin: 0; font-size: 22px; }
  .banner h2 { margin: 3px 0 0; font-size: 13px; color: #94a3b8; font-weight: 600; letter-spacing: 0.04em; }
  .meta { font-size: 11px; color: #64748b; margin: 12px 2px 0; }
  h3 { font-size: 13px; margin: 14px 2px 2px; color: #334155; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 11px; text-align: center; }
  th { background: #1e293b; color: #fff; font-weight: 700; }
  td.name, th.name { text-align: left; }
  .left1 td:first-child, .left1 th:first-child { text-align: left; }
  .sub { color: #64748b; font-size: 9px; font-weight: 400; }
  .alt td { background: #f8fafc; }
  .summary td { background: #f1f5f9; font-weight: 600; }
  .summary td:nth-child(odd) { text-align: left; color: #334155; }
  .total td { background: #e2e8f0; font-weight: 700; }
  tr.late td { background: #fef3c7; color: #92400e; font-weight: 700; }
  tr.abs td { background: #fee2e2; color: #b91c1c; font-weight: 700; }
  .empty { color: #64748b; padding: 18px !important; }
  .foot { font-size: 9.5px; color: #94a3b8; margin: 4px 2px 0; }
  .legend { font-size: 9px; color: #64748b; }
  /* Register matrix */
  table.register th.day { font-size: 8px; padding: 3px 2px; min-width: 26px; }
  table.register td { font-size: 7.5px; padding: 3px 2px; white-space: nowrap; }
  table.register td.name { min-width: 130px; white-space: normal; }
  table.register td.late { background: #fef3c7; color: #92400e; font-weight: 700; }
  table.register td.abs { background: #fee2e2; color: #b91c1c; font-weight: 700; }
</style>
</head>
<body>
  <div class="banner"><h1>${esc(report.schoolName)}</h1><h2>${esc(TYPE_TITLES[report.type])}</h2></div>
  <p class="meta">Period: ${esc(report.from)} → ${esc(report.to)} · Generated ${esc(new Date(report.generatedAt).toLocaleString())}${yearNote}${sectionNote}${phoneNote}</p>
  ${body}
  <p class="foot">Generated by TapIn School · Gate Attendance &amp; Parent Alerts</p>
</body>
</html>`;
}
