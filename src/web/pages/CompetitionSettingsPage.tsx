import {
  ActionIcon, Alert, Button, Checkbox, List, Modal, Fieldset, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { CombatFormat, CompetitionSettings, PassageOrderMode } from '../../domain/settings.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import { useCategories, useCompetition, useGrid, usePassages, useSaveZones, useUpdateCompetition, useZones } from '../api.js';
import { ZonesImpossibleAlert } from '../components/ZonesImpossibleAlert.js';
import { nextZoneName, validateZones, ZONE_MAX } from '../../domain/zones.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { HelpLine } from '../components/Help.js';
import { HELP } from '../help.js';

export const FORMAT_LABELS: Record<CombatFormat, string> = {
  single_match: 'Un seul combat',
  best_of_three: 'Au meilleur des trois',
  round_robin: 'Poule (tous contre tous)',
  three_with_repechage: '3 combattants avec repêchage',
  single_elimination: 'Élimination directe',
  double_elimination: 'Double élimination',
  pools_then_bracket: 'Poules puis tableau final',
};
const FORMAT_OPTIONS = Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }));
const ALL_DISCIPLINES = Object.keys(DISCIPLINES) as DisciplineId[];
const PASSAGE_ORDER_OPTIONS: { value: PassageOrderMode; label: string }[] = [
  { value: 'rounds', label: 'Tour par tour' },
  { value: 'categories', label: 'Catégorie par catégorie' },
];

/** NumberInput sans bornage côté client : le serveur valide et explique. */
function Kg(props: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <NumberInput data-testid={props.testId} label={props.label} suffix=" kg" decimalScale={2} clampBehavior="none"
      value={props.value} onChange={(v) => props.onChange(typeof v === 'number' ? v : Number(v))} />
  );
}

export function CompetitionSettingsPage() {
  const { id = '' } = useParams();
  const { data: competition } = useCompetition(id);
  const { data: grid } = useGrid(id);
  const update = useUpdateCompetition(id);
  const [info, setInfo] = useState({ name: '', date: '', location: '' });
  const [s, setS] = useState<CompetitionSettings | null>(null);
  const { data: savedZones } = useZones(id);
  const saveZones = useSaveZones(id);
  const { data: categories = [] } = useCategories(id);
  // `key` : identifiant d'affichage stable, y compris pour une zone pas encore enregistrée.
  // Disciplines accueillies : null = toutes.
  const [zones, setZones] = useState<{ key: string; id?: string; name: string; disciplines: DisciplineId[] | null }[]>([]);
  const { data: passages } = usePassages(id);
  const [zoneErrors, setZoneErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    if (savedZones) setZones(savedZones.map(({ id: zid, name, disciplines }) => ({ key: zid, id: zid, name, disciplines })));
  }, [savedZones]);
  // Catégories de la zone, épinglées ou réparties automatiquement.
  const zoneCategories = (zid?: string) => (zid ? categories.filter((c) => (passages?.categories[c.id]?.zoneId ?? c.zoneId) === zid) : []);
  const zoneLocked = (zid?: string) => zoneCategories(zid).some((c) => c.status === 'started' || c.status === 'finished');
  const removeZone = (key: string) => {
    setZones((zs) => zs.filter((z) => z.key !== key));
    setDeleting(null);
  };
  const deletingZone = zones.find((z) => z.key === deleting);
  const deletingCount = zoneCategories(deletingZone?.id).length;
  const toggleDiscipline = (key: string, d: DisciplineId) =>
    setZones((zs) =>
      zs.map((z) => {
        if (z.key !== key) return z;
        const current = z.disciplines ?? ALL_DISCIPLINES;
        const next = current.includes(d) ? current.filter((x) => x !== d) : ALL_DISCIPLINES.filter((x) => x === d || current.includes(x));
        return { ...z, disciplines: next.length === ALL_DISCIPLINES.length ? null : next };
      }),
    );
  const moveZone = (i: number, d: -1 | 1) =>
    setZones((zs) => {
      const next = [...zs];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });

  useEffect(() => {
    if (!competition) return;
    setInfo({ name: competition.name, date: competition.date, location: competition.location ?? '' });
    setS(competition.settings);
  }, [competition]);

  if (!s) return null;
  const set = (patch: Partial<CompetitionSettings>) => setS({ ...s, ...patch });
  const bandOptions = (grid?.ageBands ?? []).map((b) => ({ value: b.code, label: b.label }));

  // Zones vérifiées avant tout envoi, puis enregistrées en premier : une erreur n'enregistre rien d'autre.
  const save = () => {
    const input = zones.map(({ id: zid, name, disciplines }) => (zid ? { id: zid, name, disciplines } : { name, disciplines }));
    const errors = validateZones(input);
    setZoneErrors(errors);
    if (errors.length) return;
    saveZones.mutate({ zones: input, knownIds: (savedZones ?? []).map((z) => z.id) }, {
      onSuccess: () =>
        update.mutate(
          { name: info.name, date: info.date, location: info.location || null, settings: s },
          { onSuccess: () => notifications.show({ color: 'green', message: 'Réglages enregistrés' }) },
        ),
    });
  };

  return (
    <Stack data-testid="settings-form" maw={900}>
      <Fieldset legend={HELP['reglages.competition'].title}>
        <HelpLine topic="reglages.competition" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nom" value={info.name} onChange={(e) => setInfo({ ...info, name: e.currentTarget.value })} />
          <TextInput label="Date" type="date" value={info.date} onChange={(e) => setInfo({ ...info, date: e.currentTarget.value })} />
          <TextInput label="Lieu" value={info.location} onChange={(e) => setInfo({ ...info, location: e.currentTarget.value })} />
        </SimpleGrid>
      </Fieldset>

      <Fieldset legend={HELP['reglages.zones'].title}>
        <HelpLine topic="reglages.zones" />
        <Stack gap="xs">
          {zones.map((z, i) => (
            <Stack key={z.key} gap={4} data-testid="zone-row">
            <Group gap="xs" wrap="nowrap">
              <TextInput data-testid="zone-name" aria-label={`Nom de la zone ${i + 1}`} w={260} maxLength={40} value={z.name}
                onChange={(e) => { const name = e.currentTarget.value; setZones((zs) => zs.map((x) => (x.key === z.key ? { ...x, name } : x))); }} />
              <ActionIcon variant="subtle" aria-label={`Monter la zone « ${z.name} »`} disabled={i === 0} onClick={() => moveZone(i, -1)}>↑</ActionIcon>
              <ActionIcon variant="subtle" aria-label={`Descendre la zone « ${z.name} »`} disabled={i === zones.length - 1} onClick={() => moveZone(i, 1)}>↓</ActionIcon>
              <ActionIcon variant="subtle" color="red" aria-label={`Supprimer la zone « ${z.name} »`} disabled={zones.length === 1 || zoneLocked(z.id)}
                title={zoneLocked(z.id) ? 'Une catégorie lancée s’y déroule' : undefined}
                onClick={() => (zoneCategories(z.id).length ? setDeleting(z.key) : removeZone(z.key))}>✕</ActionIcon>
            </Group>
            <Group gap="sm" data-testid="zone-disciplines">
              <Text size="xs" c="dimmed">Disciplines accueillies :</Text>
              {ALL_DISCIPLINES.map((d) => (
                <Checkbox key={d} size="xs" label={DISCIPLINES[d].label} checked={z.disciplines === null || z.disciplines.includes(d)}
                  onChange={() => toggleDiscipline(z.key, d)} />
              ))}
            </Group>
            </Stack>
          ))}
          <Group>
            <Button variant="light" size="xs" data-testid="zone-add" disabled={zones.length >= ZONE_MAX}
              onClick={() => setZones((zs) => [...zs, { key: crypto.randomUUID(), name: nextZoneName(zs.map((x) => x.name)), disciplines: null }])}>Ajouter une zone</Button>
          </Group>
          {zoneErrors.length > 0 && (
            <Alert color="red" title="Zones de combat" data-testid="zone-errors">
              <List size="sm">{zoneErrors.map((e) => <List.Item key={e}>{e}</List.Item>)}</List>
            </Alert>
          )}
          <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={`Supprimer la zone « ${deletingZone?.name ?? ''} » ?`}>
            <Stack data-testid="zone-delete-confirm">
              <Text size="sm">
                {deletingCount === 1 ? '1 catégorie de cette zone sera répartie' : `${deletingCount} catégories de cette zone seront réparties`} automatiquement sur les autres zones à l’enregistrement des réglages.
              </Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setDeleting(null)}>Annuler</Button>
                <Button color="red" data-testid="zone-delete-go" onClick={() => deleting && removeZone(deleting)}>Supprimer</Button>
              </Group>
            </Stack>
          </Modal>
        </Stack>
      </Fieldset>

      <Fieldset legend={HELP['reglages.ordre'].title}>
        <HelpLine topic="reglages.ordre" />
        <Stack>
          <Select data-testid="passage-order" w={320} label="Ordre de passage des combats" data={PASSAGE_ORDER_OPTIONS} value={s.passageOrder} allowDeselect={false}
            onChange={(v) => v && set({ passageOrder: v as PassageOrderMode })} />
          <Group align="flex-end">
            <Select data-testid="finals-zone" w={320} label="Finales sur la zone" allowDeselect={false}
              data={[{ value: '', label: 'Aucune (chaque finale reste sur sa zone)' }, ...(savedZones ?? []).map((z) => ({ value: z.id, label: z.name }))]}
              value={s.finalsZoneId ?? ''} onChange={(v) => set({ finalsZoneId: v || null })} />
            <Checkbox label="Finales de kata aussi sur cette zone" disabled={!s.finalsZoneId} checked={s.kataFinalsOnFinalsZone}
              onChange={(e) => set({ kataFinalsOnFinalsZone: e.currentTarget.checked })} data-testid="kata-finals" />
          </Group>
          <ZonesImpossibleAlert impossible={passages?.impossible} />
        </Stack>
      </Fieldset>

      <Fieldset legend={HELP['reglages.recasement'].title}>
        <HelpLine topic="reglages.recasement" />
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Kg testId="gap-children" label="Écart de poids max entre deux combattants — enfants" value={s.weightGapMaxKg.children}
              onChange={(children) => set({ weightGapMaxKg: { ...s.weightGapMaxKg, children } })} />
            <Kg testId="gap-adults" label="Écart de poids max entre deux combattants — adultes" value={s.weightGapMaxKg.adults}
              onChange={(adults) => set({ weightGapMaxKg: { ...s.weightGapMaxKg, adults } })} />
          </SimpleGrid>
          <Switch label="Autoriser le mélange mineurs / adultes (validation manuelle)" checked={s.mixMinorsAdults}
            onChange={(e) => set({ mixMinorsAdults: e.currentTarget.checked })} />
          <Switch label="Autoriser le mélange seniors / vétérans (validation manuelle)" checked={s.mixSeniorsVeterans}
            onChange={(e) => set({ mixSeniorsVeterans: e.currentTarget.checked })} />
          <Switch label="Autoriser le mélange filles / garçons (validation manuelle)" checked={s.mixSexes.enabled}
            onChange={(e) => set({ mixSexes: { ...s.mixSexes, enabled: e.currentTarget.checked } })} />
          {s.mixSexes.enabled && (
            <MultiSelect label="Tranches d'âge où le mélange filles / garçons est possible" data={bandOptions}
              value={s.mixSexes.ageBandCodes} onChange={(ageBandCodes) => set({ mixSexes: { ...s.mixSexes, ageBandCodes } })} />
          )}
          <Switch label="Autoriser plusieurs disciplines de combat le même jour" checked={s.multipleCombatDisciplinesPerDay}
            onChange={(e) => set({ multipleCombatDisciplinesPerDay: e.currentTarget.checked })} />
        </Stack>
      </Fieldset>

      <Fieldset legend={HELP['reglages.pesee'].title}>
        <HelpLine topic="reglages.pesee" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Kg label="Tolérance — hommes" value={s.weighInToleranceKg.M}
            onChange={(M) => set({ weighInToleranceKg: { ...s.weighInToleranceKg, M } })} />
          <Kg label="Tolérance — femmes" value={s.weighInToleranceKg.F}
            onChange={(F) => set({ weighInToleranceKg: { ...s.weighInToleranceKg, F } })} />
        </SimpleGrid>
      </Fieldset>

      <Fieldset legend={HELP['reglages.tableaux'].title}>
        <HelpLine topic="reglages.tableaux" />
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select label="Format pour 2 combattants" data={FORMAT_OPTIONS} value={s.formats.two} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, two: v as CombatFormat } })} />
            <Select label="Format pour 3 combattants" data={FORMAT_OPTIONS} value={s.formats.three} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, three: v as CombatFormat } })} />
            <Select label="Format pour 4 et plus" data={FORMAT_OPTIONS} value={s.formats.fourPlus} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, fourPlus: v as CombatFormat } })} />
          </SimpleGrid>
          <Checkbox label="Repêchage" checked={s.repechage} onChange={(e) => set({ repechage: e.currentTarget.checked })} />
          <Checkbox label="Combat pour la 3e place" checked={s.thirdPlaceMatch}
            onChange={(e) => set({ thirdPlaceMatch: e.currentTarget.checked })} />
        </Stack>
      </Fieldset>

      <Fieldset legend={HELP['reglages.kata'].title}>
        <HelpLine topic="reglages.kata" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Médailles de bronze en kata" data={[{ value: '1', label: '1' }, { value: '2', label: '2' }]}
            value={String(s.kataBronzeCount)} allowDeselect={false}
            onChange={(v) => v && set({ kataBronzeCount: Number(v) as 1 | 2 })} />
          <Select label="Rounds de triathlon" data={[{ value: '3', label: '3 (1 par discipline)' }, { value: '6', label: '6 (2 par discipline)' }]}
            value={String(s.triathlonRounds)} allowDeselect={false}
            onChange={(v) => v && set({ triathlonRounds: Number(v) as 3 | 6 })} />
        </SimpleGrid>
      </Fieldset>

      <ApiErrorAlert error={saveZones.error ?? update.error} />
      <Group>
        <Button data-testid="settings-save" onClick={save} loading={saveZones.isPending || update.isPending}>
          Enregistrer
        </Button>
      </Group>
    </Stack>
  );
}
