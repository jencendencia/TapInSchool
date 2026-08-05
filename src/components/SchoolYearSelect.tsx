// School-year selector for the admin title bar. Reads/writes the GLOBAL school
// year selection (src/screens/admin/schoolYear.tsx) so Sections rosters,
// Students enrollment and Reports all re-scope when it changes.
import { useSchoolYear } from '../screens/admin/schoolYear';

export function SchoolYearSelect() {
  const { years, year, currentYear, setYear } = useSchoolYear();

  return (
    <label
      className="titlebar-year"
      title="Global school year — Sections rosters, Students enrollment and Reports follow this selection"
    >
      <span className="titlebar-year-icon" aria-hidden>🗓</span>
      <span className="titlebar-year-label">School Year</span>
      <select
        className="titlebar-year-select"
        value={year}
        onChange={(e) => setYear(e.target.value)}
        aria-label="School year"
        disabled={years.length === 0}
      >
        {years.length === 0 && <option value="">—</option>}
        {years.map((y) => (
          <option key={y.name} value={y.name}>
            {y.name}
            {y.is_current ? ' (current)' : ''}
          </option>
        ))}
      </select>
      <span className="titlebar-year-caret" aria-hidden>▾</span>
      <span
        className={`titlebar-year-dot ${year && year === currentYear ? 'dot-ok' : ''}`}
        title={year && year === currentYear ? 'Current school year' : 'Archived school year'}
      />
    </label>
  );
}
