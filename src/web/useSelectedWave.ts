import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useWaves } from './api.js';

/**
 * Vague choisie (adresse `?vague=`) ; à défaut ou si elle n'existe plus : la première dont la pesée n'est pas clôturée
 * (`weighIn`, Pesée et Recasement) ou la dernière dont la pesée est clôturée (`running`, Combats) ; sinon la première.
 * Écrite dans l'adresse ; null sans vague.
 */
export function useSelectedWave(id: string, prefer: 'weighIn' | 'running' = 'weighIn') {
  const { data: waves = [], isSuccess } = useWaves(id);
  const [params, setParams] = useSearchParams();
  const asked = params.get('vague');
  const fallback = prefer === 'weighIn' ? waves.find((w) => !w.weighInClosed) : [...waves].reverse().find((w) => w.weighInClosed);
  const waveId = waves.find((w) => w.id === asked)?.id ?? (fallback ?? waves[0])?.id ?? null;
  const select = (v: string) => setParams((p) => { p.set('vague', v); return p; }, { replace: true });
  useEffect(() => {
    if (waveId && asked !== waveId) select(waveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveId, asked]);
  return { waves, waveId, select, ready: isSuccess };
}
