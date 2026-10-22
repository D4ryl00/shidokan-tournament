import {
  Button, Checkbox, Fieldset, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { CombatFormat, CompetitionSettings } from '../../domain/settings.js';
import { useCompetition, useGrid, useUpdateCompetition } from '../api.js';
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
  const [info, setInfo] = useState({ name: '', date: '', location: '', tatamiCount: 2 });
  const [s, setS] = useState<CompetitionSettings | null>(null);

  useEffect(() => {
    if (!competition) return;
    setInfo({ name: competition.name, date: competition.date, location: competition.location ?? '', tatamiCount: competition.tatamiCount });
    setS(competition.settings);
  }, [competition]);

  if (!s) return null;
  const set = (patch: Partial<CompetitionSettings>) => setS({ ...s, ...patch });
  const bandOptions = (grid?.ageBands ?? []).map((b) => ({ value: b.code, label: b.label }));

  const save = () =>
    update.mutate(
      { name: info.name, date: info.date, location: info.location || null, tatamiCount: info.tatamiCount, settings: s },
      { onSuccess: () => notifications.show({ color: 'green', message: 'Réglages enregistrés' }) },
    );

  return (
    <Stack data-testid="settings-form" maw={900}>
      <Fieldset legend={HELP['reglages.competition'].title}>
        <HelpLine topic="reglages.competition" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nom" value={info.name} onChange={(e) => setInfo({ ...info, name: e.currentTarget.value })} />
          <TextInput label="Date" type="date" value={info.date} onChange={(e) => setInfo({ ...info, date: e.currentTarget.value })} />
          <TextInput label="Lieu" value={info.location} onChange={(e) => setInfo({ ...info, location: e.currentTarget.value })} />
          <NumberInput label="Nombre de tatamis" clampBehavior="none" value={info.tatamiCount}
            onChange={(v) => setInfo({ ...info, tatamiCount: Number(v) })} />
        </SimpleGrid>
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

      <ApiErrorAlert error={update.error} />
      <Group>
        <Button data-testid="settings-save" onClick={save} loading={update.isPending}>
          Enregistrer
        </Button>
      </Group>
    </Stack>
  );
}
