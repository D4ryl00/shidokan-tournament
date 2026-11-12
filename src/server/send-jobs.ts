import type { SendResult } from './mail.js';

/**
 * Envoi groupé des liens, en cours ou fini. Il se fait en tâche de fond : un envoi à beaucoup de clubs dure plus longtemps que ce
 * qu'attend un serveur web placé devant l'application (nginx coupe au bout de 60 s par défaut), et la page suit l'avancement.
 */
export interface SendJob {
  id: string;
  startedAt: string;
  /** Nombre de clubs à qui envoyer. */
  total: number;
  /** Résultat de chaque club déjà traité, dans l'ordre de l'envoi. */
  results: SendResult[];
  finished: boolean;
  /** Panne inattendue qui a arrêté l'envoi en cours de route (les clubs déjà traités restent dans `results`). */
  error: string | null;
}

export class SendJobBusyError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Un envoi de mails est déjà en cours pour cette compétition : attendez qu’il se termine.');
  }
}

/** Le dernier envoi de chaque compétition (en mémoire : un redémarrage de l'application l'oublie, le journal des mails reste). */
export class SendJobs {
  private readonly jobs = new Map<string, SendJob>();
  private readonly preparing = new Set<string>();

  get(competitionId: string): SendJob | null {
    return this.jobs.get(competitionId) ?? null;
  }

  /**
   * `prepare` vérifie tout ce qui peut refuser l'envoi entier (son refus remonte tel quel, rien n'est lancé) et rend l'envoi club par club,
   * lancé ensuite en tâche de fond. Un seul envoi à la fois par compétition.
   */
  async start(
    competitionId: string,
    total: number,
    prepare: () => Promise<(onResult: (r: SendResult) => void) => Promise<unknown>>,
  ): Promise<SendJob> {
    if (this.preparing.has(competitionId) || this.get(competitionId)?.finished === false) throw new SendJobBusyError();
    this.preparing.add(competitionId);
    let run: Awaited<ReturnType<typeof prepare>>;
    try {
      run = await prepare();
    } finally {
      this.preparing.delete(competitionId);
    }
    const job: SendJob = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), total, results: [], finished: false, error: null };
    this.jobs.set(competitionId, job);
    void run((r) => job.results.push(r))
      .catch((err: unknown) => {
        job.error = `Envoi interrompu : ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        job.finished = true;
      });
    return job;
  }
}
