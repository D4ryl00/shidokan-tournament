import { Alert, Button, Group, Modal, Paper, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { CombatBracket, MatchMethod, ResolvedMatch } from '../../domain/brackets/index.js';
import { affectedBy, type ResultRecord } from '../../domain/results.js';
import type { Ruleset } from '../../domain/types.js';
import { useDeleteResult, usePutResult } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { HelpButton, HelpText } from './Help.js';
import type { EntrantInfo } from './BracketView.js';

const METHODS: { value: MatchMethod; label: string }[] = [
  { value: 'points', label: 'Points' },
  { value: 'decision', label: 'Décision des arbitres' },
  { value: 'ko', label: 'KO' },
  { value: 'abandon', label: 'Abandon' },
  { value: 'disqualification', label: 'Disqualification' },
  { value: 'forfeit', label: 'Forfait (absent)' },
];

interface Props {
  competitionId: string;
  categoryId: string;
  bracket: CombatBracket;
  ruleset: Ruleset | null;
  match: ResolvedMatch | null;
  number?: number | string;
  records: ResultRecord[];
  tieBreaks: Record<number, string[]>;
  entrants: Map<string, EntrantInfo>;
  onClose: () => void;
}

export function ResultDialog({ competitionId, categoryId, bracket, ruleset, match, number, records, tieBreaks, entrants, onClose }: Props) {
  const put = usePutResult(competitionId);
  const del = useDeleteResult(competitionId);
  const existing = match ? records.find((r) => r.matchId === match.id) : undefined;
  const [winner, setWinner] = useState<'a' | 'b' | null>(null);
  const [method, setMethod] = useState<MatchMethod>('points');
  const [score, setScore] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    setWinner(match?.result?.winner ?? null);
    setMethod(match?.result?.method ?? 'points');
    setScore(match?.result?.score ?? '');
    setConfirmDelete(false);
    put.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id]);
  if (!match) return null;
  const affected = existing && winner && winner !== match.result?.winner ? affectedBy(bracket, records, match.id, winner, tieBreaks) : [];
  const affectedByDelete = existing ? affectedBy(bracket, records, match.id, null, tieBreaks) : [];
  // Le serveur efface le départage d'une poule dont un résultat change ou disparaît.
  const poolTieBreak = match.pool !== undefined && (tieBreaks[match.pool]?.length ?? 0) > 0 ? ' Le départage de la poule sera effacé.' : '';
  const changing = !!existing && !!winner && winner !== match.result?.winner;
  const side = (s: 'a' | 'b') => {
    const id = s === 'a' ? match.entrantA! : match.entrantB!;
    const info = entrants.get(id);
    const chosen = winner === s;
    return (
      <UnstyledButton data-testid={`result-winner-${s}`} onClick={() => setWinner(s)} style={{ flex: 1 }}>
        <Paper withBorder p="md" style={{ borderColor: chosen ? 'var(--mantine-color-shidokan-5)' : undefined, borderWidth: chosen ? 3 : 1 }}>
          <Text fw={700} size="lg">{info?.name}</Text>
          <Text size="sm" c="dimmed">{info?.club}</Text>
          {chosen && <Text size="sm" c="shidokan" fw={700}>Vainqueur</Text>}
        </Paper>
      </UnstyledButton>
    );
  };
  const save = () =>
    winner && put.mutate({ cid: categoryId, matchId: match.id, winner, method, score: score.trim() || null }, { onSuccess: onClose });

  return (
    <Modal opened onClose={onClose} closeOnEscape={!helpOpen} title={`Combat ${number ?? ''} — résultat`} size="lg">
      <Stack>
        <Group gap={4} wrap="nowrap"><HelpText topic="combats.resultat" /><HelpButton topic="combats.resultat" onOpenChange={setHelpOpen} /></Group>
        <Group grow align="stretch">{side('a')}{side('b')}</Group>
        <Group grow>
          <Select data-testid="result-method" label="Méthode" allowDeselect={false} value={method} onChange={(v) => v && setMethod(v as MatchMethod)}
            data={METHODS.filter((m) => m.value !== 'ko' || ruleset === 'shobu')} />
          <TextInput data-testid="result-score" label="Score (facultatif)" placeholder="ex. 3-1" value={score} onChange={(e) => setScore(e.currentTarget.value)} />
        </Group>
        {(affected.length > 0 || (changing && poolTieBreak)) && (
          <Alert color="orange" data-testid="result-affected">
            {affected.length > 0 ? `${affected.length} combat(s) suivant(s) déjà joué(s) seront à revoir : leur résultat sera ignoré.` : ''}
            {poolTieBreak}
          </Alert>
        )}
        <ApiErrorAlert error={put.error ?? del.error} />
        {confirmDelete && (
          <Alert color="red" title="Effacer ce résultat ?" data-testid="result-delete-warning">
            <Text size="sm">
              {affectedByDelete.length > 0
                ? `${affectedByDelete.length} combat(s) suivant(s) déjà joué(s) seront à revoir : leur résultat sera ignoré.`
                : 'Le combat redeviendra à disputer.'}
              {poolTieBreak}
            </Text>
            <Group justify="flex-end" mt="xs">
              <Button size="xs" variant="default" onClick={() => setConfirmDelete(false)}>Non</Button>
              <Button size="xs" color="red" data-testid="result-delete-confirm" loading={del.isPending}
                onClick={() => del.mutate({ cid: categoryId, matchId: match.id }, { onSuccess: onClose })}>
                Effacer le résultat
              </Button>
            </Group>
          </Alert>
        )}
        <Group justify="space-between">
          {existing && !confirmDelete ? (
            <Button variant="subtle" color="red" data-testid="result-delete" onClick={() => setConfirmDelete(true)}>
              Effacer le résultat
            </Button>
          ) : <span />}
          <Button data-testid="result-save" disabled={!winner} loading={put.isPending} color={affected.length || (changing && poolTieBreak) ? 'orange' : undefined} onClick={save}>
            {affected.length || (changing && poolTieBreak) ? 'Confirmer la correction' : 'Enregistrer'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
