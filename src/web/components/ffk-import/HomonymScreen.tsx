import { Button, Group, Modal, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { ClubEntryView, ClubLine } from '../../api.js';
import { disciplineLabel } from '../../labels.js';
import { FfkProgress } from '../club-line/FfkProgress.js';
import { listFr } from '../club-line/ffkStep.js';
import { disciplinesOf, fighterName } from './wizard.js';

/** Plusieurs fiches du club portent le nom importé : l'organisateur ou le coach choisit la bonne, ou dit que c'est un autre combattant. */
export function HomonymScreen({ intro, candidates, ageBands, progress, mobile, onResolve, onPrevious, onClose }: {
  /** « La FFK inscrit « … » (masculin, 12 ans). » */
  intro: string;
  candidates: ClubLine[];
  ageBands: ClubEntryView['ageBands'];
  progress: { index: number; total: number };
  mobile: boolean;
  /** La fiche choisie, ou `null` : « C’est un autre combattant ». */
  onResolve: (fighterId: string | null) => void;
  onPrevious: (() => void) | null;
  onClose: () => void;
}) {
  const ageOf = (code: string | null) => ageBands.find((b) => b.code === code)?.label ?? code ?? '—';
  return (
    <Modal opened onClose={onClose} fullScreen={mobile} title="Plusieurs fiches portent ce nom : laquelle ?">
      <Stack data-testid="ffk-homonym">
        <FfkProgress {...progress} />
        <Text size="sm">{intro}</Text>
        {candidates.map((l) => (
          <UnstyledButton key={l.fighterId} data-testid="ffk-homonym-choice" onClick={() => onResolve(l.fighterId)}>
            <Paper withBorder p="sm" radius="md">
              <Text fw={700}>{fighterName(l)}</Text>
              <Text size="sm" c="dimmed">{ageOf(l.line.ageBandCode)} · {listFr(disciplinesOf(l.line).map(disciplineLabel))}</Text>
            </Paper>
          </UnstyledButton>
        ))}
        <Group justify="space-between">
          <Button variant="subtle" data-testid="ffk-homonym-new" onClick={() => onResolve(null)}>C’est un autre combattant</Button>
          {onPrevious && <Button variant="default" onClick={onPrevious}>← Précédent</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
