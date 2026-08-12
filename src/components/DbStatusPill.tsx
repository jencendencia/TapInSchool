// Title-bar database pill (see NETWORK_DATABASE_CONNECTION.md §3):
//   Green  · host:port · database   — connected and ready
//   Amber  · host:port · offline    — server unreachable, retrying every 5s
//   Grey   · database …             — still resolving the config / first attempt
// Clicking the pill opens the Connect-to-database dialog.
import { useEffect, useState } from 'react';
import type { DbConfigInfo, SystemStatus } from '../../shared/types';
import { api } from '../lib/api';

export function DbStatusPill({ dbStatus, onClick }: { dbStatus?: SystemStatus['db']; onClick: () => void }) {
  const [cfg, setCfg] = useState<DbConfigInfo | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .getDbConfig()
      .then((c) => {
        if (live) setCfg(c);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const online = dbStatus?.online;
  const hostPort = cfg ? `${cfg.host}:${cfg.port}` : '';
  const dbName = cfg?.database ?? 'Database';
  const tone = online === undefined ? 'grey' : online ? 'green' : 'amber';
  const label = online === undefined ? `${dbName} …` : online ? `${hostPort} · ${dbName}` : `${hostPort} · offline`;

  return (
    <button
      type="button"
      className={`db-pill db-pill-${tone}`}
      onClick={onClick}
      title={`${dbStatus?.detail ?? 'Resolving database connection…'} — click to connect to a different server`}
    >
      <span className="db-pill-dot" />
      <span className="db-pill-label">{label}</span>
    </button>
  );
}
