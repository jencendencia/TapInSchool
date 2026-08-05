import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { KioskScreen } from './screens/KioskScreen';
import { AdminDashboard } from './screens/admin/AdminDashboard';
import { LoginModal } from './components/LoginModal';
import { ActivationScreen } from './components/ActivationScreen';

export default function App() {
  const [mode, setMode] = useState<'kiosk' | 'admin'>('kiosk');
  const [loginOpen, setLoginOpen] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [activated, setActivated] = useState<boolean | null>(null);

  // Toggling to admin requires a successful sign-in (kiosk stays public).
  const handleToggleAdmin = useCallback(() => {
    if (mode === 'kiosk') {
      if (adminAuthed) setMode('admin');
      else setLoginOpen(true);
    } else {
      setMode('kiosk');
    }
  }, [mode, adminAuthed]);

  const handleLoginSuccess = useCallback(() => {
    setAdminAuthed(true);
    setLoginOpen(false);
    setMode('admin');
  }, []);

  const handleLogout = useCallback(() => {
    void api.logout();
    setAdminAuthed(false);
    setMode('kiosk');
  }, []);

// Ctrl+Shift+A is a global shortcut in Electron (main process) and a
  // keydown listener in browser mock mode — both surface through onToggleAdmin.
  useEffect(() => api.onToggleAdmin(handleToggleAdmin), [handleToggleAdmin]);

  // License gate: check activation on startup. Browser mock mode always
  // reports activated, so dev workflows are unaffected.
  useEffect(() => {
    void api.checkLicense().then((r) => setActivated(r.activated));
  }, []);

  if (activated === null) {
    // Still checking the license — show a minimal loading state.
    return <div className="activation-screen"><div className="spinner" /></div>;
  }
  if (!activated) {
    return <ActivationScreen onActivated={() => setActivated(true)} />;
  }

  return (
    <>
      {mode === 'kiosk' ? (
        <KioskScreen onOpenAdmin={handleToggleAdmin} />
      ) : (
        <AdminDashboard onBackToKiosk={handleToggleAdmin} onLogout={handleLogout} />
      )}
      {loginOpen && <LoginModal onSuccess={handleLoginSuccess} onCancel={() => setLoginOpen(false)} />}
    </>
  );
}
