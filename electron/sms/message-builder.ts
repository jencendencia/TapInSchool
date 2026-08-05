// Composes the parent SMS text from an attendance event.
// NOTE: templates must stay ASCII-only — non-ASCII characters (like the em
// dash) force the 'unicode' SMS type, which doubles the credit cost and can
// trip telco filters on Smart/TNT lines.
import type { AttendanceFlag, EntryType, Settings } from '../../shared/types';

export interface SmsContext {
  fullName: string;
  gradeSection: string;
  /** Attendance event type; omitted for non-attendance alerts (absence). */
  entryType?: EntryType;
  /** LATE / EARLY flag (optional — include {{flag}} in the template to show it). */
  flag?: AttendanceFlag;
  /** True for automated absence alerts — overrides the action text. */
  absence?: boolean;
  scannedAt: Date;
  school: string;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function buildSmsMessage(template: string, ctx: SmsContext): string {
  const action = ctx.absence
    ? 'was marked absent today'
    : ctx.entryType === 'IN'
      ? 'checked IN to school'
      : 'checked OUT of school';
  // Function replacements insert values literally (no $-sequence / placeholder
  // re-scanning), and school is replaced LAST so the school name value can
  // never be interpreted as another placeholder. Use '-' fallbacks so
  // messages stay ASCII (plain SMS = 1 credit).
  return template
    .replace(/\{\{name\}\}/g, () => ctx.fullName)
    .replace(/\{\{section\}\}/g, () => ctx.gradeSection || '-')
    .replace(/\{\{action\}\}/g, () => action)
    .replace(/\{\{flag\}\}/g, () => ctx.flag || '')
    .replace(/\{\{time\}\}/g, () => formatTime(ctx.scannedAt))
    .replace(/\{\{school\}\}/g, () => ctx.school || 'TapIn School');
}

export function resolveTemplate(settings: Settings): string {
  return settings.sms_template || DEFAULT_TEMPLATE;
}

export const DEFAULT_TEMPLATE =
  '{{school}} Alert: {{name}} ({{section}}) {{action}} at {{time}}. Please advise. - {{school}}';
