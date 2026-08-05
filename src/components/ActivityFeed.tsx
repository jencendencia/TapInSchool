// Live activity feed shown in the kiosk right panel (PRD Screen A).
import type { ActivityItem } from '../../shared/types';
import { Avatar, EntryChip, SmsStatusPill, fmtTimeSec } from './shared';

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="feed-empty">
        <span className="feed-empty-icon">📡</span>
        <p>No scans yet today.<br />Waiting for the first QR code…</p>
      </div>
    );
  }
  return (
    <ul className="feed-list">
      {items.map((item) => (
        <li key={item.id} className="feed-item">
          <Avatar name={item.full_name} photoUrl={null} size={38} />
          <div className="feed-main">
            <div className="feed-name">{item.full_name}</div>
            <div className="feed-meta">
              {item.grade_section} · {fmtTimeSec(item.scanned_at)}
            </div>
          </div>
          <div className="feed-right">
            {item.flag && <span className={`pill pill-${item.flag.toLowerCase()}`}>{item.flag}</span>}
            <EntryChip type={item.entry_type} />
            <SmsStatusPill status={item.sms_status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
