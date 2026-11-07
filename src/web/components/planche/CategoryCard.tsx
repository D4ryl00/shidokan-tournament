import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { HTMLAttributes } from 'react';
import { Link } from 'react-router';
import { newSameClubSentences, sameClubFirstRound } from '../../../domain/brackets/same-club.js';
import { activeEntrantCount, isFreeKey, type Category } from '../../../domain/categories.js';
import { normalizeName } from '../../../domain/names.js';
import { plural } from '../../../domain/plural.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import { ALL_FORMAT_LABELS } from '../../../domain/brackets/format-labels.js';
import { useRedraw } from '../../api.js';
import type { RecasementEntry } from '../../api.js';
import { STATUS_LABELS, STATUS_TONES } from '../../pages/BracketsPage.js';
import { kataPassageText, movedMatchZones, type categoryPassages } from '../../passages.js';
import { BracketView, type EntrantInfo } from '../BracketView.js';
import { useUndoToast } from '../history/undoToast.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { FighterChip } from './FighterChip.js';
import { cardSections, isLockedCategory, LOCKED_DROP } from './model.js';
import type { DragAttrs } from './useDragMove.js';

type Passages = ReturnType<typeof categoryPassages>;

export interface CardProps {
  competitionId: string;
  category: Category;
  title: string;
  /** Discipline · règlement (classement par zone, où le groupe n'est pas la discipline). */
  subtitle?: string;
  zoneName?: string | null;
  passages: Passages;
  zones: { id: string; name: string }[];
  entrants: Map<string, EntrantInfo>;
  badges: Map<string, ProposalType>;
  badgeDetails: Map<string, RecasementEntry>;
  cases: number;
  aside: number;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Ouvre cette catégorie dans la Liste. */
  onOpenList: () => void;
  /** Mots de la recherche (pastilles trouvées surlignées). */
  words: string[];
  /** Contour : `undo` = annulation en préparation (orange), `see` = « Voir » de l'historique. */
  ring?: 'undo' | 'see' | null;
  /** Attributs ajoutés à la carte et à chaque pastille (glisser-déposer). */
  cardProps?: DragAttrs;
  chipProps?: (registrationId: string, category: Category) => HTMLAttributes<HTMLDivElement>;
  /** Pastille choisie (clic-clic). */
  selectedChip?: string | null;
}

/** Bouton « Nouveau tirage » d'une carte agrandie. */
function RedrawButton({ competitionId, category, entrants }: { competitionId: string; category: Category; entrants: Map<string, EntrantInfo> }) {
  const redraw = useRedraw(competitionId);
  const undoToast = useUndoToast(competitionId);
  return (
    <Button size="xs" variant="default" data-testid="card-redraw" loading={redraw.isPending}
      onClick={() => redraw.mutate(category.id, {
        onSuccess: (c) => undoToast(`Nouveau tirage : ${category.label}`, c.historyId ?? null,
          newSameClubSentences(category.bracket, c.bracket, (x) => entrants.get(x))),
      })}>
      Nouveau tirage
    </Button>
  );
}

export function CategoryCard(p: CardProps) {
  const c = p.category;
  const locked = isLockedCategory(c);
  const drop = p.cardProps?.['data-drop'];
  const active = activeEntrantCount(c);
  const pairs = sameClubFirstRound(c.bracket);
  const sameIds = new Set(pairs.flat());
  const sameClubName = pairs[0] ? p.entrants.get(pairs[0][0])?.club : undefined;
  const sections = cardSections(c);
  const ringColor = p.ring === 'undo' ? 'var(--mantine-color-orange-6)' : p.ring === 'see' ? 'var(--sk-accent)' : undefined;
  const kata = kataPassageText(p.passages, p.zones);
  const matched = (id: string) => p.words.length > 0 && p.words.some((w) => normalizeName(p.entrants.get(id)?.name ?? '').includes(w));
  const chip = (id: string) => (
    <FighterChip key={id} id={id} info={p.entrants.get(id)} badge={p.badges.get(id)} badgeDetail={p.badgeDetails.get(id)}
      sameClub={sameIds.has(id)} matched={matched(id)} locked={locked || p.readOnly} selected={p.selectedChip === id}
      extra={p.chipProps?.(id, c)} />
  );
  return (
    <Card withBorder padding="sm" data-testid="planche-card" data-category={c.id} data-locked={locked || undefined} data-ring={p.ring ?? undefined} {...p.cardProps}
      style={{
        gridColumn: p.expanded ? '1 / -1' : undefined, opacity: locked ? 0.7 : undefined,
        outline: ringColor ? `3px solid ${ringColor}` : undefined, outlineOffset: 1, scrollMarginTop: 80, ...p.cardProps?.style,
      }}>
      <Stack gap="xs">
        <Stack gap={2}>
          <Text fw={700} lh={1.25}>{p.title}</Text>
          {p.subtitle && <Text size="xs" c="dimmed">{p.subtitle}</Text>}
        </Stack>
        <Group gap={4}>
          {p.zoneName && <StatusBadge tone="accent" size="sm" data-testid="card-zone">{p.zoneName}</StatusBadge>}
          <StatusBadge tone="neutral" size="sm" className="num" data-testid="card-count">{plural(active, 'inscrit')}{c.absentIds.length ? ` + ${plural(c.absentIds.length, 'absent')}` : ''}</StatusBadge>
          <StatusBadge tone={STATUS_TONES[c.status]} size="sm" data-testid="card-status">{STATUS_LABELS[c.status]}{c.status === 'started' ? ' 🔒' : ''}</StatusBadge>
          {active === 1 && <StatusBadge tone="danger" size="sm" data-testid="card-alone">Sans adversaire</StatusBadge>}
          {p.cases > 0 && (
            <Badge size="sm" variant="outline" color="orange" data-testid="card-cases" component={Link} to={`/competitions/${p.competitionId}/reaffectation`}
              style={{ cursor: 'pointer' }} title="Ouvrir la réaffectation">
              {p.cases} cas à traiter{p.aside ? ` (dont ${p.aside} de côté)` : ''}
            </Badge>
          )}
          {c.format && <StatusBadge tone="neutral" size="sm" data-testid="card-format">{ALL_FORMAT_LABELS[c.format]}</StatusBadge>}
          {pairs.length > 0 && <Badge size="sm" variant="outline" color="orange" data-testid="card-same-club" title={sameClubName}>Même club</Badge>}
          {kata && <StatusBadge tone="neutral" size="sm">{kata}</StatusBadge>}
        </Group>
        {!p.expanded && (
          <Stack gap="xs" data-testid="card-content">
            {sections.length === 0 && <Text size="sm" c="dimmed">{isFreeKey(c.key) ? 'Aucun combattant pour l’instant.' : 'Aucun combattant présent.'}</Text>}
            {sections.map((s, i) => (
              <Stack key={`${s.label}-${i}`} gap={4}>
                <Text size="xs" fw={700} c="dimmed" style={{ letterSpacing: 0.4 }}>{s.label}</Text>
                {s.ids.map(chip)}
              </Stack>
            ))}
          </Stack>
        )}
        {p.expanded && (
          <BracketView category={c} entrants={p.entrants} numbers={p.passages.numbers} noRest={p.passages.noRest}
            matchZones={movedMatchZones(p.passages, p.zones, c.bracket)} badges={p.badges} badgeDetails={p.badgeDetails}
            selected={p.selectedChip} entrantProps={locked ? undefined : p.chipProps && ((id) => p.chipProps!(id, c))} />
        )}
        {drop === 'ok' && (
          <Text size="xs" ta="center" c="var(--sk-accent)" data-testid="card-drop-hint" py={6}
            style={{ border: '1px dashed var(--sk-accent)', borderRadius: 8 }}>
            Déposer ici : déplacer dans cette catégorie
          </Text>
        )}
        {drop === 'no' && (
          <Text size="xs" ta="center" c="dimmed" data-testid="card-drop-hint" py={6} style={{ border: '1px dashed var(--sk-card-line)', borderRadius: 8 }}>
            {LOCKED_DROP}
          </Text>
        )}
        <Group gap="xs">
          {c.bracket && (
            <Button size="xs" variant="subtle" data-testid="card-grow" aria-expanded={p.expanded} onClick={p.onToggle}>{p.expanded ? 'Réduire' : 'Agrandir'}</Button>
          )}
          {p.expanded && !locked && !p.readOnly && <RedrawButton competitionId={p.competitionId} category={c} entrants={p.entrants} />}
          <Button size="xs" variant="subtle" data-testid="card-open-list" onClick={p.onOpenList}>Ouvrir dans la liste</Button>
        </Group>
      </Stack>
    </Card>
  );
}
