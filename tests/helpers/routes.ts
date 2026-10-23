import type { FastifyInstance } from 'fastify';

/** Toutes les routes enregistrées (méthode, motif), depuis l'arbre de printRoutes ; les paramètres sont gardés (`:id`). */
export function registeredRoutes(a: FastifyInstance): { method: string; pattern: string }[] {
  const stack: string[] = [];
  const out: { method: string; pattern: string }[] = [];
  for (const line of a.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack.push(m[2]!);
    for (const method of (m[3] ?? '').split(', ').filter(Boolean)) out.push({ method, pattern: stack.join('') });
  }
  return out;
}
