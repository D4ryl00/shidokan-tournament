import { Button, Chip, Group, Paper, Stack, Text } from '@mantine/core';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { FfkCard, FfkCardChoice, FfkChoices } from '../../../domain/ffk-plan/plan.js';
import { initialValue, type FfkCardValue } from '../../../domain/ffk-plan/values.js';
import { plural } from '../../../domain/plural.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { useClubs, type FfkPreview } from '../../api.js';
import { useOrganiserLineInputs } from '../club-line/organiserInputs.js';
import { chosenFighter, inFilter, nextToSettle, toSettle, workingDraft, type CardDraft, type CardFilter, type PageCardState } from './cardState.js';
import { FighterCard, type CardActions, type CardEnv } from './FighterCard.js';

const FILTERS: [CardFilter, string][] = [['todo', 'À trancher'], ['done', 'Validées'], ['auto', 'Sans problème'], ['all', 'Tout']];

const without = <T,>(record: Record<string, T> | undefined, key: string): Record<string, T> => {
  const { [key]: _, ...rest } = record ?? {};
  return rest;
};

/** Confirmée sans changement : rapprochée d’office d’une fiche, rien à y changer (repliée avec les autres en une ligne). */
const unchanged = (c: FfkCard, state: PageCardState) => state === 'auto' && c.fighterId !== 'new' && c.changes.length === 0;

/**
 * 3. Combattants de l’export : une carte par combattant, empilées, avec les filtres « À trancher » (par défaut), « Validées »,
 * « Sans problème », « Tout ». Ce qu’on tape reste dans la page (`drafts`) jusqu’à « Valider la carte », qui le met dans `choices` ;
 * une carte modifiée mais pas validée est « Ne pas lier » côté serveur (laissée de côté à l’import).
 */
export function FighterCards({ competitionId, plan, grid, choices, updateChoices, drafts, setDrafts, states, stale, matchRequest }: {
  competitionId: string;
  plan: FfkPreview;
  grid: CategoryGrid | undefined;
  choices: FfkChoices;
  updateChoices: (patch: (c: FfkChoices) => FfkChoices) => void;
  drafts: Record<string, CardDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, CardDraft>>>;
  states: Record<string, PageCardState>;
  stale: boolean;
  /** « Rapprocher… » d’une fiche sans inscription FFK : cette carte s’ouvre, liée à ce combattant. */
  matchRequest: { cardKey: string; fighterId: string } | null;
}) {
  const inputs = useOrganiserLineInputs(competitionId);
  const { data: clubs = [] } = useClubs(competitionId);
  const [filter, setFilter] = useState<CardFilter>('todo');
  /** Cartes vues dans « À trancher » : elles y restent une fois validées (on voit ce qu’on vient de faire). */
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<{ key: string; ifHidden?: boolean } | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const { cards } = plan;

  const env = useMemo((): CardEnv => {
    const byId = new Map(plan.fighters.map((f) => [f.fighterId, f]));
    const clubNames = new Map(clubs.map((c) => [c.id, c.name]));
    // Les catégories nouvelles cochées à l’étape 1 se choisissent comme celles de la grille.
    const added = plan.weightClasses.filter((w) => w.accepted).map(({ id, ageBandCode, sex, label, maxKg }) => ({ id, ageBandCode, sex, label, maxKg }));
    return {
      grid, fighters: plan.fighters, fighter: (id) => byId.get(id) ?? null,
      clubs: clubs.map((c) => ({ value: c.id, label: c.name })), clubName: (id) => clubNames.get(id) ?? '…',
      ageBands: inputs.ageBands,
      weightClasses: [...inputs.weightClasses, ...added].sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity)),
      closed: new Set(inputs.closed), multipleCombats: inputs.multipleCombats, stale,
    };
  }, [plan, clubs, grid, inputs.ageBands, inputs.weightClasses, inputs.closed, inputs.multipleCombats, stale]);

  // « À trancher » : retenir les cartes qu’on y a vues.
  useEffect(() => {
    if (filter !== 'todo') return;
    const fresh = cards.filter((c) => toSettle(states[c.key]) && !seen.has(c.key)).map((c) => c.key);
    if (fresh.length) setSeen((s) => new Set([...s, ...fresh]));
  }, [filter, cards, states, seen]);

  // Défilement vers l’en-tête d’une carte, sous le résumé collé (`scroll-margin-top`) ; `ifHidden` : seulement s’il est passé au-dessus.
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(scrollTarget.key)}"]`);
    if (!el) return;
    if (scrollTarget.ifHidden && el.getBoundingClientRect().top >= (parseFloat(getComputedStyle(el).scrollMarginTop) || 0)) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [scrollTarget]);

  /**
   * Une décision sur la carte la laisse de côté jusqu’à sa validation (sans relancer l’aperçu si rien ne change). `fighterId` : le
   * combattant choisi sur la carte, envoyé pour que ses inscriptions ne changent pas tant que la carte n’est pas validée.
   */
  const unsettle = (key: string, chosen: string | 'new' | null = null) => updateChoices((c) => {
    const fighterId = chosen && chosen !== 'new' ? chosen : undefined;
    const before = c.cards?.[key];
    if (before?.kind === 'none' && before.fighterId === fighterId) return c;
    // Un combattant pris par une carte n’est plus une fiche sans inscription FFK : son action (« Supprimer ») est oubliée.
    const orphans = fighterId && c.orphans?.[fighterId] ? without(c.orphans, fighterId) : c.orphans;
    return { ...c, cards: { ...c.cards, [key]: fighterId ? { kind: 'none', fighterId } : { kind: 'none' } }, orphans };
  });
  const setChoice = (key: string, choice: FfkCardChoice) => updateChoices((c) => {
    const taken = choice.kind === 'validated' && c.orphans?.[choice.fighterId] ? choice.fighterId : null;
    return { ...c, cards: { ...c.cards, [key]: choice }, orphans: taken ? without(c.orphans, taken) : c.orphans };
  });
  const dropDraft = (key: string) => setDrafts((d) => without(d, key));

  /** Choisir le combattant ouvre la carte ; un autre choix repart des valeurs de ce combattant ; le même replie (`toggle`) ou laisse ouverte. */
  const choose = (card: FfkCard, target: string | 'new' | 'none', toggle: boolean) => {
    const { key } = card;
    if (target === 'none') {
      dropDraft(key);
      unsettle(key);
      if (openKey === key) setOpenKey(null);
      return;
    }
    const current = chosenFighter(card, drafts[key], choices.cards?.[key]);
    if (current === target) {
      setOpenKey(toggle && openKey === key ? null : key);
      return;
    }
    const saved = target === 'new' ? null : env.fighter(target);
    setDrafts((d) => ({ ...d, [key]: { fighterId: target, value: initialValue(card, saved), version: saved?.version ?? null } }));
    unsettle(key, target);
    setOpenKey(key);
  };

  const actionsFor = (card: FfkCard): CardActions => {
    const { key } = card;
    return {
      pick: (target) => choose(card, target, true),
      edit: (value: FfkCardValue) => {
        // Mise à jour fonctionnelle : le brouillon de départ (non enregistré) est relu au moment de la mise à jour.
        setDrafts((d) => {
          const base = d[key] ?? workingDraft(card, undefined, choices.cards?.[key], env.fighter);
          return base ? { ...d, [key]: { ...base, value } } : d;
        });
        unsettle(key, chosenFighter(card, drafts[key], choices.cards?.[key]));
      },
      validate: () => {
        const working = workingDraft(card, drafts[key], choices.cards?.[key], env.fighter);
        if (!working || working.fighterId === null) return;
        // La version de la fiche dont la carte est partie : l’import n’écrase pas une fiche modifiée depuis.
        setChoice(key, { kind: 'validated', fighterId: working.fighterId, value: working.value, ...(working.version ? { version: working.version } : {}) });
        dropDraft(key);
        // La carte suivante à trancher s’ouvre, et la page y défile.
        const next = nextToSettle(cards, key, { ...states, [key]: 'done' });
        setOpenKey(next);
        if (next) setScrollTarget({ key: next });
      },
      skip: () => {
        dropDraft(key);
        setChoice(key, { kind: 'skip' });
        setOpenKey(null);
      },
      revert: () => {
        dropDraft(key);
        updateChoices((c) => (c.cards?.[key] ? { ...c, cards: without(c.cards, key) } : c));
        if (openKey === key) setOpenKey(null);
      },
      close: () => {
        setOpenKey(null);
        // La carte refermée se replie : si son en-tête est passé au-dessus de l’écran, la page y revient (on garde sa place).
        setScrollTarget({ key, ifHidden: true });
      },
      reopen: () => setOpenKey(key),
    };
  };

  // « Rapprocher… » (section 4) : la carte se lie à ce combattant, s’ouvre, et la page y défile.
  useEffect(() => {
    if (!matchRequest) return;
    const card = cards.find((c) => c.key === matchRequest.cardKey);
    if (!card) return;
    choose(card, matchRequest.fighterId, false);
    setScrollTarget({ key: card.key });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par demande
  }, [matchRequest]);

  const count = (f: CardFilter) => cards.filter((c) => inFilter(states[c.key] ?? 'todo', f)).length;
  const shown = cards.filter((c) => {
    const s = states[c.key] ?? 'todo';
    return inFilter(s, filter) || (filter === 'todo' && seen.has(c.key)) || c.key === openKey;
  });
  // Confirmées sans changement : repliées ensemble en une ligne (sauf la carte ouverte).
  const folded = filter === 'todo' ? [] : shown.filter((c) => c.key !== openKey && !drafts[c.key] && unchanged(c, states[c.key] ?? 'todo'));
  const listed = shown.filter((c) => !folded.includes(c));

  const renderCard = (c: FfkCard) => (
    <FighterCard key={c.key} card={c} state={states[c.key] ?? 'todo'} draft={drafts[c.key]} choice={choices.cards?.[c.key]}
      open={openKey === c.key} env={env} actions={actionsFor(c)} />
  );

  if (cards.length === 0) return <Text size="sm" c="dimmed">Aucun combattant dans l’export.</Text>;
  return (
    <Stack gap="sm">
      <Chip.Group multiple={false} value={filter} onChange={(v) => { setFilter(v as CardFilter); setSeen(new Set()); }}>
        <Group gap="xs" role="group" aria-label="Filtrer les cartes">
          {FILTERS.map(([f, label]) => (
            <Chip key={f} value={f} size="sm" data-testid={`ffk-filter-${f}`}>{label} · {count(f).toLocaleString('fr-FR')}</Chip>
          ))}
        </Group>
      </Chip.Group>
      {listed.map(renderCard)}
      {folded.length > 0 && (
        <Paper withBorder p="sm" radius="md" data-testid="ffk-unchanged" style={{ backgroundColor: 'var(--sk-bg)' }}>
          <Group justify="space-between" gap="xs">
            <Text size="sm" fw={600}>{plural(folded.length, 'confirmée sans changement', 'confirmées sans changement')}</Text>
            <Button variant="subtle" size="compact-sm" onClick={() => setShowUnchanged((v) => !v)}>{showUnchanged ? 'Replier' : 'Afficher'}</Button>
          </Group>
          {showUnchanged && <Stack gap="sm" mt="sm">{folded.map(renderCard)}</Stack>}
        </Paper>
      )}
      {listed.length === 0 && folded.length === 0 && <Text size="sm" c="dimmed">Rien dans ce filtre.</Text>}
    </Stack>
  );
}
