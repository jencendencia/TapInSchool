// Announcements: manage the kiosk idle slideshow. Each announcement is a
// title + optional text and/or an uploaded image/video. When the kiosk is
// idle for the configured number of minutes, the active announcements are
// shown one by one in the central display. The idle delay is editable here.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Announcement, AnnouncementInput, AnnouncementMediaType } from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, Spinner, Toast } from '../../components/shared';

type ModalState =
  | { type: 'add' }
  | { type: 'edit'; announcement: Announcement }
  | { type: 'delete'; announcement: Announcement }
  | null;

const EMPTY_FORM: AnnouncementInput = {
  title: '',
  content_text: '',
  media: null,
  media_type: 'none',
  is_active: true,
  sort_order: 0,
};

function AnnouncementForm({
  initial,
  isEdit,
  onSave,
  onCancel,
}: {
  initial: AnnouncementInput;
  isEdit: boolean;
  onSave: (input: AnnouncementInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AnnouncementInput>(initial);
  const [preview, setPreview] = useState<string | null>(initial.media ?? null);
  const [previewType, setPreviewType] = useState<AnnouncementMediaType>(initial.media_type);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (file?: File | null) => {
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('Please choose an image (PNG/JPEG/GIF/WEBP) or a video (MP4/WEBM).');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the file.');
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setForm((f) => ({ ...f, media: dataUrl, media_type: isVideo ? 'video' : 'image' }));
      setPreview(dataUrl);
      setPreviewType(isVideo ? 'video' : 'image');
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const removeMedia = () => {
    setForm((f) => ({ ...f, media: null, media_type: 'none' }));
    setPreview(null);
    setPreviewType('none');
  };

  const isVideo = previewType === 'video';

  const submit = () => {
    // The title is an admin-only label (never shown on the kiosk), so an
    // announcement must carry a message and/or media to display anything.
    if (!form.content_text.trim() && !form.media) {
      setError('Add a message and/or an image/video.');
      return;
    }
    onSave({ ...form, title: form.title.trim(), content_text: form.content_text.trim() });
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <label>Title</label>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. School Fair on Friday"
        />
        <p className="field-hint">For your reference only — the title is not shown on the kiosk.</p>
      </div>
      <div className="field">
        <label>Message</label>
        <textarea
          rows={4}
          value={form.content_text}
          onChange={(e) => setForm({ ...form, content_text: e.target.value })}
          placeholder="Optional announcement text shown on the kiosk… (leave blank for picture/video-only)"
        />
      </div>
      <div className="field">
        <label>Media (image or video)</label>
        <div className="ann-media-upload">
          {preview ? (
            <div className="ann-preview">
              {isVideo ? (
                <video src={preview} controls playsInline className="ann-preview-media" />
              ) : (
                <img src={preview} alt="Announcement preview" className="ann-preview-media" />
              )}
              <button type="button" className="btn-ghost" onClick={removeMedia}>✕ Remove media</button>
            </div>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                📁 Upload image / video
              </button>
            </>
          )}
        </div>
        <p className="field-hint">
          Images and videos are saved to this computer and shown on the kiosk when it is idle.
        </p>
      </div>
      <label className="switch-row">
        <span>Active (shown on kiosk idle screen)</span>
        <span className={`switch ${form.is_active ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}>
          <span className="switch-knob" />
        </span>
      </label>
      {error && <p className="field-hint sms-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">{isEdit ? 'Save Changes' : 'Add Announcement'}</button>
      </div>
    </form>
  );
}

// Small image/video preview for the announcements table. Videos show their
// first frame (preload="metadata") with a play badge; a broken/missing file
// falls back to a type icon so the row still reads correctly. Clicking the
// thumb opens a full-size preview (onPreview).
function MediaThumb({ ann, onPreview }: { ann: Announcement; onPreview: (a: Announcement) => void }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [ann.media_url, ann.media_type]);
  if (ann.media_type === 'none' || !ann.media_url) return <span className="text-dim">—</span>;
  return (
    <button
      type="button"
      className={`ann-thumb ann-thumb-btn${broken ? ' ann-thumb-broken' : ''}`}
      title={`Preview ${ann.title || 'announcement media'}`}
      onClick={() => onPreview(ann)}
    >
      {broken ? (
        <span className="ann-thumb-fallback">{ann.media_type === 'video' ? '🎬' : '🖼'}</span>
      ) : ann.media_type === 'video' ? (
        <>
          <video
            className="ann-thumb-media"
            src={ann.media_url}
            muted
            playsInline
            preload="metadata"
            onError={() => setBroken(true)}
          />
          <span className="ann-thumb-play">▶</span>
        </>
      ) : (
        <img
          className="ann-thumb-media"
          src={ann.media_url}
          alt={ann.title || 'Announcement media'}
          onError={() => setBroken(true)}
        />
      )}
      <span className={`pill ${ann.media_type === 'video' ? 'pill-warn' : 'pill-info'} ann-thumb-pill`}>
        {ann.media_type.toUpperCase()}
      </span>
    </button>
  );
}// Full-size media preview modal (opens from the table thumbnail). Videos are
// playable via the native controls; images are shown at natural size. The ‹/›
// arrows (and ←/→ keys) browse through the media-bearing announcements.
function MediaPreviewModal({
  ann,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  ann: Announcement;
  index?: number;
  total?: number;
  onClose: () => void;
  /** Undefined at the first announcement — the previous arrow hides. */
  onPrev?: () => void;
  /** Undefined at the last announcement — the next arrow hides. */
  onNext?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [ann.media_url, ann.media_type]);

  // Escape closes the preview; ←/→ move between announcements.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const media =
    ann.media_type !== 'none' && ann.media_url ? (
      ann.media_type === 'video' ? (
        <video
          className="ann-preview-full-media"
          src={ann.media_url}
          controls
          playsInline
          onError={() => setBroken(true)}
        />
      ) : (
        <img
          className="ann-preview-full-media"
          src={ann.media_url}
          alt={ann.title || 'Announcement media'}
          onError={() => setBroken(true)}
        />
      )
    ) : null;
  return (
    <Modal title={ann.title || 'Media preview'} onClose={onClose} wide>
      <div className="ann-preview-full">
        {typeof index === 'number' && typeof total === 'number' && total > 1 && (
          <span className="ann-preview-count">{index} / {total}</span>
        )}
        <div className="ann-preview-stage">
          {broken ? (
            <div className="ann-preview-broken">
              <span className="ann-preview-broken-icon">🗑</span>
              <p className="text-dim">This media file is missing or can no longer be loaded.</p>
            </div>
          ) : media ? (
            media
          ) : (
            <p className="text-dim">No media attached to this announcement.</p>
          )}
          <button
            type="button"
            className="ann-preview-nav ann-preview-nav-prev"
            onClick={onPrev}
            disabled={!onPrev}
            aria-label="Previous announcement"
            title="Previous announcement (←)"
          >
            ‹
          </button>
          <button
            type="button"
            className="ann-preview-nav ann-preview-nav-next"
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next announcement"
            title="Next announcement (→)"
          >
            ›
          </button>
        </div>
        {ann.content_text && <p className="ann-preview-msg">{ann.content_text}</p>}
      </div>
    </Modal>
  );
}

export function AnnouncementsPage() {
const [list, setList] = useState<Announcement[] | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [preview, setPreview] = useState<Announcement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
const [idleMin, setIdleMin] = useState<number>(1);
  const [idleSaved, setIdleSaved] = useState(false);
const [slideSec, setSlideSec] = useState<string>('8');
  const [slideSaved, setSlideSaved] = useState(false);

  const load = useCallback(() => {
    void Promise.allSettled([api.listAnnouncements(), api.getSettings()]).then(([aRes, sRes]) => {
      setList(aRes.status === 'fulfilled' ? aRes.value : []);
      if (sRes.status === 'fulfilled') {
setIdleMin(sRes.value.announcements_idle_minutes || 1);
        setSlideSec(String(sRes.value.announcement_slide_seconds || 8));
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const notify = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => {
      setToast(null);
      setToastTone('success');
    }, 4000);
  };

  const saveAnnouncement = async (input: AnnouncementInput) => {
    try {
      if (modal?.type === 'edit') {
        await api.updateAnnouncement(modal.announcement.id, input);
        notify('Announcement updated');
      } else {
        // New announcements go to the END of the carousel: an explicit
        // sort_order (max + 1) so earlier reorders are not undone by the
        // default id tie-break (fresh rows all start at sort_order 0).
        const nextOrder = (list?.length ? Math.max(0, ...list.map((a) => a.sort_order)) : -1) + 1;
        await api.createAnnouncement({ ...input, sort_order: nextOrder });
        notify('Announcement added');
      }
      setModal(null);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const removeAnnouncement = async (a: Announcement) => {
    try {
      await api.deleteAnnouncement(a.id);
      notify('Announcement deleted');
      setModal(null);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  // Reorder by rewriting a sequential sort_order (0, 1, 2, …) across the list
  // and swapping the two affected rows. The stored values are not guaranteed
  // distinct — every new announcement starts at sort_order 0 — so a plain
  // value swap between equal numbers would be a no-op; rewriting the whole
  // list both normalizes the ordering and applies the move in one step.
  const moveAnnouncement = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (!list || target < 0 || target >= list.length) return;
    const ids = list.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await Promise.all(ids.map((id, i) => api.updateAnnouncement(id, { sort_order: i })));
      notify('Announcement reordered');
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const toggleActive = async (a: Announcement) => {
    try {
      await api.updateAnnouncement(a.id, { is_active: !a.is_active });
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

const saveIdleMinutes = async () => {
    const val = Math.max(1, Math.round(idleMin) || 1);
    setIdleMin(val);
    try {
      await api.updateSettings({ announcements_idle_minutes: val });
      setIdleSaved(true);
      setTimeout(() => setIdleSaved(false), 2500);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

const saveSlideSeconds = async () => {
    const parsed = Number(slideSec);
    const val = Math.max(1, Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 1);
    setSlideSec(String(val));
    try {
      await api.updateSettings({ announcement_slide_seconds: val });
      setSlideSaved(true);
      setTimeout(() => setSlideSaved(false), 2500);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  if (!list) return <Spinner label="Loading announcements…" />;

  const activeCount = list.filter((a) => a.is_active).length;

  // The preview carousel browses only media-bearing announcements (a
  // text-only announcement has nothing to preview).
  const mediaList = list.filter((a) => a.media_type !== 'none' && a.media_url);
  const previewIndex = preview ? mediaList.findIndex((a) => a.id === preview.id) : -1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Announcements</h2>
          <p className="text-dim">
            {activeCount} active · shown on the kiosk after it is idle
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>+ New Announcement</button>
        </div>
      </div>

      <div className="toolbar">
        <label className="report-range-label text-dim">
          Kiosk idle delay
          <span className="inline-field">
            <input
              type="number"
              min={1}
              value={idleMin}
              onChange={(e) => setIdleMin(Number(e.target.value))}
              style={{ width: 70 }}
            />
            <span className="text-dim">min</span>
            <button className="btn-ghost" onClick={saveIdleMinutes}>
              {idleSaved ? '✓ Saved' : 'Save'}
            </button>
          </span>
        </label>
<span className="toolbar-divider" />
        <label className="report-range-label text-dim">
          Display duration
          <span className="inline-field">
<input
              type="number"
              min={1}
              value={slideSec}
              onChange={(e) => setSlideSec(e.target.value)}
              style={{ width: 70 }}
            />
            <span className="text-dim">sec</span>
            <button className="btn-ghost" onClick={saveSlideSeconds}>
              {slideSaved ? '✓ Saved' : 'Save'}
            </button>
          </span>
        </label>
        <span className="toolbar-divider" />
        <span className="text-dim">
          The kiosk shows active announcements after {idleMin} minute{idleMin === 1 ? '' : 's'} of no activity.
        </span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Message</th>
              <th>Media</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((a, idx) => (
              <tr key={a.id}>
                <td className="ann-title">{a.title || '(untitled)'}</td>
                <td className="ann-msg">{a.content_text || '—'}</td>
                <td>
                  <MediaThumb ann={a} onPreview={setPreview} />
                </td>
                <td>
                  <span className={`pill ${a.is_active ? 'pill-success' : 'pill-dim'}`}>
                    {a.is_active ? 'ACTIVE' : 'HIDDEN'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title="Move up" disabled={idx === 0} onClick={() => void moveAnnouncement(idx, -1)}>
                      ↑
                    </button>
                    <button className="btn-icon" title="Move down" disabled={idx === list.length - 1} onClick={() => void moveAnnouncement(idx, 1)}>
                      ↓
                    </button>
                    <button className="btn-icon" title={a.is_active ? 'Hide' : 'Show'} onClick={() => void toggleActive(a)}>
                      {a.is_active ? '🙈' : '👁'}
                    </button>
                    <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', announcement: a })}>✎</button>
                    <button className="btn-icon danger" title="Delete" onClick={() => setModal({ type: 'delete', announcement: a })}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No announcements yet. Add one to display it on the kiosk idle screen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add' && (
        <Modal title="New Announcement" closeOnOverlay={false} onClose={() => setModal(null)} wide>
          <AnnouncementForm initial={EMPTY_FORM} isEdit={false} onSave={(i) => void saveAnnouncement(i)} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.announcement.title || 'Announcement'}`} closeOnOverlay={false} onClose={() => setModal(null)} wide>
          <AnnouncementForm
            initial={{
              title: modal.announcement.title,
              content_text: modal.announcement.content_text,
              media: modal.announcement.media_url,
              media_type: modal.announcement.media_type,
              is_active: modal.announcement.is_active,
              sort_order: modal.announcement.sort_order,
            }}
            isEdit
            onSave={(i) => void saveAnnouncement(i)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'delete' && (
        <Modal title="Delete announcement" closeOnOverlay={false} onClose={() => setModal(null)}>
          <p className="text-dim" style={{ marginBottom: 18 }}>
            Are you sure you want to delete <strong style={{ color: 'var(--text)' }}>"{modal.announcement.title || '(untitled)'}"</strong>?
            This will remove it from the kiosk idle slideshow and cannot be undone.
          </p>
          <div className="form-actions">
            <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-danger" onClick={() => void removeAnnouncement(modal.announcement)}>Delete announcement</button>
          </div>
        </Modal>
      )}

      {preview && (
        <MediaPreviewModal
          ann={preview}
          index={previewIndex + 1}
          total={mediaList.length}
          onClose={() => setPreview(null)}
          onPrev={previewIndex > 0 ? () => setPreview(mediaList[previewIndex - 1]) : undefined}
          onNext={
            previewIndex >= 0 && previewIndex < mediaList.length - 1
              ? () => setPreview(mediaList[previewIndex + 1])
              : undefined
          }
        />
      )}

      {toast && <Toast message={toast} tone={toastTone} />}
    </div>
  );
}
