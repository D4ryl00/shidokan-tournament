import { Anchor, Box, Loader, SegmentedControl, Text, UnstyledButton } from '@mantine/core';
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { ALL_FORMAT_LABELS } from '../../../domain/brackets/format-labels.js';
import { activeEntrantCount, type CategoryStatus } from '../../../domain/categories.js';
import { plural } from '../../../domain/plural.js';
import type { DetailsCategory } from '../../../domain/replacement/move-details.js';
import { useRegistrations, useWaves, useZones } from '../../api.js';
import { kgLabel } from '../../labels.js';
import { useEntrantInfo } from '../../pages/BracketsPage.js';
import { withSession } from '../../useSelectedWave.js';
import { BracketView } from '../BracketView.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { FighterSheet } from './FighterSheet.js';

const STATE: Record<CategoryStatus, string> = { provisional: 'pas commencée', ready: 'pas commencée', started: 'en cours', finished: 'terminée' };
const tag: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sk-muted)' };
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Cadre d'une colonne : bordure d'accent sur « Vers ». */
function ColumnFrame({ side, children }: { side: 'from' | 'to'; children: ReactNode }) {
  return (
    <Box data-testid="details-column" data-side={side}
      style={{ flex: '1 1 300px', minWidth: 0, border: `1px solid ${side === 'to' ? 'var(--sk-accent)' : 'var(--sk-line)'}`, borderRadius: 'var(--mantine-radius-md)', background: 'var(--sk-card)', overflow: 'hidden' }}>
      <Box px={8} pt={6}><Text style={tag}>{side === 'from' ? 'De' : 'Vers'}</Text></Box>
      {children}
    </Box>
  );
}

/** Colonne en cours de calcul. */
export function LoadingColumn({ side }: { side: 'from' | 'to' }) {
  return <ColumnFrame side={side}><Box p={8}><Loader size="sm" /></Box></ColumnFrame>;
}

/**
 * Une catégorie des « Détails » (De ou Vers) : libellé, ligne d'infos, puis au choix ses combattants (fiche dépliée au clic,
 * plusieurs à la fois) ou son tableau (fiche du nom choisi dessous). Ceux qui bougent sont marqués « part » (De, en tête)
 * ou « arrive » (Vers, à la fin).
 */
export function CategoryColumn({ side, category, movers, competitionId, waveId, sex }: {
  side: 'from' | 'to';
  /** null : le combattant n'avait pas de catégorie. */
  category: DetailsCategory | null;
  movers: string[];
  competitionId: string;
  /** Session affichée, gardée par le lien vers la galaxie. */
  waveId: string | null;
  sex: 'F' | 'M';
}) {
  const { data: regs = [] } = useRegistrations(competitionId);
  const { data: waves = [] } = useWaves(competitionId);
  const { data: zones = [] } = useZones(competitionId);
  const entrants = useEntrantInfo(competitionId);
  const [view, setView] = useState<'list' | 'bracket'>('list');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [chosen, setChosen] = useState<string | null>(null);

  if (!category) {
    return <ColumnFrame side={side}><Text size="sm" c="dimmed" px={8} pb={8}>Pas de catégorie</Text></ColumnFrame>;
  }

  const moving = new Set(movers);
  const mark = side === 'from' ? 'part' : 'arrive';
  const others = category.registrationIds.filter((r) => !moving.has(r));
  const mine = category.registrationIds.filter((r) => moving.has(r));
  const ids = side === 'from' ? [...mine, ...others] : [...others, ...mine];

  const total = activeEntrantCount(category);
  const activeMovers = mine.filter((r) => !category.absentIds.includes(r)).length;
  const pronoun = movers.length > 1 ? (sex === 'F' ? 'elles' : 'eux') : sex === 'F' ? 'elle' : 'lui';
  const count = side === 'to'
    ? `${plural(total - activeMovers, 'combattant', 'combattants')} (${total} avec ${pronoun})`
    : plural(total, 'combattant', 'combattants');
  const wave = waves.length > 0 ? (category.waveId ? `Session ${waves.find((w) => w.id === category.waveId)?.name ?? '?'}` : 'session en attente') : null;
  const zone = category.zoneId ? (zones.find((z) => z.id === category.zoneId)?.name ?? null) : null;
  const format = category.effectiveFormat ? lower(ALL_FORMAT_LABELS[category.effectiveFormat]) : null;
  const info = [wave, zone, format, STATE[category.status], count].filter(Boolean).join(' · ');

  const toggle = (rid: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(rid)) next.delete(rid); else next.add(rid);
    return next;
  });

  return (
    <ColumnFrame side={side}>
      <Box px={8} pb={6}>
        <Text size="sm" fw={700} style={{ overflowWrap: 'anywhere' }} data-testid="details-label">{category.label}</Text>
        <Text size="xs" c="dimmed" data-testid="details-info">{info}</Text>
        <Box mt={4} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <SegmentedControl size="xs" value={view} onChange={(v) => setView(v as 'list' | 'bracket')} data-testid="details-view"
            data={[{ value: 'list', label: 'Combattants' }, { value: 'bracket', label: 'Tableau' }]} />
          {category.id && (
            <Anchor size="xs" data-testid="details-galaxy" target="_blank" rel="noopener"
              href={withSession(`/competitions/${competitionId}/tableaux?vue=galaxie&categorie=${category.id}`, waveId)}>
              ✦ Voir dans la galaxie ↗
            </Anchor>
          )}
        </Box>
      </Box>

      {view === 'list' ? (
        ids.map((rid) => {
          const r = regs.find((x) => x.id === rid);
          const isMover = moving.has(rid);
          const absent = category.absentIds.includes(rid);
          const weight = r ? (r.weighInKg !== null ? kgLabel(r.weighInKg) : r.approxWeightKg !== null ? `≈ ${kgLabel(r.approxWeightKg)}` : null) : null;
          return (
            <Fragment key={rid}>
              <UnstyledButton data-testid="details-fighter" data-registration={rid} data-mark={isMover ? mark : absent ? 'absent' : undefined}
                aria-expanded={open.has(rid)} onClick={() => toggle(rid)}
                style={{
                  display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderTop: '1px solid var(--sk-line)', background: isMover ? 'var(--sk-warn)' : undefined, opacity: absent ? 0.55 : undefined,
                }}>
                <Text size="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b>{r ? `${r.fighter.lastName} ${r.fighter.firstName}` : rid}</b> · {r?.club?.name ?? 'sans club'}
                </Text>
                <Box style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {isMover && <StatusBadge tone="warn" size="xs">{mark}</StatusBadge>}
                  {absent && <StatusBadge tone="neutral" size="xs">absent</StatusBadge>}
                  {weight && <Text size="xs" c="dimmed" className="num">{weight}</Text>}
                </Box>
              </UnstyledButton>
              {open.has(rid) && <Box mx={8} mb={6}><FighterSheet competitionId={competitionId} registrationId={rid} /></Box>}
            </Fragment>
          );
        })
      ) : !category.bracket || category.registrationIds.length === 0 ? (
        <Text size="sm" c="dimmed" px={8} pb={8} style={{ borderTop: '1px solid var(--sk-line)', paddingTop: 6 }}>Pas de tableau pour cette catégorie</Text>
      ) : (
        <Box style={{ borderTop: '1px solid var(--sk-line)', padding: 8, overflowX: 'auto' }}>
          {/* Ceux qui bougent en orange, comme dans la liste ; le nom choisi garde son contour. Sans `onClick`, `entrantProps` laisse le clic à `onSelect`. */}
          <BracketView category={category} entrants={entrants} selected={chosen} onSelect={(rid) => setChosen((c) => (c === rid ? null : rid))}
            entrantProps={(rid) => ({ style: { cursor: 'pointer', ...(moving.has(rid) ? { background: 'var(--sk-warn)' } : {}) } })} />
          {chosen && (
            <Box mt={6}>
              <Text size="sm" mb={4} style={{ overflowWrap: 'anywhere' }} data-testid="details-chosen-name">
                {(() => { const r = regs.find((x) => x.id === chosen); return r ? <><b>{r.fighter.lastName} {r.fighter.firstName}</b> · {r.club?.name ?? 'sans club'}</> : null; })()}
              </Text>
              <FighterSheet competitionId={competitionId} registrationId={chosen} />
            </Box>
          )}
        </Box>
      )}
    </ColumnFrame>
  );
}
