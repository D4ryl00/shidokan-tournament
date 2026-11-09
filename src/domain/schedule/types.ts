/** Heures d'une session (`waveId` null : session unique d'une compétition sans session), au format HH:MM. */
export interface WaveSchedule {
  waveId: string | null;
  plannedStart: string | null;
  actualStart: string | null;
  finalsStart: string | null;
}

/** Heure saisie : HH:MM sur 24 h. */
export const isClock = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
