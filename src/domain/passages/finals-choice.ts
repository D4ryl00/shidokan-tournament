import type { PassageOrderMode } from '../settings.js';

/** Où se joue la finale d’une catégorie : sur sa zone, ou sur la zone des finales de la session. */
export type FinalsWhere = 'own' | 'finals';
/** Quand : dès que la catégorie est finie, ou en fin de session. */
export type FinalsWhen = 'ready' | 'end';

/** Choix enregistrés sur la catégorie ; null = valeur de la session, sinon défaut. */
export interface StoredFinals {
  where: FinalsWhere | null;
  when: FinalsWhen | null;
}

/** Réglages de la session (vague) : zone des finales et derniers « Tout… » appliqués. */
export interface WaveFinals {
  waveKey: string;
  finalsZoneId: string | null;
  whereDefault: FinalsWhere | null;
  whenDefault: FinalsWhen | null;
}

export interface ResolvedFinals {
  /** Zone sur laquelle se joue la finale (null : la catégorie n’a pas de zone). */
  finalZoneId: string | null;
  when: FinalsWhen;
  /** La finale se joue sur la zone des finales de la session. */
  onFinalsZone: boolean;
  /** Kata : tour 1 et finale sont deux passages distincts (sinon bloc unique). */
  kataSplit: boolean;
  /** Pourquoi « Où » n’est pas au choix. */
  fixed: 'finals-zone' | 'not-accepted' | null;
  /** Change dès que le placement de la finale change (invalide les numéros figés). */
  signature: string;
}

export function defaultFinalsChoice(o: {
  kata: boolean;
  mode: PassageOrderMode;
  hasFinalsZone: boolean;
}): { where: FinalsWhere; when: FinalsWhen } {
  if (o.hasFinalsZone) return { where: 'finals', when: 'end' };
  if (o.kata || o.mode === 'categories') return { where: 'own', when: 'ready' };
  return { where: 'own', when: 'end' };
}

export function resolveFinals(o: {
  kata: boolean;
  entrants: number;
  zoneId: string | null;
  stored: StoredFinals;
  wave: WaveFinals | undefined;
  mode: PassageOrderMode;
  accepts: (zoneId: string) => boolean;
}): ResolvedFinals {
  const { zoneId, wave } = o;
  const finalsZoneId = wave?.finalsZoneId ?? null;
  const defaults = defaultFinalsChoice({ kata: o.kata, mode: o.mode, hasFinalsZone: finalsZoneId != null });
  const where = o.stored.where ?? wave?.whereDefault ?? defaults.where;

  let fixed: ResolvedFinals['fixed'] = null;
  if (zoneId != null && finalsZoneId != null) {
    if (zoneId === finalsZoneId) fixed = 'finals-zone';
    else if (!o.accepts(finalsZoneId)) fixed = 'not-accepted';
  }

  const onFinalsZone = zoneId != null && (fixed === 'finals-zone' || (fixed === null && finalsZoneId != null && where === 'finals'));
  const finalZoneId = zoneId == null ? null : onFinalsZone ? finalsZoneId : zoneId;
  // « Quand » par défaut selon l’endroit effectif de la finale.
  const placeDefault = defaultFinalsChoice({ kata: o.kata, mode: o.mode, hasFinalsZone: onFinalsZone });
  const when = o.stored.when ?? wave?.whenDefault ?? placeDefault.when;
  const kataSplit = o.kata && (onFinalsZone || when === 'end');
  return {
    finalZoneId,
    when,
    onFinalsZone,
    kataSplit,
    fixed,
    signature: `${finalZoneId ?? ''}|${when}`,
  };
}
