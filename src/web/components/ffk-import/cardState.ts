import { VALIDATED_REJECTIONS, type FfkCard, type FfkCardChoice } from '../../../domain/ffk-plan/plan.js';
import { initialValue, missingFields, type FfkCardValue } from '../../../domain/ffk-plan/values.js';
import type { ExistingFighter } from '../../../domain/ffk-plan/cards.js';
import type { ClubFormLine } from '../../../domain/club-form.js';
import { disciplineLabel } from '../../labels.js';

/**
 * Ce que l’organisateur a en cours sur une carte, avant « Valider la carte » : le combattant choisi (`'new'` : nouveau) et les
 * valeurs du formulaire. `dirty` : choisi ou modifié ici (la carte est alors laissée de côté à l’import tant qu’elle n’est pas validée).
 */
export interface CardDraft { fighterId: string | 'new' | null; value: FfkCardValue; dirty: boolean }

/** État d’une carte sur la page : celui de l’aperçu, plus « À valider » (`pending` : modifiée, pas validée). */
export type PageCardState = 'todo' | 'pending' | 'done' | 'auto' | 'skip';

/** Filtres de la section 3. */
export type CardFilter = 'todo' | 'done' | 'auto' | 'all';

/**
 * État affiché d’une carte. Le choix de l’organisateur passe avant l’aperçu (qui arrive un peu plus tard) : une carte validée est
 * « Validée » tout de suite, sauf si l’aperçu l’a refusée (combattant déjà retenu, club disparu…).
 */
export function pageState(card: FfkCard, draft: CardDraft | undefined, choice: FfkCardChoice | undefined): PageCardState {
  if (choice?.kind === 'skip') return 'skip';
  if (draft?.dirty) return draft.fighterId !== null && missingFields(draft.value).length === 0 ? 'pending' : 'todo';
  if (choice?.kind === 'validated') return card.state === 'todo' && card.reason !== null && VALIDATED_REJECTIONS.includes(card.reason) ? 'todo' : 'done';
  if (choice?.kind === 'none') return 'todo';
  return card.state;
}

/** Reste à trancher : « À trancher » ou « À valider ». */
export const toSettle = (state: PageCardState | undefined): boolean => state === 'todo' || state === 'pending';

/** La carte entre dans ce filtre (« À trancher » montre aussi les cartes « À valider »). */
export function inFilter(state: PageCardState, filter: CardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'todo') return toSettle(state);
  return state === filter;
}

/** Carte suivante à trancher après `after`, dans l’ordre des cartes (puis depuis le début) ; `null` s’il n’y en a plus. */
export function nextToSettle(cards: FfkCard[], after: string, states: Record<string, PageCardState>): string | null {
  const i = cards.findIndex((c) => c.key === after);
  const ordered = [...cards.slice(i + 1), ...cards.slice(0, Math.max(i, 0))];
  return ordered.find((c) => c.key !== after && toSettle(states[c.key]))?.key ?? null;
}

/** Combattant coché sur la carte : celui du brouillon, sinon du choix validé, sinon celui de l’aperçu (rapprochement d’office). */
export function chosenFighter(card: FfkCard, draft: CardDraft | undefined, choice: FfkCardChoice | undefined): string | 'new' | null {
  if (draft) return draft.fighterId;
  if (choice?.kind === 'validated') return choice.fighterId;
  if (choice) return null;
  return card.fighterId;
}

/**
 * Valeurs que montre la carte ouverte : le brouillon, sinon le choix validé, sinon la valeur de départ du combattant de l’aperçu
 * (`initialValue` : rien de pris d’office là où l’export et la fiche diffèrent). `null` : aucun combattant choisi.
 */
export function workingDraft(card: FfkCard, draft: CardDraft | undefined, choice: FfkCardChoice | undefined, fighter: (id: string) => ExistingFighter | null): CardDraft | null {
  if (draft) return draft;
  if (choice?.kind === 'validated') return { fighterId: choice.fighterId, value: choice.value, dirty: false };
  const fighterId = chosenFighter(card, draft, choice);
  if (fighterId === null) return null;
  return { fighterId, value: initialValue(card, fighterId === 'new' ? null : fighter(fighterId)), dirty: false };
}

/** « Karaté, Kata » : les disciplines d’une ligne ; « — » sans discipline. */
export const lineDisciplines = (line: Pick<ClubFormLine, 'combats' | 'kata'>): string =>
  [...line.combats.map(disciplineLabel), ...(line.kata ? [disciplineLabel('kata')] : [])].join(', ') || '—';
