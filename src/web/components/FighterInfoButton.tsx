import { ActionIcon, Popover, Text } from '@mantine/core';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { FighterSheet } from './replacement/FighterSheet.js';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Icône ⓘ à côté d'un nom : ouvre la fiche du combattant dans une bulle. Ni le clic, ni le clavier, ni le glisser n'en
 * remontent à la pastille ou à la case (choix clic-clic, échange, déplacement). La bulle est dans un portail, mais les
 * événements React la traversent : elle les arrête aussi.
 */
export function FighterInfoButton({ competitionId, registrationId, name, club }: { competitionId: string; registrationId: string; name: string; club: string }) {
  const [opened, setOpened] = useState(false);
  // Mantine ne ferme sur Échap que si le focus est dans la bulle : ici il reste sur ⓘ (ou ailleurs), d'où l'écoute de la fenêtre.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpened(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened]);
  return (
    // Bulle pilotée à la main (Échap, ci-dessus) : Mantine ne pose alors plus d'onClick sur la cible. L'enveloppe arrête aussi
    // les événements venus de la bulle (portail), qui remonteraient sinon à la pastille.
    // Pas d'arrêt de pointerdown/mousedown : React le ferait aussi pour l'écoute native de Mantine (clic dehors), et la bulle
    // d'un autre ⓘ ne se fermerait plus. Aucune pastille n'écoute ces événements.
    <span onClick={stop} onKeyDown={stop} onDragStart={stop} style={{ display: 'inline-flex', flexShrink: 0 }}>
    <Popover opened={opened} onChange={setOpened} withArrow shadow="md" position="bottom-start" width="min(340px, calc(100vw - 32px))" transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <ActionIcon data-testid="fighter-info" size="sm" variant="subtle" aria-label={`Fiche de ${name}`} title="Fiche du combattant"
          draggable={false} onClick={(e) => { e.stopPropagation(); setOpened((o) => !o); }} onKeyDown={stop}
          // mousedown annulé : sinon la pastille, qui est déplaçable, démarre un glisser depuis ⓘ.
          onMouseDown={(e) => e.preventDefault()}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          style={{ color: 'var(--sk-muted)', flexShrink: 0 }}>
          ⓘ
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown data-testid="fighter-info-sheet" onClick={stop} onKeyDown={stop} onPointerDown={stop} onMouseDown={stop} onDragStart={stop}>
        <Text size="sm"><b>{name}</b> · {club}</Text>
        <FighterSheet competitionId={competitionId} registrationId={registrationId} />
      </Popover.Dropdown>
    </Popover>
    </span>
  );
}
