import { useEffect, useState } from 'react';
import { nowOnDay } from '../../../domain/schedule/clock.js';

/** Secondes depuis minuit (Paris) le jour `date`, recalculées toutes les 30 s ; null un autre jour que celui de la compétition. */
export function useNow(date: string): number | null {
  const [now, setNow] = useState(() => nowOnDay(new Date(), date));
  useEffect(() => {
    const tick = () => setNow(nowOnDay(new Date(), date));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [date]);
  return now;
}
