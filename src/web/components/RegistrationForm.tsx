import {
  Alert, Autocomplete, Button, Checkbox, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput,
} from '@mantine/core';
import { useRef, useState, type FormEvent } from 'react';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { weightClassesFor } from '../../domain/grid.js';
import { normalizeName } from '../../domain/names.js';
import { parsePreferences, type RegistrationInput, type RegistrationRow } from '../../domain/registration.js';
import type { DisciplineId, Ruleset, Sex } from '../../domain/types.js';
import { ApiError, useClubs, useCreateRegistration, useGrid, useUpdateRegistration, useUpsertClub } from '../api.js';
import { DISCIPLINE_OPTIONS, prefsLabel, prefsToCodes } from '../labels.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

interface FormState {
  club: string;
  lastName: string;
  firstName: string;
  sex: Sex;
  ageBandCode: string | null;
  discipline: DisciplineId;
  ruleset: Ruleset;
  weightClassId: string | null;
  prefs: string;
  acceptsJiyuFirst: boolean;
  approxWeightKg: number | '';
  onsite: boolean;
  grade: string;
}

function fromRow(row: RegistrationRow): FormState {
  return {
    club: row.club?.name ?? '',
    lastName: row.fighter.lastName,
    firstName: row.fighter.firstName,
    sex: row.fighter.sex,
    ageBandCode: row.fighter.ageBandCode,
    discipline: row.discipline,
    ruleset: row.ruleset ?? 'jiyu',
    weightClassId: row.weightClassId,
    prefs: prefsToCodes(row.otherDisciplines),
    acceptsJiyuFirst: row.acceptsJiyuFirst ?? false,
    approxWeightKg: row.approxWeightKg ?? '',
    onsite: row.source === 'onsite',
    grade: row.fighter.grade ?? '',
  };
}

const EMPTY: FormState = {
  club: '', lastName: '', firstName: '', sex: 'F', ageBandCode: null, discipline: 'karate', ruleset: 'jiyu',
  weightClassId: null, prefs: '', acceptsJiyuFirst: false, approxWeightKg: '', onsite: false, grade: '',
};

/** Saisie rapide : « Entrée » enregistre et garde club, âge, sexe et discipline pour la suivante. */
export function RegistrationForm({ competitionId, edit, onDone }: { competitionId: string; edit?: RegistrationRow; onDone?: () => void }) {
  const { data: grid } = useGrid(competitionId);
  const { data: clubs = [] } = useClubs(competitionId);
  const upsertClub = useUpsertClub(competitionId);
  const create = useCreateRegistration(competitionId);
  const update = useUpdateRegistration(competitionId);
  const [f, setF] = useState<FormState>(edit ? fromRow(edit) : EMPTY);
  // Révision à l'ouverture du formulaire : une modification faite entre-temps sur un autre poste n'est pas écrasée.
  const [openRev] = useState(edit?.rev);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  if (!grid) return null;
  const hasWeight = DISCIPLINES[f.discipline].hasWeight;
  const weightOptions = f.ageBandCode ? weightClassesFor(grid, f.ageBandCode, f.sex).map((w) => ({ value: w.id, label: w.label })) : [];
  const prefs = parsePreferences(f.prefs, f.discipline);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setWarning(null);
    setSaved(null);
    let clubId: string | null = null;
    if (f.club.trim()) {
      const existing = clubs.find((c) => normalizeName(c.name) === normalizeName(f.club));
      clubId = existing ? existing.id : (await upsertClub.mutateAsync({ name: f.club.trim() })).id;
    }
    const input: RegistrationInput = {
      clubId,
      lastName: f.lastName,
      firstName: f.firstName,
      sex: f.sex,
      ageBandCode: f.ageBandCode ?? '',
      discipline: f.discipline,
      ruleset: hasWeight ? f.ruleset : null,
      weightClassId: hasWeight ? f.weightClassId : null,
      approxWeightKg: f.approxWeightKg === '' ? null : f.approxWeightKg,
      otherDisciplines: prefs.value,
      acceptsJiyuFirst: hasWeight && f.ruleset === 'shobu' ? f.acceptsJiyuFirst : null,
      // Le grade ne concerne que le kata : ailleurs, celui du combattant est conservé.
      ...(f.discipline === 'kata' ? { grade: f.grade.trim() || null } : {}),
      source: edit ? (edit.source === 'onsite' || edit.source === 'manual' ? (f.onsite ? 'onsite' : 'manual') : edit.source) : f.onsite ? 'onsite' : 'manual',
    };
    if (edit) {
      try {
        await update.mutateAsync({ rid: edit.id, input, rev: openRev });
      } catch (e) {
        // Modifiée entre-temps sur un autre poste : le formulaire se ferme (la liste est rechargée, le message affiché).
        if (e instanceof ApiError && e.status === 409) onDone?.();
        throw e;
      }
      onDone?.();
      return;
    }
    const res = await create.mutateAsync(input);
    setWarning(res.warning);
    setSaved(`${res.row.fighter.lastName} ${res.row.fighter.firstName} enregistré(e).`);
    setF((s) => ({ ...s, lastName: '', firstName: '', prefs: '', approxWeightKg: '', acceptsJiyuFirst: false, grade: '' }));
    lastNameRef.current?.focus();
  };

  return (
    <form onSubmit={(e) => void submit(e).catch(() => undefined)}>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Autocomplete data-testid="reg-club" label="Club" data={clubs.map((c) => c.name)} value={f.club} onChange={(club) => set({ club })} />
          <TextInput data-testid="reg-lastname" ref={lastNameRef} label="Nom" required value={f.lastName}
            onChange={(e) => set({ lastName: e.currentTarget.value })} data-autofocus />
          <TextInput data-testid="reg-firstname" label="Prénom" value={f.firstName} onChange={(e) => set({ firstName: e.currentTarget.value })} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <div>
            <Text size="sm" fw={500} mb={4}>Sexe</Text>
            <SegmentedControl data-testid="reg-sex" fullWidth value={f.sex} onChange={(v) => set({ sex: v as Sex, weightClassId: null })}
              data={[{ value: 'F', label: 'Féminin' }, { value: 'M', label: 'Masculin' }]} />
          </div>
          <Select data-testid="reg-age" label="Catégorie d'âge" required searchable data={grid.ageBands.map((b) => ({ value: b.code, label: b.label }))}
            value={f.ageBandCode} onChange={(v) => set({ ageBandCode: v, weightClassId: null })} />
          <Select data-testid="reg-discipline" label="Discipline" data={DISCIPLINE_OPTIONS} value={f.discipline} allowDeselect={false}
            onChange={(v) => v && set({ discipline: v as DisciplineId })} />
        </SimpleGrid>
        {hasWeight && (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <div>
              <Text size="sm" fw={500} mb={4}>Règlement</Text>
              <SegmentedControl data-testid="reg-ruleset" fullWidth value={f.ruleset} onChange={(v) => set({ ruleset: v as Ruleset })}
                data={[{ value: 'jiyu', label: 'Jiyu' }, { value: 'shobu', label: 'Shobu' }]} />
            </div>
            <Select data-testid="reg-weight" label="Catégorie de poids" required searchable data={weightOptions} value={f.weightClassId}
              onChange={(v) => set({ weightClassId: v })} disabled={!f.ageBandCode} />
            <NumberInput label="Poids actuel approx." suffix=" kg" decimalScale={1} value={f.approxWeightKg}
              onChange={(v) => set({ approxWeightKg: v === '' ? '' : Number(v) })} />
          </SimpleGrid>
        )}
        {f.discipline === 'kata' && (
          <TextInput data-testid="reg-grade" label="Grade (si kata)" placeholder="ex. 1er dan" maxLength={30} value={f.grade}
            onChange={(e) => set({ grade: e.currentTarget.value })} />
        )}
        {DISCIPLINES[f.discipline].inPreferences && (
          <TextInput data-testid="reg-prefs" label="Autres disciplines par ordre de préférence (1 karaté, 2 shido-boxing, 3 shido-mix)"
            placeholder="ex. 32" value={f.prefs} onChange={(e) => set({ prefs: e.currentTarget.value })}
            description={prefs.value.length ? prefsLabel(prefs.value) : 'Vide : ne change pas de discipline'}
            error={prefs.errors.length ? prefs.errors.join(' ') : undefined} />
        )}
        <Group>
          {hasWeight && f.ruleset === 'shobu' && (
            <Checkbox data-testid="reg-jiyu-first" label="Si reclassement, garder en priorité la discipline (passer en jiyu plutôt que changer de discipline)"
              checked={f.acceptsJiyuFirst} onChange={(e) => set({ acceptsJiyuFirst: e.currentTarget.checked })} />
          )}
          {(!edit || edit.source === 'manual' || edit.source === 'onsite') && (
            <Checkbox data-testid="reg-onsite" label="Inscription sur place" checked={f.onsite} onChange={(e) => set({ onsite: e.currentTarget.checked })} />
          )}
        </Group>
        {warning && <Alert color="yellow" data-testid="registration-warning">{warning}</Alert>}
        {saved && <Text c="green" size="sm">{saved}</Text>}
        <ApiErrorAlert error={create.error ?? update.error ?? upsertClub.error} />
        <Group>
          <Button data-testid="reg-submit" type="submit" loading={create.isPending || update.isPending}>
            {edit ? 'Enregistrer' : 'Ajouter (Entrée)'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
