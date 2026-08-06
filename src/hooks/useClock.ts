import { useEffect, useState } from 'react';

export interface ClockState {
  time: string;
  date: string;
}

function getClock(): ClockState {
  const now = new Date();
  return {
    // 12-hour clock with AM/PM (e.g. "03:05:12 PM").
    time: now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  };
}

export function useClock(): ClockState {
  const [clock, setClock] = useState<ClockState>(getClock);
  useEffect(() => {
    const t = setInterval(() => setClock(getClock()), 1000);
    return () => clearInterval(t);
  }, []);
  return clock;
}
