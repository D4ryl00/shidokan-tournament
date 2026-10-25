import { DateInput, type DateInputProps } from '@mantine/dates';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import 'dayjs/locale/fr.js';

dayjs.extend(customParseFormat);

/**
 * Champ de date au format français (JJ/MM/AAAA, calendrier en français) ; la valeur reste `AAAA-MM-JJ`, comme celle envoyée
 * au serveur. Une date tapée à la main est lue au même format.
 */
export function DateField({ value, onChange, ...rest }: Omit<DateInputProps, 'value' | 'onChange'> & { value: string | null; onChange: (v: string | null) => void; 'data-testid'?: string }) {
  return (
    <DateInput locale="fr" valueFormat="DD/MM/YYYY" placeholder="JJ/MM/AAAA" firstDayOfWeek={1}
      dateParser={(s) => { const d = dayjs(s.trim(), ['DD/MM/YYYY', 'D/M/YYYY', 'YYYY-MM-DD'], true); return d.isValid() ? d.format('YYYY-MM-DD') : null; }}
      value={value || null} onChange={onChange} {...rest} />
  );
}
