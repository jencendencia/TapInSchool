// Kiosk gate-direction mode. Lives in the MAIN process so every scan path —
// USB scanner, webcam fallback, manual check-in — consults the same state.
//
// 'auto' keeps the toggle engine (last scan of the day decides IN/OUT).
// 'in' / 'out' force every scan to that entry type, which lets gate staff
// record a correct check-OUT for a student who forgot to swipe in the morning
// (the toggle engine would otherwise call it "Checked IN" in the afternoon).
//
// The mode deliberately RESETS to 'auto' on every app start: a forced mode
// left over from yesterday must not silently mis-record today's scans.
import type { EntryType, ScanMode } from '../../shared/types';

let current: ScanMode = 'auto';

export function getScanMode(): ScanMode {
  return current;
}

export function setScanMode(mode: ScanMode): ScanMode {
  current = mode === 'in' || mode === 'out' ? mode : 'auto';
  return current;
}

/** The forced entry type for a mode — undefined when 'auto' (use the toggle). */
export function forcedEntryType(mode: ScanMode): EntryType | undefined {
  if (mode === 'in') return 'IN';
  if (mode === 'out') return 'OUT';
  return undefined;
}
