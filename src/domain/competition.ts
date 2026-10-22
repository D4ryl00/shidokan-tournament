import type { CompetitionSettings } from './settings.js';

export interface Competition {
  id: string;
  name: string;
  date: string;
  location: string | null;
  tatamiCount: number;
  settings: CompetitionSettings;
  createdAt: string;
}

export interface CompetitionInput {
  name: string;
  date: string;
  location?: string | null;
  tatamiCount?: number;
}
