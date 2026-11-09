import { ActionIcon, Button, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { Category } from '../../domain/categories.js';
import { ageGroupOf, combatTiming, timingText, type CategoryDurations as Durations, type CombatTiming } from '../../domain/schedule/durations.js';
import { useCompetition, useGrid, usePassages, useUpdateCategory } from '../api.js';
import { categoryPassages } from '../passages.js';
import { roundTitle } from './BracketView.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { MinSecInput, useInvalidFields } from './MinSecInput.js';
import { IconTrash } from './ui/icons.js';
import { SectionCard } from './ui/SectionCard.js';

/** Rounds, round et repos d'une durée de combat (la prolongation reste celle de la compétition). */
function TimingFields({ value, onChange, onValidity, testId }: {
  value: CombatTiming; onChange: (t: CombatTiming) => void; onValidity: (key: string) => (valid: boolean) => void; testId: string;
}) {
  return (
    <Group align="flex-start" gap="sm" data-testid={testId}>
      <NumberInput label="Rounds" size="sm" w={90} min={1} max={12} allowDecimal={false} value={value.rounds}
        error={value.rounds < 1 || value.rounds > 12 ? 'De 1 à 12' : null}
        onChange={(v) => onChange({ ...value, rounds: typeof v === 'number' ? v : 0 })} />
      <MinSecInput label="Round" min={10} max={900} value={value.roundSec} onChange={(roundSec) => onChange({ ...value, roundSec })} onValidityChange={onValidity('round')} />
      <MinSecInput label="Repos" min={0} max={600} value={value.restSec} onChange={(restSec) => onChange({ ...value, restSec })} onValidityChange={onValidity('rest')} />
    </Group>
  );
}

const validTiming = (t: CombatTiming) => Number.isInteger(t.rounds) && t.rounds >= 1 && t.rounds <= 12;

/**
 * Durée des combats d'un tableau : celle de la compétition, ou la sienne, avec des exceptions combat par combat
 * (précédence : combat, tableau, compétition). Permis même tableau lancé ou commencé. Pas de bloc pour un kata.
 */
export function CategoryDurations({ competitionId, category, readOnly }: { competitionId: string; category: Category; readOnly: boolean }) {
  const { data: competition } = useCompetition(competitionId);
  const { data: grid } = useGrid(competitionId);
  const { data: plan } = usePassages(competitionId);
  const update = useUpdateCategory(competitionId);
  const [draft, setDraft] = useState<CombatTiming | null>(null);
  const [exception, setException] = useState<{ matchId: string | null; timing: CombatTiming | null }>({ matchId: null, timing: null });
  // Durée en erreur dans l'un des deux formulaires : son bouton attend qu'elle soit corrigée.
  const ownFields = useInvalidFields();
  const exceptionFields = useInvalidFields();
  const bracket = category.bracket?.kind === 'combat' ? category.bracket : null;
  if (category.key.discipline === 'kata' || !competition || !grid) return null;

  const base = { schedule: competition.settings.schedule, triathlonRounds: competition.settings.triathlonRounds };
  const group = ageGroupOf(category.key, grid);
  const durations = category.durations;
  const inherited = combatTiming(base, group, null, null);
  const own = durations?.bracket ?? null;
  const editing = draft ?? own;
  const mode = editing ? 'own' : 'inherit';
  const save = (d: Durations, after?: () => void) =>
    update.mutate({ cid: category.id, durations: d.bracket === null && Object.keys(d.matches).length === 0 ? null : d }, { onSuccess: after });
  const matches = durations?.matches ?? {};

  const numbers = categoryPassages(plan, category.id).numbers;
  const label = (id: string) => {
    const m = bracket?.matches.find((x) => x.id === id);
    if (!m) return `Combat ${id}`;
    const rounds = Math.max(0, ...(bracket?.matches ?? []).filter((x) => x.phase === 'main').map((x) => x.round));
    const n = numbers?.get(id);
    return `${n !== undefined ? `n° ${n} · ` : ''}${roundTitle(m.phase, m.round, rounds)}${n === undefined ? ` (${id})` : ''}`;
  };
  const available = (bracket?.matches ?? []).filter((m) => !(m.id in matches));
  const pick = exception.matchId ? combatTiming(base, group, durations, exception.matchId) : null;
  const newTiming = exception.timing ?? pick;

  return (
    <SectionCard title="Durée des combats" help="tableaux.durees" data-testid="category-durations">
      <Stack gap="sm">
        <Select size="sm" w={320} maw="100%" label="Durée des combats" disabled={readOnly || update.isPending} allowDeselect={false} data-testid="durations-mode"
          data={[{ value: 'inherit', label: `Comme la compétition (${timingText(inherited)})` }, { value: 'own', label: 'Autre' }]}
          value={mode}
          onChange={(v) => {
            if (v === 'inherit') { setDraft(null); if (own) save({ bracket: null, matches }); }
            else setDraft(own ?? inherited);
          }} />
        {mode === 'own' && editing && (
          readOnly ? <Text size="sm" data-testid="durations-own">{timingText(editing)}, repos {editing.restSec} s</Text> : (
            <Group align="flex-end" gap="sm">
              <TimingFields testId="durations-own" value={editing} onChange={setDraft} onValidity={ownFields.field} />
              <Button size="sm" data-testid="durations-save" loading={update.isPending} disabled={!validTiming(editing) || ownFields.invalid}
                onClick={() => save({ bracket: { ...inherited, ...editing }, matches }, () => setDraft(null))}>Enregistrer</Button>
            </Group>
          )
        )}
        {bracket && (
          <Stack gap="xs">
            <Text fw={600} size="sm">Exceptions</Text>
            {Object.keys(matches).length === 0 && <Text size="sm" c="dimmed">Aucune : tous les combats suivent la durée ci-dessus.</Text>}
            {Object.entries(matches).map(([id, t]) => (
              <Group key={id} gap="xs" wrap="nowrap" data-testid="durations-exception">
                <Text size="sm" style={{ flex: 1 }}>{label(id)} : {timingText(t)}</Text>
                {!readOnly && (
                  <ActionIcon variant="subtle" color="red" aria-label={`Retirer l’exception : ${label(id)}`}
                    onClick={() => { const { [id]: _gone, ...rest } = matches; save({ bracket: durations?.bracket ?? null, matches: rest }); }}>
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            ))}
            {!readOnly && available.length > 0 && (
              <Stack gap="xs">
                <Select size="sm" w={320} maw="100%" label="Ajouter une exception" placeholder="Choisir un combat" searchable data-testid="exception-match"
                  data={available.map((m) => ({ value: m.id, label: label(m.id) }))}
                  value={exception.matchId} onChange={(v) => setException({ matchId: v, timing: null })} />
                {exception.matchId && newTiming && (
                  <Group align="flex-end" gap="sm">
                    <TimingFields key={exception.matchId} testId="exception-timing" value={newTiming} onValidity={exceptionFields.field}
                      onChange={(t) => setException({ matchId: exception.matchId, timing: t })} />
                    <Button size="sm" data-testid="exception-add" loading={update.isPending} disabled={!validTiming(newTiming) || exceptionFields.invalid}
                      onClick={() => save({ bracket: durations?.bracket ?? null, matches: { ...matches, [exception.matchId!]: { ...pick!, ...newTiming } } },
                        () => setException({ matchId: null, timing: null }))}>
                      Ajouter
                    </Button>
                  </Group>
                )}
              </Stack>
            )}
          </Stack>
        )}
        <ApiErrorAlert error={update.error} />
      </Stack>
    </SectionCard>
  );
}
