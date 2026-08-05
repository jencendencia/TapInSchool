// Admin & Management Dashboard (PRD Screen B): sidebar navigation with
// Overview, Students, Attendance Logs, SMS Outbox, and Settings pages.
import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api, isElectron } from '../../lib/api';
import { WindowControls } from '../../components/WindowControls';
import { OverviewPage } from './Overview';
import { StudentsPage } from './Students';
import { LogsPage } from './Logs';
import { SmsOutboxPage } from './SmsOutbox';
import { SettingsPage } from './Settings';
import { ReportsPage } from './Reports';
import { SchoolLogo } from '../../components/shared';

type Tab = 'overview' | 'students' | 'logs' | 'reports' | 'sms' | 'settings';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'students', label: 'Students', icon: '🧑‍🎓' },
  { id: 'logs', label: 'Attendance Logs', icon: '🕐' },
  { id: 'reports', label: 'Reports', icon: '📄' },
  { id: 'sms', label: 'SMS Outbox', icon: '✉' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function AdminDashboard({ onBackToKiosk, onLogout }: { onBackToKiosk: () => void; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [settings, setSettings] = useState<Settings | null>(null);

  // Refetch on tab switch so a freshly saved logo / school name in Settings
  // shows up in the sidebar right away.
  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, [tab]);

  return (
    <div className="admin">
      {isElectron && (
        <div className="admin-titlebar">
          <span className="admin-titlebar-label">{settings?.school_name || 'TapIn School'} · Admin</span>
          <WindowControls />
        </div>
      )}
      <div className="admin-body">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <div className="kiosk-logo">
              <SchoolLogo logoUrl={settings?.logo_url} />
            </div>
            <div>
              <div className="kiosk-name">{settings?.school_name || 'TapIn School'}</div>
              <div className="kiosk-tagline">Admin Dashboard</div>
            </div>
          </div>
          <nav className="admin-nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                className={`admin-nav-item ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <span className="admin-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-foot">
            <button className="btn-ghost" onClick={onLogout}>
              🔒 Log out
            </button>
            <button className="btn-primary" onClick={onBackToKiosk}>
              ← Back to Kiosk
            </button>
          </div>
        </aside>
        <main className="admin-main">
          {tab === 'overview' && <OverviewPage />}
          {tab === 'students' && <StudentsPage />}
          {tab === 'logs' && <LogsPage />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'sms' && <SmsOutboxPage />}
          {tab === 'settings' && (
            <SettingsPage
              onSettingsSaved={() => {
                void api.getSettings().then(setSettings);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
