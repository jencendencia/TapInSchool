// Attendance logs: historical search + CSV export (PRD Screen B).
import { useCallback, useEffect, useState } from 'react';
import type { AttendanceLogRow, EntryType } from '../../../shared/types';
import { api, downloadTextFile } from '../../lib/api';
import { EntryChip, Spinner, fmtTimeSec } from '../../components/shared';

const PAGE_SIZE = 50;

export function LogsPage() {
  const [rows, setRows] = useState<AttendanceLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [entryType, setEntryType] = useState<EntryType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const load = useCallback(() => {
    void api
      .listLogs({
        search: search || undefined,
        entryType: entryType || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59` : undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
      });
  }, [search, entryType, from, to, offset]);

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
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} title="From date" />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} title="To date" />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Grade / Section</th>
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
                <td><EntryChip type={r.entry_type} /></td>
                <td>
                  {r.flag ? (
                    <span className={`pill pill-${r.flag.toLowerCase()}`}>{r.flag}</span>
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
                <td colSpan={7} className="empty-cell">No attendance records match the filters.</td>
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
