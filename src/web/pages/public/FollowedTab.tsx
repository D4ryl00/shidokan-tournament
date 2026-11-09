import { FollowTab } from '../../components/public/FollowTab.js';
import type { PublicTabProps } from './tabProps.js';

/** Onglet « Suivis » de la page publique. */
export function FollowedTab(props: PublicTabProps) {
  return <FollowTab {...props} />;
}
