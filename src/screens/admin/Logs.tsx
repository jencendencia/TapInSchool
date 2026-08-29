// Attendance logs: historical search + CSV export (PRD Screen B).
import { useCallback, useEffect, useState } from 'react';
import type { AttendanceLogRow, EntryType, Settings } from '../../../shared/types';
import { api, downloadTextFile } from '../../lib/api';
import { EntryChip, Spinner, fmtTimeSec } from '../../components/shared';

const PAGE_SIZE = 50;

/** Compute the midpoint between am_time_out and pm_time_in for AM/PM split. */
function getMidTime(settings: Settings): string {
  const parse = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const amOut = settings.am_time_out ? parse(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(amOut) ? amOut : 720;
  if (Number.isNaN(amOut)) {
    const amIn = settings.am_time_in ? parse(settings.am_time_in) : NaN;
    const pmOut = settings.pm_time_out ? parse(settings.pm_time_out) : NaN;
    if (!Number.isNaN(amIn) && !Number.isNaN(pmOut)) midMin = Math.round((amIn + pmOut) / 2);
  }
  const h = String(Math.floor(midMin / 60)).padStart(2, '0');
  const m = String(midMin % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** Return 'AM' or 'PM' based on scan time vs bell-time midpoint. */
function sessionOf(scannedAt: string, midTime: string): 'AM' | 'PM' {
  // Convert the ISO timestamp to local time before comparing it with the
  // school's local bell-time midpoint. Slicing the ISO string compares UTC,
  // which can turn a local PM scan into an AM scan in the logs UI.
  const date = new Date(scannedAt);
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return hm < midTime ? 'AM' : 'PM';
}

type SessionFilter = '' | 'AM' | 'PM';

export function LogsPage() {
  const [rows, setRows] = useState<AttendanceLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [entryType, setEntryType] = useState<EntryType | ''>('');
  const [session, setSession] = useState<SessionFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => { void api.getSettings().then(setSettings).catch(() => {}); }, []);

  const midTime = settings ? getMidTime(settings) : '12:00';

  const load = useCallback(() => {
    void api
      .listLogs({
        search: search || undefined,
        entryType: entryType || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59` : undefined,
        limit: 2000, // fetch more client-side to support session filter
        offset: 0,
      })
      .then((res) => {
        let filtered = res.rows;
        // Client-side session filter (AM/PM based on bell-time midpoint)
        if (session && settings) {
          filtered = filtered.filter((r) => sessionOf(r.scanned_at, midTime) === session);
        }
        setTotal(session ? filtered.length : res.total);
        // Paginate client-side when session filter is active
        const paged = session ? filtered.slice(offset, offset + PAGE_SIZE) : res.rows;
        setRows(session ? paged : res.rows);
      });
  }, [search, entryType, session, from, to, offset, settings, midTime]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const exportCsv = () => {
    void api
      .exportLogsCsv({
        search: search || undefined,
        entryType: entryType || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59` : undefined,
      })
      .then((csv) => downloadTextFile(`attendance-logs-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv'));
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Attendance Logs</h2>
          <p className="text-dim">{total} records</p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={exportCsv}>⬇ Export CSV</button>
        </div>
      </div>

      <div className="toolbar">
        <input className="search-input" placeholder="Search student…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        <select value={entryType} onChange={(e) => { setEntryType(e.target.value as EntryType | ''); setOffset(0); }}>
          <option value="">All types</option>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
        <select value={session} onChange={(e) => { setSession(e.target.value as SessionFilter); setOffset(0); }}>
          <option value="">All sessions</option>
          <option value="AM">☀️ Morning (AM)</option>
          <option value="PM">🌙 Afternoon (PM)</option>
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} title="From date" />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} title="To date" />
      </div>

      <div className="table-wrap">
        <table className="table logs-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Grade / Section</th>
              <th>Session</th>
              <th>Type</th>
              <th>Flag</th>
              <th>Source</th>
              <th>Scanned At</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td>
                  <div className="cell-student">
                    <span>{r.full_name}</span>
                    <span className="mono text-dim">{r.student_no}</span>
                  </div>
                </td>
                <td>{r.grade_section || '—'}</td>
                <td>{(() => {
                  const sess = sessionOf(r.scanned_at, midTime);
                  return sess === 'AM'
                    ? <span className="pill pill-am">☀️ AM</span>
                    : <span className="pill pill-pm">🌙 PM</span>;
                })()}</td>
                <td><EntryChip type={r.entry_type} /></td>
                <td>
                  {r.flag ? (
                    <span className={`pill pill-${r.flag.toLowerCase()}`}>{sessionOf(r.scanned_at, midTime)} {r.flag}</span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td><span className="pill pill-dim">{r.source}</span></td>
                <td>{fmtTimeSec(r.scanned_at)}</td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">No attendance records match the filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="text-dim">Page {page} of {pages}</span>
        <button className="btn-ghost" disabled={page <= 1} onClick={() => setOffset(offset - PAGE_SIZE)}>← Prev</button>
        <button className="btn-ghost" disabled={page >= pages} onClick={() => setOffset(offset + PAGE_SIZE)}>Next →</button>
      </div>
      {!rows && <Spinner label="Loading logs…" />}
    </div>
  );
}
