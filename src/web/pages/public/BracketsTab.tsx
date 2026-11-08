import { Box, Group, Paper, SegmentedControl, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ALL_FORMAT_LABELS } from '../../../domain/brackets/format-labels.js';
import type { PublicCategory, PublicCompetition } from '../../../domain/public/types.js';
import { BracketView } from '../../components/BracketView.js';
import {
  categoryPassages, CATEGORY_STATUS_LABELS, entrantInfos, filterCategories, followedRegistrations, highlightedRegistrations, NO_FILTERS, toMap,
  type CategoryFilters,
} from '../../components/public/bracketsModel.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { StatusBadge, type Tone } from '../../components/ui/StatusBadge.js';
import { DISCIPLINE_OPTIONS } from '../../labels.js';
import type { PublicTabProps } from './tabProps.js';

const STATUS_TONES: Record<PublicCategory['status'], Tone> = { upcoming: 'neutral', started: 'warn', finished: 'ok' };
const cardStyle = { background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' } as const;

/** Zone · format d'un tableau (« Tatami 1 · Élimination directe »). */
function headline(pub: PublicCompetition, c: PublicCategory): string {
  const zone = pub.zones.find((z) => z.id === c.zoneId)?.name;
  const format = c.bracket.kind === 'kata' ? ALL_FORMAT_LABELS.kata_two_rounds : ALL_FORMAT_LABELS[c.bracket.format];
  return [zone, format].filter(Boolean).join(' · ');
}

function Passages({ pub, c }: { pub: PublicCompetition; c: PublicCategory }) {
  const rows = categoryPassages(pub, c);
  if (rows.length === 0) return <Text size="sm" c="dimmed" data-testid="public-passages-empty">Pas de numéro de passage pour cette catégorie.</Text>;
  return (
    <Stack gap={0} data-testid="public-passages">
      {rows.map((r) => (
        <Group key={r.key} gap="xs" wrap="nowrap" align="baseline" py={6} style={{ borderTop: '1px solid var(--sk-line)' }} data-testid="public-passage">
          <Text span className="num" fw={700} style={{ flexShrink: 0, minWidth: 40 }}>n° {r.number}</Text>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {r.kata ? `Kata · ${r.result}` : `${r.a ?? 'à déterminer'} contre ${r.b ?? 'à déterminer'}`}
            </Text>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{[r.zone, !r.kata && r.result ? r.result : r.kata && r.played ? 'passé' : ''].filter(Boolean).join(' · ')}</Text>
          </Box>
        </Group>
      ))}
    </Stack>
  );
}

function CategoryDetail({ pub, c, highlighted }: { pub: PublicCompetition; c: PublicCategory; highlighted: Set<string> }) {
  const [view, setView] = useState<'tableau' | 'combats'>('tableau');
  const entrants = useMemo(() => entrantInfos(pub), [pub]);
  return (
    <Stack gap="sm" p="sm" data-testid="public-category" style={cardStyle}>
      <Box>
        <Group gap="xs" wrap="wrap" justify="space-between" align="flex-start">
          <Text fw={700} style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{c.label}</Text>
          <StatusBadge tone={STATUS_TONES[c.status]}>{CATEGORY_STATUS_LABELS[c.status]}</StatusBadge>
        </Group>
        <Text size="sm" c="dimmed" data-testid="public-category-head">{headline(pub, c)}</Text>
      </Box>
      <SegmentedControl size="xs" value={view} onChange={(v) => setView(v as typeof view)} data={[{ value: 'tableau', label: 'Tableau' }, { value: 'combats', label: 'Combats' }]} data-testid="public-category-view" />
      {view === 'combats' ? <Passages pub={pub} c={c} /> : (
        <Box style={{ overflowX: 'auto', maxWidth: '100%' }} data-testid="public-bracket-scroll">
          <BracketView category={c} entrants={entrants} numbers={toMap(c.numbers)} matchZones={toMap(c.matchZones)} results={c.results}
            kataScores={c.kataScores ?? undefined} tieBreaks={c.tieBreaks.pools} kataTieBreak={c.tieBreaks.kata} highlighted={highlighted} />
        </Box>
      )}
    </Stack>
  );
}

/** Onglet « Tableaux » : filtres, liste des catégories, puis le tableau (lecture seule) et les combats de la catégorie ouverte. */
export function BracketsTab({ pub, followed }: PublicTabProps) {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<CategoryFilters>(NO_FILTERS);
  const [q, setQ] = useState('');
  const openId = params.get('categorie');
  const open = pub.categories.find((c) => c.id === openId) ?? null;
  const highlighted = useMemo(() => {
    const out = followedRegistrations(pub, followed);
    for (const r of highlightedRegistrations(pub, q)) out.add(r);
    return out;
  }, [pub, followed, q]);
  const shown = filterCategories(pub.categories, filters);
  const waves = pub.waves.filter((w) => pub.categories.some((c) => (c.waveId ?? '') === (w.id ?? '')));
  const zones = pub.zones.filter((z) => pub.categories.some((c) => c.zoneId === z.id));
  const select = (value: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (value) n.set('categorie', value); else n.delete('categorie'); return n; }, { replace: true });
  const set = <K extends keyof CategoryFilters>(k: K, v: string | null) => setFilters({ ...filters, [k]: v ?? 'all' });
  const all = { value: 'all', label: 'Tous' };

  if (pub.categories.length === 0) return <EmptyState title="Aucun tableau pour le moment." data-testid="public-brackets-empty" />;
  return (
    <Stack gap="sm" data-testid="public-brackets">
      <TextInput value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Chercher un combattant ou un club (surligné)" aria-label="Chercher dans les tableaux" data-testid="public-brackets-search" />
      <Group gap="xs" grow wrap="wrap">
        <Select size="xs" label="Discipline" allowDeselect={false} value={filters.discipline} onChange={(v) => set('discipline', v)} data={[all, ...DISCIPLINE_OPTIONS]} data-testid="public-filter-discipline" />
        <Select size="xs" label="Session" allowDeselect={false} value={filters.waveId} onChange={(v) => set('waveId', v)} data={[all, ...waves.map((w) => ({ value: w.id ?? '', label: w.name }))]} data-testid="public-filter-wave" />
        <Select size="xs" label="Zone" allowDeselect={false} value={filters.zoneId} onChange={(v) => set('zoneId', v)} data={[all, ...zones.map((z) => ({ value: z.id, label: z.name }))]} data-testid="public-filter-zone" />
        <Select size="xs" label="État" allowDeselect={false} value={filters.status} onChange={(v) => set('status', v)}
          data={[all, ...(Object.keys(CATEGORY_STATUS_LABELS) as PublicCategory['status'][]).map((s) => ({ value: s, label: CATEGORY_STATUS_LABELS[s] }))]} data-testid="public-filter-status" />
      </Group>
      {shown.length === 0 && <Text size="sm" c="dimmed" data-testid="public-brackets-none">Aucune catégorie avec ces filtres.</Text>}
      <Stack gap={4}>
        {shown.map((c) => (
          <Paper key={c.id} withBorder={false} style={{ ...cardStyle, borderColor: c.id === open?.id ? 'var(--sk-accent)' : undefined }}>
            <UnstyledButton onClick={() => select(c.id === open?.id ? null : c.id)} aria-expanded={c.id === open?.id} data-testid="public-category-item" style={{ display: 'block', width: '100%', padding: '8px 12px' }}>
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                <Text size="sm" fw={600} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{c.label}</Text>
                <StatusBadge tone={STATUS_TONES[c.status]}>{CATEGORY_STATUS_LABELS[c.status]}</StatusBadge>
              </Group>
            </UnstyledButton>
          </Paper>
        ))}
      </Stack>
      {open && <CategoryDetail key={open.id} pub={pub} c={open} highlighted={highlighted} />}
    </Stack>
  );
}
