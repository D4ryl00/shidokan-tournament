import { Alert, Anchor, Box, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useLayoutEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PublicHeader } from '../../components/public/PublicHeader.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { useDocumentTitle } from '../../documentTitle.js';
import { isGone, usePublicCompetition } from '../../publicApi.js';
import { usePublicEvents, useReceivedAt } from '../../publicLive.js';
import { followedFighters, usePins } from '../../publicPins.js';
import { PublicError } from '../../components/public/PublicError.js';
import { BracketsTab } from './BracketsTab.js';
import { FollowedTab } from './FollowedTab.js';
import { frDate } from './PublicHomePage.js';
import { ResultsTab } from './ResultsTab.js';
import type { PublicTabProps } from './tabProps.js';
import { ZonesTab } from './ZonesTab.js';

export type PublicTabName = 'suivis' | 'zones' | 'tableaux' | 'resultats';

const TABS: { name: PublicTabName; label: string; Component: (p: PublicTabProps) => React.ReactNode }[] = [
  { name: 'suivis', label: '★ Suivis', Component: FollowedTab },
  { name: 'zones', label: 'Zones', Component: ZonesTab },
  { name: 'tableaux', label: 'Tableaux', Component: BracketsTab },
  { name: 'resultats', label: 'Résultats', Component: ResultsTab },
];

const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Page publique d'une compétition : en-tête, puis un onglet (`?onglet=`, « suivis » par défaut ; compétition passée : tableaux et résultats). */
export function PublicCompetitionPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error, failureReason } = usePublicCompetition(id);
  const connected = usePublicEvents(id);
  const updated = useReceivedAt(data);
  const [search] = useSearchParams();
  const [pins, setPins] = usePins(id);
  const gone = isGone(data);
  useDocumentTitle(data && !gone ? data.name : undefined);

  const pub = data && !gone ? data : null;
  const tabs = pub?.phase === 'past' ? TABS.filter((t) => t.name === 'tableaux' || t.name === 'resultats') : TABS;
  const requested = search.get('onglet');
  const active = tabs.find((t) => t.name === requested) ?? tabs[0]!;
  const followed = useMemo(() => new Set(pub ? followedFighters(pub, pins) : []), [pub, pins]);
  const launched = !!pub?.waves.some((w) => w.launched);
  // Autre onglet : en haut de la page (avant l'effet d'un onglet qui amène lui-même un élément à l'écran). Corps entre
  // accolades : `scrollTo` rend une promesse dans les navigateurs récents, et un effet ne doit rien rendre d'autre qu'une fonction.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [active.name]);

  return (
    <Box mih="100vh" style={{ background: 'var(--sk-bg)' }}>
      <PublicHeader />
      {!connected && !gone && (
        <Alert color="yellow" radius={0} py={6} data-testid="public-offline">Connexion perdue, nouvel essai…</Alert>
      )}
      <Stack gap="md" p="md" maw={900} mx="auto" className="sk-pub-body">
        {isLoading && !failureReason && <Group justify="center" py="xl"><Loader /></Group>}
        <PublicError error={error ?? failureReason} hasData={!!data} />
        {gone && (
          <EmptyState title="Cette compétition n’est plus affichée." data-testid="public-gone"
            action={<Anchor component={Link} to="/public">Retour à l’accueil</Anchor>} />
        )}
        {pub && (
          <>
            <Stack gap={2}>
              <Title order={1} fz="h3">{pub.name}</Title>
              <Text size="sm" c="dimmed">{[frDate(pub.date), pub.location].filter(Boolean).join(' · ')}</Text>
              {pub.phase === 'today' && (
                <Text size="xs" c="dimmed" data-testid="public-live">
                  <Text span fw={700} inherit style={{ color: 'var(--sk-accent)' }}>● EN DIRECT</Text>
                  {updated && ` · mis à jour à ${hhmm(updated)}`}
                </Text>
              )}
            </Stack>
            <nav className="sk-pub-tabs" aria-label="Onglets de la compétition">
              {tabs.map((t) => (
                <Link key={t.name} to={`?onglet=${t.name}`} replace className="sk-pub-tab" data-testid={`public-tab-${t.name}`}
                  aria-current={t.name === active.name ? 'page' : undefined}>{t.label}</Link>
              ))}
            </nav>
            {!launched && pub.phase !== 'past' && <Text size="sm" c="dimmed" data-testid="public-not-launched">Numéros et horaires au lancement de la session.</Text>}
            <active.Component pub={pub} followed={followed} pins={pins} onPins={setPins} />
          </>
        )}
      </Stack>
    </Box>
  );
}
