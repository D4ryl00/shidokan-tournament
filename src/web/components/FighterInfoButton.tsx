import { ActionIcon, Popover, Text } from '@mantine/core';
import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { FighterSheet } from './replacement/FighterSheet.js';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Icône ⓘ à côté d'un nom : ouvre la fiche du combattant dans une bulle. Ni le clic, ni le clavier, ni le glisser n'en
 * remontent à la pastille ou à la case (choix clic-clic, échange, déplacement). La bulle est dans un portail, mais les
 * événements React la traversent : elle les arrête aussi.
 */
export function FighterInfoButton({ competitionId, registrationId, name, club, style }: { competitionId: string; registrationId: string; name: string; club: string; style?: CSSProperties }) {
  // Popover monté au premier clic seulement (une page peut avoir des centaines de ⓘ) ; ensuite il reste monté.
  const [mounted, setMounted] = useState(false);
  const [opened, setOpened] = useState(false);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const hadFocus = useRef(false);
  // Au montage du Popover l'icône est recréée : le focus, s'il était sur ⓘ (clavier), y est remis.
  useEffect(() => {
    if (mounted && hadFocus.current) { iconRef.current?.focus(); hadFocus.current = false; }
  }, [mounted]);
  // Mantine ne ferme sur Échap que si le focus est dans la bulle. Focus ailleurs : écoute de la fenêtre ci-dessous. Focus resté
  // sur ⓘ (Tab puis Entrée) : l'arrêt de propagation de ⓘ la coupe, donc Échap est traité dans le onKeyDown de ⓘ.
  // Molette sur la galaxie : les cartes bougent par transformation CSS, la bulle ne les suit pas, on la ferme. Le défilement
  // de la page (planche) ne la ferme pas.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpened(false); };
    const onWheel = (e: WheelEvent) => { if (e.target instanceof Element && e.target.closest('[data-testid="galaxy"]')) setOpened(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('wheel', onWheel, { capture: true }); };
  }, [opened]);
  const icon = (onClick: () => void) => (
    <ActionIcon ref={iconRef} data-testid="fighter-info" size={24} variant="subtle" aria-label={`Fiche de ${name}`} title="Fiche du combattant"
      draggable={false} onClick={onClick}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpened(false); }}
      // mousedown annulé : pas de focus ni de sélection de texte au clic sur ⓘ.
      onMouseDown={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ color: 'var(--sk-muted)', flexShrink: 0 }}>
      ⓘ
    </ActionIcon>
  );
  return (
    // L'enveloppe arrête les événements venus de ⓘ et de la bulle (portail), qui remonteraient sinon à la carte ou au tableau.
    // Pas d'arrêt de pointerdown/mousedown : React le ferait aussi pour l'écoute native de Mantine (clic dehors), et la bulle
    // d'un autre ⓘ ne se fermerait plus. Aucune pastille n'écoute ces événements.
    <span onClick={stop} onKeyDown={stop} onDragStart={stop} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
      {!mounted ? icon(() => { hadFocus.current = document.activeElement === iconRef.current; setMounted(true); setOpened(true); }) : (
        // Bulle pilotée à la main (Échap, ci-dessus) : Mantine ne pose alors plus d'onClick sur la cible.
        <Popover opened={opened} onChange={setOpened} withArrow shadow="md" position="bottom-start" width="min(340px, calc(100vw - 32px))" transitionProps={{ duration: 0 }}>
          <Popover.Target>{icon(() => setOpened((o) => !o))}</Popover.Target>
          <Popover.Dropdown data-testid="fighter-info-sheet" onClick={stop} onKeyDown={stop} onPointerDown={stop} onMouseDown={stop} onDragStart={stop}>
            <Text size="sm"><b>{name}</b> · {club}</Text>
            <FighterSheet competitionId={competitionId} registrationId={registrationId} />
          </Popover.Dropdown>
        </Popover>
      )}
    </span>
  );
}
