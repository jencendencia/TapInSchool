// School logo persistence. The renderer uploads a small resized image as a
// `data:image/...;base64,...` URI. Instead of storing that blob in the
// `settings` table, we write it to disk under the app's userData folder and
// store only a `tapin-logo://logo/<file>` URL in the DB. main.ts registers a
// protocol handler that serves these files back to the renderer, so both dev
// (http) and packaged (file://) builds can render them.
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

const SCHEME = 'tapin-logo';
const URL_PREFIX = `${SCHEME}://logo/`;
const LOGO_DIR = 'logos';
const LOGO_BASE = 'school-logo';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function logosDir(): string {
  return path.join(app.getPath('userData'), LOGO_DIR);
}

/** Removes every persisted school-logo file in the given directory (best-effort). */
async function clearLogoFiles(dir: string): Promise<void> {
  const existing = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    existing
      .filter((f) => f.startsWith(LOGO_BASE))
      .map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined)),
  );
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error('Unsupported logo image format');
  const mime = match[1];
  const ext =
    mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
  return { buffer: Buffer.from(match[2], 'base64'), ext };
}

/**
 * Persists a data-URI logo to disk and returns its `tapin-logo://` URL.
 * Any previously saved logo file is removed first so only the current one
 * stays on disk (handles a format change, e.g. png -> jpg).
 */
export async function saveLogo(dataUrl: string): Promise<string> {
  const { buffer, ext } = parseDataUrl(dataUrl);
  const dir = logosDir();
  await fs.mkdir(dir, { recursive: true });
  // Drop any previously saved logo so only the current one stays on disk
  // (handles a format change, e.g. png -> jpg).
  await clearLogoFiles(dir);
  await fs.writeFile(path.join(dir, `${LOGO_BASE}.${ext}`), buffer);
  return `${URL_PREFIX}${LOGO_BASE}.${ext}`;
}

/** Removes every persisted logo file (used when the logo is cleared). */
export async function deleteAllLogos(): Promise<void> {
  await clearLogoFiles(logosDir());
}

/** Content-Type for a served file, falling back to a generic binary type. */
export function mimeForFile(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream';
}
