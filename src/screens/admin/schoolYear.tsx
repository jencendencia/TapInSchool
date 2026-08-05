// Global school-year selection for the admin area. The selector lives in the
// title bar; every year-scoped page (Sections rosters, Students enrollment,
// Reports groupings) reads the SAME selection from here, so picking a year in
// the title bar re-scopes the whole dashboard.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SchoolYear } from '../../../shared/types';
import { api } from '../../lib/api';

interface SchoolYearCtxValue {
  /** All registered school years (exactly one flagged current). */
  years: SchoolYear[];
  /** The globally selected school year name (defaults to the current year). */
  year: string;
  /** The current year's name ('' before load). */
  currentYear: string;
  setYear: (name: string) => void;
  /** Re-fetches the year list (call after add / set-current / delete). */
  refresh: () => Promise<void>;
}

const SchoolYearCtx = createContext<SchoolYearCtxValue>({
  years: [],
  year: '',
  currentYear: '',
  setYear: () => undefined,
  refresh: async () => undefined,
});

export function SchoolYearProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [year, setYear] = useState('');
  const prevCurrent = useRef('');

  const refresh = useCallback(async () => {
    try {
      const list = await api.listSchoolYears();
      setYears(list);
      const current = list.find((y) => y.is_current)?.name ?? list[0]?.name ?? '';
      setYear((prev) => {
        // Follow a rollover: when we were on the old current year and the DB
        // current year moved, jump the selection to the new current year.
        if (prevCurrent.current && prev === prevCurrent.current && current && current !== prevCurrent.current) {
          return current;
        }
        return prev && list.some((y) => y.name === prev) ? prev : current;
      });
      prevCurrent.current = current;
    } catch {
      // DB offline — keep the last known list and selection; the title bar
      // degrades gracefully instead of throwing an unhandled rejection.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: SchoolYearCtxValue = {
    years,
    year,
    currentYear: years.find((y) => y.is_current)?.name ?? year,
    setYear,
    refresh,
  };
  return <SchoolYearCtx.Provider value={value}>{children}</SchoolYearCtx.Provider>;
}

export function useSchoolYear(): SchoolYearCtxValue {
  return useContext(SchoolYearCtx);
}
