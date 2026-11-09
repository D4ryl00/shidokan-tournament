/** Un raccourci vers une section de la page : lien d'ancre (`href`) ou action (`onClick`, défilement à la main). */
export interface JumpLink { key: string; label: string; count?: number; href?: string; onClick?: () => void }

/**
 * Sommaire en pastilles (« Cadets 3 », « Envoi des mails ») : le même style partout où une page propose d'aller à une de ses sections.
 * Le nombre, s'il y en a un, suit le nom en plus discret.
 */
export function JumpLinks({ items, label = 'Aller à', itemTestId, ...rest }: { items: JumpLink[]; label?: string; itemTestId?: string; 'data-testid'?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="sk-jumps" data-testid={rest['data-testid']}>
      {items.map((x) => {
        const body = <>{x.label}{x.count !== undefined && <span className="sk-jump-count">{x.count.toLocaleString('fr-FR')}</span>}</>;
        return x.href !== undefined
          ? <a key={x.key} className="sk-jump" href={x.href} data-testid={itemTestId}>{body}</a>
          : <button key={x.key} type="button" className="sk-jump" onClick={x.onClick} data-testid={itemTestId}>{body}</button>;
      })}
    </nav>
  );
}
