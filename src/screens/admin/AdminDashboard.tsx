// Admin & Management Dashboard (PRD Screen B): sidebar navigation with
// Overview, Students, Attendance Logs, SMS Outbox, and Settings pages.
import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api, isElectron } from '../../lib/api';
import { WindowControls } from '../../components/WindowControls';
import { SchoolYearSelect } from '../../components/SchoolYearSelect';
import { SchoolYearProvider } from './schoolYear';
import { OverviewPage } from './Overview';
import { StudentsPage } from './Students';
import { SectionsPage } from './Sections';
import { LogsPage } from './Logs';
import { SmsOutboxPage } from './SmsOutbox';
import { SettingsPage } from './Settings';
import { ReportsPage } from './Reports';
import { BadgesPage } from './Badges';
import { AnnouncementsPage } from './Announcements';
import { UsersPage } from './Users';
import { Modal, SchoolLogo } from '../../components/shared';

type Tab = 'overview' | 'students' | 'sections' | 'logs' | 'reports' | 'badges' | 'sms' | 'announcements' | 'users' | 'settings';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'students', label: 'Students', icon: '🧑‍🎓' },
  { id: 'sections', label: 'Sections', icon: '🧑‍🏫' },
  { id: 'logs', label: 'Attendance Logs', icon: '🕐' },
  { id: 'reports', label: 'Reports', icon: '📄' },
  { id: 'badges', label: 'Badges & Ranking', icon: '🏅' },
  { id: 'sms', label: 'SMS Outbox', icon: '✉' },
  { id: 'announcements', label: 'Announcements', icon: '📢' },
  { id: 'users', label: 'Users & Roles', icon: '🧑‍💼' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Refetch on tab switch so a freshly saved logo / school name in Settings
  // shows up in the sidebar right away.
  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, [tab]);

  return (
    <SchoolYearProvider>
      <div className="admin">
        <div className="admin-titlebar">
          <span className="admin-titlebar-label">{settings?.school_name || 'TapIn School'} · Admin</span>
          <div className="admin-titlebar-right">
            <SchoolYearSelect />
            {isElectron && <WindowControls />}
          </div>
        </div>
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
            <button className="btn-ghost" onClick={() => setConfirmLogout(true)}>
              🔒 Log out
            </button>
<button className="btn-primary" onClick={onLogout}>
              ← Back to Kiosk
            </button>
          </div>
        </aside>
        <main className="admin-main">
          {tab === 'overview' && <OverviewPage />}
          {tab === 'students' && <StudentsPage />}
          {tab === 'sections' && <SectionsPage />}
          {tab === 'logs' && <LogsPage />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'badges' && <BadgesPage />}
{tab === 'sms' && <SmsOutboxPage />}
          {tab === 'announcements' && <AnnouncementsPage />}
          {tab === 'users' && <UsersPage />}
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

      {confirmLogout && (
        <Modal title="Log out" closeOnOverlay={false} onClose={() => setConfirmLogout(false)}>
          <p className="text-dim" style={{ marginBottom: 18 }}>
            Are you sure you want to log out of the admin dashboard? You will need to sign in again to manage students, attendance, and reports.
          </p>
          <div className="form-actions">
            <button className="btn-ghost" onClick={() => setConfirmLogout(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setConfirmLogout(false);
                onLogout();
              }}
            >
              Log out
            </button>
          </div>
        </Modal>
      )}
    </SchoolYearProvider>
  );
}
