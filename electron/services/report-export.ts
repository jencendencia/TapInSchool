// Styled .xlsx export for the Reports tab (P1 6.1). Uses exceljs — pure JS,
// no native bindings — to produce a real formatted workbook for every report
// type: school title banner, a summary grid, and a bordered data table with a
// frozen header. Kept in the main process because the renderer is sandboxed.
import ExcelJS from 'exceljs';
import type { ReportData } from '../../shared/types';

const TITLE_BG = 'FF0F172A';
const HEADER_BG = 'FF1E293B';
const LABEL_BG = 'FFF1F5F9';
const ALT_BG = 'FFF8FAFC';
const LATE_BG = 'FFFEF3C7';
const ABS_BG = 'FFFEE2E2';
const BORDER_COLOR = 'FFCBD5E1';
const TEXT = 'FF0F172A';
const MUTED = 'FF64748B';
const WHITE = 'FFFFFFFF';

function border() {
  return {
    top: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    left: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    bottom: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    right: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
  };
}

const FONT = { name: 'Calibri', size: 11, color: { argb: TEXT } } as const;

function cell(ws: ExcelJS.Worksheet, row: number, col: number, value: string | number) {
  const c = ws.getCell(row, col);
  c.value = value;
  c.font = { ...FONT };
  c.alignment = { horizontal: 'center' };
  c.border = border();
  return c;
}

function banner(ws: ExcelJS.Worksheet, report: ReportData, title: string, lastCol: number): void {
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = report.schoolName;
  t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: WHITE } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 34;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = title;
  sub.font = { name: 'Calibri', size: 13, bold: true, color: { argb: TEXT } };
  sub.alignment = { horizontal: 'center' };

  ws.mergeCells(3, 1, 3, lastCol);
  const period = ws.getCell(3, 1);
  const section = report.section ? `    ·    Section: ${report.section}` : '';
  const masked = report.maskPhones ? '    ·    Phones masked' : '';
  period.value = `Period: ${report.from}  —  ${report.to}    ·    Generated ${new Date(report.generatedAt).toLocaleString()}${section}${masked}`;
  period.font = { name: 'Calibri', size: 10, italic: true, color: { argb: MUTED } };
  period.alignment = { horizontal: 'center' };
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[], leftAligned: boolean[] = []): void {
  headers.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    c.alignment = { horizontal: leftAligned[i] ? 'left' : 'center', vertical: 'middle' };
    c.border = border();
  });
  ws.getRow(row).height = 24;
}

function bodyRows(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rows: (string | number)[][],
  leftAligned: boolean[] = [],
): number {
  let r = startRow;
  for (const values of rows) {
    values.forEach((v, i) => {
      const c = cell(ws, r, i + 1, v);
      c.alignment = { horizontal: leftAligned[i] ? 'left' : 'center' };
      if (r % 2 === 0) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_BG } };
    });
    ws.getRow(r).height = 20;
    r++;
  }
  return r;
}

function pairGrid(ws: ExcelJS.Worksheet, startRow: number, pairs: [string, string | number][]): number {
  let rowIdx = startRow;
  for (let i = 0; i < pairs.length; i += 2) {
    const row = ws.getRow(rowIdx);
    row.height = 22;
    const l1 = ws.getCell(rowIdx, 1);
    l1.value = pairs[i][0];
    l1.font = { ...FONT, bold: true };
    l1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
    l1.border = border();
    const v1 = ws.getCell(rowIdx, 2);
    v1.value = pairs[i][1];
    v1.font = { ...FONT, bold: true };
    v1.alignment = { horizontal: 'center' };
    v1.border = border();
    if (pairs[i + 1]) {
      const l2 = ws.getCell(rowIdx, 4);
      l2.value = pairs[i + 1][0];
      l2.font = { ...FONT, bold: true };
      l2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      l2.border = border();
      const v2 = ws.getCell(rowIdx, 5);
      v2.value = pairs[i + 1][1];
      v2.font = { ...FONT, bold: true };
      v2.alignment = { horizontal: 'center' };
      v2.border = border();
    }
    rowIdx++;
  }
  return rowIdx;
}

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

const TYPE_SHEETS: Record<ReportData['type'], string> = {
  summary: 'Summary',
  register: 'Daily Register',
  'per-student': 'Per-Student',
  'per-section': 'Per-Section',
  absentee: 'Absentee List',
  tardiness: 'Tardiness',
  'sms-audit': 'SMS Audit',
  trends: 'Trends',
};

export async function buildReportWorkbook(report: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TapIn School';
  const ws = wb.addWorksheet(TYPE_SHEETS[report.type] ?? 'Report');
  const s = report.summary;

  if (report.type === 'summary') {
    for (let c = 1; c <= 8; c++) ws.getColumn(c).width = c === 1 ? 16 : 10;
    banner(ws, report, 'Attendance Summary', 8);
    const pairs: [string, string | number][] = [
      ['Total scans', s.scans], ['Checked IN', s.in],
      ['Checked OUT', s.out], ['Late arrivals', s.late],
      ['Early departures', s.early], ['Absent (records)', s.absent],
      ['Students present', s.present], ['SMS sent', s.sms],
      ['School days', s.schoolDays], ['Active students', s.activeStudents],
      ['Attendance rate', pct(s.attendanceRate)], ['Avg daily attendance', s.ada === null ? '—' : s.ada.toFixed(1)],
      ['On-time IN', `${s.onTime} (${pct(s.onTimePct)})`], ['Late IN', `${s.late} (${pct(s.latePct)})`],
      ['At-risk (<80%)', s.atRiskCount],
    ];
    let rowIdx = pairGrid(ws, 5, pairs);
    rowIdx += 2;
    const headerRowIdx = rowIdx;
    headerRow(ws, headerRowIdx, ['Day', 'Scans', 'IN', 'OUT', 'Late', 'Early', 'Absent', 'Present'], [true]);
    const dataRows = report.daily.map((d) => [d.day, d.scans, d.in, d.out, d.late, d.early, d.absent, d.present]);
    const end = bodyRows(ws, headerRowIdx + 1, dataRows, [true]);
    const totals = ['TOTAL', s.scans, s.in, s.out, s.late, s.early, s.absent, ''];
    totals.forEach((v, i) => {
      const c = ws.getCell(end, i + 1);
      c.value = v;
      c.font = { ...FONT, bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      c.alignment = { horizontal: i === 0 ? 'left' : 'center' };
      c.border = border();
    });
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  } else if (report.type === 'per-student') {
    for (let c = 1; c <= 12; c++) ws.getColumn(c).width = [22, 16, 9, 8, 8, 10, 8, 8, 9, 8, 11, 14][c - 1];
    banner(ws, report, 'Per-Student Summary', 12);
    const headerRowIdx = 5;
    headerRow(ws, headerRowIdx, ['Student', 'Section', 'Present', 'Late', 'Absent', 'Rate', 'IN', 'OUT', 'Min late', 'SMS', 'Last SMS', 'Phone'], [true, true]);
    const rows = report.perStudent.map((r) => [
      r.fullName, r.gradeSection, r.daysPresent, r.daysLate, r.daysAbsent, pct(r.attendanceRate),
      r.totalIn, r.totalOut, r.totalMinutesLate, r.smsCount, r.lastSmsStatus ?? '—', r.parentPhone,
    ]);
    bodyRows(ws, headerRowIdx + 1, rows, [true, true, false, false, false, false, false, false, false, false, false, true]);
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  } else if (report.type === 'per-section') {
    for (let c = 1; c <= 7; c++) ws.getColumn(c).width = [22, 10, 10, 10, 10, 10, 10][c - 1];
    banner(ws, report, 'Per-Section Rollup', 7);
    const headerRowIdx = 5;
    headerRow(ws, headerRowIdx, ['Section', 'Enrolled', 'Present', 'Absent', 'Late', 'Early', 'Rate'], [true]);
    const rows = report.perSection.map((r) => [
      r.gradeSection, r.enrolled, r.present, r.absent, r.late, r.early, pct(r.attendanceRate),
    ]);
    bodyRows(ws, headerRowIdx + 1, rows, [true]);
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  } else if (report.type === 'register') {
    const days = report.register.days;
    const colCount = 2 + days.length;
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 16;
    days.forEach((_, i) => (ws.getColumn(3 + i).width = 11));
    banner(ws, report, `Daily Register${report.register.capped ? ' (last 35 days)' : ''}`, colCount);
    const headerRowIdx = 5;
    const headers = ['Student', 'Section', ...days.map((d) => (d || '—').slice(5).replace('-', '/'))];
    const leftAligned = [true, true, ...days.map(() => false)];
    headerRow(ws, headerRowIdx, headers, leftAligned);
    const byKey = new Map(report.register.rows.map((r) => [`${r.studentId}:${r.day}`, r] as const));
    const lateCutoff = report.cutoffs.late;
    let r = headerRowIdx + 1;
    for (const st of report.register.students) {
      ws.getRow(r).height = 18;
      const nameC = ws.getCell(r, 1);
      nameC.value = st.fullName;
      nameC.font = { ...FONT };
      nameC.alignment = { horizontal: 'left' };
      nameC.border = border();
      const secC = ws.getCell(r, 2);
      secC.value = st.gradeSection;
      secC.font = { ...FONT };
      secC.border = border();
      days.forEach((d, i) => {
        const row = byKey.get(`${st.studentId}:${d}`);
        const c = ws.getCell(r, 3 + i);
        c.border = border();
        if (!row) {
          c.value = 'ABSENT';
          c.font = { ...FONT, bold: true, color: { argb: 'FFB91C1C' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ABS_BG } };
        } else {
          const late = lateCutoff && row.firstIn ? row.firstIn > lateCutoff : false;
          c.value = `${row.firstIn ?? '—'}/${row.lastOut ?? '—'}${late ? ' *' : ''}`;
          c.font = { ...FONT, bold: late };
          if (late) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LATE_BG } };
        }
        c.alignment = { horizontal: 'center' };
      });
      r++;
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: headerRowIdx }];
  } else if (report.type === 'absentee') {
    for (let c = 1; c <= 5; c++) ws.getColumn(c).width = [12, 24, 16, 14, 9][c - 1];
    banner(ws, report, 'Absentee List', 5);
    let rowIdx = 5;
    const tHead = rowIdx;
    headerRow(ws, tHead, ['Student', 'Section', 'Days absent', 'Phone'], [true, true, false, true]);
    rowIdx = bodyRows(
      ws,
      tHead + 1,
      report.absenteeTotals.map((a) => [a.fullName, a.gradeSection, a.daysAbsent, a.parentPhone]),
      [true, true, false, true],
    );
    rowIdx += 2;
    const dHead = rowIdx;
    headerRow(ws, dHead, ['Day', 'Student', 'Section', 'Phone', 'SMS sent'], [true, true, true, true]);
    bodyRows(
      ws,
      dHead + 1,
      report.absentee.map((a) => [a.day, a.fullName, a.gradeSection, a.parentPhone, a.smsSent ? 'Yes' : 'No']),
      [true, true, true, true],
    );
    ws.views = [{ state: 'frozen', ySplit: tHead }];
  } else if (report.type === 'tardiness') {
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = [12, 9, 24, 16, 12, 14][c - 1];
    banner(ws, report, 'Tardiness Detail', 6);
    let rowIdx = 5;
    const fHead = rowIdx;
    headerRow(ws, fHead, ['Student', 'Section', 'Times late'], [true, true]);
    rowIdx = bodyRows(
      ws,
      fHead + 1,
      report.tardinessFrequency.map((t) => [t.fullName, t.gradeSection, t.lateCount]),
      [true, true],
    );
    rowIdx += 2;
    const dHead = rowIdx;
    headerRow(ws, dHead, ['Day', 'Time', 'Student', 'Section', 'Minutes late', 'Phone'], [true, true, true]);
    bodyRows(
      ws,
      dHead + 1,
      report.tardiness.map((t) => [t.day, t.scannedTime, t.fullName, t.gradeSection, `${t.minutesLate} min`, t.parentPhone]),
      [true, true, true],
    );
    ws.views = [{ state: 'frozen', ySplit: fHead }];
  } else if (report.type === 'sms-audit') {
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = [12, 9, 9, 9, 9, 16][c - 1];
    banner(ws, report, 'SMS Audit', 6);
    let rowIdx = 5;
    const dHead = rowIdx;
    headerRow(ws, dHead, ['Day', 'Sent', 'Pending', 'Failed', 'Total']);
    rowIdx = bodyRows(ws, dHead + 1, report.smsAudit.daily.map((d) => [d.day, d.sent, d.pending, d.failed, d.total]), [true]);
    rowIdx += 2;
    const fHead = rowIdx;
    headerRow(ws, fHead, ['Sent at', 'Student', 'Phone', 'Provider', 'Attempts', 'Error'], [true]);
    bodyRows(
      ws,
      fHead + 1,
      report.smsAudit.failures.map((f) => [f.createdAt, f.fullName ?? '—', f.parentPhone, f.provider ?? '—', f.attempts, f.error ?? '—']),
      [true, true, true, true, false, true],
    );
    ws.views = [{ state: 'frozen', ySplit: dHead }];
  } else if (report.type === 'trends') {
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = [12, 9, 12, 9, 9, 9][c - 1];
    banner(ws, report, 'Attendance Trends', 6);
    let rowIdx = 5;
    const wHead = rowIdx;
    headerRow(ws, wHead, ['Week (Mon)', 'Days', 'Present-days', 'Rate']);
    rowIdx = bodyRows(
      ws,
      wHead + 1,
      report.trends.weekly.map((w) => [w.weekStart, w.days, w.presentDays, pct(w.attendanceRate)]),
      [true],
    );
    rowIdx += 2;
    const dHead = rowIdx;
    headerRow(ws, dHead, ['Day', 'Days', 'Rate']);
    rowIdx = bodyRows(
      ws,
      dHead + 1,
      report.trends.dayOfWeek.map((d) => [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday], d.days, pct(d.attendanceRate)]),
      [true],
    );
    rowIdx += 2;
    const hHead = rowIdx;
    headerRow(ws, hHead, ['Hour', 'IN', 'OUT']);
    bodyRows(
      ws,
      hHead + 1,
      report.trends.gateHours.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.in, h.out]),
      [true],
    );
    ws.views = [{ state: 'frozen', ySplit: wHead }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
