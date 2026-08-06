# Task: Configurable seconds-per-announcement on the Announcements page

## Steps
- [x] 1. `shared/types.ts`: add `announcement_slide_seconds: number` to `Settings`.
- [x] 2. `electron/db/settings.ts`: add default + KEYS whitelist entry.
- [x] 3. `src/lib/api.ts`: add default in `DEFAULT_MOCK_SETTINGS`.
- [x] 4. `src/screens/admin/Announcements.tsx`: add "Display duration (seconds)" field + save.
- [x] 5. `src/screens/KioskScreen.tsx`: use configured seconds for non-video slides.
- [x] 6. Run `npm run typecheck` to verify.

All steps complete. Typecheck passes cleanly.
