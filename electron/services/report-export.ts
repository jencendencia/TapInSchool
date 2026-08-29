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
  student: 'Student Record',
  sf1: 'School Register (SF1)',
};

export async function buildReportWorkbook(report: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.schoolName || 'TapIn School';
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
    headerRow(ws, headerRowIdx, ['Day', 'Scans', 'AM IN', 'AM OUT', 'PM IN', 'PM OUT', 'AM Late', 'AM Early', 'PM Late', 'PM Early', 'AM Absent', 'PM Absent', 'Present'], [true]);
    const dataRows = report.daily.map((d) => [d.day, d.scans, d.morningIn, d.morningOut, d.afternoonIn, d.afternoonOut, d.amLate, d.amEarly, d.pmLate, d.pmEarly, d.amAbsent, d.pmAbsent, d.present]);
    const end = bodyRows(ws, headerRowIdx + 1, dataRows, [true]);
    const totals = ['TOTAL', s.scans, '', '', '', '', '', '', '', '', '', '', ''];
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
    const colCount = 15;
    const widths = [22, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    for (let c = 1; c <= colCount; c++) ws.getColumn(c).width = widths[c - 1];
    banner(ws, report, 'Per-Section Rollup', colCount);
    const headerRowIdx = 5;
    headerRow(ws, headerRowIdx, ['Section', 'Enrolled', 'Present AM', 'Present PM', 'Absent AM', 'Absent PM', 'Late AM', 'Late PM', 'Early AM', 'Early PM', 'Rate', 'IN AM', 'IN PM', 'OUT AM', 'OUT PM'], [true]);
    const rows = report.perSection.map((r) => [
      r.gradeSection, r.enrolled, r.presentAm, r.presentPm, r.absentAm, r.absentPm,
      r.lateAm, r.latePm, r.earlyAm, r.earlyPm, pct(r.attendanceRate),
      r.totalInAm, r.totalInPm, r.totalOutAm, r.totalOutPm,
    ]);
    bodyRows(ws, headerRowIdx + 1, rows, [true]);
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  } else if (report.type === 'register') {
    const days = report.register.days;
    // 4 columns per day: AM IN, AM OUT, PM IN, PM OUT
    const colCount = 2 + days.length * 4;
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 16;
    days.forEach((_, i) => {
      ws.getColumn(3 + i * 4).width = 8;   // AM IN
      ws.getColumn(4 + i * 4).width = 8;   // AM OUT
      ws.getColumn(5 + i * 4).width = 8;   // PM IN
      ws.getColumn(6 + i * 4).width = 8;   // PM OUT
    });
    banner(ws, report, `Daily Register${report.register.capped ? ' (last 35 days)' : ''}`, colCount);
    const headerRowIdx = 5;
    // Row 1: Student | Section | day labels (colspan 4)
    const headers1 = ['Student', 'Section'];
    for (const d of days) {
      headers1.push((d || '—').slice(5).replace('-', '/'), '', '', '');
    }
    headerRow(ws, headerRowIdx, headers1, [true, true, ...days.map(() => false).flatMap(() => [false, false, false, false])]);
    // Merge day label cells
    for (let i = 0; i < days.length; i++) {
      ws.mergeCells(headerRowIdx, 3 + i * 4, headerRowIdx, 6 + i * 4);
    }
    // Row 2: AM IN | AM OUT | PM IN | PM OUT sub-headers
    const subRow = headerRowIdx + 1;
    ws.getCell(subRow, 1).value = '';
    ws.getCell(subRow, 1).border = border();
    ws.getCell(subRow, 2).value = '';
    ws.getCell(subRow, 2).border = border();
    for (let i = 0; i < days.length; i++) {
      for (let j = 0; j < 4; j++) {
        const c = ws.getCell(subRow, 3 + i * 4 + j);
        c.value = j < 2 ? `AM ${j === 0 ? 'IN' : 'OUT'}` : `PM ${j === 2 ? 'IN' : 'OUT'}`;
        c.font = { ...FONT, bold: true, size: 8, color: { argb: j < 2 ? 'FFD97706' : 'FF6366F1' } };
        c.alignment = { horizontal: 'center' };
        c.border = border();
      }
    }
    const byKey = new Map(report.register.rows.map((r) => [`${r.studentId}:${r.day}`, r] as const));
    let r = subRow + 1;
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
        const vals = row
          ? [row.morningIn ?? '—', row.morningOut ?? '—', row.afternoonIn ?? '—', row.afternoonOut ?? '—']
          : ['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'];
        vals.forEach((v, j) => {
          const c = ws.getCell(r, 3 + i * 4 + j);
          c.border = border();
          c.value = v;
          c.alignment = { horizontal: 'center' };
          if (!row) {
            c.font = { ...FONT, bold: true, color: { argb: 'FFB91C1C' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ABS_BG } };
          } else if ((j === 0 && row.amLate) || (j === 2 && row.pmLate)) {
            c.font = { ...FONT, bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LATE_BG } };
          } else if ((j === 1 && row.amEarly) || (j === 3 && row.pmEarly)) {
            c.font = { ...FONT, bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF38BDF8' } };
          } else {
            c.font = { ...FONT };
          }
        });
      });
      r++;
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: headerRowIdx + 1 }];
  } else if (report.type === 'absentee') {
    for (let c = 1; c <= 6; c++) ws.getColumn(c).width = [12, 24, 12, 12, 14, 9][c - 1];
    banner(ws, report, 'Absentee List', 6);
    let rowIdx = 5;
    const tHead = rowIdx;
    headerRow(ws, tHead, ['Student', 'Section', 'Absent AM', 'Absent PM', 'Phone'], [true, true, false, false, true]);
    rowIdx = bodyRows(
      ws,
      tHead + 1,
      report.absenteeTotals.map((a) => [a.fullName, a.gradeSection, a.daysAbsentAm, a.daysAbsentPm, a.parentPhone]),
      [true, true, false, false, true],
    );
    rowIdx += 2;
    const dHead = rowIdx;
    headerRow(ws, dHead, ['Day', 'Student', 'Section', 'Session', 'Phone', 'SMS sent'], [true, true, true, true]);
    bodyRows(
      ws,
      dHead + 1,
      report.absentee.map((a) => [a.day, a.fullName, a.gradeSection, a.session === 'FULL' ? 'Full day' : a.session === 'AM' ? 'AM' : 'PM', a.parentPhone, a.smsSent ? 'Yes' : 'No']),
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
  } else if (report.type === 'student') {
    const rec = report.studentRecord;
    for (let c = 1; c <= 8; c++) ws.getColumn(c).width = [16, 14, 12, 10, 10, 9, 9, 10][c - 1];
    banner(ws, report, 'Student Attendance Record', 8);
    if (!rec) {
      headerRow(ws, 5, ['No student selected']);
      ws.views = [{ state: 'frozen', ySplit: 5 }];
    } else {
      let rowIdx = pairGrid(ws, 5, [
        ['Student', rec.fullName], ['Student No', rec.studentNo],
        ['Section', rec.gradeSection], ['Phone', rec.parentPhone],
        ['Present days', rec.summary.daysPresent], ['Late days', rec.summary.daysLate],
        ['Absent days', rec.summary.daysAbsent], ['Attendance rate', pct(rec.summary.attendanceRate)],
        ['Total IN', rec.summary.totalIn], ['Total OUT', rec.summary.totalOut],
        ['Minutes late', rec.summary.totalMinutesLate], ['SMS sent', rec.summary.smsCount],
        ['Last SMS', rec.summary.lastSmsStatus ?? '—'],
      ]);
      rowIdx += 2;
      const dHead = rowIdx;
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      headerRow(ws, dHead, ['Day', 'Weekday', 'Status', 'AM IN', 'AM OUT', 'PM IN', 'PM OUT', 'Late', 'Early', 'Scans'], [true]);
      rowIdx = bodyRows(
        ws,
        dHead + 1,
        rec.days.map((d) => {
          const status = !d.present ? (d.schoolDay ? 'ABSENT' : '—') : d.late ? 'LATE' : 'PRESENT';
          return [d.day, dow[new Date(d.day + 'T00:00:00').getDay()], status,
            d.morningIn ?? '—', d.morningOut ?? '—',
            d.afternoonIn ?? '—', d.afternoonOut ?? '—',
            d.late ? 'YES' : '', d.early ? 'YES' : '', d.scans.length];
        }),
        [true],
      );
      rowIdx += 2;
      const sHead = rowIdx;
      headerRow(ws, sHead, ['Date', 'Time', 'Type', 'Flag', 'Source'], [true]);
      bodyRows(
        ws,
        sHead + 1,
        rec.days.flatMap((d) => d.scans.map((s) => [d.day, s.time, s.entryType, s.flag || '—', s.source])),
        [true],
      );
      ws.views = [{ state: 'frozen', ySplit: dHead }];
    }
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
  } else if (report.type === 'sf1') {
    for (let c = 1; c <= 9; c++) ws.getColumn(c).width = [6, 16, 28, 6, 12, 30, 24, 16, 12][c - 1];
    banner(ws, report, 'School Register (SF1)', 9);
    let rowIdx = 5;
    for (const g of report.schoolRegister) {
      // Section group banner row.
      const secRow = ws.getRow(rowIdx);
      secRow.height = 22;
      ws.mergeCells(rowIdx, 1, rowIdx, 9);
      const sc = ws.getCell(rowIdx, 1);
      sc.value = `Grade Level & Section: ${g.gradeSection}`;
      sc.font = { ...FONT, bold: true };
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      sc.alignment = { horizontal: 'left' };
      sc.border = border();
      rowIdx++;
      const hHead = rowIdx;
      headerRow(ws, hHead, ['No.', 'LRN', "LEARNER'S NAME (Last Name, First Name, Middle Name)", 'Sex', 'Birthdate', 'Address (Home)', 'Guardian', 'Contact No.', 'Remarks'], [false, false, true, false, false, true, true, false, false]);
      rowIdx = bodyRows(
        ws,
        hHead + 1,
        g.rows.map((r, i) => [i + 1, r.lrn || r.studentNo, r.fullName, r.sex, '', r.address, r.guardian, r.contact, '']),
        [false, false, true, false, false, true, true, false, false],
      );
      // Section totals row.
      const total = g.male + g.female;
      const t = ws.getCell(rowIdx, 1);
      t.value = `MALE: ${g.male} · FEMALE: ${g.female} · TOTAL: ${total}`;
      t.font = { ...FONT, bold: true };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      t.alignment = { horizontal: 'left' };
      for (let c = 2; c <= 9; c++) {
        const cc = ws.getCell(rowIdx, c);
        cc.border = border();
        cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      }
      rowIdx += 2;
    }
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
