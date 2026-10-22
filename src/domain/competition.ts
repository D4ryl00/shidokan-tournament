import type { CompetitionSettings } from './settings.js';

export interface Competition {
  id: string;
  name: string;
  date: string;
  location: string | null;
  settings: CompetitionSettings;
  createdAt: string;
}

export interface CompetitionInput {
  name: string;
  date: string;
  location?: string | null;
  /** Nombre de zones de combat créées (« Tatami 1 » … « Tatami N ») ; 2 par défaut. */
  zoneCount?: number;
}
