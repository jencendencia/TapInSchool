// Sorting helpers for grade labels. A plain string sort() puts "Grade 10"
// before "Grade 7" (lexically "1" < "7"), so grades are compared numerically
// first and fall back to localeCompare for ties (e.g. "Grade 7" vs
// "Grade 7 Special" or non-numeric labels like "Nursery").

/** Natural comparator: "Grade 7" < "Grade 8" < "Grade 9" < "Grade 10" < "Grade 11". */
export function compareGrades(a: string, b: string): number {
  const na = Number.parseInt(a.replace(/\D+/g, ''), 10);
  const nb = Number.parseInt(b.replace(/\D+/g, ''), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Sorts an array of grade labels in natural numeric order (non-mutating). */
export function sortGrades(grades: string[]): string[] {
  return [...grades].sort(compareGrades);
}
