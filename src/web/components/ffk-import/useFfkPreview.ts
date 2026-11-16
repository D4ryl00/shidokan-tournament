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
  /** Le fichier et les choix dont l’aperçu affiché est tiré. */
  const [planFor, setPlanFor] = useState<{ source: FfkSource; choices: FfkChoices } | null>(null);
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
        setPlanFor({ source, choices });
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
    /**
     * L’aperçu affiché ne correspond pas (encore) au fichier et aux choix en cours : calcul en route, ou dernier calcul en erreur.
     * « Importer… » attend : l’import n’envoie jamais un plan périmé.
     */
    stale: loading || !!error || planFor === null || planFor.source !== source || planFor.choices !== choices,
    /** Fichier lu : premier aperçu, sans aucune décision. */
    start: (uploadId: string, sheets: FfkSheetSetup[]) => {
      setPlan(null);
      setPlanFor(null);
      setChoices({});
      setSource({ uploadId, sheets });
    },
    /** « Recalculer l’aperçu » : onglets et colonnes modifiés, décisions gardées. */
    recalc: (sheets: FfkSheetSetup[]) => setSource((s) => s && { ...s, sheets }),
    /** Nouvel aperçu, mêmes onglets et mêmes choix (import refusé parce que les inscriptions ont changé). */
    refresh: () => setSource((s) => s && { ...s }),
    /** Nouveau fichier choisi : tout repart de zéro (une réponse encore en route est ignorée). */
    reset: () => {
      latest.current++;
      setSource(null);
      setPlan(null);
      setPlanFor(null);
      setChoices({});
      setError(null);
      setLoading(false);
    },
    /** Une décision change : l’aperçu est recalculé. */
    updateChoices: (patch: (c: FfkChoices) => FfkChoices) => setChoices(patch),
  };
}
