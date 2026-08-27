// ILAW Lesson Plan service — CRUD, templates, and AI generation support.
// ILAW format:
//   I — Initiating: Motivation, Review, Preparation
//   L — Leading: Presentation, Discussion, Explanation
//   A — Assisting: Activity, Application, Practice
//   W — Widening: Evaluation, Generalization, Assignment, Reflection
import { db } from '../electron/db/connection';

// ---- Types ----------------------------------------------------------------

export interface IlawSection {
  initiating: {
    motivation: string;
    review: string;
    preparation: string;
  };
  leading: {
    presentation: string;
    discussion: string;
    explanation: string;
  };
  assisting: {
    activity: string;
    application: string;
    practice: string;
  };
  widening: {
    evaluation: string;
    generalization: string;
    assignment: string;
    reflection: string;
  };
}

export interface LessonPlan {
  id: number;
  teacher_id: number;
  subject_id: number;
  grade_section: string;
  school_year: string;
  plan_date: string;
  topic: string;
  objectives: string;
  grade_level: string;
  quarter: number | null;
  week_no: number | null;
  ilaw_data: IlawSection;
  ai_generated: boolean;
  ai_prompt: string | null;
  status: 'draft' | 'final' | 'archived';
  materials: string;
  references_text: string;
  created_at: string;
  updated_at: string;
}

export interface LessonPlanInput {
  subject_id: number;
  grade_section: string;
  school_year?: string;
  plan_date: string;
  topic: string;
  objectives: string;
  grade_level?: string;
  quarter?: number;
  week_no?: number;
  ilaw_data: IlawSection;
  materials?: string;
  references_text?: string;
  status?: 'draft' | 'final' | 'archived';
}

export interface LessonPlanTemplate {
  id: number;
  name: string;
  subject_id: number | null;
  grade_level: string;
  ilaw_data: IlawSection;
  is_public: boolean;
  created_by: number | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface LessonPlanTemplateInput {
  name: string;
  subject_id?: number;
  grade_level?: string;
  ilaw_data: IlawSection;
  is_public?: boolean;
}

// ---- Empty ILAW template --------------------------------------------------

export function emptyIlawData(): IlawSection {
  return {
    initiating: { motivation: '', review: '', preparation: '' },
    leading: { presentation: '', discussion: '', explanation: '' },
    assisting: { activity: '', application: '', practice: '' },
    widening: { evaluation: '', generalization: '', assignment: '', reflection: '' },
  };
}

// ---- Lesson Plans CRUD ----------------------------------------------------

export async function listLessonPlans(
  teacherId: number,
  filters?: { subjectId?: number; gradeSection?: string; status?: string; from?: string; to?: string },
): Promise<LessonPlan[]> {
  const where: string[] = ['teacher_id = ?'];
  const params: unknown[] = [teacherId];

  if (filters?.subjectId) { where.push('subject_id = ?'); params.push(filters.subjectId); }
  if (filters?.gradeSection) { where.push('grade_section = ?'); params.push(filters.gradeSection); }
  if (filters?.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters?.from) { where.push('plan_date >= ?'); params.push(filters.from); }
  if (filters?.to) { where.push('plan_date <= ?'); params.push(filters.to); }

  const rows = await db.query<LessonPlan[]>(
    `SELECT * FROM lesson_plans WHERE ${where.join(' AND ')} ORDER BY plan_date DESC, id DESC`,
    params,
  );
  return rows.map((r) => ({ ...r, ilaw_data: parseIlaw(r.ilaw_data) }));
}

export async function getLessonPlan(id: number): Promise<LessonPlan | null> {
  const rows = await db.query<LessonPlan[]>('SELECT * FROM lesson_plans WHERE id = ?', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], ilaw_data: parseIlaw(rows[0].ilaw_data) };
}

export async function createLessonPlan(teacherId: number, input: LessonPlanInput): Promise<LessonPlan> {
  const [cur] = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  const year = String(input.school_year ?? '').trim() || (cur?.name ?? '');
  const topic = String(input.topic ?? '').trim();
  if (!topic) throw new Error('Topic is required.');

  const ilawJson = JSON.stringify(input.ilaw_data || emptyIlawData());

  const res = await db.execute(
    `INSERT INTO lesson_plans (teacher_id, subject_id, grade_section, school_year, plan_date,
      topic, objectives, grade_level, quarter, week_no, ilaw_data, ai_generated, status, materials, references_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      teacherId,
      input.subject_id,
      String(input.grade_section ?? '').trim(),
      year,
      input.plan_date || new Date().toISOString().slice(0, 10),
      topic,
      String(input.objectives ?? '').trim(),
      String(input.grade_level ?? '').trim(),
      input.quarter ?? null,
      input.week_no ?? null,
      ilawJson,
      0,
      input.status ?? 'draft',
      String(input.materials ?? '').trim(),
      String(input.references_text ?? '').trim(),
    ],
  );

  const [row] = await db.query<LessonPlan[]>('SELECT * FROM lesson_plans WHERE id = ?', [res.insertId]);
  return { ...row, ilaw_data: parseIlaw(row.ilaw_data) };
}

export async function updateLessonPlan(id: number, patch: Partial<LessonPlanInput>): Promise<LessonPlan> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if ('subject_id' in patch) { sets.push('subject_id = ?'); params.push(patch.subject_id); }
  if ('grade_section' in patch) { sets.push('grade_section = ?'); params.push(String(patch.grade_section ?? '').trim()); }
  if ('plan_date' in patch) { sets.push('plan_date = ?'); params.push(patch.plan_date); }
  if ('topic' in patch) { sets.push('topic = ?'); params.push(String(patch.topic ?? '').trim()); }
  if ('objectives' in patch) { sets.push('objectives = ?'); params.push(String(patch.objectives ?? '').trim()); }
  if ('grade_level' in patch) { sets.push('grade_level = ?'); params.push(String(patch.grade_level ?? '').trim()); }
  if ('quarter' in patch) { sets.push('quarter = ?'); params.push(patch.quarter ?? null); }
  if ('week_no' in patch) { sets.push('week_no = ?'); params.push(patch.week_no ?? null); }
  if ('ilaw_data' in patch) { sets.push('ilaw_data = ?'); params.push(JSON.stringify(patch.ilaw_data)); }
  if ('materials' in patch) { sets.push('materials = ?'); params.push(String(patch.materials ?? '').trim()); }
  if ('references_text' in patch) { sets.push('references_text = ?'); params.push(String(patch.references_text ?? '').trim()); }
  if ('status' in patch) { sets.push('status = ?'); params.push(patch.status); }

  if (!sets.length) throw new Error('Nothing to update.');
  params.push(id);
  await db.execute(`UPDATE lesson_plans SET ${sets.join(', ')} WHERE id = ?`, params);

  const [row] = await db.query<LessonPlan[]>('SELECT * FROM lesson_plans WHERE id = ?', [id]);
  return { ...row, ilaw_data: parseIlaw(row.ilaw_data) };
}

export async function deleteLessonPlan(id: number): Promise<void> {
  await db.execute('DELETE FROM lesson_plans WHERE id = ?', [id]);
}

// ---- Templates CRUD -------------------------------------------------------

export async function listLessonPlanTemplates(teacherId: number, subjectId?: number): Promise<LessonPlanTemplate[]> {
  const where = ['(is_public = 1 OR created_by = ?)'];
  const params: unknown[] = [teacherId];
  if (subjectId) { where.push('(subject_id = ? OR subject_id IS NULL)'); params.push(subjectId); }
  return db.query<LessonPlanTemplate[]>(
    `SELECT * FROM lesson_plan_templates WHERE ${where.join(' AND ')} ORDER BY use_count DESC, name`,
    params,
  );
}

export async function createLessonPlanTemplate(teacherId: number, input: LessonPlanTemplateInput): Promise<LessonPlanTemplate> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Template name is required.');
  const res = await db.execute(
    `INSERT INTO lesson_plan_templates (name, subject_id, grade_level, ilaw_data, is_public, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      name,
      input.subject_id ?? null,
      String(input.grade_level ?? '').trim(),
      JSON.stringify(input.ilaw_data || emptyIlawData()),
      input.is_public ?? false,
      teacherId,
    ],
  );
  const [row] = await db.query<LessonPlanTemplate[]>('SELECT * FROM lesson_plan_templates WHERE id = ?', [res.insertId]);
  return { ...row, ilaw_data: parseIlaw(row.ilaw_data) };
}

export async function useLessonPlanTemplate(templateId: number): Promise<void> {
  await db.execute('UPDATE lesson_plan_templates SET use_count = use_count + 1 WHERE id = ?', [templateId]);
}

export async function deleteLessonPlanTemplate(id: number): Promise<void> {
  await db.execute('DELETE FROM lesson_plan_templates WHERE id = ?', [id]);
}

// ---- AI Generation Support ------------------------------------------------

/** Generate a structured ILAW prompt that can be sent to an AI service. */
export function buildAiPrompt(
  topic: string,
  gradeLevel: string,
  subjectName: string,
  objectives: string,
  existingIlaw?: IlawSection,
): string {
  return `You are an expert Filipino teacher following the DepEd MATATAG curriculum.

Generate a detailed lesson plan in ILAW format for:
- Subject: ${subjectName}
- Grade Level: ${gradeLevel}
- Topic: ${topic}
${objectives ? `- Learning Objectives: ${objectives}` : ''}

ILAW FORMAT:
I — Initiating (Motivation, Review of previous lesson, Preparation for new learning)
L — Leading (Presentation of new concepts, Discussion, Explanation with examples)
A — Assisting (Activities, Application, Group/Individual practice, Hands-on work)
W — Widening (Evaluation, Generalization/Summary, Assignment, Reflection)

For each section, provide:
1. Specific teaching strategies and activities
2. Materials needed
3. Time allocation (in minutes)
4. Assessment methods
5. Differentiation strategies for diverse learners

Use the Philippine context and culture in examples.
Include DepEd-recognized teaching methods (cooperative learning, inquiry-based, etc.).

${existingIlaw ? `\nExisting draft (improve and expand):\n${JSON.stringify(existingIlaw, null, 2)}` : ''}

Return the lesson plan in this JSON format:
{
  "initiating": {
    "motivation": "...",
    "review": "...",
    "preparation": "..."
  },
  "leading": {
    "presentation": "...",
    "discussion": "...",
    "explanation": "..."
  },
  "assisting": {
    "activity": "...",
    "application": "...",
    "practice": "..."
  },
  "widening": {
    "evaluation": "...",
    "generalization": "...",
    "assignment": "...",
    "reflection": "..."
  }
}`;
}

/** Parse ilaw_data that might be stored as a string or object. */
function parseIlaw(data: unknown): IlawSection {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return emptyIlawData(); }
  }
  if (typeof data === 'object' && data !== null) return data as IlawSection;
  return emptyIlawData();
}

/** Format ILAW data as readable text for display/print. */
export function formatIlawAsText(ilaw: IlawSection): string {
  const sections = [
    { letter: 'I', title: 'Initiating', items: [
      { label: 'Motivation', value: ilaw.initiating.motivation },
      { label: 'Review', value: ilaw.initiating.review },
      { label: 'Preparation', value: ilaw.initiating.preparation },
    ]},
    { letter: 'L', title: 'Leading', items: [
      { label: 'Presentation', value: ilaw.leading.presentation },
      { label: 'Discussion', value: ilaw.leading.discussion },
      { label: 'Explanation', value: ilaw.leading.explanation },
    ]},
    { letter: 'A', title: 'Assisting', items: [
      { label: 'Activity', value: ilaw.assisting.activity },
      { label: 'Application', value: ilaw.assisting.application },
      { label: 'Practice', value: ilaw.assisting.practice },
    ]},
    { letter: 'W', title: 'Widening', items: [
      { label: 'Evaluation', value: ilaw.widening.evaluation },
      { label: 'Generalization', value: ilaw.widening.generalization },
      { label: 'Assignment', value: ilaw.widening.assignment },
      { label: 'Reflection', value: ilaw.widening.reflection },
    ]},
  ];

  return sections.map((s) => {
    const header = `${s.letter} — ${s.title}`;
    const items = s.items.filter((i) => i.value.trim()).map((i) => `  ${i.label}: ${i.value.trim()}`);
    return items.length > 0 ? `${header}\n${items.join('\n')}` : header;
  }).join('\n\n');
}
