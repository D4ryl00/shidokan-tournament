import { Alert, Button, Checkbox, Group, List, Modal, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLaunch, useLaunchStatus, useNumberPending, useNumberPreview, useReopen, useReplacement, useSetWaveSchedule, useWaveSchedules, useZones, type RenumberMode, type WaveState } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { StatusBadge, type Tone } from './ui/StatusBadge.js';
import { HelpButton } from './Help.js';
import { plural } from '../../domain/plural.js';

const STATES: Record<WaveState, { label: string; tone: Tone }> = {
  preparation: { label: 'En préparation', tone: 'warn' },
  launched: { label: 'Lancée', tone: 'ok' },
  reopened: { label: 'Rouverte', tone: 'warn' },
  finished: { label: 'Terminée', tone: 'accent' },
};

/** Heure de Paris, « HH:MM ». */
const nowInParis = () =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** Champ d'heure « HH:MM » : s'enregistre à la sortie du champ si l'heure est valide et a changé (vide : efface). */
function ClockField({ label, description, value, onSave, testId, extra }: {
  label: string; description?: string; value: string | null; onSave: (v: string | null) => void; testId: string; extra?: React.ReactNode;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const valid = text === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  const commit = (t: string) => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t !== value : t === '' && value !== null) onSave(t === '' ? null : t); };
  return (
    <Group align="flex-end" gap="xs" wrap="nowrap">
      {/* Champ de 120 px ; l'aide et l'erreur passent dessous, sur toute la largeur utile (une ou deux lignes, pas une colonne étroite). */}
      <TimeInput size="sm" maw={260} styles={{ wrapper: { width: 120 } }} inputWrapperOrder={['label', 'input', 'description', 'error']}
        label={label} description={description} value={text} data-testid={testId}
        error={valid ? null : 'Heure attendue : 14:30'}
        onChange={(e) => setText(e.currentTarget.value)} onBlur={() => commit(text)} />
      {extra && <Button size="sm" variant="default" onClick={() => { const t = nowInParis(); setText(t); commit(t); }}>{extra}</Button>}
    </Group>
  );
}

/**
 * Lancement d'une vague (null : vague implicite d'une compétition sans vague) : « Figer et imprimer la vague »,
 * « Rouvrir la vague », catégories à numéroter et « Numéroter à la suite » / « Refiger la vague ».
 */
export function WaveLaunchPanel({ competitionId, waveId }: { competitionId: string; waveId: string | null }) {
  const [dialog, setDialog] = useState<'launch' | 'reopen' | 'number' | null>(null);
  const [restart, setRestart] = useState(false);
  const [mode, setMode] = useState<RenumberMode>('append');
  const { data: status } = useLaunchStatus(competitionId, waveId);
  const { data: preview } = useLaunchStatus(competitionId, waveId, restart, dialog === 'launch');
  const { data: zones = [] } = useZones(competitionId);
  const { data: replacement } = useReplacement(competitionId, waveId, dialog === 'launch');
  const asideCount = replacement?.summary.setAside ?? 0;
  const launch = useLaunch(competitionId);
  const reopen = useReopen(competitionId);
  const number = useNumberPending(competitionId);
  const numberPreview = useNumberPreview(competitionId);
  const schedules = useWaveSchedules(competitionId);
  const setSchedule = useSetWaveSchedule(competitionId);
  const times = schedules.data?.find((w) => w.waveId === waveId) ?? { waveId, plannedStart: null, actualStart: null, finalsStart: null };
  const saveTime = (field: 'plannedStart' | 'actualStart' | 'finalsStart', v: string | null) =>
    setSchedule.mutate({ waveId, [field]: v }, { onSuccess: () => notifications.show({ color: 'green', message: 'Horaire enregistré' }) });
  const printUrl = `/competitions/${competitionId}/impression?session=${encodeURIComponent(waveId ?? '')}`;
  if (!status) return null;
  const zoneName = (zid: string) => zones.find((z) => z.id === zid)?.name ?? '?';
  const previewNumbers = (m: RenumberMode) => {
    setMode(m);
    numberPreview.reset();
    numberPreview.mutate({ waveId, mode: m });
  };
  const openNumber = () => {
    previewNumbers('append');
    setDialog('number');
  };
  const close = () => {
    setDialog(null);
    for (const m of [launch, reopen, number, numberPreview]) m.reset();
  };
  // Numéroter exactement ce que l'aperçu a montré.
  const shown = numberPreview.data && !numberPreview.isPending ? numberPreview.data : null;

  return (
    <Stack gap="xs" data-testid="wave-launch">
      <Group gap="xs">
        <StatusBadge tone={STATES[status.state].tone} size="lg" data-testid="wave-state">{STATES[status.state].label}</StatusBadge>
        {status.state === 'preparation' && <Button size="xs" data-testid="launch-open" onClick={() => { setRestart(false); setDialog('launch'); }}>Figer et imprimer la session…</Button>}
        {(status.state === 'launched' || status.state === 'finished') && (
          <>
            <Button size="xs" variant="default" component={Link} to={printUrl} target="_blank" data-testid="wave-print">Imprimer la session</Button>
            <Button size="xs" variant="subtle" color="orange" data-testid="reopen-open" onClick={() => setDialog('reopen')}>Rouvrir la session</Button>
          </>
        )}
        {status.state === 'reopened' && <Button size="xs" data-testid="refreeze-open" onClick={openNumber}>Refiger la session…</Button>}
      </Group>
      <Group align="flex-start" gap="md" data-testid="wave-times">
        <Group gap={4} wrap="nowrap" align="center"><Text fw={600} size="sm">Horaires</Text><HelpButton topic="combats.horaires" /></Group>
        <ClockField label="Début prévu" value={times.plannedStart} testId="wave-planned" onSave={(v) => saveTime('plannedStart', v)} />
        {status.state !== 'preparation' && (
          <>
            <ClockField label="Démarrée à" value={times.actualStart} testId="wave-actual" extra="Maintenant" onSave={(v) => saveTime('actualStart', v)} />
            <ClockField label="Finales à" description="vide : à la fin des combats éliminatoires" value={times.finalsStart} testId="wave-finals" onSave={(v) => saveTime('finalsStart', v)} />
          </>
        )}
      </Group>
      <ApiErrorAlert error={setSchedule.error} />
      {status.pending.length > 0 && status.state !== 'reopened' && (
        <Alert color="orange" data-testid="pending-alert" title={`${plural(status.pending.length, 'catégorie')} à numéroter`}>
          <Text size="sm" mb={6}>{status.pending.map((p) => p.label).join(', ')} : sans numéro de passage (catégorie nouvelle ou régénérée).</Text>
          <Button size="xs" data-testid="number-open" onClick={openNumber}>Numéroter à la suite…</Button>
        </Alert>
      )}

      <Modal opened={dialog === 'launch'} onClose={close} title="Figer et imprimer la session" size="lg">
        <Stack>
          {launch.isSuccess ? (
            <>
              <Alert color="green">Session figée : ses numéros de passage ne changeront plus.</Alert>
              <Button component={Link} to={printUrl} target="_blank" data-testid="launch-print">Imprimer la session</Button>
            </>
          ) : (
            <>
              <Text size="sm">Les zones et les numéros de passage de la session sont enregistrés : ils ne changent plus (sauf réouverture). Imprimez ensuite les tableaux.</Text>
              {preview && preview.blocking.length > 0 && (
                <Alert color="red" title="Impossible de figer" data-testid="launch-blocking">
                  <List size="sm">{preview.blocking.map((b) => <List.Item key={b}>{b}</List.Item>)}</List>
                </Alert>
              )}
              {asideCount > 0 && (
                <Alert color="orange" data-testid="launch-set-aside">{plural(asideCount, 'carte mise de côté', 'cartes mises de côté')} en Réaffectation pour cette session.</Alert>
              )}
              <Checkbox label="Reprendre les numéros à 1 (nouveau jour)" checked={restart} onChange={(e) => setRestart(e.currentTarget.checked)} data-testid="launch-restart" />
              {preview && (
                <Table data-testid="launch-zones">
                  <Table.Tbody>
                    {preview.zones.filter((z) => z.first !== null).map((z) => (
                      <Table.Tr key={z.zoneId}><Table.Td>{zoneName(z.zoneId)}</Table.Td><Table.Td>n° {z.first} à {z.last}</Table.Td></Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <ApiErrorAlert error={launch.error} />
              <Group justify="flex-end">
                <Button variant="default" onClick={close}>Annuler</Button>
                <Button data-testid="launch-confirm" loading={launch.isPending} disabled={!preview || preview.blocking.length > 0}
                  onClick={() => launch.mutate({ waveId, restart })}>Figer</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      <Modal opened={dialog === 'reopen'} onClose={close} title="Rouvrir la session ?">
        <Stack>
          <Text size="sm">Les catégories sans résultat redeviennent modifiables : des tableaux déjà affichés pourront changer. Les catégories commencées restent verrouillées.</Text>
          <ApiErrorAlert error={reopen.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button color="orange" data-testid="reopen-confirm" loading={reopen.isPending} onClick={() => reopen.mutate({ waveId }, { onSuccess: close })}>Rouvrir la session</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={dialog === 'number'} onClose={close} title={status.state === 'reopened' ? 'Refiger la session' : 'Numéroter les catégories modifiées'} size="lg">
        <Stack>
          <SegmentedControl data-testid="number-mode" value={mode} onChange={(v) => previewNumbers(v as RenumberMode)}
            data={[{ value: 'append', label: 'À la suite' }, { value: 'shuffle', label: 'Mélangés' }]} />
          <Text size="sm">
            {mode === 'append'
              ? 'À la suite : seules les catégories modifiées reçoivent de nouveaux numéros, après le dernier numéro de leur zone ; leurs tableaux sont à réimprimer (« mis à jour à … »).'
              : 'Mélangés : les zones qui reçoivent une catégorie modifiée sont entièrement renumérotées (combats non joués), avec la règle de repos ; réimprimez tous leurs tableaux.'}
          </Text>
          <div data-testid="number-preview">
            {shown && shown.changes.length === 0 && <Text size="sm">Aucun numéro ne change.</Text>}
            {shown?.changes.map((c) => <Text size="sm" key={c.categoryId}>{c.label} : n° {c.numbers.join(', ')}</Text>)}
          </div>
          {shown && shown.blocking.length > 0 && (
            <Alert color="red" title="Impossible de numéroter" data-testid="number-blocking">
              <List size="sm">{shown.blocking.map((b) => <List.Item key={b}>{b}</List.Item>)}</List>
            </Alert>
          )}
          <ApiErrorAlert error={numberPreview.error ?? number.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button data-testid="number-confirm" loading={number.isPending} disabled={!shown || shown.blocking.length > 0}
              onClick={() => shown && number.mutate({ waveId, mode, categoryIds: shown.changes.map((c) => c.categoryId) }, { onSuccess: close })}>
              {status.state === 'reopened' ? 'Refiger la session' : mode === 'append' ? 'Numéroter à la suite' : 'Numéroter (mélangés)'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
