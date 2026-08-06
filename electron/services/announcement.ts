// Announcement media persistence. Uploaded images/videos arrive as inline
// data URIs (data:image/... or data:video/...). Instead of storing those blobs
// in the announcements table, we write each file to disk under the app's
// userData folder and store only a `tapin-media://media/<file>` URL in the DB.
// main.ts registers a protocol handler that serves these files back to the
// renderer, mirroring the tapin-logo:// scheme used for the school logo.
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

const SCHEME = 'tapin-media';
export const MEDIA_URL_PREFIX = `${SCHEME}://media/`;
const MEDIA_DIR = 'announcements';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function mediaDir(): string {
  return path.join(app.getPath('userData'), MEDIA_DIR);
}

/** Content-Type for a served media file, falling back to a generic binary type. */
export function mediaMimeForFile(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Parses a data URI into a buffer + extension. Accepts image and video types.
 * Throws for unsupported formats so the caller can surface a friendly error.
 */
function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime));base64,(.+)$/s.exec(
      dataUrl.trim(),
    );
  if (!match) throw new Error('Unsupported media format (use PNG/JPEG/GIF/WEBP image or MP4/WEBM video)');
  const mime = match[1];
  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/gif'
          ? 'gif'
          : mime === 'video/webm'
            ? 'webm'
            : mime === 'video/quicktime'
              ? 'mov'
              : 'jpg';
  return { buffer: Buffer.from(match[2], 'base64'), ext };
}

/**
 * Persists a data-URI media file to disk and returns its `tapin-media://` URL.
 * Optionally removes a previously held file (when replacing an announcement's
 * media) so orphaned files don't accumulate.
 */
export async function saveMedia(dataUrl: string, previousUrl?: string | null): Promise<string> {
  const { buffer, ext } = parseDataUrl(dataUrl);
  const dir = mediaDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `ann-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  if (previousUrl) await deleteMediaUrl(previousUrl).catch(() => undefined);
  return `${MEDIA_URL_PREFIX}${filename}`;
}

/** Removes a single media file referenced by a tapin-media:// URL (best-effort). */
export async function deleteMediaUrl(mediaUrl: string | null | undefined): Promise<void> {
  if (!mediaUrl) return;
  if (!mediaUrl.startsWith(MEDIA_URL_PREFIX)) return;
  const key = mediaUrl.slice(MEDIA_URL_PREFIX.length);
  const filePath = path.resolve(mediaDir(), key);
  if (!filePath.startsWith(mediaDir() + path.sep)) return; // path-traversal guard
  await fs.unlink(filePath).catch(() => undefined);
}
