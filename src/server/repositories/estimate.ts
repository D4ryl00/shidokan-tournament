import { isFinalPassage, opensKataRound, planPassages, waveKey } from '../../domain/passages/index.js';
import { clockToSeconds, secondsToClock } from '../../domain/schedule/clock.js';
import { estimateDay, type DayEstimateView, type EstimateItem } from '../../domain/schedule/estimate.js';
import { isClock } from '../../domain/schedule/types.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from './competitions.js';
import { launchedWaveKeys } from './launch-state.js';
import { planInput } from './passages.js';
import { NotFoundError } from './registrations.js';
import { listWaveSchedules } from './wave-schedules.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';

const IMPLICIT_WAVE = 'Session unique';

/**
 * Horaires estimés de la journée (spec §7.7) : chaque session dans l'ordre, ses passages figés (lancée) ou en direct (non
 * lancée), avec les durées du mode spectateur ; `shift` : une session ne commence pas, sur une zone, avant la fin de la
 * précédente.
 */
export async function estimateFor(db: AppDb, competitionId: string, shift: boolean): Promise<DayEstimateView> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const { changeoverSec } = competition.settings.schedule;
  const input = await planInput(db, competitionId);
  const plan = planPassages(input);
  const zones = await listZones(db, competitionId);
  const knownZones = new Set(zones.map((z) => z.id));

  const waves = await listWaves(db, competitionId);
  const sessions = waves.length === 0 ? [{ key: waveKey(null), name: IMPLICIT_WAVE }] : waves.map((w) => ({ key: waveKey(w.id), name: w.name }));
  const order = new Map(sessions.map((s, i) => [s.key, i]));
  const planned = new Map(listWaveSchedules(db, competitionId).map((s) => [waveKey(s.waveId), s.plannedStart]));
  const finalsZone = new Map((input.waveFinals ?? []).map((w) => [w.waveKey, w.finalsZoneId]));

  // Passages comme les files du mode spectateur : catégories jouables, finales (« Quand ») et attente d'une finale « Dès que
  // finie » jouée hors de la zone de sa catégorie ; durée sans le changement (compté par la ligne de temps). Un kataka après
  // le premier de son tour n'en porte pas : il suit le précédent sans changement.
  const byId = new Map(input.categories.map((c) => [c.id, c]));
  const keyOf = (p: { categoryId: string; matchId: string }) => `${p.categoryId}:${p.matchId}`;
  const passages = plan.zones.map((z) => ({
    zoneId: z.zoneId,
    passages: z.passages
      .filter((p) => byId.get(p.categoryId)?.playable && order.has(waveKey(p.waveId)))
      .sort((a, b) => order.get(waveKey(a.waveId))! - order.get(waveKey(b.waveId))! || a.number - b.number),
  }));
  const finalKeys = new Set<string>();
  const nonFinals = new Map<string, string[]>();
  for (const p of passages.flatMap((z) => z.passages)) {
    if (isFinalPassage(byId.get(p.categoryId)!.bracket, p.matchId)) finalKeys.add(keyOf(p));
    else nonFinals.set(p.categoryId, [...(nonFinals.get(p.categoryId) ?? []), keyOf(p)]);
  }
  const estimateWaves = sessions.map((s) => {
    const start = planned.get(s.key) ?? null;
    const z = finalsZone.get(s.key) ?? null;
    return { key: s.key, plannedStart: start !== null && isClock(start) ? clockToSeconds(start) : null, finalsZoneId: z !== null && knownZones.has(z) ? z : null };
  });
  const estimate = estimateDay({
    changeoverSec,
    shift,
    waves: estimateWaves,
    zones: passages.map((z) => ({
      zoneId: z.zoneId,
      items: z.passages.map((p): EstimateItem => {
        const finals = finalKeys.has(keyOf(p)) ? (plan.finals[p.categoryId]?.when ?? null) : null;
        const away = finals === 'ready' && plan.categories[p.categoryId]?.zoneId !== z.zoneId;
        const bracket = byId.get(p.categoryId)!.bracket;
        const changeover = bracket?.kind !== 'kata' || opensKataRound(bracket, p.matchId);
        return {
          key: keyOf(p),
          waveKey: waveKey(p.waveId),
          durationSec: input.durationSec!(p.categoryId, p.matchId) - (changeover ? changeoverSec : 0),
          finals,
          ...(away ? { waitsFor: nonFinals.get(p.categoryId) ?? [] } : {}),
          ...(changeover ? {} : { changeoverBefore: false }),
        };
      }),
    })),
  });
  const names = new Map(sessions.map((s) => [s.key, s.name]));
  const finalsZoneOf = new Map(estimateWaves.map((w) => [w.key, w.finalsZoneId]));
  // Heures prévues par passage : seulement les sessions non lancées (les autres ont leurs heures réelles) ; aucune si relatif.
  const launched = launchedWaveKeys(db, competitionId);
  const sessionOf = new Map(passages.flatMap((z) => z.passages).map((p) => [keyOf(p), waveKey(p.waveId)]));
  const plannedStarts: Record<string, string> = {};
  if (!estimate.relative) {
    for (const [k, s] of Object.entries(estimate.starts)) if (!launched.has(sessionOf.get(k) ?? '')) plannedStarts[k] = secondsToClock(s);
  }
  const { starts: _starts, ...day } = estimate;
  return {
    ...day,
    plannedStarts,
    zones: zones.map((z) => ({ id: z.id, name: z.name })),
    waves: estimate.waves.map((w) => ({ ...w, name: names.get(w.key) ?? '', finalsZoneId: finalsZoneOf.get(w.key) ?? null })),
  };
}
