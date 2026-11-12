/** Réponse d'une requête de test (ce qu'en lisent les tests d'envoi). */
export interface Reply {
  statusCode: number;
  body: string;
  json(): any;
}

/**
 * Envoi groupé des liens en entier : la demande (202 : l'envoi part en tâche de fond), puis l'avancement lu jusqu'à la fin. Rend la
 * réponse à la demande, avec pour `json()` les résultats club par club ; un refus (400, 409…) est rendu tel quel.
 */
export async function sendAndWait(call: (method: 'GET' | 'POST', url: string, payload?: unknown) => Promise<Reply>, url: string, payload: unknown): Promise<Reply> {
  const res = await call('POST', url, payload);
  if (res.statusCode !== 202) return res;
  for (let i = 0; i < 2000; i++) {
    const { job } = (await call('GET', url)).json() as { job: { finished: boolean; results: unknown[]; error: string | null } | null };
    if (job?.finished) {
      if (job.error) throw new Error(job.error);
      const body = JSON.stringify(job.results);
      return { statusCode: res.statusCode, body, json: () => JSON.parse(body) };
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('Envoi jamais terminé');
}
