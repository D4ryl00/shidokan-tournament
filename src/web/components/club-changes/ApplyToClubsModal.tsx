import { Badge, Button, Checkbox, Group, Modal, Radio, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { sameEmail } from '../../../domain/emails.js';
import { useApplyDirectoryToClubs, type ApplyResult, type UpcomingLine } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { frDate, LABEL, shownValue } from './ClubChangeModal.js';

const WRAP = { overflowWrap: 'anywhere' } as const;
const keyOf = (l: UpcomingLine) => `${l.clubId}:${l.field}`;

/** Ce que la ligne change : les adresses en ajouts et retraits, les autres champs de la valeur du club à celle de l'annuaire. */
function summary(l: UpcomingLine): string {
  if (l.field === 'coachEmails') {
    const club = Array.isArray(l.clubValue) ? l.clubValue : [];
    const directory = Array.isArray(l.directoryValue) ? l.directoryValue : [];
    const parts = [
      ...club.filter((e) => !directory.some((d) => sameEmail(d, e))).map((e) => `retire ${e}`),
      ...directory.filter((e) => !club.some((c) => sameEmail(c, e))).map((e) => `ajoute ${e}`),
    ];
    return parts.join(', ') || shownValue(directory);
  }
  return `${shownValue(l.clubValue)} → ${shownValue(l.directoryValue)}`;
}

/** Phrase d'introduction par défaut : après « Modifier » dans l'annuaire. */
const SAVED_INTRO = 'La fiche est enregistrée. Ces clubs de compétitions à venir diffèrent de la nouvelle fiche.';

/**
 * Après l'enregistrement d'une fiche d'annuaire (« Modifier », synchronisation Google), ou à la demande depuis la fiche : les clubs des compétitions
 * à venir qui diffèrent de la fiche. Une ligne sans conflit est cochée ; une ligne en conflit garde la valeur du club sauf choix contraire. Une
 * compétition gérée ailleurs est montrée sans choix. La fiche est déjà enregistrée : fermer n'annule rien.
 */
export function ApplyToClubsModal({ entryId, lines, onClose, intro = SAVED_INTRO }: { entryId: string; lines: UpcomingLine[]; onClose: () => void; intro?: string }) {
  const apply = useApplyDirectoryToClubs();
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const editable = lines.filter((l) => l.managedHere);
  const chosen = editable.filter((l) => (l.kind === 'apply' ? !unticked.has(keyOf(l)) : taken.has(keyOf(l))));
  const toggle = (set: Set<string>, key: string, on: boolean) => { const n = new Set(set); if (on) n.add(key); else n.delete(key); return n; };

  const competitions = [...new Map(lines.map((l) => [l.competitionId, l])).values()];
  const send = () => {
    const items = [...new Set(chosen.map((l) => l.clubId))].map((clubId) => ({
      clubId,
      fields: chosen.filter((l) => l.clubId === clubId).map(({ field, clubValue, directoryValue }) => ({ field, clubValue, directoryValue })),
    }));
    apply.mutate({ entryId, items }, { onSuccess: setResults });
  };

  return (
    <Modal opened onClose={onClose} size="lg" title={<Text fw={700}>Appliquer aux compétitions à venir ?</Text>}>
      {results ? (
        <Stack>
          {results.map((r) => (
            <Text key={r.clubId} size="sm" data-testid="apply-result" c={r.status === 'refused' ? 'red' : undefined} style={WRAP}>
              {r.competitionName} : {r.status === 'applied' ? 'appliqué.' : `refusé. ${r.message ?? ''}`}
            </Text>
          ))}
          <Group justify="flex-end"><Button onClick={onClose}>Fermer</Button></Group>
        </Stack>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed" style={WRAP}>{intro}</Text>
          {competitions.map((c) => (
            <Stack key={c.competitionId} gap={6} data-testid={`apply-competition-${c.competitionId}`}>
              <Text fw={600} style={WRAP}>{c.competitionName}, le {frDate(c.competitionDate)}</Text>
              {lines.filter((l) => l.competitionId === c.competitionId).map((l) => {
                const key = keyOf(l);
                const testId = `apply-line-${l.competitionId}-${l.field}`;
                if (!l.managedHere) {
                  return (
                    <Stack key={key} gap={0} data-testid={testId}>
                      <Text size="sm" style={WRAP}>{LABEL[l.field]} : {summary(l)}</Text>
                      <Text size="xs" c="dimmed">Gérée par {l.ownerName ?? 'une autre installation'} : à appliquer après le retour de la main.</Text>
                    </Stack>
                  );
                }
                if (l.kind === 'apply') {
                  return (
                    <div key={key} data-testid={testId}>
                      <Checkbox size="sm" label={`${LABEL[l.field]} : ${summary(l)}`} checked={!unticked.has(key)} styles={{ label: WRAP }}
                        onChange={(e) => setUnticked((s) => toggle(s, key, !e.currentTarget.checked))} />
                    </div>
                  );
                }
                return (
                  <Stack key={key} gap={4} data-testid={testId}>
                    <Group gap="xs" wrap="nowrap" align="flex-start">
                      <Badge color="yellow" variant="light" style={{ flexShrink: 0 }}>Conflit</Badge>
                      <Text size="sm" style={WRAP}>{LABEL[l.field]} : {summary(l)}</Text>
                    </Group>
                    <Radio.Group value={taken.has(key) ? 'directory' : 'club'} aria-label={`${LABEL[l.field]} dans ${l.competitionName}`}
                      onChange={(v) => setTaken((s) => toggle(s, key, v === 'directory'))}>
                      <Group gap="md">
                        <Radio value="club" label="Garder le club" />
                        <Radio value="directory" label="Prendre l’annuaire" />
                      </Group>
                    </Radio.Group>
                  </Stack>
                );
              })}
            </Stack>
          ))}
          <ApiErrorAlert error={apply.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={apply.isPending}>Ne rien appliquer</Button>
            <Button onClick={send} loading={apply.isPending} disabled={chosen.length === 0}>Appliquer</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
