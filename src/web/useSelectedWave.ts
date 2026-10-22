import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useWaves } from './api.js';

/**
 * Vague choisie (adresse `?vague=`) ; à défaut ou si elle n'existe plus, la première dont la pesée n'est pas clôturée
 * (sinon la première), écrite dans l'adresse. null sans vague. Partagé par la Pesée et le Recasement.
 */
export function useSelectedWave(id: string) {
  const { data: waves = [], isSuccess } = useWaves(id);
  const [params, setParams] = useSearchParams();
  const asked = params.get('vague');
  const waveId = waves.find((w) => w.id === asked)?.id ?? (waves.find((w) => !w.weighInClosed) ?? waves[0])?.id ?? null;
  const select = (v: string) => setParams((p) => { p.set('vague', v); return p; }, { replace: true });
  useEffect(() => {
    if (waveId && asked !== waveId) select(waveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveId, asked]);
  return { waves, waveId, select, ready: isSuccess };
}
