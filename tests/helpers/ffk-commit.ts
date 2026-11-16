import type { FastifyInstance } from 'fastify';

/** Import FFK comme la page le fait : aperçu (pour son empreinte), puis import avec cette empreinte. `competition` : `/api/competitions/<id>`. */
export async function ffkCommit(app: FastifyInstance, competition: string, up: { uploadId: string; sheets: unknown[] }, choices: object = {}) {
  const url = `${competition}/ffk-imports/${up.uploadId}`;
  const preview = await app.inject({ method: 'POST', url: `${url}/preview`, payload: { sheets: up.sheets, choices } });
  return app.inject({ method: 'POST', url: `${url}/commit`, payload: { sheets: up.sheets, choices, fingerprint: preview.json().fingerprint } });
}
