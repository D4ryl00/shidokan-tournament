import '../print.css';
import { Badge, Button, Group, Modal, NumberInput, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import type { Presence } from '../../domain/replacement/index.js';
import { useCloseWeighIn, useGrid, useSetWeighIn, useWeighIn, type WeighInFighter } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ageBandLabel, disciplineLabel } from '../labels.js';

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
      w={110}
      size="xs"
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

export function WeighInPage() {
  const { id = '' } = useParams();
  const { data } = useWeighIn(id);
  const { data: grid } = useGrid(id);
  const set = useSetWeighIn(id);
  const close = useCloseWeighIn(id);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(false);
  const fighters = (data?.fighters ?? []).filter((f) => !search || normalizeName(`${f.label} ${f.club}`).includes(normalizeName(search)));
  const all = data?.fighters ?? [];
  const count = (p: Presence) => all.filter((f) => f.presence === p).length;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <TextInput placeholder="Rechercher (nom, club)" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Text size="sm" data-testid="weighin-counters">
            {count('present')} présent(s) · {count('absent')} absent(s) · {count('unknown')} non pesé(s)
          </Text>
          {data?.closed && <Badge color="gray">Pesée clôturée</Badge>}
        </Group>
        <Group>
          <Button variant="light" component={Link} to={`/competitions/${id}/impression/pesee`} target="_blank">Feuilles de pesée par club</Button>
          <Button variant="light" component={Link} to={`/competitions/${id}/impression/pesee?par=categorie`} target="_blank" data-testid="weighin-sheets-category">
            … par catégorie
          </Button>
          <Button color="orange" data-testid="weighin-close" onClick={() => setConfirm(true)} disabled={count('unknown') === 0}>Clôturer la pesée</Button>
        </Group>
      </Group>
      <ApiErrorAlert error={set.error ?? close.error} />
      <Table striped>
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
                <Table.Td>{f.label}</Table.Td>
                <Table.Td>{f.club || '—'}</Table.Td>
                <Table.Td>{ageBandLabel(grid, f.ageBandCode)} {f.sex}</Table.Td>
                <Table.Td>
                  {f.registrations.map((r) => (
                    <Text key={r.id} size="xs">
                      {disciplineLabel(r.discipline)}{r.weightClassLabel ? ` ${r.weightClassLabel}` : ''}
                      {r.recased && <Badge ml={4} size="xs" variant="light" color="gray" data-testid="weighin-recased" title={r.categoryLabel ?? undefined}>recasé</Badge>}
                    </Text>
                  ))}
                </Table.Td>
                <Table.Td>
                  <SegmentedControl data-testid="weighin-presence" size="xs" value={f.presence}
                    onChange={(v) => set.mutate({ fighterId: f.fighterId, presence: v as Presence })}
                    data={[{ value: 'unknown', label: '?' }, { value: 'present', label: 'Présent' }, { value: 'absent', label: 'Absent' }]} />
                </Table.Td>
                <Table.Td>
                  {combat.length > 0 ? (
                    <WeightCell key={`${f.fighterId}-${f.weighInKg ?? ''}`} fighter={f} index={i} onSave={(kg) => set.mutate({ fighterId: f.fighterId, weighInKg: kg })} />
                  ) : (
                    <Text size="xs" c="dimmed">kata : pas de pesée</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {out ? (
                    <Badge color="blue" variant="outline" data-testid="weighin-out">⚖ hors catégorie → {out.weighInClassLabel}</Badge>
                  ) : combat[0]?.weighInClassLabel ? (
                    <Text size="sm">{combat[0].weighInClassLabel}</Text>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Clôturer la pesée ?">
        <Stack>
          <Text>{count('unknown')} combattant(s) non pesé(s) seront marqués absents et retirés des tableaux non lancés.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button color="orange" data-testid="weighin-close-confirm"
              onClick={() => close.mutate(undefined, { onSuccess: (r) => { setConfirm(false); notifications.show({ message: `${r.markedAbsent} combattant(s) marqué(s) absent(s).` }); } })}>
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
  const { data } = useWeighIn(id);
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
  return (
    <div className="print-root">
      <Group className="no-print" mb="md"><Button onClick={() => window.print()}>Imprimer</Button></Group>
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
