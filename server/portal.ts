// TapIn Teacher Portal — embedded in the kiosk app so installing/running
// TapIn School automatically serves the COMPANION app's web portal at
// http://<this-machine-ip>:4000 (no separate install for teachers).
//
//   • Backend: reuses the kiosk's own services where possible (badges/excuses,
//     DB, settings) plus ported teacher-side services (server/attendance.ts,
//     server/reports.ts, server/teacher-service.ts).
//   • Frontend: the COMPANION app's built renderer, copied into `portal-dist/`
//     at build time by scripts/build-portal.mjs and shipped with the installer
//     (extraResources in electron-builder.yml). The kiosk's own UI is never
//     served here.
//   • JSON-RPC-ish endpoint: POST /api/rpc { method, params } → { result } or
//     { error: { message } } — mirrors the companion app's TeacherApi contract.
//   • Cookie sessions (httpOnly, SameSite=Lax); the server identity is
//     authoritative — the client never picks its own actor.
//   • Exports: POST /api/export streams CSV / XLSX; PDF renders via a hidden
//     Electron window (real PDFs) with an HTML print-page fallback.
//
// Env:  PORT (default 4000) · PORTAL_BIND (default 0.0.0.0) ·
//       SESSION_TTL_HOURS (default 12) · PORTAL_ENABLED=0 disables.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { db, currentConfig } from '../electron/db/connection';
import { ensureSchema } from '../electron/db/schema';
import { withJobLock } from '../electron/services/job-lock';
import * as kioskBadges from '../electron/services/badges';
import * as attendance from './attendance';
import * as reports from './reports';
import { csvText, defaultFileName, pdfHtml, xlsxBuffer } from './export-data';
import { readSchoolInfo } from './settings';
import * as teacher from './teacher-service';
import type { TeacherRole } from './teacher-types';
import type { ReportData } from './teacher-types';

// dist-electron/server/portal.js → project root.
const ROOT = path.join(__dirname, '..', '..');

const PORT = Number(process.env.PORT || 4000);
const BIND = process.env.PORTAL_BIND || '0.0.0.0';
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_HOURS) || 12) * 3600 * 1000;
const COOKIE = 'tapin_portal';
const MAX_BODY = 10 * 1024 * 1024; // exports can carry big report payloads

/** Where the companion renderer lives: extraResources/portal-dist in packaged
 *  builds, <kiosk>/portal-dist in dev / standalone. */
function portalDistDir(): string {
  try {
    const { app } = require('electron') as typeof import('electron');
    if (app?.isPackaged) return path.join(process.resourcesPath, 'portal-dist');
  } catch {
    // Plain node (standalone `npm run portal`) — no electron app.
  }
  return path.join(ROOT, 'portal-dist');
}

// ---------------------------------------------------------------------------
// Sessions (in-memory; a kiosk restart signs everyone out — fine for a LAN)
// ---------------------------------------------------------------------------
interface Session {
  id: number;
  username: string;
  role: TeacherRole;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const header = String(req.headers.cookie ?? '');
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sessionFrom(req: http.IncomingMessage): Session | null {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function setSessionCookie(res: http.ServerResponse, token: string, maxAgeSeconds: number): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, maxAgeSeconds)}`,
  );
}

// ---- Login rate limiting (tiny in-memory, per IP) ---------------------------
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

function allowLogin(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX;
}

// ---------------------------------------------------------------------------
// RPC dispatch — mirrors the companion TeacherApi contract. The session
// (cookie) is the identity; the client never supplies its own actor.
// ---------------------------------------------------------------------------
type RpcHandler = (params: unknown[], session: Session) => Promise<unknown>;

const rpcHandlers: Record<string, RpcHandler> = {
  logout: async () => undefined,

  // ---- Teacher management (dept-head scoped) -------------------------------
  listTeachers: async (_p, s) => teacher.listTeachers(s),
  createTeacher: async (p, s) => teacher.createTeacher(p[0] as Parameters<typeof teacher.createTeacher>[0], s),
  updateTeacher: async (p, s) => teacher.updateTeacher(Number(p[0]), p[1] as Parameters<typeof teacher.updateTeacher>[1], s),
  deleteTeacher: async (p, s) => teacher.deleteTeacher(Number(p[0]), s),

  // ---- Sections --------------------------------------------------------------
  listAllSections: async () => teacher.listAllSections(),
  listMySections: async (_p, s) => teacher.listMySections(s.id),

  // ---- Attendance --------------------------------------------------------------
  getRoster: async (p) => attendance.getRoster(String(p[0]), p[1] as string | undefined),
  getStudentDay: async (p) => attendance.getStudentDay(Number(p[0]), p[1] as string | undefined),
  manualCheckIn: async (p) => attendance.manualCheckIn(Number(p[0])),
  sectionTodayStats: async (p) => attendance.sectionTodayStats(String(p[0])),

  // ---- Excuses + badges (kiosk's own service; self-heal after edits) ----------
  listExcuses: async (p) => kioskBadges.listExcuses(Number(p[0])),
  addExcuse: async (p) => {
    const excuse = await kioskBadges.addExcuse(Number(p[0]), String(p[1]), p[2] as Parameters<typeof kioskBadges.addExcuse>[2], p[3] as string | undefined);
    // The kiosk's addExcuse doesn't recompute — do it here so badge rows stay
    // correct immediately (same behavior as the companion app).
    await kioskBadges.recomputeStudent(Number(p[0])).catch(() => undefined);
    return excuse;
  },
  removeExcuse: async (p) => {
    const studentId = await kioskBadges.removeExcuse(Number(p[0]));
    if (studentId) await kioskBadges.recomputeStudent(studentId).catch(() => undefined);
    return undefined;
  },
  getStudentBadges: async (p) => kioskBadges.evaluateStudentToday(Number(p[0])),
  badgeLeaderboard: async (p) =>
    kioskBadges.badgeLeaderboard(Number(p[1]) || 10, p[0] ? String(p[0]) : undefined),

  // ---- Reports (ported builders) ------------------------------------------------
  getSectionReport: async (p) => reports.getSectionReport(String(p[0]), String(p[1]), String(p[2])),
  getPerSectionReport: async (p) => reports.getPerSectionReport(p[0] as string[], String(p[1]), String(p[2])),
  getAbsenteeReport: async (p) => reports.getAbsenteeReport(String(p[0]), String(p[1]), String(p[2])),
  getTardinessReport: async (p) => reports.getTardinessReport(String(p[0]), String(p[1]), String(p[2])),
  getRegisterReport: async (p) => reports.getRegisterReport(String(p[0]), String(p[1]), String(p[2])),

  // The Connect-to-database dialog is desktop-only; the portal reads .env.
  connectDb: async () => {
    throw new Error('Not available in the portal — set DB_* variables in the kiosk\u2019s .env file.');
  },
  resetDbConfig: async () => {
    throw new Error('Not available in the portal — set DB_* variables in the kiosk\u2019s .env file.');
  },
};

function rpcResult(method: string, params: unknown[], session: Session | null): Promise<{ result: unknown } | { error: { message: string } }> {
  const handler = rpcHandlers[method];
  if (!handler) {
    return Promise.resolve({ error: { message: `Unknown method "${method}".` } });
  }
  return Promise.resolve()
    .then(() => handler(params, session as Session))
    .then((result) => ({ result }))
    .catch((err: Error) => ({ error: { message: err?.message ?? 'Internal error.' } }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
/** Renders a real PDF via a hidden Electron window (the kiosk always runs
 *  inside Electron). Returns null when Electron isn't available (standalone
 *  node run) — the caller then streams the print HTML instead. */
async function pdfBytes(data: ReportData, meta?: { schoolName?: string; schoolYear?: string }): Promise<Buffer | null> {
  try {
    const { BrowserWindow } = require('electron') as typeof import('electron');
    const win = new BrowserWindow({
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pdfHtml(data, meta)));
      await new Promise((r) => setTimeout(r, 150));
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  } catch {
    return null;
  }
}

async function handleExport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const kind = String(body?.kind ?? '');
  const data = body?.data as ReportData | undefined;
  if (!data || typeof data !== 'object' || typeof data.kind !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid export payload.' } }));
    return;
  }

  if (kind === 'csv') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${defaultFileName(data, 'csv')}"`,
    });
    res.end(csvText(data));
    return;
  }
  if (kind === 'xlsx') {
    const buf = await xlsxBuffer(data);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${defaultFileName(data, 'xlsx')}"`,
    });
    res.end(buf);
    return;
  }
  if (kind === 'pdf') {
    const info = await readSchoolInfo();
    const meta = { schoolName: info.schoolName, schoolYear: info.schoolYear };
    const pdf = await pdfBytes(data, meta);
    if (pdf) {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${defaultFileName(data, 'pdf')}"`,
      });
      res.end(pdf);
    } else {
      // No Electron (standalone node run): print-ready HTML that auto-opens
      // the browser print dialog (Save as PDF).
      const html = pdfHtml(data, meta).replace('</body>', '<script>window.addEventListener(\'load\', () => setTimeout(() => window.print(), 250));</script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'inline' });
      res.end(html);
    }
    return;
  }
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Unknown export kind.' } }));
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

const PORTAL_SCRIPT = '<script>window.__TAPIN_PORTAL__ = true;</script>';

/** The bundled companion index.html with the portal-mode flag injected. */
function portalIndexHtml(distDir: string): string {
  let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  if (!html.includes('window.__TAPIN_PORTAL__ = true')) {
    html = html.replace('</head>', `${PORTAL_SCRIPT}</head>`);
  }
  return html;
}

const NOT_BUNDLED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TapIn Teacher Portal</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;background:#020617;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:32px 40px;max-width:520px}
h1{font-size:18px;margin:0 0 8px}p{color:#94a3b8;font-size:13px;line-height:1.5}code{background:#1e293b;padding:2px 6px;border-radius:6px}</style></head>
<body><div class="card"><h1>🎓 TapIn Teacher portal</h1>
<p>The portal UI is not bundled with this build. Rebuild with <code>npm run build</code> (or <code>npm run dist</code>) from the kiosk folder so <code>portal-dist/</code> is included, then restart.</p>
</div></body></html>`;

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const distDir = portalDistDir();
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(NOT_BUNDLED_PAGE);
    return;
  }

  const url = (req.url ?? '/').split('?')[0];
  const requested = url === '/' ? '/index.html' : url;
  const filePath = path.normalize(path.join(distDir, requested));
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (!url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(portalIndexHtml(distDir));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (filePath === indexHtml) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(portalIndexHtml(distDir));
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
}

function clientIp(req: http.IncomingMessage): string {
  return String(req.socket.remoteAddress ?? 'unknown');
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
let server: http.Server | null = null;

export function isPortalRunning(): boolean {
  return server !== null;
}

/** Starts the portal HTTP server. Safe to call once. The DB + schema are
 *  handled by the kiosk's own boot; the standalone `npm run portal` script
 *  boots them itself. PORTAL_ENABLED=0 (or a busy port) disables gracefully. */
export function startPortal(): void {
  if (server || String(process.env.PORTAL_ENABLED) === '0') return;
  const srv = http.createServer(handler);
  server = srv;
  srv.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[tapin-portal] port ${PORT} already in use — portal disabled on this machine.`);
    } else {
      console.error('[tapin-portal] server error:', err.message);
    }
    server = null;
  });
  srv.listen(PORT, BIND, () => {
    const ui = fs.existsSync(path.join(portalDistDir(), 'index.html'));
    console.log(`[tapin-portal] TapIn Teacher portal on http://${BIND}:${PORT} (portal UI ${ui ? 'bundled' : 'NOT bundled — run npm run build'})`);
  });
}

export function stopPortal(): void {
  if (!server) return;
  const srv = server;
  server = null;
  srv.close(() => undefined);
}

const handler: http.RequestListener = async (req, res) => {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];

  // Hardening headers (LAN-grade; production would add a stricter CSP).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    if (url === '/api/health' && method === 'GET') {
      sendJson(res, 200, { ok: true, db: db.isOnline() });
      return;
    }

    if (url === '/api/rpc' && method === 'POST') {
      const body = await readJsonBody(req);
      const rpcMethod = String(body?.method ?? '');
      const params: unknown[] = Array.isArray(body?.params) ? body.params : [];

      if (rpcMethod === 'login') {
        const ip = clientIp(req);
        if (!allowLogin(ip)) {
          sendJson(res, 429, { error: { message: 'Too many sign-in attempts. Try again in a few minutes.' } });
          return;
        }
        const result = await teacher.login(String(params[0] ?? ''), String(params[1] ?? ''));
        if (result.ok && result.teacher) {
          const token = crypto.randomBytes(24).toString('hex');
          sessions.set(token, {
            id: result.teacher.id,
            username: result.teacher.username,
            role: result.teacher.role,
            expiresAt: Date.now() + SESSION_TTL_MS,
          });
          setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
        }
        sendJson(res, 200, { result });
        return;
      }

      if (rpcMethod === 'countTeachers' || rpcMethod === 'getStatus' || rpcMethod === 'getDbConfig') {
        let result: unknown;
        if (rpcMethod === 'countTeachers') result = await teacher.countTeachers();
        else if (rpcMethod === 'getStatus') result = { db: db.getStatus() };
        else {
          const cfg = currentConfig();
          const fromEnv = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].some((k) => process.env[k] !== undefined);
          result = {
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            database: cfg.database,
            hasSavedPassword: false,
            isSaved: false,
            source: fromEnv ? 'env' : 'defaults',
            online: db.isOnline(),
          };
        }
        sendJson(res, 200, { result });
        return;
      }

      const session = sessionFrom(req);
      if (!session) {
        sendJson(res, 401, { error: { message: 'Session expired — sign in again.' } });
        return;
      }

      if (rpcMethod === 'logout') {
        const token = parseCookies(req)[COOKIE];
        if (token) sessions.delete(token);
        setSessionCookie(res, token, 0);
        sendJson(res, 200, { result: undefined });
        return;
      }

      sendJson(res, 200, await rpcResult(rpcMethod, params, session));
      return;
    }

    if (url === '/api/export' && method === 'POST') {
      if (!sessionFrom(req)) {
        sendJson(res, 401, { error: { message: 'Session expired — sign in again.' } });
        return;
      }
      await handleExport(req, res);
      return;
    }

    if (url.startsWith('/api/')) {
      sendJson(res, 404, { error: { message: 'Not found.' } });
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 400, { error: { message: (err as Error).message ?? 'Bad request.' } });
    } else {
      res.destroy();
    }
  }
};

// ---------------------------------------------------------------------------
// Standalone run (npm run portal — for testing without the kiosk UI)
// ---------------------------------------------------------------------------
async function bootForStandalone(): Promise<void> {
  db.on('status', (s: { online: boolean }) => {
    if (s.online) {
      void withJobLock('tapin:schema', () => ensureSchema(db.query.bind(db)), 60)
        .catch((err) => console.error('[tapin-portal] schema apply failed:', err));
    }
  });
  db.start();
  const deadline = Date.now() + 30000;
  while (!db.isOnline() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (db.isOnline()) {
    try {
      await withJobLock('tapin:schema', () => ensureSchema(db.query.bind(db)), 60);
    } catch (err) {
      console.error('[tapin-portal] schema init failed:', err);
    }
  }
}

if (require.main === module) {
  const { loadEnv } = require('../electron/lib/env') as typeof import('../electron/lib/env');
  loadEnv(ROOT);
  startPortal();
  void bootForStandalone();
  process.on('SIGINT', () => {
    void db.stop().finally(() => {
      stopPortal();
      process.exit(0);
    });
  });
  process.on('SIGTERM', () => {
    void db.stop().finally(() => {
      stopPortal();
      process.exit(0);
    });
  });
}
