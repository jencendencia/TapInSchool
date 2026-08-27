// Renders the kiosk admin's school-wide SF1 (School Register) report to a PNG
// so it can be inspected. Uses the real DB. Run:
//   npx electron scripts/render-sf1-preview.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const { loadEnv } = require('../dist-electron/electron/lib/env.js');
  loadEnv(app.getAppPath());
  const { db, applySavedConfig } = require('../dist-electron/electron/db/connection.js');
  try {
    const cfgPath = path.join(process.env.APPDATA || '', 'TapIn School', 'db-config.json');
    if (fs.existsSync(cfgPath)) applySavedConfig(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  } catch {}
  db.start();
  for (let i = 0; i < 15 && !db.isOnline(); i++) await new Promise((r) => setTimeout(r, 600));

  const { getReportData } = require('../dist-electron/electron/services/report.js');
  const { buildReportHtml } = require('../dist-electron/shared/report-html.js');

  const report = await getReportData({ type: 'sf1', from: '2026-08-01', to: '2026-08-16', schoolYear: '' });
  const html = buildReportHtml(report);

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const h = await win.webContents.executeJavaScript('document.body.scrollHeight');
  win.setContentSize(1400, Math.max(900, h + 20));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage();
  const out = path.join(app.getAppPath(), 'sf1-admin-preview.png');
  fs.writeFileSync(out, image.toPNG());
  console.log('Saved:', out);
  await db.stop();
  app.quit();
});
