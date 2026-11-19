import { NumberInput, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { AGE_GROUPS, type AgeGroup, type CombatTiming, type ScheduleSettings } from '../../domain/schedule/durations.js';
import { MinSecInput } from './MinSecInput.js';

const GROUP_LABELS: Record<AgeGroup, string> = { under14: 'Moins de 14 ans', youth: '14 à 17 ans', adults: '18 ans et plus', triathlon: 'Triathlon' };

/**
 * Durées des combats de la compétition (Réglages et Sessions) : par groupe d'âge (et sa finale), le changement et le passage de
 * kata. `field(clé)` (voir `useInvalidFields`) prévient l'écran d'une durée mal saisie, qui bloque alors l'enregistrement.
 */
export function ScheduleDurationsFields({ schedule, triathlonRounds, onChange, field }: {
  schedule: ScheduleSettings;
  /** Rounds du triathlon, réglés dans « Rounds de triathlon ». */
  triathlonRounds: number;
  onChange: (schedule: ScheduleSettings) => void;
  field: (key: string) => (valid: boolean) => void;
}) {
  return (
    <Stack gap="md">
      {AGE_GROUPS.map((g) => {
        const t = schedule.groups[g];
        const setT = (patch: Partial<CombatTiming>) => onChange({ ...schedule, groups: { ...schedule.groups, [g]: { ...t, ...patch } } });
        const f = schedule.finals[g];
        const setF = (next: CombatTiming | null) => onChange({ ...schedule, finals: { ...schedule.finals, [g]: next } });
        return (
          <Stack key={g} gap={4} data-testid={`durations-${g}`}>
            <Text fw={600} size="sm">{GROUP_LABELS[g]}</Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              {g === 'triathlon'
                ? <Stack gap={2}><Text size="sm" fw={500}>Rounds</Text><Text size="sm">{triathlonRounds}</Text><Text size="xs" c="dimmed">réglé dans Rounds de triathlon</Text></Stack>
                : <NumberInput label="Rounds" size="sm" min={1} max={12} allowDecimal={false} clampBehavior="none" value={t.rounds}
                    onChange={(v) => setT({ rounds: typeof v === 'number' ? v : 0 })} />}
              <MinSecInput label="Round" min={10} max={900} value={t.roundSec} onChange={(roundSec) => setT({ roundSec })} onValidityChange={field(`${g}.round`)} />
              <MinSecInput label="Repos" min={0} max={600} value={t.restSec} onChange={(restSec) => setT({ restSec })} onValidityChange={field(`${g}.rest`)} />
              <MinSecInput label="Prolongation" min={0} max={900} value={t.overtimeSec} onChange={(overtimeSec) => setT({ overtimeSec })} onValidityChange={field(`${g}.overtime`)} />
            </SimpleGrid>
            <Select label="Finale" size="sm" data-testid={`durations-finals-${g}`} allowDeselect={false}
              data={[{ value: 'same', label: 'Comme les autres combats' }, { value: 'other', label: 'Autre' }]}
              value={f ? 'other' : 'same'}
              onChange={(v) => v && setF(v === 'other' ? { ...t, rounds: g === 'triathlon' ? triathlonRounds : t.rounds } : null)} />
            {f && (
              <SimpleGrid cols={{ base: 2, sm: 4 }} data-testid={`durations-finals-fields-${g}`}>
                <NumberInput label="Rounds" size="sm" min={1} max={12} allowDecimal={false} clampBehavior="none" value={f.rounds}
                  onChange={(v) => setF({ ...f, rounds: typeof v === 'number' ? v : 0 })} />
                <MinSecInput label="Round" min={10} max={900} value={f.roundSec} onChange={(roundSec) => setF({ ...f, roundSec })} onValidityChange={field(`${g}.finals.round`)} />
                <MinSecInput label="Repos" min={0} max={600} value={f.restSec} onChange={(restSec) => setF({ ...f, restSec })} onValidityChange={field(`${g}.finals.rest`)} />
                <MinSecInput label="Prolongation" min={0} max={900} value={f.overtimeSec} onChange={(overtimeSec) => setF({ ...f, overtimeSec })} onValidityChange={field(`${g}.finals.overtime`)} />
              </SimpleGrid>
            )}
          </Stack>
        );
      })}
      <Text size="xs" c="dimmed">La prolongation n’est pas comptée dans les heures.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <MinSecInput label="Changement entre deux combats" min={0} max={900} value={schedule.changeoverSec} onValidityChange={field('changeover')}
          onChange={(changeoverSec) => onChange({ ...schedule, changeoverSec })} />
        <MinSecInput label="Kata : durée d’un passage" min={10} max={900} value={schedule.kataPassageSec} onValidityChange={field('kata')}
          onChange={(kataPassageSec) => onChange({ ...schedule, kataPassageSec })} />
      </SimpleGrid>
    </Stack>
  );
}
