import { useEffect } from 'react';

/** Titre de l'onglet du navigateur : « Pesée · Coupe d'automne — Shidokan France » (l'écran d'abord, lisible dans un onglet étroit). */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} — Shidokan France` : 'Shidokan France';
  }, [title]);
}
