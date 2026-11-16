import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import type { FfkCard, FfkCardChoice, FfkSearchFighter } from '../../../domain/ffk-plan/plan.js';
import { ffkCardDiffs, missingFields, type FfkCardValue } from '../../../domain/ffk-plan/values.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { ageBandLabel, SEX_LABELS } from '../../labels.js';
import { ClubLineFields } from '../ClubLineFields.js';
import type { AgeBandInfo, LineFormContext, WeightClassInfo } from '../club-line/lineForm.js';
import { StatusBadge, type Tone } from '../ui/StatusBadge.js';
import { chosenFighter, lineDisciplines, workingDraft, type CardDraft, type PageCardState } from './cardState.js';
import { ChoiceOption } from './ChoiceOption.js';
import { searchByName, searchReady } from './search.js';

/** Ce que toutes les cartes partagent : la grille, les combattants et les clubs de la compétition, les choix de la fenêtre combattant. */
export interface CardEnv {
  grid: CategoryGrid | undefined;
  /** Combattants de la compétition (recherche « Pas dans la liste ? »). */
  fighters: FfkSearchFighter[];
  fighter: (id: string) => FfkSearchFighter | null;
  /** Clubs de la compétition, pour le champ « Club ». */
  clubs: { value: string; label: string }[];
  clubName: (id: string) => string;
  ageBands: AgeBandInfo[];
  /** Grille, plus les catégories nouvelles cochées à l’étape 1. */
  weightClasses: WeightClassInfo[];
  closed: Set<string>;
  /** Réglage de la compétition : plusieurs combats par jour. */
  multipleCombats: boolean;
  /** L’aperçu est en cours de calcul (l’état venu du serveur peut retarder d’un instant). */
  stale: boolean;
}

/** Gestes de l’organisateur sur une carte (la page les traduit en brouillon et en `choices`). */
export interface CardActions {
  /** Combattant coché (un second clic sur le combattant déjà choisi ouvre ou replie la carte). */
  pick: (target: string | 'new' | 'none') => void;
  edit: (value: FfkCardValue) => void;
  validate: () => void;
  skip: () => void;
  revert: () => void;
  close: () => void;
  reopen: () => void;
}

const BADGE: Record<PageCardState, [Tone, string]> = {
  todo: ['warn', 'À trancher'], pending: ['warn', 'À valider'], done: ['ok', 'Validée'], auto: ['accent', 'Sans problème'], skip: ['danger', 'Écartée'],
};
const STRIPE: Partial<Record<PageCardState, string>> = {
  todo: 'var(--mantine-color-orange-6)', pending: 'var(--mantine-color-orange-6)', done: 'var(--mantine-color-green-6)',
};

/** « −35 kg » : la catégorie de poids telle que l’export l’écrit. */
function exportWeight(card: FfkCard): string | null {
  const raw = card.rows.find((r) => r.weightLabel)?.weightLabel;
  return raw ? `${raw.replace('-', '−')} kg` : null;
}

/**
 * Une carte de la section 3 : un combattant de l’export (toutes ses lignes), le combattant de l’app auquel le lier, et, ouverte,
 * le formulaire du combattant de l’app avec les cases FFK / Fiche club sous chaque champ qui diffère.
 */
export function FighterCard({ card, state, draft, choice, open, env, actions }: {
  card: FfkCard;
  state: PageCardState;
  draft: CardDraft | undefined;
  choice: FfkCardChoice | undefined;
  open: boolean;
  env: CardEnv;
  actions: CardActions;
}) {
  const [query, setQuery] = useState('');
  const chosen = chosenFighter(card, draft, choice);
  const working = workingDraft(card, draft, choice, env.fighter);
  const fighter = chosen && chosen !== 'new' ? env.fighter(chosen) : null;
  const name = `${card.exportLine.lastName} ${card.exportLine.firstName}`;
  const { exportLine } = card;
  const weight = exportWeight(card);
  const facts = [
    exportLine.ageBandCode ? ageBandLabel(env.grid, exportLine.ageBandCode) : null,
    exportLine.sex ? SEX_LABELS[exportLine.sex] : null,
    weight,
  ].filter(Boolean).join(' · ');
  const clubText = card.clubId ? env.clubName(card.clubId) : card.clubEntity ? `${card.rows[0]?.clubName ?? card.clubEntity} (pas relié)` : 'Sans club dans l’export';
  const sources = card.rows.map((r) => `onglet ${r.sheet}, ligne ${r.line}`).join(' · ');
  const [tone, label] = BADGE[state];
  const stripe = STRIPE[state];
  // Validée ou écartée, et pas rouverte : repliée en une ligne de résumé.
  const folded = !open && (state === 'done' || state === 'skip');
  const formShown = open && working !== null && state !== 'skip';
  const revertable = !!draft?.dirty || choice !== undefined;
  const pickAndClear = (target: string | 'new' | 'none') => {
    actions.pick(target);
    setQuery('');
  };

  return (
    <Paper withBorder p="sm" radius="md" data-testid="ffk-card" data-card-key={card.key} data-state={state}
      style={{
        backgroundColor: 'var(--sk-bg)', scrollMarginTop: 'calc(var(--sk-bar-h, 56px) + 72px)',
        borderColor: state === 'todo' || state === 'pending' ? 'var(--mantine-color-orange-6)' : undefined,
        boxShadow: stripe ? `inset 3px 0 0 ${stripe}` : undefined,
      }}>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} style={{ overflowWrap: 'anywhere' }}>
              {name} <Text span c="dimmed" fw={500}>· {lineDisciplines(exportLine)}</Text>
            </Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{facts}{facts ? ' · ' : ''}{clubText}</Text>
            <Text size="xs" c="dimmed">FFK : {sources}</Text>
          </div>
          <StatusBadge tone={tone} data-testid="ffk-card-state">{label}</StatusBadge>
        </Group>
        {card.notes.map((n) => <Text key={n} size="sm" c="var(--sk-warn-text)">{n}</Text>)}

        {folded ? (
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed" style={{ minWidth: 0, overflowWrap: 'anywhere' }} data-testid="ffk-card-summary">
              {state === 'skip' ? 'Ligne écartée : pas importée.' : <FoldedSummary card={card} chosen={chosen} working={working} env={env} />}
            </Text>
            <Button variant="subtle" size="compact-sm" onClick={actions.reopen}>Modifier</Button>
          </Group>
        ) : (
          <>
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">Combattant de l’app</Text>
              <Stack gap={4} role="radiogroup" aria-label={`Combattant de l’app pour ${name}`}>
                {card.candidates.map((c) => {
                  const f = env.fighter(c.fighterId);
                  return (
                    <ChoiceOption key={c.fighterId} checked={chosen === c.fighterId} onClick={() => pickAndClear(c.fighterId)} sub={f && fighterDetails(f)}>
                      C’est <b>{f?.label ?? 'un combattant'}</b> ({c.reason})
                    </ChoiceOption>
                  );
                })}
                {fighter && !card.candidates.some((c) => c.fighterId === fighter.fighterId) && (
                  <ChoiceOption checked onClick={() => pickAndClear(fighter.fighterId)} sub={`choisi par recherche · ${fighterDetails(fighter)}`}>
                    C’est <b>{fighter.label}</b>
                  </ChoiceOption>
                )}
                <ChoiceOption checked={chosen === 'new'} onClick={() => pickAndClear('new')}>➕ Nouveau combattant</ChoiceOption>
                <ChoiceOption checked={chosen === null && state !== 'skip'} onClick={() => pickAndClear('none')} sub="la ligne est laissée de côté">
                  Ne pas lier pour l’instant
                </ChoiceOption>
              </Stack>
              <TextInput type="search" autoComplete="off" size="sm" placeholder="Pas dans la liste ? Chercher un inscrit par son nom…"
                aria-label={`Chercher un inscrit pour ${name}`} value={query} onChange={(e) => setQuery(e.currentTarget.value)} style={{ maxWidth: 420 }} />
              {searchReady(query) && <SearchResults query={query} chosen={chosen} env={env} onPick={pickAndClear} />}
            </Stack>

            {formShown ? (
              <OpenForm card={card} working={working} fighter={fighter} env={env} actions={actions} revertable={revertable} />
            ) : (
              <Group justify="space-between" gap="xs">
                <Text size="sm" c={state === 'todo' || state === 'pending' ? 'var(--sk-warn-text)' : 'dimmed'} data-testid="ffk-card-hint">
                  {hint(card, state, chosen, working, choice, env.stale)}
                </Text>
                {revertable && <Button variant="subtle" size="compact-sm" onClick={actions.revert}>Annuler mes modifications</Button>}
              </Group>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}

/** « Benjamins · Club X · Karaté, Kata » : de quoi reconnaître un inscrit. */
const fighterDetails = (f: FfkSearchFighter) => `${f.clubName} · ${f.ageLabel} · ${f.disciplines}`;

function SearchResults({ query, chosen, env, onPick }: { query: string; chosen: string | 'new' | null; env: CardEnv; onPick: (id: string) => void }) {
  const results = searchByName(env.fighters, query, (f) => f.label);
  if (!results.length) return <Text size="xs" c="dimmed">Aucun inscrit ne contient « {query.trim()} ».</Text>;
  return (
    <Stack gap={4}>
      {results.map((f) => (
        <ChoiceOption key={f.fighterId} checked={chosen === f.fighterId} onClick={() => onPick(f.fighterId)} sub={fighterDetails(f)}>
          C’est <b>{f.label}</b>
        </ChoiceOption>
      ))}
    </Stack>
  );
}

/** Ce qu’on lit sous une carte non ouverte : ce qui arrivera à l’import, et comment la régler. */
function hint(card: FfkCard, state: PageCardState, chosen: string | 'new' | null, working: CardDraft | null, choice: FfkCardChoice | undefined, stale: boolean): string {
  if (state === 'skip') return 'Ligne écartée. Choisissez un combattant pour la réintégrer.';
  if (state === 'pending') return 'Modifiée mais pas validée : ouvrez-la et validez, sinon elle est laissée de côté.';
  if (state === 'auto') return 'Sera importée telle quelle. Cliquez sur le combattant pour voir ou modifier les champs ; un second clic les replie.';
  if (state === 'done') return 'Validée. Cliquez sur le combattant pour voir ou modifier les champs.';
  if (chosen === null) {
    const why = !stale && card.reason && card.reason !== 'combattant pas choisi' ? ` (${card.reason})` : '';
    return `Choisissez le combattant pour ouvrir la carte. Sinon cette ligne n’est pas importée${why}.`;
  }
  // Validée, mais refusée par l’aperçu (combattant déjà retenu, club ou catégorie disparus…).
  if (choice?.kind === 'validated' && !stale && card.reason) return `Validée, mais laissée de côté : ${card.reason}. Ouvrez-la pour corriger.`;
  const missing = working ? missingFields(working.value) : [];
  if (missing.length) return `Reste à remplir : ${missing.join(', ').toLowerCase()}. Cliquez sur le combattant pour ouvrir la carte.`;
  return 'Cliquez sur le combattant pour ouvrir la carte.';
}

/** « Liée à X · Catégorie d’âge : Pupilles → Benjamins », ou « Nouveau combattant : … ». */
function FoldedSummary({ card, chosen, working, env }: { card: FfkCard; chosen: string | 'new' | null; working: CardDraft | null; env: CardEnv }) {
  if (chosen === 'new') {
    const l = working?.value.line;
    return <>Nouveau combattant{l ? ` : ${l.lastName} ${l.firstName}` : ''}.</>;
  }
  const f = chosen ? env.fighter(chosen) : null;
  // Les changements viennent de l’aperçu, une fois la carte validée de son côté.
  const changes = card.state === 'done' && !env.stale ? card.changes : null;
  return <>Liée à {f?.label ?? '…'}{changes ? ` · ${changes.length ? changes.join(' ; ') : 'aucun changement'}` : ''}</>;
}

/** Carte ouverte : le formulaire du combattant de l’app, puis « Écarter », « Annuler mes modifications », « Fermer », « Valider la carte ». */
function OpenForm({ card, working, fighter, env, actions, revertable }: {
  card: FfkCard;
  working: CardDraft;
  fighter: FfkSearchFighter | null;
  env: CardEnv;
  actions: CardActions;
  revertable: boolean;
}) {
  const ctx: LineFormContext = {
    mode: 'organiser', multipleCombats: true, closed: env.closed, ageBands: env.ageBands, weightClasses: env.weightClasses, saved: fighter?.line ?? null,
  };
  const missing = missingFields(working.value);
  // Verrous du combattant choisi (combats commencés). Sans club et sans combat commencé, il n’est pas verrouillé : la carte lui en donne un.
  const locked = fighter && !fighter.editable && (fighter.clubId !== null || fighter.startedDisciplines.length > 0);
  return (
    <Stack gap="sm" pt="xs" style={{ borderTop: '1px solid var(--sk-line)' }}>
      <ClubLineFields key={`${card.key}:${working.fighterId}`} value={working.value} onChange={actions.edit} ctx={ctx}
        diffs={ffkCardDiffs(card, fighter)} clubs={env.clubs} weightIssue={card.weightIssue} showLicenceHint={!!fighter?.licence}
        oneCombatPerDay={!env.multipleCombats}
        disabled={locked ? { locked: true, partly: fighter.partlyEditable, started: fighter.startedDisciplines } : undefined} />
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs">
          <Button variant="subtle" color="red" size="compact-sm" onClick={actions.skip}>Écarter cette ligne</Button>
          {revertable && <Button variant="subtle" size="compact-sm" onClick={actions.revert}>Annuler mes modifications</Button>}
        </Group>
        <Group gap="xs" justify="flex-end" style={{ marginLeft: 'auto' }}>
          {missing.length > 0 && (
            <Text size="sm" c="var(--sk-warn-text)" data-testid="ffk-card-missing">Reste à remplir : {missing.join(', ').toLowerCase()}.</Text>
          )}
          <Button variant="default" onClick={actions.close}>Fermer</Button>
          <Button data-testid="ffk-card-validate" disabled={missing.length > 0} onClick={actions.validate}>Valider la carte</Button>
        </Group>
      </Group>
    </Stack>
  );
}
