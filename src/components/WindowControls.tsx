// Frameless-window controls (minimize / maximize / close) used on the kiosk
// and admin screens, since the BrowserWindow is created with frame: false.
// Only rendered in Electron — browser mock mode has no OS window to control.
import { api } from '../lib/api';

export function WindowControls() {
  return (
    <div className="win-controls">
      <button
        type="button"
        className="win-btn"
        onClick={() => void api.windowMinimize()}
        title="Minimize"
        aria-label="Minimize"
      >
        <span className="win-icon win-icon-min">─</span>
      </button>
      <button
        type="button"
        className="win-btn"
        onClick={() => void api.windowMaximizeToggle()}
        title="Maximize / Restore"
        aria-label="Maximize / Restore"
      >
        <span className="win-icon">▢</span>
      </button>
      <button
        type="button"
        className="win-btn win-btn-close"
        onClick={() => void api.windowClose()}
        title="Close"
        aria-label="Close"
      >
        <span className="win-icon">✕</span>
      </button>
    </div>
  );
}
