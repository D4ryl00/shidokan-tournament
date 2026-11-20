import type { SendResult } from './mail.js';

/** Ce qu'envoie un envoi groupé : les liens d'inscription, ou les récapitulatifs PDF. */
export type SendJobKind = 'invitation' | 'recap';

/**
 * Envoi groupé des liens ou des récapitulatifs, en cours ou fini. Il se fait en tâche de fond : un envoi à beaucoup de clubs dure plus longtemps que ce
 * qu'attend un serveur web placé devant l'application (nginx coupe au bout de 60 s par défaut), et la page suit l'avancement.
 */
export interface SendJob {
  id: string;
  kind: SendJobKind;
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

/**
 * Le dernier envoi de chaque type, par compétition (en mémoire : un redémarrage de l'application l'oublie, le journal des mails reste).
 * Un seul envoi à la fois par compétition, liens et récapitulatifs confondus.
 */
export class SendJobs {
  private readonly jobs = new Map<string, Partial<Record<SendJobKind, SendJob>>>();
  private readonly preparing = new Set<string>();

  get(competitionId: string, kind: SendJobKind): SendJob | null {
    return this.jobs.get(competitionId)?.[kind] ?? null;
  }

  private busy(competitionId: string): boolean {
    return this.preparing.has(competitionId) || Object.values(this.jobs.get(competitionId) ?? {}).some((j) => !j.finished);
  }

  /**
   * `prepare` vérifie tout ce qui peut refuser l'envoi entier (son refus remonte tel quel, rien n'est lancé) et rend l'envoi club par club,
   * lancé ensuite en tâche de fond. Un seul envoi à la fois par compétition, de quelque type qu'il soit.
   */
  async start(
    competitionId: string,
    total: number,
    prepare: () => Promise<(onResult: (r: SendResult) => void) => Promise<unknown>>,
    kind: SendJobKind,
  ): Promise<SendJob> {
    if (this.busy(competitionId)) throw new SendJobBusyError();
    this.preparing.add(competitionId);
    let run: Awaited<ReturnType<typeof prepare>>;
    try {
      run = await prepare();
    } finally {
      this.preparing.delete(competitionId);
    }
    const job: SendJob = { id: crypto.randomUUID(), kind, startedAt: new Date().toISOString(), total, results: [], finished: false, error: null };
    this.jobs.set(competitionId, { ...this.jobs.get(competitionId), [kind]: job });
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
