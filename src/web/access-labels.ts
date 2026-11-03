/** Heure de création de chaque lien d'un club, à la minute ; avec les secondes quand un autre lien du club a été créé la même minute (les titres se distinguent). */
export function accessTimes(accesses: { id: string; createdAt: string }[]): Map<string, string> {
  const minute = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const count = new Map<string, number>();
  for (const a of accesses) count.set(minute(a.createdAt), (count.get(minute(a.createdAt)) ?? 0) + 1);
  return new Map(
    accesses.map((a) => [
      a.id,
      new Date(a.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...((count.get(minute(a.createdAt)) ?? 0) > 1 ? { second: '2-digit' } : {}) }),
    ]),
  );
}
