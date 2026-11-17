import { Button, Group, Loader, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useParams } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import { journalDetailLine, journalText } from '../../domain/journal/text.js';
import { actorLabel, JOURNAL_TYPE_LABELS, JOURNAL_TYPES, JOURNAL_VIA_LABELS, type JournalChange, type JournalEntryView, type JournalType } from '../../domain/journal/types.js';
import { useJournal } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { IconSearch } from '../components/ui/icons.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { groupByDay, highlight, hhmm, receivedNote, toggleType, visibleDetails } from '../journal.js';

/** Texte avec les mots de la recherche surlignés. */
function Hl({ text, q }: { text: string; q: string }) {
  return <>{highlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

/** « Poids : 52,4 kg → 53,1 kg », l'ancienne valeur barrée (rien avant : la nouvelle seule ; rien après : « — »). `sep` : entre libellé et valeurs. */
function Change({ c, q, sep = ' : ' }: { c: JournalChange; q: string; sep?: string }) {
  return (
    <>
      <Hl text={`${c.label}${sep}`} q={q} />
      {c.before !== null && <><span className="sk-journal-old"><Hl text={c.before} q={q} /></span><span className="sk-journal-arrow">→</span></>}
      <Hl text={c.after ?? '—'} q={q} />
    </>
  );
}

/** Ligne de détail d'une entrée regroupée, comme la maquette : « LEROY Emma (Dojo Marseille) : absente ». */
function DetailLine({ e, q }: { e: JournalEntryView; q: string }) {
  const l = journalDetailLine(e);
  const ofSubject = !!e.data.subject && l.lead === e.data.subject;
  const parts = [
    ...(l.outcome ? [<Hl key="o" text={l.outcome} q={q} />] : []),
    ...l.changes.map((c, i) => <Change key={`c${i}`} c={c} q={q} sep={ofSubject ? ' ' : ' : '} />),
    ...(l.detail ? [<Hl key="d" text={l.detail} q={q} />] : []),
  ];
  return (
    <div data-testid="journal-detail-line">
      <Hl text={l.lead} q={q} />
      {parts.map((p, i) => <span key={i}>{i === 0 && ofSubject ? ' : ' : ' · '}{p}</span>)}
    </div>
  );
}

/** Texte d'une ligne de détail tel qu'affiché, pour savoir si la recherche la touche. */
const detailText = (c: JournalEntryView): string => {
  const l = journalDetailLine(c);
  return [l.lead, l.outcome, ...l.changes.map((x) => `${x.label} ${x.before ?? ''} ${x.after ?? ''}`), l.detail].filter(Boolean).join(' ');
};

function Entry({ e, q, open, onToggle }: { e: JournalEntryView; q: string; open: boolean; onToggle: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const words = normalizeName(q).split(' ').filter(Boolean);
  const { shown, hidden } = visibleDetails(e.children, showAll, (c) => {
    const t = normalizeName(detailText(c));
    return words.length > 0 && words.every((w) => t.includes(w));
  });
  const t = journalText(e);
  const note = receivedNote(e);
  return (
    <div className="sk-journal-ev" data-testid="journal-entry" data-entry-id={e.id} data-raw={e.type === 'non-detaille' || undefined}>
      <div className="sk-journal-time">{hhmm(e.at)}</div>
      <div className="sk-journal-type">
        <i className="sk-journal-dot" style={{ background: `var(--sk-type-${e.type})` }} aria-hidden />
        {JOURNAL_TYPE_LABELS[e.type]}
      </div>
      <div className="sk-journal-what">
        <div className="sk-journal-title" data-testid="journal-title"><Hl text={t.title} q={q} /></div>
        {t.detail && <div className="sk-journal-det"><Hl text={t.detail} q={q} /></div>}
        {t.changes.map((c, i) => <div key={i} className="sk-journal-det"><Change c={c} q={q} /></div>)}
        {note && <div className="sk-journal-det sk-journal-note">{note}</div>}
        {e.children.length > 0 && (
          <>
            <button type="button" className="sk-journal-toggle" aria-expanded={open} onClick={() => { setShowAll(false); onToggle(); }} data-testid="journal-toggle">
              {open ? '▾ Masquer le détail' : '▸ Voir le détail'}
            </button>
            {open && (
              <div className="sk-journal-sub">
                {shown.map((c) => <DetailLine key={c.id} e={c} q={q} />)}
                {hidden > 0 && (
                  <button type="button" className="sk-journal-toggle" onClick={() => setShowAll(true)} data-testid="journal-more">
                    … {plural(hidden, 'autre')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="sk-journal-who">
        <div className="sk-journal-who-name" data-testid="journal-who"><Hl text={actorLabel(e.actor)} q={q} /></div>
        <span className="sk-journal-via" data-testid="journal-via"><Hl text={JOURNAL_VIA_LABELS[e.via]} q={q} /></span>
      </div>
    </div>
  );
}

/**
 * Garde sa place à celui qui lit plus bas quand le fil est relu en direct (de nouvelles entrées arrivent en haut) : la première
 * entrée visible reste où elle était. En haut du fil, rien n'est retenu : les nouvelles entrées apparaissent à l'écran. L'ancrage
 * du navigateur est coupé le temps de la page (il ne fait pas pareil partout), celui-ci le remplace.
 */
function useKeepReaderPlace(entries: JournalEntryView[], feed: RefObject<HTMLDivElement | null>) {
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const firstId = useRef<string | null>(null);
  const capture = useCallback(() => {
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-bar-h')) || 0;
    anchor.current = null;
    for (const el of feed.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []) {
      const r = el.getBoundingClientRect();
      if (r.bottom > bar) {
        anchor.current = { id: el.dataset.entryId!, top: r.top };
        return;
      }
    }
  }, [feed]);
  useEffect(() => {
    const style = document.documentElement.style;
    const before = style.overflowAnchor;
    style.overflowAnchor = 'none';
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      style.overflowAnchor = before;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
    };
  }, [capture]);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (a && a.id !== firstId.current && window.scrollY > 0) {
      const el = feed.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(a.id)}"]`);
      const delta = el ? el.getBoundingClientRect().top - a.top : 0;
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
    }
    firstId.current = entries[0]?.id ?? null;
    capture();
  }, [entries, feed, capture]);
}

/** Charge la page suivante quand le bas du fil approche de l'écran. */
function useLoadMore(sentinel: RefObject<HTMLDivElement | null>, more: boolean, loading: boolean, load: () => void) {
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || loading || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && load(), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel, more, loading, load]);
}

export function JournalPage() {
  const { id = '' } = useParams();
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 250);
  const [types, setTypes] = useState<JournalType[]>([]);
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useJournal(id, { q, types });
  const entries = useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;
  // Dépliées ou repliées à la main ; sinon, ouvertes d'office quand la recherche touche une ligne de détail.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  useEffect(() => setToggled({}), [q]);
  const feed = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useKeepReaderPlace(entries, feed);
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  useLoadMore(sentinel, !!hasNextPage, isFetchingNextPage, loadMore);
  const filtered = q !== '' || types.length > 0;

  return (
    <Stack gap="sm" className="sk-journal">
      <PageHeader title="Journal" summary={data ? plural(total, 'événement') : undefined}
        actions={<span className="sk-journal-live" data-testid="journal-live"><i className="sk-journal-dot" style={{ background: 'var(--sk-ok-text)' }} aria-hidden />en direct</span>} />
      <TextInput type="search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} leftSection={<IconSearch />}
        placeholder="Rechercher : nom, club, catégorie, valeur…" aria-label="Rechercher dans le journal" autoComplete="off" data-testid="journal-search" />
      <Group gap={6} role="group" aria-label="Types" data-testid="journal-types">
        <Text size="xs" c="dimmed" mr={2}>Type :</Text>
        <button type="button" className="sk-journal-chip" aria-pressed={types.length === 0} onClick={() => setTypes([])} style={{ fontWeight: 600 }}>Tous</button>
        {JOURNAL_TYPES.map((t) => (
          <button key={t} type="button" className="sk-journal-chip" aria-pressed={types.includes(t)} onClick={() => setTypes((s) => toggleType(s, t))}>
            <i className="sk-journal-dot" style={{ background: `var(--sk-type-${t})` }} aria-hidden />
            {JOURNAL_TYPE_LABELS[t]}
          </button>
        ))}
      </Group>
      <ApiErrorAlert error={error} />
      <div ref={feed} data-testid="journal-feed">
        {!data ? (
          !error && <Loader size="sm" />
        ) : entries.length === 0 ? (
          <Text c="dimmed" ta="center" p="xl" data-testid="journal-empty">{filtered ? 'Aucun événement ne correspond.' : 'Aucun événement pour l’instant.'}</Text>
        ) : (
          groupByDay(entries).map((g) => (
            <section key={g.day} aria-label={g.day}>
              <div className="sk-journal-day" data-testid="journal-day">{g.day}</div>
              <div className="sk-journal-feed">
                {g.entries.map((e) => {
                  const open = toggled[e.id] ?? e.open;
                  return <Entry key={e.id} e={e} q={q} open={open} onToggle={() => setToggled((s) => ({ ...s, [e.id]: !open }))} />;
                })}
              </div>
            </section>
          ))
        )}
      </div>
      <div ref={sentinel}>
        {hasNextPage && (
          <Group justify="center" p="sm">
            {isFetchingNextPage ? <Loader size="sm" /> : (
              <Button variant="subtle" size="xs" onClick={loadMore} data-testid="journal-more">⋯ la suite se charge en descendant</Button>
            )}
          </Group>
        )}
      </div>
    </Stack>
  );
}
