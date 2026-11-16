import { useEffect, useRef, useState } from 'react';
import type { FfkChoices } from '../../../domain/ffk-plan/plan.js';
import { type FfkPreview, type FfkSheetSetup, usePreviewFfk } from '../../api.js';

export interface FfkSource {
  uploadId: string;
  sheets: FfkSheetSetup[];
}

/**
 * État partagé de la page « Import FFK » : le fichier lu (onglets et colonnes), les décisions de l’organisateur (`choices`) et
 * l’aperçu que le serveur en recalcule à chaque changement. Seule la réponse à la dernière demande est appliquée (une réponse
 * plus ancienne arrivée en retard est ignorée), et l’aperçu précédent reste affiché pendant le calcul.
 */
export function useFfkPreview(competitionId: string) {
  const { mutateAsync } = usePreviewFfk(competitionId);
  const [source, setSource] = useState<FfkSource | null>(null);
  const [choices, setChoices] = useState<FfkChoices>({});
  const [plan, setPlan] = useState<FfkPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!source) return;
    const request = ++latest.current;
    setLoading(true);
    mutateAsync({ ...source, choices }).then(
      (p) => {
        if (request !== latest.current) return;
        setPlan(p);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (request !== latest.current) return;
        setError(e);
        setLoading(false);
      },
    );
  }, [source, choices, mutateAsync]);

  return {
    source, choices, plan, error, loading,
    /** Fichier lu : premier aperçu, sans aucune décision. */
    start: (uploadId: string, sheets: FfkSheetSetup[]) => {
      setPlan(null);
      setChoices({});
      setSource({ uploadId, sheets });
    },
    /** « Recalculer l’aperçu » : onglets et colonnes modifiés, décisions gardées. */
    recalc: (sheets: FfkSheetSetup[]) => setSource((s) => s && { ...s, sheets }),
    /** Nouveau fichier choisi : tout repart de zéro (une réponse encore en route est ignorée). */
    reset: () => {
      latest.current++;
      setSource(null);
      setPlan(null);
      setChoices({});
      setError(null);
      setLoading(false);
    },
    /** Une décision change : l’aperçu est recalculé. */
    updateChoices: (patch: (c: FfkChoices) => FfkChoices) => setChoices(patch),
  };
}
