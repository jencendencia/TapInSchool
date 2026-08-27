// Report export generators — pure, Electron-free (no dialogs, no windows, no fs).
// Used by:
//   - electron/services/export.ts  (desktop: pick a file, write it)
//   - server/index.ts              (portal: stream the bytes as a download)
// The renderer already has the report data; it passes the payload back and the
// caller turns it into a file.
import ExcelJS from 'exceljs';
import type { ReportData } from './teacher-types';

export interface Table {
  headers: string[];
  rows: (string | number)[][];
}

export function sanitize(name: string): string {
  return String(name ?? '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'report';
}

export function tableFor(data: ReportData): Table {
  switch (data.kind) {
    case 'section':
      return {
        headers: ['Student No', 'Full Name', 'Days Present', 'Days Late', 'Days Absent', 'Attendance %', 'Total IN', 'Total OUT', 'Minutes Late'],
        rows: data.rows.map((r) => [
          r.studentNo, r.fullName, r.daysPresent, r.daysLate, r.daysAbsent,
          r.attendanceRate === null ? '' : r.attendanceRate, r.totalIn, r.totalOut, r.totalMinutesLate,
        ]),
      };
    case 'per-section':
      return {
        headers: ['Section', 'Enrolled', 'Present', 'Absent', 'Late', 'Early', 'Attendance %'],
        rows: data.rows.map((r) => [
          r.gradeSection, r.enrolled, r.present, r.absent, r.late, r.early,
          r.attendanceRate === null ? '' : r.attendanceRate,
        ]),
      };
    case 'absentee':
      return {
        headers: ['Student No', 'Full Name', 'Absent Date'],
        rows: data.rows.map((r) => [r.studentNo, r.fullName, r.day]),
      };
    case 'tardiness':
      return {
        headers: ['Student No', 'Full Name', 'Date', 'Scan Time', 'Minutes Late'],
        rows: data.rows.map((r) => [r.studentNo, r.fullName, r.day, r.scannedTime, r.minutesLate]),
      };
    case 'register':
      // DepEd SF2 matrix: one learner per row, one column per school day,
      // with the official marks (blank present, x absent, L tardy).
      return {
        headers: [
          'LRN', 'NAME (Last Name, First Name, Middle Name)',
          ...data.days.map((d) => String(Number(d.slice(8)))),
          'ABSENT', 'TARDY',
        ],
        rows: data.rows.map((r) => [
          r.lrn || r.studentNo, r.fullName,
          ...r.marks.map((m) => (m === 'X' || m === 'E' ? 'x' : m === 'L' ? 'L' : '')),
          r.daysAbsent + r.daysExcused, r.daysLate,
        ]),
      };
    case 'sf1':
      // DepEd SF1 School Register columns.
      return {
        headers: ['No.', 'LRN', "LEARNER'S NAME (Last Name, First Name, Middle Name)", 'Sex', 'Birthdate', 'Address (Home)', 'Guardian', 'Contact No.', 'Remarks'],
        rows: data.rows.map((r, i) => [
          i + 1, r.lrn || r.studentNo, r.fullName, r.sex, '', r.address, r.guardian, r.contact, '',
        ]),
      };
  }
}

export function defaultFileName(data: ReportData, ext: string, schoolName?: string): string {
  const section = 'section' in data ? data.section : 'all';
  const school = schoolName || ('schoolName' in data && data.schoolName ? data.schoolName : '');
  const prefix = school ? `${sanitize(school)}-` : '';
  if (data.kind === 'sf1') return `${prefix}sf1-${sanitize(section)}-${sanitize(data.schoolYear)}.${ext}`;
  return `${prefix}${data.kind}-${sanitize(section)}-${data.from}_${data.to}.${ext}`;
}

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full CSV document (headers + rows), ready to write or stream. */
export function csvText(data: ReportData): string {
  const table = tableFor(data);
  const lines = [table.headers.map(csvEscape).join(','), ...table.rows.map((r) => r.map(csvEscape).join(','))];
  return lines.join('\n');
}

/** Excel workbook bytes (exceljs) — works in plain Node and in the browser. */
export async function xlsxBuffer(data: ReportData): Promise<Buffer> {
  const table = tableFor(data);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sanitize(data.kind));
  sheet.addRow(table.headers);
  sheet.getRow(1).font = { bold: true };
  for (const r of table.rows) sheet.addRow(r);
  sheet.columns.forEach((col, i) => {
    const max = Math.max(
      ...table.headers.map((h) => h.length),
      ...table.rows.map((r) => String(r[i] ?? '').length),
    );
    col.width = Math.min(48, Math.max(10, max + 2));
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Standalone print-ready HTML report (Electron prints it to PDF via a hidden
 *  window; the portal streams it to a browser tab for print/save-as-PDF).
 *  Every report gets the DepEd letterhead; the register (SF2) report renders
 *  as the official daily-attendance form (letterhead, day matrix, per-day
 *  totals, legend, signature block) in landscape. `meta` supplies the school
 *  name/year when the report payload doesn't already carry them (all kinds
 *  except register). */
export function pdfHtml(data: ReportData, meta?: { schoolName?: string; schoolYear?: string }): string {
  if (data.kind === 'register') return sf2Html(data);
  if (data.kind === 'sf1') return sf1Html(data);
  const titles: Record<string, string> = {
    section: 'Per-Student Attendance Report',
    'per-section': 'Per-Section Attendance Summary',
    absentee: 'List of Absentees',
    tardiness: 'List of Tardiness (Late Comers)',
  };
  const title = titles[data.kind] ?? `${data.kind.replace('-', ' ')} report`;
  const table = tableFor(data);
  const rows = table.rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  const header = table.headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const sectionLine = 'section' in data && data.section ? `Section: ${data.section} · ` : '';
  const metaLine = `${sectionLine}Range: ${data.from} → ${data.to}${meta?.schoolYear ? ` · School Year: ${meta.schoolYear}` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; font-size: 11px; }
    .letterhead { text-align: center; }
    .letterhead .rep { font-weight: 700; font-size: 13px; }
    .letterhead .school { font-weight: 700; font-size: 15px; margin-top: 3px; }
    .title { text-align: center; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.02em; margin: 8px 0 2px; }
    .meta { text-align: center; color: #333; font-size: 10px; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
    th { background: #f1f5f9; }
  </style></head><body>
    <div class="letterhead">
      <div class="rep">Republic of the Philippines</div>
      <div>Department of Education</div>
      <div class="school">${esc(meta?.schoolName ?? '')}</div>
    </div>
    <div class="title">${esc(title)}</div>
    <div class="meta">${esc(metaLine)}</div>
    <table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Official DepEd SF2 — School Form 2: Daily Attendance Report of Learners. */
export function sf2Html(data: Extract<ReportData, { kind: 'register' }>): string {
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const males = data.rows.filter((r) => r.sex === 'M');
  const females = data.rows.filter((r) => r.sex === 'F');
  const absentOf = (r: { marks: string[] }) => r.marks.filter((m) => m === 'X' || m === 'E').length;
  const tardyOf = (r: { marks: string[] }) => r.marks.filter((m) => m === 'L').length;
  const maleAbsent = sum(males.map(absentOf));
  const maleTardy = sum(males.map(tardyOf));
  const femaleAbsent = sum(females.map(absentOf));
  const femaleTardy = sum(females.map(tardyOf));
  const gradeLevel = /^Grade\s*\d+/i.test(data.section) ? data.section.split('-')[0].trim() : '';
  const totalDaily = sum(data.perDayTotal);
  const avgDaily = data.days.length > 0 ? Math.round((totalDaily / data.days.length) * 10) / 10 : 0;
  const attPct =
    data.rows.length > 0 && data.days.length > 0
      ? Math.round((totalDaily / (data.rows.length * data.days.length)) * 1000) / 10
      : 0;

  const dayHeader = data.days
    .map((d, i) => `<th>${Number(d.slice(8))}<br><span class="dow">${data.dayLetters[i]}</span></th>`)
    .join('');
  const learnerRow = (r: (typeof data.rows)[number]) => `<tr>
      <td class="lrn">${esc(r.lrn || r.studentNo)}</td>
      <td class="name">${esc(r.fullName)}</td>
      ${r.marks.map((m) => `<td class="mark ${m === 'L' ? 'tardy' : ''}">${m === 'X' || m === 'E' ? 'x' : ''}</td>`).join('')}
      <td>${absentOf(r)}</td><td>${tardyOf(r)}</td><td></td>
    </tr>`;
  const totalRow = (label: string, perDay: number[], absent: number, tardy: number) => `<tr class="total">
    <td colspan="2" class="glabel">${label} | TOTAL Per Day</td>
    ${perDay.map((n) => `<td>${n || ''}</td>`).join('')}
    <td>${absent}</td><td>${tardy}</td><td></td>
  </tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; font-size: 10.5px; }
    .letterhead { text-align: center; }
    .letterhead .rep { font-weight: 700; font-size: 13px; }
    .letterhead .school { font-weight: 700; font-size: 15px; margin-top: 3px; }
    .title { text-align: center; font-weight: 700; font-size: 12px; text-transform: uppercase; margin: 8px 0 2px; }
    .subtitle { text-align: center; font-size: 9px; font-style: italic; margin-bottom: 8px; }
    .fields { font-size: 10px; margin-bottom: 8px; }
    .fields .row { display: flex; gap: 6px 34px; flex-wrap: wrap; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 2px 4px; text-align: center; }
    th { font-size: 8.5px; }
    .sub { font-size: 7px; font-weight: 400; }
    .dow { font-weight: 400; font-size: 7.5px; }
    .name { text-align: left; padding-left: 5px; }
    .lrn { font-size: 8.5px; }
    .mark { min-width: 13px; height: 15px; }
    .tardy { background: linear-gradient(to bottom, #000 0%, #000 45%, transparent 45%); }
    tr.total td { font-weight: 700; font-size: 8.5px; text-align: left; }
    tr.total td:not(:first-child) { text-align: center; }
    tr.total .glabel { text-align: left; }
    tr.total td:last-child, tr.total td:nth-last-child(2) { background: #f1f5f9; }
    .guidelines { font-size: 9px; margin-top: 6px; }
    .guidelines ol { margin: 2px 0 0 16px; padding: 0; }
    .summary { display: inline-block; border: 1px solid #000; font-size: 9px; margin-top: 6px; }
    .summary td { border: 1px solid #000; padding: 2px 7px; }
    .summary .v { text-align: right; font-weight: 700; }
    .sig { display: flex; justify-content: space-between; margin-top: 22px; text-align: center; }
    .sig .line { margin-top: 18px; }
    .sig .role { font-size: 8.5px; }
  </style></head><body>
    <div class="letterhead">
      <div class="rep">Republic of the Philippines</div>
      <div>Department of Education</div>
      <div class="school">${esc(data.schoolName)}</div>
    </div>
    <div class="title">School Form 2 (SF2) Daily Attendance Report of Learners</div>
    <div class="subtitle">(This replaces Form 1, Form 2 &amp; STS Form 4 – Absenteeism and Dropout Profile)</div>
    <div class="fields">
      <div class="row"><span><b>School ID:</b> _______________</span><span><b>School Year:</b> ${esc(data.schoolYear)}</span><span><b>Report for the Month of:</b> ${esc(data.monthLabel)}</span></div>
      <div class="row"><span><b>Name of School:</b> ${esc(data.schoolName)}</span><span><b>Grade Level:</b> ${esc(gradeLevel)}</span><span><b>Section:</b> ${esc(data.section)}</span></div>
    </div>
    <table>
      <thead><tr>
        <th rowspan="2">LRN</th>
        <th rowspan="2">NAME<br><span class="sub">(Last Name, First Name, Middle Name)</span></th>
        ${dayHeader}
        <th colspan="2">Total for the Month</th>
        <th rowspan="2">REMARKS<br><span class="sub">(If DROPPED OUT, state reason, please refer to legend no. 2. If TRANSFERRED IN/OUT, write the name of School.)</span></th>
      </tr><tr>
        ${data.days.map((_d, i) => `<th class="dow">${data.dayLetters[i]}</th>`).join('')}
        <th>ABSENT</th><th>TARDY</th>
      </tr></thead>
      <tbody>
        ${males.map(learnerRow).join('')}
        ${totalRow('MALE', data.perDayMale, maleAbsent, maleTardy)}
        ${females.map(learnerRow).join('')}
        ${totalRow('FEMALE', data.perDayFemale, femaleAbsent, femaleTardy)}
        ${totalRow('Combined', data.perDayTotal, maleAbsent + femaleAbsent, maleTardy + femaleTardy)}
      </tbody>
    </table>
    <div class="guidelines"><b>GUIDELINES:</b>
      <ol>
        <li>The attendance shall be accomplished daily. Refer to the codes for checking learners' attendance.</li>
        <li>CODES FOR CHECKING ATTENDANCE: (blank) – Present; (x) – Absent; Tardy (half shaded = Upper for Late Comer, Lower for Cutting Classes)</li>
        <li>Dates shall be written in the columns after Learner's Name.</li>
      </ol>${data.capped ? '<div style="color:#b91c1c"><b>Note:</b> range capped to the last 35 school days.</div>' : ''}
    </div>
    <table class="summary">
      <tr><td>No. of Days of Classes:</td><td class="v">${data.days.length}</td></tr>
      <tr><td>Enrolment (M / F / TOTAL):</td><td class="v">${males.length} / ${females.length} / ${data.rows.length}</td></tr>
      <tr><td>Average Daily Attendance:</td><td class="v">${avgDaily}</td></tr>
      <tr><td>Percentage of Attendance for the month:</td><td class="v">${attPct}%</td></tr>
    </table>
    <div class="sig">
      <div>I certify that this is a true and correct report.<div class="line">______________________________</div><div class="role">(Signature of Teacher over Printed Name)</div></div>
      <div>Attested by:<div class="line">______________________________</div><div class="role">(Signature of School Head over Printed Name)</div></div>
    </div>
  </body></html>`;
}

/** Official DepEd SF1 — School Form 1: School Register (per section, portal). */
export function sf1Html(data: Extract<ReportData, { kind: 'sf1' }>): string {
  const gradeLevel = /^Grade\s*\d+/i.test(data.section) ? data.section.split('-')[0].trim() : '';
  const body = data.rows
    .map(
      (r, i) => `<tr>
      <td>${i + 1}</td>
      <td class="lrn">${esc(r.lrn || r.studentNo)}</td>
      <td class="name">${esc(r.fullName)}</td>
      <td>${esc(r.sex)}</td>
      <td></td>
      <td class="addr">${esc(r.address)}</td>
      <td>${esc(r.guardian)}</td>
      <td>${esc(r.contact)}</td>
      <td></td>
    </tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; font-size: 10.5px; }
    .letterhead { text-align: center; }
    .letterhead .rep { font-weight: 700; font-size: 13px; }
    .letterhead .school { font-weight: 700; font-size: 15px; margin-top: 3px; }
    .title { text-align: center; font-weight: 700; font-size: 12px; text-transform: uppercase; margin: 8px 0 2px; }
    .subtitle { text-align: center; font-size: 8px; font-style: italic; margin-bottom: 8px; }
    .fields { font-size: 10px; margin-bottom: 8px; }
    .fields .row { display: flex; gap: 6px 34px; flex-wrap: wrap; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 3px 5px; text-align: center; }
    th { font-size: 8.5px; }
    .sub { font-size: 7px; font-weight: 400; }
    .name { text-align: left; padding-left: 5px; }
    .addr { text-align: left; padding-left: 5px; font-size: 9px; }
    .lrn { font-size: 8.5px; }
    .summary { display: inline-block; border: 1px solid #000; font-size: 9px; margin-top: 8px; }
    .summary td { border: 1px solid #000; padding: 2px 12px; }
    .summary .v { text-align: right; font-weight: 700; }
    .sig { display: flex; justify-content: space-between; margin-top: 26px; text-align: center; }
    .sig .line { margin-top: 22px; }
    .sig .role { font-size: 8.5px; }
  </style></head><body>
    <div class="letterhead">
      <div class="rep">Republic of the Philippines</div>
      <div>Department of Education</div>
      <div class="school">${esc(data.schoolName)}</div>
    </div>
    <div class="title">School Form 1 (SF1) — School Register</div>
    <div class="subtitle">(This is a report on the learners enrolled at the beginning of the school year. Please accomplish this form by filling up all the necessary data in the corresponding cells. Shaded areas are for Schools Division Offices (SDOs) only.)</div>
    <div class="fields">
      <div class="row"><span><b>School ID:</b> _______________</span><span><b>School Year:</b> ${esc(data.schoolYear)}</span><span><b>Grade Level:</b> ${esc(gradeLevel)}</span></div>
      <div class="row"><span><b>Name of School:</b> ${esc(data.schoolName)}</span><span><b>Section:</b> ${esc(data.section)}</span></div>
    </div>
    <table>
      <thead><tr>
        <th rowspan="2">No.</th>
        <th rowspan="2">LRN</th>
        <th rowspan="2">LEARNER'S NAME<br><span class="sub">(Last Name, First Name, Middle Name)</span></th>
        <th rowspan="2">Sex</th>
        <th rowspan="2">Birthdate</th>
        <th rowspan="2">Address (Home)</th>
        <th rowspan="2">Guardian</th>
        <th rowspan="2">Contact No.</th>
        <th rowspan="2">Remarks</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <table class="summary">
      <tr><td>MALE</td><td class="v">${data.male}</td></tr>
      <tr><td>FEMALE</td><td class="v">${data.female}</td></tr>
      <tr><td>TOTAL</td><td class="v">${data.rows.length}</td></tr>
    </table>
    <div class="sig">
      <div>Prepared by:<div class="line">______________________________</div><div class="role">(Signature of Class Adviser over Printed Name)</div></div>
      <div>Noted by:<div class="line">______________________________</div><div class="role">(Signature of School Head over Printed Name)</div></div>
    </div>
  </body></html>`;
}
