// Badges & Ranking (BADGE_RANKING_PLAN.md §7.3): the full badge leaderboard for
// the selected school year — rank, badge chips, score — with a section filter
// and a per-student badge history. The school-year filter is the global
// selector in the admin title bar (like Students/Sections/Reports); the view
// calls badgeLeaderboard() without a top-N cap so no student is cut off.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Badge,
  BadgeCode,
  BadgeLeaderboardRow,
  BadgeWeekProgress,
  Student,
} from '../../../shared/types';
import { BADGE_INFO } from '../../../shared/types';
import { api } from '../../lib/api';
import { compareGrades } from '../../lib/sort';
import { Avatar, Modal, Spinner } from '../../components/shared';
import { useSchoolYear } from './schoolYear';

/** Upper bound for the "full" ranking (the whole school, no pagination). */
const FULL_LIMIT = 500;

function StatCard({ label, value, accent, hint }: { label: string; value: number | string; accent: string; hint?: string }) {
  return (
    <div className="stat-card" title={hint}>
      <div className="stat-label text-dim">{label}</div>
      <div className="stat-value" style={{ color: accent }}>{value}</div>
    </div>
  );
}

/** Highest tier medal (🥈/🥇/💎) within a badge family list. */
function bestTierIcon(badges: Badge[]): string {
  let best: BadgeCode | null = null;
  for (const b of badges) {
    if (!best || BADGE_INFO[b.badgeCode].tier > BADGE_INFO[best].tier) best = b.badgeCode;
  }
  return best ? BADGE_INFO[best].tierIcon : '';
}

function RankCell({ index }: { index: number }) {
  const medal = ['🥇', '🥈', '🥉'][index];
  return medal ? (
    <span className="rank-medal" title={`#${index + 1}`}>{medal}</span>
  ) : (
    <span className="text-dim">#{index + 1}</span>
  );
}

function BadgeHistoryModal({
  row,
  badges,
  currentWeek,
  currentYear,
  hasRange,
  onClose,
}: {
  row: BadgeLeaderboardRow;
  badges: Badge[];
  /** Weekly progress — only fetched when viewing the CURRENT school year. */
  currentWeek: BadgeWeekProgress | null;
  currentYear: boolean;
  /** Whether an earned-date filter is active (affects the empty state text). */
  hasRange: boolean;
  onClose: () => void;
}) {
  const att = badges.filter((b) => b.badgeCode.startsWith('ATT'));
  const punct = badges.filter((b) => b.badgeCode.startsWith('PUNCT'));
  const score = badges.reduce((sum, b) => sum + BADGE_INFO[b.badgeCode].points, 0);
  const sorted = [...badges].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  return (
    <Modal title={`Badges — ${row.fullName}`} onClose={onClose} wide>
      <div className="badge-history-head">
        <div className="cell-student" style={{ minWidth: 0 }}>
          <Avatar name={row.fullName} size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="badge-history-name">{row.fullName}</div>
            <div className="text-dim" style={{ fontSize: 13 }}>
              {row.studentNo} · {row.gradeSection || 'No section'}
            </div>
          </div>
        </div>
        <div className="badge-history-score">
          <span className="text-dim">Badge score</span>
          <strong>⭐ {score} pts</strong>
          <span className="text-dim" style={{ fontSize: 12 }}>🎖 {att.length} · ⏱ {punct.length}</span>
        </div>
      </div>

      {currentYear && currentWeek && (currentWeek.requiredDays > 0 || currentWeek.excusedDays > 0) && (
        <div className="badge-history-week">
          <h4>This week</h4>
          {currentWeek.attendanceComplete ? (
            <span className="kiosk-badge kiosk-badge-earned">
              {BADGE_INFO.ATT_W.icon} {BADGE_INFO.ATT_W.label} earned
            </span>
          ) : currentWeek.attendanceMissed ? (
            <span className="kiosk-badge kiosk-badge-missed">
              {BADGE_INFO.ATT_W.icon} Week missed — see you next week
            </span>
          ) : (
            <span className="kiosk-badge">
              {BADGE_INFO.ATT_W.icon} {currentWeek.presentDays}/{currentWeek.requiredDays} days this week
            </span>
          )}
          {currentWeek.punctualityComplete && (
            <span className="kiosk-badge kiosk-badge-earned">
              {BADGE_INFO.PUNCT_W.icon} {BADGE_INFO.PUNCT_W.label} earned
            </span>
          )}
          {currentWeek.excusedDays > 0 && (
            <span className="kiosk-badge kiosk-badge-dim">✓ {currentWeek.excusedDays} excused</span>
          )}
        </div>
      )}

      {sorted.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Window</th>
                <th>Period start</th>
                <th>Earned</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const info = BADGE_INFO[b.badgeCode];
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="badge-history-badge">
                        <span className="badge-metal">{info.tierIcon}</span>
                        {info.icon} {info.label}
                        <span className="pill pill-success">{info.metal}</span>
                      </span>
                    </td>
                    <td>{info.windowLabel}</td>
                    <td className="mono">{b.periodStart}</td>
                    <td className="mono">{new Date(b.earnedAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-dim" style={{ padding: '14px 0' }}>
          No badges match the current school year{hasRange ? ' and date range' : ''}.
        </p>
      )}
    </Modal>
  );
}

export function BadgesPage() {
  const { year, currentYear } = useSchoolYear();
  const [section, setSection] = useState('');
  const [search, setSearch] = useState('');
  // Optional earned-date range (YYYY-MM-DD) — narrows the ranking + history.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<BadgeLeaderboardRow[] | null>(null);
  const [badgesByStudent, setBadgesByStudent] = useState<Map<number, Badge[]>>(new Map());
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollMap, setEnrollMap] = useState<Map<number, string>>(new Map());
  const [history, setHistory] = useState<{ row: BadgeLeaderboardRow; week: BadgeWeekProgress | null } | null>(null);

  // Sections resolve through the SELECTED school year's enrollments, falling
  // back to the live section (mirrors Students/Reports).
  useEffect(() => {
    void api.listStudents().then(setStudents).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!year) {
      setEnrollMap(new Map());
      return;
    }
    void api
      .listEnrollments(year)
      .then((rows) => setEnrollMap(new Map(rows.map((r) => [r.studentId, r.gradeSection]))))
      .catch(() => undefined);
  }, [year]);

  // A section from a previous school year won't exist in the new one — reset
  // the filters whenever the globally selected year changes.
  useEffect(() => {
    setSection('');
    setFrom('');
    setTo('');
  }, [year]);

  const load = useCallback(() => {
    void api
      .badgeLeaderboard(FULL_LIMIT, section || undefined, year || undefined, from || undefined, to || undefined)
      .then(setRows)
      .catch(() => setRows([]));
    void api
      .listBadges(year || undefined, from || undefined, to || undefined)
      .then((list) => {
        const map = new Map<number, Badge[]>();
        for (const b of list) {
          const arr = map.get(b.studentId) ?? [];
          arr.push(b);
          map.set(b.studentId, arr);
        }
        setBadgesByStudent(map);
      })
      .catch(() => undefined);
  }, [section, year, from, to]);

  useEffect(load, [load]);

  const sections = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if (s.grade_section) set.add(s.grade_section);
    for (const sec of enrollMap.values()) if (sec) set.add(sec);
    return [...set].sort(compareGrades);
  }, [students, enrollMap]);

  const filtered = useMemo(() => {
    if (!rows || !search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) => r.fullName.toLowerCase().includes(q) || r.studentNo.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    let totalBadges = 0;
    let totalScore = 0;
    for (const r of rows ?? []) {
      totalBadges += r.badgeCount;
      totalScore += r.score;
    }
    let platinum = 0;
    for (const list of badgesByStudent.values()) {
      if (list.some((b) => b.badgeCode === 'ATT_Y' || b.badgeCode === 'PUNCT_Y')) platinum++;
    }
    return { ranked: rows?.length ?? 0, totalBadges, totalScore, platinum };
  }, [rows, badgesByStudent]);

  const openHistory = (row: BadgeLeaderboardRow) => {
    setHistory({ row, week: null });
    if (year === currentYear) {
      // Only the latest click wins — a slower response for an earlier row must
      // not overwrite the current selection (same guard as the kiosk card).
      const studentId = row.studentId;
      void api
        .getStudentBadges(studentId)
        .then((sum) => {
          setHistory((prev) => (prev && prev.row.studentId === studentId ? { row: prev.row, week: sum.currentWeek } : prev));
        })
        .catch(() => undefined);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>🏅 Badges & Ranking</h2>
          <p className="text-dim">
            Attendance & punctuality champions{year ? ` · School year: ${year}` : ''}
            {section ? ` · ${section}` : ' · all sections'}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Students ranked" value={stats.ranked} accent="#E2E8F0" hint="Students who earned at least one badge this school year" />
        <StatCard label="Badges earned" value={stats.totalBadges} accent="#FCD34D" />
        <StatCard label="Total score" value={stats.totalScore} accent="#34D399" hint="Σ of badge points (weekly 1 · monthly 3 · quarterly 6 · school year 10)" />
        <StatCard label="Platinum holders" value={stats.platinum} accent="#C4B5FD" hint="Students with a school-year (Platinum) badge" />
      </div>

      <div className="toolbar">
        <label className="report-range-label text-dim">
          Section
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="report-range-label text-dim">
          Earned from
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} title="Only count badges earned on/after this date" />
        </label>
        <label className="report-range-label text-dim">
          to
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} title="Only count badges earned on/before this date" />
        </label>
        <input
          className="search-input"
          style={{ maxWidth: 280, flex: 'none' }}
          placeholder="Search student…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-dim" style={{ fontSize: 13, alignSelf: 'center' }}>
          Ranked by badge score · excused days never break a badge
        </span>
      </div>

      {rows === null ? (
        <Spinner label="Loading ranking…" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Student</th>
                <th>Section</th>
                <th>Attendance</th>
                <th>Punctuality</th>
                <th>Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((r, i) => {
                const list = badgesByStudent.get(r.studentId) ?? [];
                const att = list.filter((b) => b.badgeCode.startsWith('ATT'));
                const punct = list.filter((b) => b.badgeCode.startsWith('PUNCT'));
                const detail = list
                  .map((b) => {
                    const info = BADGE_INFO[b.badgeCode];
                    return `${info.tierIcon} ${info.label} · ${info.metal} (${info.windowLabel}) — ${b.periodStart}`;
                  })
                  .join('\n');
                return (
                  <tr key={r.studentId}>
                    <td><RankCell index={i} /></td>
                    <td>
                      <div className="cell-student">
                        <Avatar name={r.fullName} size={34} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{r.fullName}</div>
                          <div className="text-dim" style={{ fontSize: 12 }}>{r.studentNo}</div>
                        </div>
                      </div>
                    </td>
                    <td>{r.gradeSection || '—'}</td>
                    <td>
                      {att.length > 0 ? (
                        <span className="badge-cell" title={detail}>
                          <span className="badge-chip badge-att">
                            {BADGE_INFO.ATT_W.icon} {att.length}
                            <span className="badge-metal">{bestTierIcon(att)}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td>
                      {punct.length > 0 ? (
                        <span className="badge-cell" title={detail}>
                          <span className="badge-chip badge-punct">
                            {BADGE_INFO.PUNCT_W.icon} {punct.length}
                            <span className="badge-metal">{bestTierIcon(punct)}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td>
                      <span className="star-count">⭐ {r.score}</span>
                    </td>
                    <td>
                      <button
                        className="btn-ghost"
                        style={{ padding: '5px 12px', fontSize: 13 }}
                        onClick={() => openHistory(r)}
                        title="View this student's badge history"
                      >
                        History
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    {rows.length === 0
                      ? 'No badges earned yet this school year — students earn them by being present every non-excused school day in a week, month, quarter, or the whole school year.'
                      : 'No students match the current filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {history && (
        <BadgeHistoryModal
          row={history.row}
          badges={badgesByStudent.get(history.row.studentId) ?? []}
          currentWeek={history.week}
          currentYear={year === currentYear}
          hasRange={!!from || !!to}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}
