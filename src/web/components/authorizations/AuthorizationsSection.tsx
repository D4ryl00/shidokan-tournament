import { Anchor, Button, Card, Checkbox, Group, Loader, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { AUTHORIZATION_KIND_LABELS, gapText, type AnswerableKind, type AuthorizationClub, type AuthorizationRow } from '../../../domain/authorizations.js';
import { allClubsMessage, byFighter, clubMessage, messageRows } from '../../../domain/authorizations-text.js';
import { plural } from '../../../domain/plural.js';
import { useAuthorizations, useGrantAuthorization, useUngrantAuthorization } from '../../api.js';
import { copyWithNotice } from '../../clipboard.js';
import { usePoste } from '../../poste.js';
import { withSession } from '../../useSelectedWave.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { useUndoDialog } from '../history/undo-dialog-context.js';
import { EmptyState } from '../ui/EmptyState.js';
import { SectionCard } from '../ui/SectionCard.js';
import { StatusBadge } from '../ui/StatusBadge.js';

/** Icône de l'état, et ce qu'elle veut dire pour un lecteur d'écran. */
const ICONS: Record<AuthorizationRow['status'], [string, string]> = { pending: ['⏳', 'en attente'], granted: ['✓', 'accordée'], info: ['⚖', 'poids à demander'] };
const NO_MOVE = 'Aucun déplacement à défaire : ce groupe existait déjà.';
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Nom écrit dans le message : aucun pour les combattants sans club. */
const messageClub = (c: AuthorizationClub) => ({ name: c.clubId ? c.name : '' });

/**
 * « ③ Autorisations à demander » (spec étape 45 §7.4) : les demandes aux coachs de la session affichée, par club, combattants
 * numérotés, avec leur réponse. Un poste de Zone ne voit ni demandes ni réponses.
 */
export function AuthorizationsSection({ competitionId, waveId }: { competitionId: string; waveId: string | null }) {
  const [poste] = usePoste(competitionId);
  if (poste.kind === 'zone') return null;
  return <Authorizations competitionId={competitionId} waveId={waveId} />;
}

function Authorizations({ competitionId, waveId }: { competitionId: string; waveId: string | null }) {
  const { data, error } = useAuthorizations(competitionId, waveId);
  const grant = useGrantAuthorization(competitionId);
  const ungrant = useUngrantAuthorization(competitionId);
  const { requestUndoDialog } = useUndoDialog();
  const [onlyPending, setOnlyPending] = useState(true);
  const clubs = data?.clubs ?? [];
  const toCopy = clubs.map((c) => ({ ...messageClub(c), rows: messageRows(c.requests) }));
  const answer = (r: AuthorizationRow) => ({ registrationId: r.registrationId, kind: r.situation.kind as AnswerableKind });
  const busy = (m: typeof grant, r: AuthorizationRow) => m.isPending && m.variables?.registrationId === r.registrationId && m.variables.kind === r.situation.kind;

  const request = (r: AuthorizationRow) => (
    <Group key={r.id} data-testid="auth-request" data-status={r.status} justify="space-between" align="flex-start" wrap="wrap" gap="xs" pl="md">
      <Stack gap={2} style={{ minWidth: 0, flex: '1 1 260px' }}>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          <span role="img" aria-label={ICONS[r.status][1]}>{ICONS[r.status][0]}</span> <b>{AUTHORIZATION_KIND_LABELS[r.situation.kind]}</b> — {r.current} → {r.proposed}
          {r.situation.kind === 'weight' && ` · écart estimé ${gapText(r.situation.gapKg)} maximum`}
        </Text>
        {r.situation.kind !== 'weight' && <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{r.bullet}</Text>}
        {r.status === 'pending' && r.blame.length === 0 && <Text size="xs" c="dimmed" data-testid="auth-no-move">{NO_MOVE}</Text>}
        {r.status === 'pending' && r.blame.length > 0 && r.blocked && (
          <Text size="xs" c="red" data-testid="auth-blocked" style={{ overflowWrap: 'anywhere' }}>{r.blocked}</Text>
        )}
      </Stack>
      {r.status === 'pending' && (
        <Group gap={4} wrap="wrap">
          <Button size="compact-sm" color="green" variant="light" data-testid="auth-grant" loading={busy(grant, r)} onClick={() => grant.mutate(answer(r))}>
            Accordée
          </Button>
          {r.blame.length > 0 ? (
            <Button size="compact-sm" color="red" variant="subtle" data-testid="auth-refuse" disabled={r.blocked !== null} title={r.blocked ?? undefined}
              onClick={() => requestUndoDialog(r.blame)}>
              Refusée…
            </Button>
          ) : (
            <Anchor component={Link} size="sm" data-testid="auth-manual"
              to={withSession(`/competitions/${competitionId}/tableaux?vue=liste&categorie=${r.categoryId}&combattant=${r.registrationId}`, waveId)}>
              Déplacer à la main ↗
            </Anchor>
          )}
        </Group>
      )}
      {r.status === 'granted' && r.answeredAt && (
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed" className="num">accordée {time(r.answeredAt)} ·</Text>
          <Button size="compact-xs" variant="subtle" color="gray" data-testid="auth-ungrant" loading={busy(ungrant, r)} onClick={() => ungrant.mutate(answer(r))}>
            annuler
          </Button>
        </Group>
      )}
    </Group>
  );

  const club = (c: AuthorizationClub, i: number) => {
    const shown = c.requests.filter((r) => !onlyPending || r.status !== 'granted');
    if (shown.length === 0) return null;
    // Combattants numérotés dans l'ordre de la liste ; un combattant inscrit dans deux disciplines a un seul numéro.
    const fighters = byFighter(shown);
    const text = clubMessage(toCopy[i]!, toCopy[i]!.rows);
    return (
      <Card key={c.clubId ?? ''} withBorder padding="sm" data-testid="auth-club">
        <Stack gap="xs">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs" wrap="wrap" style={{ minWidth: 0 }}>
              <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{c.name}</Text>
              {c.preApproval && <StatusBadge tone="neutral" size="sm" data-testid="auth-pre-approval">pré-accord coché sur la fiche</StatusBadge>}
            </Group>
            <Button size="compact-sm" variant="outline" color="green" data-testid="auth-copy" disabled={!text}
              onClick={() => void copyWithNotice(text, `Texte copié pour ${c.clubId ? c.name : 'les combattants sans club'}.`)}>
              📋 Copier pour le club
            </Button>
          </Group>
          {fighters.map((rs, n) => (
            <Stack key={rs[0]!.fighterId} gap={4} data-testid="auth-fighter">
              <Text size="sm" fw={600}>{n + 1}. {rs[0]!.label}</Text>
              {rs.map(request)}
            </Stack>
          ))}
        </Stack>
      </Card>
    );
  };

  const all = allClubsMessage(toCopy);
  const pending = data?.pending ?? 0;
  const anyShown = clubs.some((c) => c.requests.some((r) => !onlyPending || r.status !== 'granted'));
  return (
    <SectionCard
      title={<>③ Autorisations à demander <span data-testid="auth-pending" className="num">⏳ {pending}</span></>}
      help="reaffectation.autorisations" borderColor="var(--sk-ok-text)" data-testid="replacement-step-authorizations"
      actions={(
        <Group gap="xs" wrap="wrap">
          <Checkbox size="sm" label="Seulement en attente" data-testid="auth-only-pending" checked={onlyPending} onChange={(e) => setOnlyPending(e.currentTarget.checked)} />
          <Button size="compact-sm" variant="outline" color="green" data-testid="auth-copy-all" disabled={!all}
            onClick={() => void copyWithNotice(all, `Texte copié pour ${plural(toCopy.filter((c) => c.rows.length > 0).length, 'club', 'clubs')}.`)}>
            📋 Copier tout
          </Button>
        </Group>
      )}>
      <ApiErrorAlert error={error ?? grant.error ?? ungrant.error} />
      {!data && !error && <Loader size="sm" />}
      {data && clubs.length === 0 && (
        <EmptyState icon="✓" title="Aucune autorisation à demander" text="Aucun combattant ne demande l’accord de son club ni son poids : rien à envoyer." />
      )}
      {data && clubs.length > 0 && !anyShown && (
        <EmptyState icon="✓" title="Toutes les demandes ont une réponse" text="Décochez « Seulement en attente » pour revoir les accords." />
      )}
      {anyShown && <Stack gap="sm">{clubs.map(club)}</Stack>}
    </SectionCard>
  );
}
