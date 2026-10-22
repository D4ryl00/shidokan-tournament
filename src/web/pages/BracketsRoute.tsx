import { useParams } from 'react-router';
import { useCompetition } from '../api.js';
import { BracketsPage } from './BracketsPage.js';

export function BracketsRoute() {
  const { id = '' } = useParams();
  const { data } = useCompetition(id);
  return <BracketsPage settingsRepechage={data?.settings.repechage ?? false} settingsThird={data?.settings.thirdPlaceMatch ?? false} />;
}
