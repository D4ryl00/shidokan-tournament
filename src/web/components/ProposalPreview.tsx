import { Group, List, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { Fragment } from 'react';
import type { PreviewData } from '../api.js';
import { FighterName, useFighterActive, WithFighterHighlight } from './FighterHighlight.js';
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
            <List.Item key={i}>
              {p.map((n, j) => (
                <Fragment key={j}>{j > 0 && (p.length === 2 ? ' contre ' : ' · ')}<FighterName name={n} /></Fragment>
              ))}
              {p.length === 1 && ' (sans adversaire)'}
            </List.Item>
          ))}
        </List>
      )}
    </div>
  );
}

/** Un tableau modifié : encadré de la couleur d'accent quand il contient le combattant mis en valeur. */
function CategoryChange({ c }: { c: PreviewData['categories'][number] }) {
  const isActive = useFighterActive();
  const active = [...c.before, ...c.after].some((pair) => pair.some(isActive));
  return (
    <Paper withBorder p="xs" data-testid="preview-category" data-active={active || undefined} style={active ? { borderColor: 'var(--sk-accent)' } : undefined}>
      <Text fw={500} size="sm" mb={4}>{c.label}</Text>
      <SimpleGrid cols={2}>
        <Lineup title="Avant" pairs={c.before} />
        <Lineup title="Après" pairs={c.after} />
      </SimpleGrid>
    </Paper>
  );
}

/**
 * Aperçu avant validation : qui bouge, quels tableaux changent, qui rencontre qui. Un nom survolé ou cliqué s'allume partout
 * (avec la liste des déplacements au-dessus, quand elle est dans le même `FighterHighlight`).
 */
export function ProposalPreview({ data }: { data: PreviewData }) {
  return <WithFighterHighlight><PreviewContent data={data} /></WithFighterHighlight>;
}

function PreviewContent({ data }: { data: PreviewData }) {
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
      {data.categories.map((c) => <CategoryChange key={c.label} c={c} />)}
      {data.unresolved !== undefined && data.unresolved > 0 && <Text size="sm" c="orange">{data.unresolved} cas resteront sans solution automatique.</Text>}
    </Stack>
  );
}
