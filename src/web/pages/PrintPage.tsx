import '../print.css';
import { Button, Group, Text } from '@mantine/core';
import { useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import { validResults } from '../../domain/results.js';
import { useCategories, useCategoryResults, useCompetition, usePodiums, useZones } from '../api.js';
import { BracketView, type EntrantInfo } from '../components/BracketView.js';
import { HelpText } from '../components/Help.js';
import { useEntrantInfo } from './BracketsPage.js';

/** Zone utile d'une page A4 paysage (marges 10 mm) moins l'en-tête, en pixels CSS. */
const PAGE_WIDTH = 1040;
const PAGE_HEIGHT = 640;
const MIN_ZOOM = 0.45;

/** Réduit le tableau pour qu'il tienne sur une page (sans descendre sous MIN_ZOOM). */
function FitToPage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.zoom = '1';
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      const z = Math.max(MIN_ZOOM, Math.min(1, PAGE_WIDTH / w, PAGE_HEIGHT / h));
      el.style.zoom = String(z);
      setZoom(z);
    };
    measure();
  });
  return (
    <div ref={ref} data-testid="print-fit" data-zoom={zoom} style={{ width: 'max-content', maxWidth: 'none' }}>
      {children}
    </div>
  );
}

export function PrintSection({ category, entrants, competitionLine, withResults = false }: { category: Category; entrants: Map<string, EntrantInfo>; competitionLine: string; withResults?: boolean }) {
  const { id = '' } = useParams();
  const { data: res } = useCategoryResults(id, withResults ? category.id : null);
  const { data: zones = [] } = useZones(id);
  const zone = zones.find((z) => z.id === category.zoneId);
  const results = res && category.bracket?.kind === 'combat' ? validResults(category.bracket, res.records, res.tieBreaks.pools).results : undefined;
  return (
    <section className="print-section" data-testid="print-section">
      <div className="print-header">
        <img src="/shidokan-france-logo.webp" alt="" width={44} height={44} />
        <div>
          <h1>{category.label}</h1>
          <Text size="sm">{competitionLine}</Text>
          {zone && <Text size="md" fw={700}>Zone : {zone.name}</Text>}
        </div>
      </div>
      <FitToPage>
        <BracketView category={category} entrants={entrants} printable results={results} kataScores={res?.kataScores}
          tieBreaks={res?.tieBreaks.pools} kataTieBreak={res?.tieBreaks.kata} />
      </FitToPage>
    </section>
  );
}

/** /competitions/:id/impression[?categories=id1,id2] — hors de l'AppShell, toujours en noir sur blanc. */
export function PrintPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { data: competition } = useCompetition(id);
  const { data: categories = [] } = useCategories(id);
  const entrants = useEntrantInfo(id);
  const wanted = params.get('categories')?.split(',').filter(Boolean);
  const withResults = params.get('resultats') === '1';
  // Sans sélection : seulement les catégories à disputer (une catégorie dont tous les membres sont absents n'est pas imprimée).
  const list = wanted ? categories.filter((c) => wanted.includes(c.id)) : categories.filter((c) => activeEntrantCount(c) >= 2);
  const line = competition
    ? [competition.name, new Date(`${competition.date}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'long' }), competition.location].filter(Boolean).join(' — ')
    : '';
  return (
    <div className="print-root">
      <Group className="no-print" mb="md">
        <Button onClick={() => window.print()}>Imprimer</Button>
        <Text size="sm">
          {withResults ? 'Feuilles de résultats' : 'Tableaux'} : {list.length} catégorie(s) — une par page, format A4 paysage. Pour un PDF, choisir « Enregistrer au format PDF ».
        </Text>
        <HelpText topic="impression" />
      </Group>
      {list.map((c) => (
        <PrintSection key={c.id} category={c} entrants={entrants} competitionLine={line} withResults={withResults} />
      ))}
    </div>
  );
}

/** /competitions/:id/impression/podiums — podiums des catégories terminées, puis classement des clubs. */
export function PodiumsPrintPage() {
  const { id = '' } = useParams();
  const { data: competition } = useCompetition(id);
  const { data } = usePodiums(id);
  const entrants = useEntrantInfo(id);
  const name = (rid: string | null) => (rid ? `${entrants.get(rid)?.name ?? '?'} — ${entrants.get(rid)?.club ?? ''}` : '—');
  const done = (data?.categories ?? []).filter((c) => c.complete);
  return (
    <div className="print-root">
      <Group className="no-print" mb="md"><Button onClick={() => window.print()}>Imprimer</Button><HelpText topic="impression" /></Group>
      <section className="print-section" data-testid="podium-print">
        <div className="print-header">
          <img src="/shidokan-france-logo.webp" alt="" width={44} height={44} />
          <h1>Podiums — {competition?.name}</h1>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Catégorie', '1er', '2e', '3e'].map((h) => <th key={h} style={{ border: '1px solid #000', padding: 6, textAlign: 'left' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {done.map((c) => (
              <tr key={c.id}>
                <td style={{ border: '1px solid #000', padding: 6, fontWeight: 700 }}>{c.label}</td>
                <td style={{ border: '1px solid #000', padding: 6 }}>{name(c.podium.first)}</td>
                <td style={{ border: '1px solid #000', padding: 6 }}>{name(c.podium.second)}</td>
                <td style={{ border: '1px solid #000', padding: 6 }}>{c.podium.thirds.map(name).join(' / ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="print-section">
        <div className="print-header"><h1>Classement des clubs</h1></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Club', 'Or', 'Argent', 'Bronze', 'Total'].map((h) => <th key={h} style={{ border: '1px solid #000', padding: 6, textAlign: 'left' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(data?.medals ?? []).map((m) => (
              <tr key={m.clubId}>
                {[m.club, m.gold, m.silver, m.bronze, m.gold + m.silver + m.bronze].map((v, i) => <td key={i} style={{ border: '1px solid #000', padding: 6 }}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
