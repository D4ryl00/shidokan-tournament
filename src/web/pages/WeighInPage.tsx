import '../print.css';
import { Button, Group, Loader, Modal, NumberInput, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import type { Presence } from '../../domain/replacement/index.js';
import { useCloseWeighIn, useGrid, useSetWeighIn, useWeighIn, type WeighInFighter } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { HelpText } from '../components/Help.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconSearch } from '../components/ui/icons.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { ageBandLabel, disciplineLabel } from '../labels.js';
import { useSelectedWave } from '../useSelectedWave.js';
import { TableCard } from '../components/ui/TableCard.js';

function WeightCell({ fighter, index, onSave }: { fighter: WeighInFighter; index: number; onSave: (kg: number | null) => void }) {
  const [value, setValue] = useState<number | ''>(fighter.weighInKg ?? '');
  const save = () => {
    const kg = value === '' ? null : Number(value);
    if (kg !== fighter.weighInKg) onSave(kg);
  };
  return (
    <NumberInput
      data-testid="weighin-weight"
      data-weight-index={index}
      w={130}
      size="md"
      styles={{ input: { fontWeight: 700, fontSize: 'var(--mantine-font-size-lg)', fontVariantNumeric: 'tabular-nums' } }}
      suffix=" kg"
      decimalScale={2}
      decimalSeparator=","
      hideControls
      value={value}
      onChange={(v) => setValue(v === '' ? '' : Number(v))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        save();
        const next = document.querySelector<HTMLInputElement>(`[data-weight-index="${index + 1}"]`);
        next?.focus();
        next?.select();
      }}
    />
  );
}

/** Présence en contrôle segmenté : présent en vert, absent en orangé, « ? » neutre. */
const presenceStyles = (p: Presence) => ({
  indicator: { backgroundColor: p === 'present' ? 'var(--sk-ok)' : p === 'absent' ? 'var(--sk-warn)' : 'var(--sk-chip)' },
  label: { fontWeight: 600, ...(p === 'present' ? { '--sc-label-color': 'var(--sk-ok-text)' } : p === 'absent' ? { '--sc-label-color': 'var(--sk-warn-text)' } : {}) },
});

export function WeighInPage() {
  const { id = '' } = useParams();
  const { waves, waveId, select, ready } = useSelectedWave(id);
  const { data } = useWeighIn(id, waveId);
  const sheetQuery = waveId ? `session=${encodeURIComponent(waveId)}` : '';
  const { data: grid } = useGrid(id);
  const set = useSetWeighIn(id);
  const close = useCloseWeighIn(id);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(false);
  const fighters = (data?.fighters ?? []).filter((f) => !search || normalizeName(`${f.label} ${f.club}`).includes(normalizeName(search)));
  const all = data?.fighters ?? [];
  const count = (p: Presence) => all.filter((f) => f.presence === p).length;

  // Tant que les vagues ne sont pas chargées, on ne sait pas quelle pesée afficher (jamais « toute la compétition » par erreur).
  if (!ready) return <Loader />;
  return (
    <Stack gap="md">
      {waves.length > 0 && (
        <Group gap="xs">
          <Text size="sm" fw={600}>Session :</Text>
          <SegmentedControl data-testid="weighin-wave" value={waveId ?? ''} onChange={select}
            data={waves.map((w) => ({ value: w.id, label: w.name }))} />
        </Group>
      )}
      <Group justify="space-between" gap="sm">
        <Group gap="sm">
          <TextInput placeholder="Rechercher (nom, club)" leftSection={<IconSearch />} value={search} w={240} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Group gap={6} data-testid="weighin-counters">
            <StatusBadge tone="ok" size="lg" className="num">{plural(count('present'), 'présent')}</StatusBadge>
            <StatusBadge tone="neutral" size="lg" className="num">{plural(count('absent'), 'absent')}</StatusBadge>
            <StatusBadge tone={count('unknown') > 0 ? 'warn' : 'neutral'} size="lg" className="num">{plural(count('unknown'), 'non pesé', 'non pesés')}</StatusBadge>
          </Group>
          {data?.closed && <StatusBadge tone="accent" size="lg">Pesée clôturée</StatusBadge>}
        </Group>
        <Group gap="sm">
          <Text size="sm" c="dimmed">Feuilles de pesée :</Text>
          <Button.Group>
            <Button variant="default" component={Link} to={`/competitions/${id}/impression/pesee${sheetQuery ? `?${sheetQuery}` : ''}`} target="_blank" data-testid="weighin-sheets-club">par club</Button>
            <Button variant="default" component={Link} to={`/competitions/${id}/impression/pesee?par=categorie${sheetQuery ? `&${sheetQuery}` : ''}`} target="_blank" data-testid="weighin-sheets-category">
              par catégorie
            </Button>
          </Button.Group>
          <Button data-testid="weighin-close" onClick={() => setConfirm(true)} disabled={count('unknown') === 0}>Clôturer la pesée</Button>
        </Group>
      </Group>
      <ApiErrorAlert error={set.error ?? close.error} />
      {fighters.length > 0 && (
      <TableCard>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Combattant</Table.Th><Table.Th>Club</Table.Th><Table.Th>Âge</Table.Th><Table.Th>Inscriptions</Table.Th>
            <Table.Th>Présence</Table.Th><Table.Th>Poids</Table.Th><Table.Th>Catégorie du poids</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {fighters.map((f, i) => {
            const combat = f.registrations.filter((r) => r.hasWeight);
            const out = combat.find((r) => r.outOfClass);
            return (
              <Table.Tr key={f.fighterId} data-testid="weighin-row">
                <Table.Td fw={600} style={{ whiteSpace: 'nowrap' }}>{f.label}</Table.Td>
                <Table.Td maw={200}><Text size="sm" className="sk-ellipsis" title={f.club || undefined}>{f.club || '—'}</Text></Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{ageBandLabel(grid, f.ageBandCode)} {f.sex}</Table.Td>
                <Table.Td>
                  {f.registrations.map((r) => (
                    <Group key={r.id} gap={4} wrap="nowrap">
                      <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{disciplineLabel(r.discipline)}{r.weightClassLabel ? ` ${r.weightClassLabel}` : ''}</Text>
                      {r.recased && <StatusBadge tone="neutral" size="sm" data-testid="weighin-recased" title={r.categoryLabel ?? undefined}>Réaffecté</StatusBadge>}
                    </Group>
                  ))}
                </Table.Td>
                <Table.Td>
                  <SegmentedControl data-testid="weighin-presence" size="sm" value={f.presence} styles={presenceStyles(f.presence)}
                    onChange={(v) => set.mutate({ fighterId: f.fighterId, presence: v as Presence, ...(waveId ? { waveId } : {}) })}
                    data={[{ value: 'unknown', label: '?' }, { value: 'present', label: 'Présent' }, { value: 'absent', label: 'Absent' }]} />
                </Table.Td>
                <Table.Td>
                  {combat.length > 0 ? (
                    <WeightCell key={`${f.fighterId}-${f.weighInKg ?? ''}`} fighter={f} index={i} onSave={(kg) => set.mutate({ fighterId: f.fighterId, weighInKg: kg, ...(waveId ? { waveId } : {}) })} />
                  ) : (
                    <Text size="sm" c="dimmed">Kata : pas de pesée</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {out ? (
                    <StatusBadge tone="warn" data-testid="weighin-out">⚖ Hors catégorie → {out.weighInClassLabel}</StatusBadge>
                  ) : combat[0]?.weighInClassLabel ? (
                    <Text size="sm">{combat[0].weighInClassLabel}</Text>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      </TableCard>
      )}
      {data && fighters.length === 0 && (
        all.length === 0
          ? <EmptyState title="Personne à peser" text={waves.length > 0 ? 'Aucun combattant inscrit dans cette session.' : 'Aucune inscription pour l’instant : elles se font dans l’étape Préparer.'} />
          : <EmptyState title="Aucun combattant ne correspond" text="Changez la recherche." />
      )}
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Clôturer la pesée ?">
        <Stack>
          <Text>{count('unknown') === 1 ? '1 combattant non pesé sera marqué absent et retiré' : `${count('unknown')} combattants non pesés seront marqués absents et retirés`} des tableaux non lancés.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button data-testid="weighin-close-confirm"
              onClick={() => close.mutate(waveId ?? undefined, { onSuccess: (r) => { setConfirm(false); notifications.show({ message: `${plural(r.markedAbsent, 'combattant marqué absent', 'combattants marqués absents')}.` }); } })}>
              Clôturer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Feuilles de pesée imprimables, une par club ou (`?par=categorie`) une par catégorie de combat. */
export function WeighInSheets() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  // Avec des vagues : les feuilles de la vague choisie dans l'écran de pesée (même repli que l'écran).
  const { waveId, ready } = useSelectedWave(id);
  const { data } = useWeighIn(id, waveId);
  const { data: grid } = useGrid(id);
  const byCategory = params.get('par') === 'categorie';
  const groups = new Map<string, WeighInFighter[]>();
  const rank = new Map<string, number>();
  const add = (key: string, f: WeighInFighter) => groups.set(key, [...(groups.get(key) ?? []), f]);
  for (const f of data?.fighters ?? []) {
    if (!byCategory) add(f.club || 'Sans club', f);
    // Par catégorie : seules les inscriptions pesées comptent (le kata n'a pas de pesée).
    else
      for (const r of f.registrations)
        if (r.hasWeight && r.categoryLabel) {
          add(r.categoryLabel, f);
          rank.set(r.categoryLabel, r.categoryOrder ?? Number.MAX_SAFE_INTEGER);
        }
  }
  // Par catégorie : dans l'ordre de la grille (tranches d'âge, puis poids), comme l'onglet Tableaux.
  const sorted = byCategory ? [...groups].sort(([a], [b]) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b)) : [...groups];
  if (!ready) return null;
  return (
    <div className="print-root">
      <Group className="no-print" mb="md"><Button onClick={() => window.print()}>Imprimer</Button><HelpText topic="impression" /></Group>
      {sorted.map(([title, list]) => (
        <section key={title} className="print-section" data-testid="weighin-sheet">
          <div className="print-header">
            <img src="/shidokan-france-logo.webp" alt="" width={44} height={44} />
            <h1>Pesée — {title}</h1>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{[byCategory ? 'Club' : null, 'Combattant', 'Âge', 'Inscriptions', 'Présent', 'Poids'].filter((h) => h !== null).map((h) => <th key={h} style={{ border: '1px solid #000', padding: 6, textAlign: 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.fighterId}>
                  {byCategory && <td style={{ border: '1px solid #000', padding: 6 }}>{f.club || 'Sans club'}</td>}
                  <td style={{ border: '1px solid #000', padding: 6 }}>{f.label}</td>
                  <td style={{ border: '1px solid #000', padding: 6 }}>{ageBandLabel(grid, f.ageBandCode)} {f.sex}</td>
                  <td style={{ border: '1px solid #000', padding: 6 }}>{f.registrations.map((r) => `${disciplineLabel(r.discipline)}${r.weightClassLabel ? ` ${r.weightClassLabel}` : ''}`).join(', ')}</td>
                  <td style={{ border: '1px solid #000', padding: 6, width: 70 }} />
                  <td style={{ border: '1px solid #000', padding: 6, width: 100 }} />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
