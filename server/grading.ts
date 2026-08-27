// DepEd Grading System — grading sheets, class records, and transmutation.
// Implements the DepEd Order No. 8, s. 2015 grading components:
//   Written Work (WW) = 30%, Performance Tasks (PT) = 50%, Quarterly Assessment (QA) = 20%
// Transmutation table maps initial grade (raw score out of 100) to a letter grade.
import { db } from '../electron/db/connection';

// ---- DepEd Transmutation Table --------------------------------------------

/** Maps initial grade (0-100) → letter grade. */
export function transmuteToLetter(grade: number): string {
  if (grade >= 98) return 'A+';
  if (grade >= 95) return 'A';
  if (grade >= 92) return 'A-';
  if (grade >= 89) return 'B+';
  if (grade >= 86) return 'B';
  if (grade >= 83) return 'B-';
  if (grade >= 80) return 'C+';
  if (grade >= 77) return 'C';
  if (grade >= 74) return 'C-';
  if (grade >= 71) return 'D+';
  if (grade >= 68) return 'D';
  if (grade >= 65) return 'D-';
  if (grade >= 62) return 'E+';
  if (grade >= 59) return 'E';
  return 'E-';
}

/** Maps initial grade (0-100) → transmuted grade (numeric, same range). */
export function transmuteToNumber(grade: number): number {
  if (grade >= 98) return 100;
  if (grade >= 95) return 98;
  if (grade >= 92) return 95;
  if (grade >= 89) return 92;
  if (grade >= 86) return 89;
  if (grade >= 83) return 86;
  if (grade >= 80) return 83;
  if (grade >= 77) return 80;
  if (grade >= 74) return 77;
  if (grade >= 71) return 74;
  if (grade >= 68) return 71;
  if (grade >= 65) return 68;
  if (grade >= 62) return 65;
  if (grade >= 59) return 62;
  if (grade >= 50) return 59;
  return 49;
}

/** Complete transmutation table for display / reference. */
export const TRANSMUTATION_TABLE: { range: string; letter: string; transmuted: number }[] = [
  { range: '98-100', letter: 'A+', transmuted: 100 },
  { range: '95-97', letter: 'A', transmuted: 98 },
  { range: '92-94', letter: 'A-', transmuted: 95 },
  { range: '89-91', letter: 'B+', transmuted: 92 },
  { range: '86-88', letter: 'B', transmuted: 89 },
  { range: '83-85', letter: 'B-', transmuted: 86 },
  { range: '80-82', letter: 'C+', transmuted: 83 },
  { range: '77-79', letter: 'C', transmuted: 80 },
  { range: '74-76', letter: 'C-', transmuted: 77 },
  { range: '71-73', letter: 'D+', transmuted: 74 },
  { range: '68-70', letter: 'D', transmuted: 71 },
  { range: '65-67', letter: 'D-', transmuted: 68 },
  { range: '62-64', letter: 'E+', transmuted: 65 },
  { range: '59-61', letter: 'E', transmuted: 62 },
  { range: 'Below 59', letter: 'E-', transmuted: 49 },
];

// ---- Types ----------------------------------------------------------------

export interface GradingComponent {
  id: number;
  subject_id: number;
  grade_section: string;
  school_year: string;
  quarter: number;
  component_type: 'WW' | 'PT' | 'QA';
  component_name: string;
  max_score: number;
  weight_pct: number;
  order_idx: number;
  date_administered: string | null;
  created_at: string;
}

export interface GradingComponentInput {
  subject_id: number;
  grade_section: string;
  school_year?: string;
  quarter: number;
  component_type: 'WW' | 'PT' | 'QA';
  component_name: string;
  max_score?: number;
  weight_pct?: number;
  order_idx?: number;
  date_administered?: string | null;
}

export interface GradingScore {
  id: number;
  component_id: number;
  student_id: number;
  score: number;
  recorded_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ClassRecord {
  id: number;
  subject_id: number;
  grade_section: string;
  school_year: string;
  quarter: number;
  student_id: number;
  ww_score: number | null;
  ww_max: number | null;
  pt_score: number | null;
  pt_max: number | null;
  qa_score: number | null;
  qa_max: number | null;
  raw_score: number | null;
  initial_grade: number | null;
  transmuted_grade: number | null;
  letter_grade: string | null;
  remarks: string;
  recorded_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface GradingSheet {
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  gradeSection: string;
  schoolYear: string;
  quarter: number;
  components: {
    ww: GradingComponent[];
    pt: GradingComponent[];
    qa: GradingComponent[];
  };
  students: {
    studentId: number;
    studentNo: string;
    fullName: string;
    scores: { componentId: number; score: number }[];
  }[];
  computed: {
    studentId: number;
    wwRaw: number;
    wwMax: number;
    wwWeighted: number;
    ptRaw: number;
    ptMax: number;
    ptWeighted: number;
    qaRaw: number;
    qaMax: number;
    qaWeighted: number;
    rawScore: number;
    initialGrade: number;
    transmutedGrade: number;
    letterGrade: string;
  }[];
}

// ---- Components CRUD ------------------------------------------------------

export async function listGradingComponents(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
  quarter: number,
): Promise<GradingComponent[]> {
  return db.query<GradingComponent[]>(
    `SELECT * FROM grading_components
     WHERE subject_id = ? AND grade_section = ? AND school_year = ? AND quarter = ?
     ORDER BY component_type, order_idx, id`,
    [subjectId, gradeSection, schoolYear, quarter],
  );
}

export async function createGradingComponent(input: GradingComponentInput): Promise<GradingComponent> {
  const name = String(input.component_name ?? '').trim();
  if (!name) throw new Error('Component name is required.');
  const [cur] = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  const year = String(input.school_year ?? '').trim() || (cur?.name ?? '');
  const res = await db.execute(
    `INSERT INTO grading_components (subject_id, grade_section, school_year, quarter, component_type, component_name, max_score, weight_pct, order_idx, date_administered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.subject_id,
      String(input.grade_section ?? '').trim(),
      year,
      input.quarter,
      input.component_type,
      name,
      input.max_score ?? 100,
      input.weight_pct ?? 0,
      input.order_idx ?? 0,
      input.date_administered ?? null,
    ],
  );
  const [row] = await db.query<GradingComponent[]>('SELECT * FROM grading_components WHERE id = ?', [res.insertId]);
  return row;
}

export async function updateGradingComponent(id: number, patch: Partial<GradingComponentInput>): Promise<GradingComponent> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ('component_name' in patch) { sets.push('component_name = ?'); params.push(String(patch.component_name ?? '').trim()); }
  if ('max_score' in patch) { sets.push('max_score = ?'); params.push(patch.max_score ?? 100); }
  if ('weight_pct' in patch) { sets.push('weight_pct = ?'); params.push(patch.weight_pct ?? 0); }
  if ('order_idx' in patch) { sets.push('order_idx = ?'); params.push(patch.order_idx ?? 0); }
  if ('date_administered' in patch) { sets.push('date_administered = ?'); params.push(patch.date_administered ?? null); }
  if (!sets.length) throw new Error('Nothing to update.');
  params.push(id);
  await db.execute(`UPDATE grading_components SET ${sets.join(', ')} WHERE id = ?`, params);
  const [row] = await db.query<GradingComponent[]>('SELECT * FROM grading_components WHERE id = ?', [id]);
  return row;
}

export async function deleteGradingComponent(id: number): Promise<void> {
  await db.execute('DELETE FROM grading_components WHERE id = ?', [id]);
}

// ---- Scores CRUD ----------------------------------------------------------

export async function setScore(componentId: number, studentId: number, score: number, recordedBy?: number): Promise<GradingScore> {
  await db.execute(
    `INSERT INTO grading_scores (component_id, student_id, score, recorded_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE score = VALUES(score), recorded_by = VALUES(recorded_by)`,
    [componentId, studentId, score, recordedBy ?? null],
  );
  const [row] = await db.query<GradingScore[]>(
    'SELECT * FROM grading_scores WHERE component_id = ? AND student_id = ?',
    [componentId, studentId],
  );
  return row;
}

export async function setBulkScores(
  componentId: number,
  scores: { student_id: number; score: number }[],
  recordedBy?: number,
): Promise<number> {
  let count = 0;
  for (const s of scores) {
    await setScore(componentId, s.student_id, s.score, recordedBy);
    count++;
  }
  return count;
}

export async function getScoresForComponent(componentId: number): Promise<GradingScore[]> {
  return db.query<GradingScore[]>(
    'SELECT * FROM grading_scores WHERE component_id = ? ORDER BY student_id',
    [componentId],
  );
}

// ---- Class Records (Computed Grades) --------------------------------------

/** Compute a student's class record for one subject/quarter. */
async function computeClassRecord(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
  quarter: number,
  studentId: number,
  recordedBy?: number,
): Promise<ClassRecord | null> {
  const components = await listGradingComponents(subjectId, gradeSection, schoolYear, quarter);
  if (components.length === 0) return null;

  const wwComponents = components.filter((c) => c.component_type === 'WW');
  const ptComponents = components.filter((c) => c.component_type === 'PT');
  const qaComponents = components.filter((c) => c.component_type === 'QA');

  // Get scores for this student
  const allScoreRows = await db.query<{ component_id: number; score: number }[]>(
    `SELECT component_id, score FROM grading_scores
     WHERE student_id = ? AND component_id IN (${components.map(() => '?').join(',')})`,
    [studentId, ...components.map((c) => c.id)],
  );
  const scoreMap = new Map<number, number>();
  for (const s of allScoreRows) scoreMap.set(s.component_id, Number(s.score));

  // Compute weighted scores per component type
  const computeWeighted = (comps: GradingComponent[]): { raw: number; max: number; weighted: number } => {
    if (comps.length === 0) return { raw: 0, max: 0, weighted: 0 };
    let totalScore = 0;
    let totalMax = 0;
    for (const c of comps) {
      const score = scoreMap.get(c.id) ?? 0;
      totalScore += score;
      totalMax += Number(c.max_score);
    }
    const rawPct = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
    return { raw: totalScore, max: totalMax, weighted: rawPct };
  };

  const ww = computeWeighted(wwComponents);
  const pt = computeWeighted(ptComponents);
  const qa = computeWeighted(qaComponents);

  // DepEd weights: WW=30%, PT=50%, QA=20%
  const rawScore = (ww.weighted * 0.3) + (pt.weighted * 0.5) + (qa.weighted * 0.2);
  const initialGrade = Math.round(rawScore * 100) / 100;
  const transmutedGrade = transmuteToNumber(initialGrade);
  const letterGrade = transmuteToLetter(transmutedGrade);

  const remarks = transmutedGrade >= 75 ? 'Passed' : 'Did Not Meet Expectations';

  // Upsert class record
  await db.execute(
    `INSERT INTO class_records (subject_id, grade_section, school_year, quarter, student_id,
      ww_score, ww_max, pt_score, pt_max, qa_score, qa_max,
      raw_score, initial_grade, transmuted_grade, letter_grade, remarks, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      ww_score = VALUES(ww_score), ww_max = VALUES(ww_max),
      pt_score = VALUES(pt_score), pt_max = VALUES(pt_max),
      qa_score = VALUES(qa_score), qa_max = VALUES(qa_max),
      raw_score = VALUES(raw_score), initial_grade = VALUES(initial_grade),
      transmuted_grade = VALUES(transmuted_grade), letter_grade = VALUES(letter_grade),
      remarks = VALUES(remarks), recorded_by = VALUES(recorded_by)`,
    [
      subjectId, gradeSection, schoolYear, quarter, studentId,
      Math.round(ww.weighted * 100) / 100, 100,
      Math.round(pt.weighted * 100) / 100, 100,
      Math.round(qa.weighted * 100) / 100, 100,
      Math.round(rawScore * 100) / 100,
      initialGrade,
      transmutedGrade,
      letterGrade,
      remarks,
      recordedBy ?? null,
    ],
  );

  const [row] = await db.query<ClassRecord[]>(
    'SELECT * FROM class_records WHERE subject_id = ? AND grade_section = ? AND school_year = ? AND quarter = ? AND student_id = ?',
    [subjectId, gradeSection, schoolYear, quarter, studentId],
  );
  return row;
}

/** Recompute all class records for a subject/section/quarter. */
export async function recomputeAllClassRecords(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
  quarter: number,
  recordedBy?: number,
): Promise<ClassRecord[]> {
  const students = await db.query<{ id: number }[]>(
    'SELECT id FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name',
    [gradeSection],
  );

  const records: ClassRecord[] = [];
  for (const s of students) {
    const record = await computeClassRecord(subjectId, gradeSection, schoolYear, quarter, s.id, recordedBy);
    if (record) records.push(record);
  }
  return records;
}

/** Get class records for a subject/section/quarter. */
export async function getClassRecords(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
  quarter: number,
): Promise<(ClassRecord & { full_name: string; student_no: string })[]> {
  return db.query(
    `SELECT cr.*, s.full_name, s.student_no
     FROM class_records cr JOIN students s ON s.id = cr.student_id
     WHERE cr.subject_id = ? AND cr.grade_section = ? AND cr.school_year = ? AND cr.quarter = ?
     ORDER BY s.full_name`,
    [subjectId, gradeSection, schoolYear, quarter],
  );
}

/** Get a full grading sheet (all components + scores + computed grades). */
export async function getGradingSheet(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
  quarter: number,
): Promise<GradingSheet> {
  const subject = await db.query<{ subject_code: string; subject_name: string }[]>(
    'SELECT subject_code, subject_name FROM subjects WHERE id = ?',
    [subjectId],
  );
  const sub = subject[0] ?? { subject_code: '', subject_name: '' };

  const components = await listGradingComponents(subjectId, gradeSection, schoolYear, quarter);
  const ww = components.filter((c) => c.component_type === 'WW');
  const pt = components.filter((c) => c.component_type === 'PT');
  const qa = components.filter((c) => c.component_type === 'QA');

  const students = await db.query<{ id: number; student_no: string; full_name: string }[]>(
    'SELECT id, student_no, full_name FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name',
    [gradeSection],
  );

  // Get all scores
  const allScores = await db.query<{ component_id: number; student_id: number; score: number }[]>(
    `SELECT component_id, student_id, score FROM grading_scores
     WHERE component_id IN (${components.length ? components.map(() => '?').join(',') : '0'})`,
    ...[components.map((c) => c.id)],
  );
  const scoreMap = new Map<string, number>();
  for (const s of allScores) scoreMap.set(`${s.component_id}_${s.student_id}`, Number(s.score));

  const studentData = students.map((s) => ({
    studentId: s.id,
    studentNo: s.student_no,
    fullName: s.full_name,
    scores: components.map((c) => ({ componentId: c.id, score: scoreMap.get(`${c.id}_${s.id}`) ?? 0 })),
  }));

  // Compute grades
  const computed = students.map((s) => {
    const computeWeighted = (comps: GradingComponent[]): { raw: number; max: number; weighted: number } => {
      if (comps.length === 0) return { raw: 0, max: 0, weighted: 0 };
      let totalScore = 0;
      let totalMax = 0;
      for (const c of comps) {
        totalScore += scoreMap.get(`${c.id}_${s.id}`) ?? 0;
        totalMax += Number(c.max_score);
      }
      return { raw: totalScore, max: totalMax, weighted: totalMax > 0 ? (totalScore / totalMax) * 100 : 0 };
    };

    const wwStats = computeWeighted(ww);
    const ptStats = computeWeighted(pt);
    const qaStats = computeWeighted(qa);

    const rawScore = (wwStats.weighted * 0.3) + (ptStats.weighted * 0.5) + (qaStats.weighted * 0.2);
    const initialGrade = Math.round(rawScore * 100) / 100;
    const transmutedGrade = transmuteToNumber(initialGrade);
    const letterGrade = transmuteToLetter(transmutedGrade);

    return {
      studentId: s.id,
      wwRaw: Math.round(wwStats.raw * 100) / 100,
      wwMax: wwStats.max,
      wwWeighted: Math.round(wwStats.weighted * 100) / 100,
      ptRaw: Math.round(ptStats.raw * 100) / 100,
      ptMax: ptStats.max,
      ptWeighted: Math.round(ptStats.weighted * 100) / 100,
      qaRaw: Math.round(qaStats.raw * 100) / 100,
      qaMax: qaStats.max,
      qaWeighted: Math.round(qaStats.weighted * 100) / 100,
      rawScore: Math.round(rawScore * 100) / 100,
      initialGrade,
      transmutedGrade,
      letterGrade,
    };
  });

  return {
    subjectId,
    subjectName: sub.subject_name,
    subjectCode: sub.subject_code,
    gradeSection,
    schoolYear,
    quarter,
    components: { ww, pt, qa },
    students: studentData,
    computed,
  };
}

/** Get final grades across all 4 quarters for a subject/section (for SF9/Report Card). */
export async function getFinalGrades(
  subjectId: number,
  gradeSection: string,
  schoolYear: string,
): Promise<{
  studentId: number;
  studentNo: string;
  fullName: string;
  grades: { quarter: number; transmutedGrade: number; letterGrade: string }[];
  finalGrade: number;
  finalLetter: string;
  isHonor: boolean;
}[]> {
  const students = await db.query<{ id: number; student_no: string; full_name: string }[]>(
    'SELECT id, student_no, full_name FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name',
    [gradeSection],
  );

  const allRecords = await db.query<{ student_id: number; quarter: number; transmuted_grade: number; letter_grade: string }[]>(
    `SELECT student_id, quarter, transmuted_grade, letter_grade
     FROM class_records
     WHERE subject_id = ? AND grade_section = ? AND school_year = ? AND transmuted_grade IS NOT NULL
     ORDER BY student_id, quarter`,
    [subjectId, gradeSection, schoolYear],
  );

  const byStudent = new Map<number, { quarter: number; transmutedGrade: number; letterGrade: string }[]>();
  for (const r of allRecords) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push({ quarter: r.quarter, transmutedGrade: Number(r.transmuted_grade), letterGrade: r.letter_grade });
    byStudent.set(r.student_id, list);
  }

  return students.map((s) => {
    const grades = byStudent.get(s.id) ?? [];
    const finalGrade = grades.length > 0
      ? Math.round(grades.reduce((sum, g) => sum + g.transmutedGrade, 0) / grades.length)
      : 0;
    const finalLetter = transmuteToLetter(finalGrade);
    const isHonor = finalGrade >= 90; // With High Honors
    return { studentId: s.id, studentNo: s.student_no, fullName: s.full_name, grades, finalGrade, finalLetter, isHonor };
  });
}
