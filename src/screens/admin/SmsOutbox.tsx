// SMS Outbox: delivery audit log, failed retries, test SMS (PRD Screen B).
import { useCallback, useEffect, useState } from 'react';
import type { SmsLogRow, SmsStatus } from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, SmsStatusPill, Spinner, Toast, fmtTimeSec } from '../../components/shared';

const PAGE_SIZE = 50;

export function SmsOutboxPage() {
  const [rows, setRows] = useState<SmsLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<SmsStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<SmsLogRow | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listSms({ status: status || undefined, limit: PAGE_SIZE, offset }).then((res) => {
      setRows(res.rows);
      setTotal(res.total);
    });
  }, [status, offset]);

  useEffect(load, [load]);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const retry = async (id: number) => {
    await api.retrySms(id);
    notify(`SMS #${id} re-queued`);
    load();
  };

  const sendTest = async () => {
    const res = await api.testSms(testPhone);
    setTestResult(res.message);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>SMS Outbox</h2>
          <p className="text-dim">{total} messages</p>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={() => { setTestOpen(true); setTestResult(null); }}>📱 Test SMS</button>
        </div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value as SmsStatus | ''); setOffset(0); }}>
          <option value="">All statuses</option>
          <option value="PENDING">PENDING / QUEUED</option>
          <option value="SENT">SENT</option>
          <option value="FAILED">FAILED</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Parent Mobile</th>
              <th>Message</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td>{r.full_name ?? '—'}</td>
                <td className="mono">{r.parent_phone}</td>
                <td>
                  <button className="msg-preview" onClick={() => setExpanded(r)} title="View full message">
                    {r.message.slice(0, 44)}…
                  </button>
                </td>
                <td><SmsStatusPill status={r.status} /></td>
                <td className="mono">{r.attempts}</td>
                <td>{fmtTimeSec(r.created_at)}</td>
                <td>
                  {(r.status === 'FAILED' || r.status === 'PENDING') && (
                    <button className="btn-icon" title="Retry now" onClick={() => void retry(r.id)}>↻</button>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">No SMS records.</td>
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
      {!rows && <Spinner label="Loading SMS outbox…" />}

      {expanded && (
        <Modal title={`SMS #${expanded.id} — delivery details`} onClose={() => setExpanded(null)}>
          <div className="sms-detail">
            <p><b>To:</b> <span className="mono">{expanded.parent_phone}</span></p>
            <p><b>Status:</b> <SmsStatusPill status={expanded.status} /> {expanded.provider && <span className="text-dim">via {expanded.provider}</span>}</p>
            <p><b>Attempts:</b> {expanded.attempts}</p>
            <p><b>Created:</b> {fmtTimeSec(expanded.created_at)}</p>
            {expanded.sent_at && <p><b>Sent:</b> {fmtTimeSec(expanded.sent_at)}</p>}
            {expanded.error && <p className="sms-error"><b>Last error:</b> {expanded.error}</p>}
            <div className="sms-message-box">{expanded.message}</div>
          </div>
        </Modal>
      )}

      {testOpen && (
        <Modal title="Send a test SMS" onClose={() => setTestOpen(false)}>
          <div className="form">
            <div className="field">
              <label>Recipient mobile</label>
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="09171234567" />
            </div>
            <button className="btn-primary" onClick={() => void sendTest()}>Send test</button>
            {testResult && <p className={testResult.startsWith('Error') ? 'sms-error' : 'sms-ok'}>{testResult}</p>}
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
