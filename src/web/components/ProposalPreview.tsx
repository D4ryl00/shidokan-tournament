import { Group, List, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { PreviewData } from '../api.js';
import { ReplacementBadge } from './ReplacementBadge.js';

function Lineup({ title, pairs }: { title: string; pairs: string[][] }) {
  return (
    <div>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">{title}</Text>
      {pairs.length === 0 ? (
        <Text size="sm" c="dimmed">(vide)</Text>
      ) : (
        <List size="sm">
          {pairs.map((p, i) => (
            <List.Item key={i}>{p.length === 1 ? `${p[0]} (sans adversaire)` : p.length === 2 ? `${p[0]} contre ${p[1]}` : p.join(' · ')}</List.Item>
          ))}
        </List>
      )}
    </div>
  );
}

/** Aperçu avant validation : qui bouge, quels tableaux changent, qui rencontre qui. */
export function ProposalPreview({ data }: { data: PreviewData }) {
  const simple = data.steps.filter((s) => !s.manual);
  const manual = data.steps.filter((s) => s.manual);
  return (
    <Stack data-testid="preview-content">
      {data.steps.length > 1 && (
        <>
          <Title order={6}>Cas simples ({simple.length})</Title>
          <Stack gap={4} data-testid="preview-simple">
            {simple.map((s) => (
              <Group key={s.proposal.id} gap="xs" wrap="nowrap"><ReplacementBadge type={s.proposal.type} state="proposed" size="xs" checks={s.proposal.checks} /><Text size="sm">{s.proposal.reason}</Text></Group>
            ))}
          </Stack>
          <Title order={6}>Cas qui demandent normalement une validation manuelle ({manual.length})</Title>
          <Stack gap={4} data-testid="preview-manual">
            {manual.map((s) => (
              <Group key={s.proposal.id} gap="xs" wrap="nowrap"><ReplacementBadge type={s.proposal.type} state="proposed" size="xs" checks={s.proposal.checks} /><Text size="sm">{s.proposal.reason}</Text></Group>
            ))}
          </Stack>
        </>
      )}
      {data.steps.length === 1 && <Text size="sm">{data.steps[0]!.proposal.reason}</Text>}
      <Title order={6}>Tableaux modifiés</Title>
      {data.categories.map((c) => (
        <Paper key={c.label} withBorder p="xs">
          <Text fw={500} size="sm" mb={4}>{c.label}</Text>
          <SimpleGrid cols={2}>
            <Lineup title="Avant" pairs={c.before} />
            <Lineup title="Après" pairs={c.after} />
          </SimpleGrid>
        </Paper>
      ))}
      {data.unresolved !== undefined && data.unresolved > 0 && <Text size="sm" c="orange">{data.unresolved} cas resteront sans solution automatique.</Text>}
    </Stack>
  );
}
