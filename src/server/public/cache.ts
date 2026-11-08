import { createHash } from 'node:crypto';
import { todayInParis } from '../../domain/public/view.js';
import type { AppDb } from '../db/client.js';
import { onAnyCompetitionChange, onCompetitionChange } from '../events.js';
import { isPublicCompetition, loadPublicCompetition, loadPublicList } from './load.js';

/** Réponse publique prête à envoyer : corps JSON et son empreinte. */
export interface CachedBody {
  etag: string;
  body: string;
}

interface Entry extends CachedBody {
  /** Jour (à Paris) du calcul : la phase change à minuit. */
  day: string;
}

/**
 * Réponses publiques d'une base, gardées en mémoire jusqu'au prochain changement. `versions` : un calcul commencé avant un
 * changement n'est pas gardé (il a pu lire des données d'avant).
 */
interface State {
  details: Map<string, Entry>;
  versions: Map<string, number>;
  watched: Map<string, () => void>;
  list: Entry | null;
  listVersion: number;
  offAny: () => void;
}

const states = new WeakMap<AppDb, State>();

function stateOf(db: AppDb): State {
  let s = states.get(db);
  if (!s) {
    const state: State = { details: new Map(), versions: new Map(), watched: new Map(), list: null, listVersion: 0, offAny: () => {} };
    // La liste dépend de toutes les compétitions.
    state.offAny = onAnyCompetitionChange(() => {
      state.list = null;
      state.listVersion++;
    });
    states.set(db, state);
    s = state;
  }
  return s;
}

/** Suit les changements d'une compétition (une seule fois) : sa réponse est effacée à chacun. */
function watch(s: State, id: string): void {
  if (s.watched.has(id)) return;
  s.watched.set(
    id,
    onCompetitionChange(id, () => {
      s.details.delete(id);
      s.versions.set(id, (s.versions.get(id) ?? 0) + 1);
    }),
  );
}

function entry(value: unknown, day: string): Entry {
  const body = JSON.stringify(value);
  return { day, body, etag: `"${createHash('sha1').update(body).digest('hex')}"` };
}

/**
 * Fiche publique d'une compétition (calculée au premier appel du jour, effacée à chaque changement de la compétition) ;
 * null si elle est inconnue ou privée. La visibilité est relue à chaque appel.
 */
export async function publicCompetition(db: AppDb, id: string, now = new Date()): Promise<CachedBody | null> {
  // Rien n'est gardé ni suivi pour un identifiant inconnu ou privé (des adresses inventées ne remplissent pas la mémoire).
  if (!isPublicCompetition(db, id)) return null;
  const s = stateOf(db);
  const day = todayInParis(now);
  const cached = s.details.get(id);
  if (cached && cached.day === day) return cached;
  watch(s, id);
  const version = s.versions.get(id) ?? 0;
  const view = await loadPublicCompetition(db, id, now);
  if (!view) return null;
  const e = entry(view, day);
  if ((s.versions.get(id) ?? 0) === version) s.details.set(id, e);
  return e;
}

/** Liste des compétitions publiques (calculée au premier appel du jour, effacée au changement de n'importe laquelle). */
export async function publicList(db: AppDb, now = new Date()): Promise<CachedBody> {
  const s = stateOf(db);
  const day = todayInParis(now);
  if (s.list && s.list.day === day) return s.list;
  const version = s.listVersion;
  const e = entry(await loadPublicList(db, now), day);
  if (s.listVersion === version) s.list = e;
  return e;
}

/** Oublie les réponses d'une base et ses abonnements (arrêt de l'application). */
export function forgetPublicCache(db: AppDb): void {
  const s = states.get(db);
  if (!s) return;
  s.offAny();
  for (const off of s.watched.values()) off();
  states.delete(db);
}
