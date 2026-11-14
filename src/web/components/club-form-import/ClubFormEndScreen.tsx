import { Box, Button, Checkbox, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState } from 'react';
import type { ClubFormItem } from '../../../domain/club-form-read.js';
import { ApiError, RELOAD_STATUSES, type ClubEntryView, type ClubLine, type LineOps } from '../../api.js';
import { disciplineLabel } from '../../labels.js';
import { listFr } from '../club-line/ffkStep.js';
import { disciplinesOf, fighterName, wizardSummary, type WizardState } from '../ffk-import/wizard.js';
import { clubFormAbsentRows, clubFormSummaryText } from './steps.js';

/** Fin : récapitulatif, fiches du club absentes de la fiche renvoyée (cases décochées), « Terminer » supprime les cochées. */
export function ClubFormEndScreen({ state, lines, ops, ageBands, weightClasses, mobile, onClose, toggle }: {
  state: Extract<WizardState<ClubFormItem>, { stage: 'end' }>;
  lines: ClubLine[];
  ops: LineOps;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  mobile: boolean;
  onClose: (message?: string) => void;
  toggle: (fighterId: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  // Fenêtre fermée pendant « Terminer » : les suppressions suivantes ne sont pas faites.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // remonté (mode strict)
    return () => { mounted.current = false; };
  }, []);
  const sum = wizardSummary(state);
  const rows = clubFormAbsentRows(state.plan, lines);
  // « Benjamins · -35 kg · Karaté et Kata ».
  const describe = (l: ClubLine) => {
    const age = ageBands.find((b) => b.code === l.line.ageBandCode)?.label;
    const weight = weightClasses.find((w) => w.id === l.line.weightClassId)?.label;
    const disciplines = disciplinesOf(l.line);
    return [age, weight ? `${weight} kg` : null, disciplines.length ? listFr(disciplines.map(disciplineLabel)) : null].filter(Boolean).join(' · ');
  };

  const finish = async () => {
    setFinishing(true);
    let deleted = 0;
    const failed: string[] = [];
    // Page close, lien remplacé… : inutile d'essayer les suivantes, la page est rechargée.
    let stopped: string | null = null;
    for (const { line: l } of rows.filter((r) => r.checkable && state.remove.includes(r.line.fighterId))) {
      if (!mounted.current) return;
      try {
        await ops.remove({ fighterId: l.fighterId, version: l.version });
        deleted++;
      } catch (e) {
        if (e instanceof ApiError && RELOAD_STATUSES.has(e.status) && e.status !== 409) {
          stopped = e.message;
          break;
        }
        failed.push(`${fighterName(l)} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
    if (!mounted.current) return;
    setFinishing(false);
    if (stopped) {
      notifications.show({ color: 'orange', message: stopped });
      return onClose();
    }
    if (failed.length) notifications.show({ color: 'orange', message: `Fiche non supprimée : ${failed.join(', ')}.` });
    onClose(clubFormSummaryText(sum, deleted));
  };

  return (
    <Modal opened onClose={() => onClose()} fullScreen={mobile} title="Importer une fiche renvoyée">
      <Stack data-testid="club-form-end">
        <Title order={3} fz="md">Terminé</Title>
        <Text data-testid="club-form-summary">
          <b>{sum.added}</b> {sum.added <= 1 ? 'ajouté' : 'ajoutés'}{sum.notAdded > 0 && <> · <b>{sum.notAdded}</b> {sum.notAdded <= 1 ? 'non ajouté' : 'non ajoutés'}</>} · <b>{sum.updated}</b> mis à jour · <b>{sum.left}</b> {sum.left <= 1 ? 'laissé tel quel' : 'laissés tels quels'}
        </Text>
        {rows.length > 0 && (
          <Paper withBorder p="sm" radius="md" data-testid="club-form-absents">
            <Stack gap="sm">
              <div>
                <Text fw={700}>Inscrits chez nous, absents de la fiche</Text>
                <Text size="sm" c="dimmed" mt={2}>Cochez seulement ceux qui ne viendront pas : leur fiche est supprimée.</Text>
              </div>
              {rows.map(({ line: l, checkable }) => checkable ? (
                <Checkbox key={l.fighterId} data-testid="club-form-absent" label={fighterName(l)} description={describe(l)}
                  checked={state.remove.includes(l.fighterId)} onChange={() => toggle(l.fighterId)} />
              ) : (
                <Box key={l.fighterId} data-testid="club-form-absent-locked">
                  <Text size="sm">{fighterName(l)}</Text>
                  <Text size="xs" c="dimmed">Verrouillé{l.reason ? ` : ${l.reason}` : ''}</Text>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}
        <Group justify="flex-end">
          <Button data-testid="club-form-finish" loading={finishing || ops.pending} onClick={finish}>Terminer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
