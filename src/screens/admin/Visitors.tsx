// Visitors (walk-in gate passes): staff register walk-in visitors at the gate,
// each gets a reusable VP QR code (scanned at the kiosk like a student), and
// the admin can block access or review the IN/OUT visit log.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Visitor, VisitorInput, VisitorLogRow } from '../../../shared/types';
import { api } from '../../lib/api';
import { Avatar, EntryChip, Modal, QrCodeImage, Spinner, Toast, fmtTimeSec } from '../../components/shared';

type SubTab = 'registry' | 'logs';

const EMPTY_FORM: VisitorInput = {
  full_name: '',
  contact_phone: '',
  purpose: '',
  host_office: '',
  id_presented: '',
};

type ModalState =
  | { type: 'add' }
  | { type: 'edit'; visitor: Visitor }
  | { type: 'qr'; visitor: Visitor }
  | null;

function VisitorForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: VisitorInput;
  onSave: (input: VisitorInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<VisitorInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof VisitorInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!form.full_name.trim()) {
      setError('Visitor name is required.');
      return;
    }
    onSave(form);
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <label>Full Name</label>
        <input
          required
          value={form.full_name}
          onChange={(e) => set('full_name', e.target.value)}
          placeholder="e.g. Ramon Bautista"
          autoFocus
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Contact Phone (optional)</label>
          <input value={form.contact_phone ?? ''} onChange={(e) => set('contact_phone', e.target.value)} placeholder="09171234567" />
        </div>
        <div className="field">
          <label>ID Presented (optional)</label>
          <input value={form.id_presented ?? ''} onChange={(e) => set('id_presented', e.target.value)} placeholder="e.g. Driver's License N-12345678" />
        </div>
      </div>
      <div className="field">
        <label>Purpose of Visit</label>
        <input value={form.purpose ?? ''} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Delivery, Parent meeting, Facility inspection" />
      </div>
      <div className="field">
        <label>Host / Office Being Visited</label>
        <input value={form.host_office ?? ''} onChange={(e) => set('host_office', e.target.value)} placeholder="e.g. Principal's Office, Supplies Office" />
      </div>
      {error && <p className="field-hint sms-error">{error}</p>}
      <p className="field-hint">A reusable VP QR code is generated automatically — print it and hand it to the visitor.</p>
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">Save Visitor</button>
      </div>
    </form>
  );
}

function VisitorQrModal({ visitor, onClose }: { visitor: Visitor; onClose: () => void }) {
  const print = async () => {
    const url = await QRCode.toDataURL(visitor.qr_hash_payload, { width: 480, margin: 2 });
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Visitor QR — ${visitor.full_name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      img{width:300px;border:1px solid #ccc;border-radius:8px;padding:12px}
      h2{margin:8px 0 2px}p{margin:2px 0;color:#555}
      code{font-size:12px;color:#888;word-break:break-all}</style></head><body>
      <h2>${visitor.full_name}</h2>
      ${visitor.purpose ? `<p>${visitor.purpose}</p>` : ''}
      ${visitor.host_office ? `<p>Visiting: ${visitor.host_office}</p>` : ''}
      <img src="${url}" alt="QR" />
      <p><code>${visitor.qr_hash_payload}</code></p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Modal title={`Visitor QR — ${visitor.full_name}`} onClose={onClose}>
      <div className="qr-modal">
        <QrCodeImage text={visitor.qr_hash_payload} size={220} />
        <h3>{visitor.full_name}</h3>
        <p className="text-dim">
          {visitor.purpose && <>{visitor.purpose} · </>}
          {visitor.host_office || 'No host on file'}
        </p>
        <code className="qr-payload">{visitor.qr_hash_payload}</code>
        <p className="qr-note text-dim">
          Scan this at the kiosk to check the visitor IN and OUT. The same QR works on every visit — deactivate the visitor to block access.
        </p>
        <div className="form-actions">
          <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(visitor.qr_hash_payload)}>Copy</button>
          <button className="btn-primary" onClick={() => void print()}>🖨 Print</button>
        </div>
      </div>
    </Modal>
  );
}

function RegistryTab({
  onOpenModal,
}: {
  onOpenModal: (m: Exclude<ModalState, null>) => void;
}) {
  const [visitors, setVisitors] = useState<Visitor[] | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback((q = '') => {
    void api.listVisitors(q || undefined).then(setVisitors);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  if (!visitors) return <Spinner label="Loading visitors…" />;

  const toggleActive = async (v: Visitor) => {
    try {
      await api.updateVisitor(v.id, { is_active: !v.is_active });
      load(search);
    } catch (err) {
      window.alert(`Could not update visitor: ${(err as Error).message}`);
    }
  };

  const remove = async (v: Visitor) => {
    if (!window.confirm(`Delete ${v.full_name}? Their visit logs are removed too.`)) return;
    await api.deleteVisitor(v.id);
    load(search);
  };

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search name or contact phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Visitor</th>
              <th>Purpose</th>
              <th>Host / Office</th>
              <th>ID Presented</th>
              <th>Contact</th>
              <th>QR Payload</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visitors.map((v) => (
              <tr key={v.id}>
                <td>
                  <div className="cell-student">
                    <Avatar name={v.full_name} showPhoto={false} size={34} />
                    <span>{v.full_name}</span>
                  </div>
                </td>
                <td>{v.purpose || '—'}</td>
                <td>{v.host_office || '—'}</td>
                <td>{v.id_presented || '—'}</td>
                <td>{v.contact_phone || '—'}</td>
                <td><code className="qr-payload sm">{v.qr_hash_payload}</code></td>
                <td>
                  <span className={`pill ${v.is_active ? 'pill-success' : 'pill-danger'}`}>
                    {v.is_active ? 'ACTIVE' : 'BLOCKED'}
                  </span>
                  <button
                    className="btn-icon toggle-btn"
                    title={v.is_active ? 'Block access (deactivate QR)' : 'Allow access (activate QR)'}
                    onClick={() => void toggleActive(v)}
                  >
                    {v.is_active ? '🔓' : '🔒'}
                  </button>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title="QR code" onClick={() => onOpenModal({ type: 'qr', visitor: v })}>▦</button>
                    <button className="btn-icon" title="Edit" onClick={() => onOpenModal({ type: 'edit', visitor: v })}>✎</button>
                    <button className="btn-icon danger" title="Delete" onClick={() => void remove(v)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {visitors.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">
                  {search ? 'No visitors match the search.' : 'No visitors registered yet. Register the first walk-in visitor to issue their gate QR.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LogsTab() {
  const [logs, setLogs] = useState<VisitorLogRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    void api
      .listAllVisitorLogs({
        from: from || undefined,
        // Inclusive end-of-day (mirrors the attendance Logs tab): the backend
        // compares scanned_at <= this value, so a bare date would drop every
        // scan after midnight.
        to: to ? `${to}T23:59:59` : undefined,
      })
      .then(setLogs);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
        {(from || to) && (
          <button
            className="btn-ghost"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            ✕ Clear dates
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Scanned At</th>
              <th>Visitor</th>
              <th>Purpose</th>
              <th>Host / Office</th>
              <th>Type</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((l) => (
              <tr key={l.id}>
                <td className="mono">{fmtTimeSec(l.scanned_at)}</td>
                <td>
                  <div className="cell-student">
                    <Avatar name={l.full_name} showPhoto={false} size={30} />
                    <span>{l.full_name}</span>
                  </div>
                </td>
                <td>{l.purpose || '—'}</td>
                <td>{l.host_office || '—'}</td>
                <td><EntryChip type={l.entry_type} /></td>
                <td><span className="pill pill-dim">{l.source}</span></td>
              </tr>
            ))}
            {logs?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">No visit logs match the date range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function VisitorsPage() {
  const [tab, setTab] = useState<SubTab>('registry');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const saveVisitor = async (input: VisitorInput) => {
    try {
      if (modal?.type === 'edit') {
        await api.updateVisitor(modal.visitor.id, input);
        notify('Visitor updated');
      } else {
        const created = await api.createVisitor(input);
        notify(`Visitor registered — QR payload ${created.qr_hash_payload}`);
      }
      setModal(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Visitors</h2>
          <p className="text-dim">Walk-in gate passes — register a visitor, issue their QR, and track IN/OUT visits</p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>+ Register Visitor</button>
        </div>
      </div>

      <div className="subnav" role="tablist">
        <button
          className={`subnav-btn ${tab === 'registry' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'registry'}
          onClick={() => setTab('registry')}
        >
          🧑‍🤝‍🧑 Visitor Registry
        </button>
        <button
          className={`subnav-btn ${tab === 'logs' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'logs'}
          onClick={() => setTab('logs')}
        >
          🕐 Visit Logs
        </button>
      </div>

      <div key={reloadKey}>
        {tab === 'registry' && <RegistryTab onOpenModal={setModal} />}
        {tab === 'logs' && <LogsTab />}
      </div>

      {modal?.type === 'add' && (
        <Modal title="Register Visitor" closeOnOverlay={false} onClose={() => setModal(null)}>
          <VisitorForm initial={EMPTY_FORM} onSave={(i) => void saveVisitor(i)} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.visitor.full_name}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <VisitorForm
            initial={{
              full_name: modal.visitor.full_name,
              contact_phone: modal.visitor.contact_phone,
              purpose: modal.visitor.purpose,
              host_office: modal.visitor.host_office,
              id_presented: modal.visitor.id_presented,
            }}
            onSave={(i) => void saveVisitor(i)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'qr' && <VisitorQrModal visitor={modal.visitor} onClose={() => setModal(null)} />}

      {toast && <Toast message={toast} />}
    </div>
  );
}
