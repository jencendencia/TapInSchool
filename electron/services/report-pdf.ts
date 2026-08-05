// PDF export for the attendance report. Rather than calling printToPDF on the
// live kiosk window (which depends on the app's @media print stylesheet and is
// unreliable — Electron/Chromium can produce blank output from a fullscreen
// frameless window), we render the report into a dedicated hidden window whose
// entire document IS the report, then print that. The result is deterministic
// and independent of the visible UI.
import { BrowserWindow } from 'electron';
import { buildReportHtml } from '../../shared/report-html';
import type { ReportData } from '../../shared/types';

export async function exportReportToPdf(report: ReportData): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      // Don't throttle timers in the hidden window while it settles.
      backgroundThrottling: false,
    },
  });
  try {
    // paintWhenInitiallyHidden defaults to true, so the hidden window still
    // composites and printToPDF captures real content. (If blank output ever
    // persists on a specific GPU/windows combo, webPreferences.offscreen: true
    // is the guaranteed-compositing fallback.)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildReportHtml(report)));
    // Give layout/rendering a moment to settle before capturing.
    await new Promise((r) => setTimeout(r, 150));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      // Page size and margins come from the document's @page rule.
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
