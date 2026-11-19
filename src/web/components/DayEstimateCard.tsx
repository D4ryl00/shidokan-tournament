import { Alert, Anchor, Box, Button, Checkbox, Group, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link } from 'react-router';
import { plural } from '../../domain/plural.js';
import { secondsToClock, secondsToDuration } from '../../domain/schedule/clock.js';
import { isEmptyDurations, type ScheduleSettings } from '../../domain/schedule/durations.js';
import type { DayEstimateView } from '../../domain/schedule/estimate.js';
import type { CompetitionSettings } from '../../domain/settings.js';
import { useCategories, useCompetition, useDayEstimate, useUpdateCompetition } from '../api.js';
import { HELP } from '../help.js';
import { settingsPatch } from '../settingsPatch.js';
import { useUnsaved } from '../unsaved.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { HelpButton } from './Help.js';
import { useInvalidFields } from './MinSecInput.js';
import { ScheduleDurationsFields } from './ScheduleDurationsFields.js';
import { SectionCard } from './ui/SectionCard.js';
import { StatusBadge } from './ui/StatusBadge.js';

/** Case « Décaler… » gardée sur le poste (cochée par défaut) ; le stockage peut être absent ou refusé. */
const SHIFT_KEY = 'horaires-decaler';
function readShift(): boolean {
  try { return localStorage.getItem(SHIFT_KEY) !== '0'; } catch { return true; }
}
function writeShift(shift: boolean): void {
  try { localStorage.setItem(SHIFT_KEY, shift ? '1' : '0'); } catch { /* sans mémoire : le choix reste celui de l'écran */ }
}

/**
 * Horaires estimés de la journée (spec §7.7), dans l'onglet Sessions : la fin estimée, les durées de combat modifiables sur place
 * (les mêmes que dans Réglages, enregistrées pareil), puis, par session, chaque zone et les chevauchements.
 */
export function DayEstimateCard({ competitionId }: { competitionId: string }) {
  const [shift, setShift] = useState(readShift);
  const { data: estimate, error } = useDayEstimate(competitionId, shift);
  const at = (sec: number) => (estimate?.relative ? `+ ${secondsToDuration(sec)}` : secondsToClock(sec));
  return (
    <SectionCard data-testid="day-estimate" title={HELP['sessions.horaires'].title} help="sessions.horaires">
      <Stack gap="md">
        {estimate ? (
          <Stack gap={4}>
            <Text fw={700} size="lg" className="num" data-testid="day-estimate-end">Fin estimée de la journée : {at(estimate.end)}</Text>
            {estimate.relative && (
              <Text size="sm" c="dimmed" data-testid="day-estimate-relative">
                Saisissez le « Début prévu » de la première session (onglet Combats) pour avoir des heures. En attendant, les durées
                comptent depuis le début de la journée et les débuts prévus des sessions suivantes ne sont pas pris en compte.
              </Text>
            )}
          </Stack>
        ) : error ? <ApiErrorAlert error={error} /> : <Loader size="sm" />}
        <Checkbox data-testid="day-estimate-shift" checked={shift} label="Décaler une session qui commence avant la fin de la précédente"
          onChange={(e) => { const v = e.currentTarget.checked; setShift(v); writeShift(v); }} />
        <DurationsEditor competitionId={competitionId} />
        {estimate && <Stack gap="md">{estimate.waves.map((w) => <WaveEstimate key={w.key} wave={w} view={estimate} at={at} />)}</Stack>}
      </Stack>
    </SectionCard>
  );
}

function WaveEstimate({ wave: w, view, at }: { wave: DayEstimateView['waves'][number]; view: DayEstimateView; at: (sec: number) => string }) {
  const zoneName = (zid: string) => view.zones.find((z) => z.id === zid)?.name ?? '';
  // Décalée sur une zone, la session ne commence pas à son heure prévue : le début affiché est celui de sa première zone.
  const start = w.zones.length > 0 ? Math.min(...w.zones.map((z) => z.start)) : w.start;
  const longest = Math.max(0, ...w.zones.map((z) => z.end - z.start));
  return (
    <Stack gap={6} data-testid="day-estimate-wave" pt="sm" style={{ borderTop: '1px solid var(--sk-line)' }}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text fw={600} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{w.name}</Text>
        <Text size="sm" className="num" data-testid="day-estimate-wave-times">
          {at(start)} → {at(w.end)} · {secondsToDuration(w.end - start)}
        </Text>
      </Group>
      {w.overlap.map((o) => (
        <StatusBadge key={o.zoneId} tone="warn" wrap data-testid="day-estimate-overlap">
          Chevauche la session précédente de {secondsToDuration(o.minutes * 60)} ({zoneName(o.zoneId)})
        </StatusBadge>
      ))}
      {w.zones.length === 0 && <Text size="sm" c="dimmed">Aucun combat à estimer : pas encore de tableau dans cette session.</Text>}
      {w.zones.map((z) => (
        <Group key={z.zoneId} gap="xs" wrap="wrap" data-testid="day-estimate-zone">
          <Text size="sm" fw={500} w={110} style={{ overflowWrap: 'anywhere' }}>{zoneName(z.zoneId)}</Text>
          <Text size="sm" className="num">{at(z.start)} → {at(z.end)}</Text>
          <Text size="sm" c="dimmed" className="num">{plural(z.passages, 'passage')}</Text>
          {/* Zone la plus chargée de la session : barre pleine. */}
          <Box aria-hidden style={{ flex: '1 1 120px', minWidth: 80, height: 8, borderRadius: 4, background: 'var(--sk-line)' }}>
            <Box style={{ width: `${longest > 0 ? ((z.end - z.start) / longest) * 100 : 0}%`, height: '100%', borderRadius: 4, background: 'var(--sk-accent)' }} />
          </Box>
        </Group>
      ))}
      {w.finalsZoneId && (
        <Text size="sm" c="dimmed" data-testid="day-estimate-finals">
          Finales sur {zoneName(w.finalsZoneId)}{w.finalsStart !== null ? `, celles de fin de session vers ${at(w.finalsStart)}` : ''}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Durées des combats de la compétition, comme dans Réglages : formulaire parti des réglages chargés, enregistrement de ce qui a
 * changé seulement (`settingsPatch`), saisie en cours signalée (mise à jour automatique en attente, confirmation pour quitter).
 */
function DurationsEditor({ competitionId }: { competitionId: string }) {
  const { data: competition } = useCompetition(competitionId);
  const { data: categories = [] } = useCategories(competitionId);
  const update = useUpdateCompetition(competitionId);
  const durationFields = useInvalidFields();
  const [base, setBase] = useState<{ settings: CompetitionSettings; from: unknown } | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);
  const dirty = !!base && !!schedule && JSON.stringify(schedule) !== JSON.stringify(base.settings.schedule);
  const load = (c: NonNullable<typeof competition>) => {
    setBase({ settings: c.settings, from: c });
    setSchedule(c.settings.schedule);
  };
  // Réglages rechargés (autre poste, Réglages) : repris tant qu'aucune durée n'est en cours de saisie ici.
  if (competition && competition !== base?.from && !dirty) load(competition);
  useUnsaved('horaires-durees', dirty);
  if (!base || !schedule) return null;

  const own = categories.filter((c) => c.registrationIds.length > 0 && c.durations && !isEmptyDurations(c.durations));
  const save = () => {
    if (durationFields.invalid) return;
    update.mutate({ settings: settingsPatch(base.settings, { ...base.settings, schedule }) }, {
      onSuccess: (c) => {
        load(c);
        notifications.show({ color: 'green', message: 'Durées enregistrées' });
      },
    });
  };
  return (
    <Stack gap="sm" p="md" data-testid="day-estimate-durations" style={{ border: '1px solid var(--sk-line)', borderRadius: 'var(--mantine-radius-md)' }}>
      <Group gap={4} wrap="nowrap">
        <Text fw={600}>{HELP['reglages.durees'].title}</Text>
        <HelpButton topic="reglages.durees" />
      </Group>
      <ScheduleDurationsFields schedule={schedule} triathlonRounds={base.settings.triathlonRounds} field={durationFields.field} onChange={setSchedule} />
      {own.length > 0 && (
        <Alert color="blue" p="xs" data-testid="day-estimate-own">
          <Text size="sm">
            {own.length === 1 ? '1 catégorie a sa propre durée' : `${own.length} catégories ont leur propre durée`} (onglet Tableaux) :{' '}
            {own.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Anchor component={Link} to={`/competitions/${competitionId}/tableaux?vue=liste&categorie=${c.id}`} size="sm">{c.label}</Anchor>
              </span>
            ))}
            .
          </Text>
        </Alert>
      )}
      <ApiErrorAlert error={update.error} />
      <Group justify="space-between" gap="xs" wrap="wrap">
        {durationFields.invalid ? <Text size="sm" c="red" data-testid="day-estimate-invalid">Une durée est mal saisie : corrigez-la pour enregistrer.</Text>
          : dirty ? <StatusBadge tone="warn" data-testid="day-estimate-unsaved">Durées non enregistrées</StatusBadge>
            : <Text size="sm" c="dimmed">L’estimation suit les durées enregistrées.</Text>}
        <Button data-testid="day-estimate-save" onClick={save} loading={update.isPending} disabled={durationFields.invalid || !dirty}>
          Enregistrer les durées
        </Button>
      </Group>
    </Stack>
  );
}
