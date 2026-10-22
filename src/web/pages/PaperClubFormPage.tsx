import '../print.css';
import { Button, Group } from '@mantine/core';
import { useParams } from 'react-router';
import { ageBandAbbreviations, CLUB_FORM_TITLE } from '../../domain/club-form.js';
import { useCompetition, useGrid } from '../api.js';
import { HelpText } from '../components/Help.js';

const ROWS = 10;
const frDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* Dimensions en millimètres : la feuille fait 277 × 190 mm (A4 paysage moins 1 cm de marge) et ne doit jamais déborder. */
const CSS = `
.pf { width: 277mm; height: 190mm; margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column; color: #000; background: #fff;
  font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; overflow: hidden; }
.pf-head { display: flex; align-items: center; gap: 4mm; min-height: 20mm; flex: none; }
.pf-head img { width: 18mm; height: 18mm; }
.pf-title { flex: 1; border: 0.8mm solid #000; text-align: center; padding: 1mm 3mm; min-height: 18mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }
.pf-title b { font-size: 15pt; letter-spacing: 0.2mm; line-height: 1.15; }
.pf-title span { font-size: 9pt; line-height: 1.25; }
.pf-fields { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 1.5mm 3mm; margin-top: 3mm; flex: none; }
.pf-box { border: 0.25mm solid #666; height: 7mm; padding: 0 2mm; display: flex; align-items: center; box-sizing: border-box; font-weight: 700; white-space: nowrap; }
.pf table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm; }
.pf th { border: 0.3mm solid #333; background: #f2f2f2; font-size: 8.5pt; line-height: 1.15; padding: 0.6mm 0.8mm; vertical-align: bottom; }
.pf th.sub { font-weight: 400; font-style: italic; font-size: 7.5pt; vertical-align: middle; }
.pf td { border: 0.25mm solid #777; height: 11.5mm; padding: 0 1mm; font-size: 8.5pt; vertical-align: middle; overflow: hidden; }
.pf .opts { white-space: nowrap; line-height: 1.55; }
.pf .ck { display: inline-block; width: 2.8mm; height: 2.8mm; border: 0.3mm solid #222; vertical-align: -0.5mm; margin: 0 0.6mm 0 1.2mm; box-sizing: border-box; }
.pf .num { display: inline-block; width: 3.6mm; height: 3.6mm; border: 0.3mm solid #222; vertical-align: -1mm; margin: 0 0.6mm 0 1mm; box-sizing: border-box; }
.pf .ages { display: grid; column-gap: 0.8mm; font-size: 8pt; line-height: 1.6; }
.pf .ages.dense { font-size: 7pt; line-height: 1.3; }
.pf .ages > span { white-space: nowrap; }
.pf .ages .ck { margin-left: 0; }
.pf-foot { margin-top: auto; padding-top: 1.5mm; font-size: 8pt; line-height: 1.35; flex: none; display: flex; gap: 4mm; align-items: flex-end; }
.pf-foot .page { flex: none; font-weight: 700; white-space: nowrap; }
@media screen { .pf { box-shadow: 0 0 0 1px #ccc; } }
`;

const Ck = ({ label }: { label: string }) => (
  <>
    <span className="ck" />
    {label}{' '}
  </>
);
const Num = ({ label }: { label: string }) => (
  <>
    <span className="num" />
    {label}{' '}
  </>
);

/** Fiche de pré-inscription à imprimer et remplir à la main (cases à cocher), une page A4 paysage. */
export function PaperClubFormPage() {
  const { id = '' } = useParams();
  const { data: competition } = useCompetition(id);
  const { data: grid } = useGrid(id);
  if (!competition || !grid) return null;
  const bands = grid.ageBands.filter((b) => b.onClubForm);
  const subtitle = [competition.name, frDate(competition.date), competition.location].filter(Boolean).join(' — ');
  const abbreviations = ageBandAbbreviations(bands);
  const legend = bands
    .map((b) => {
      const abbr = abbreviations.get(b.code)!;
      const ages = b.maxAge === null ? `${b.minAge}+` : `${b.minAge}-${b.maxAge}`;
      // « V1 (35-45) » : le libellé n'apporte rien quand l'abréviation le contient déjà.
      return /^V\d$/.test(abbr) ? `${abbr} (${ages})` : `${abbr} ${b.label.toLowerCase()} (${ages})`;
    })
    .join(' · ');
  // Au-delà de 12 tranches, trois rangées plus serrées pour garder chaque case lisible.
  const ageRows = bands.length > 12 ? 3 : 2;
  const ageColumns = Math.ceil(bands.length / ageRows);
  return (
    <div className="print-root">
      <style>{CSS}</style>
      <Group className="no-print" mb="md">
        <Button onClick={() => window.print()}>Imprimer</Button>
        <HelpText topic="impression" />
      </Group>
      <div className="pf" data-testid="paper-form">
        <div className="pf-head">
          <img src="/shidokan-france-logo.webp" alt="" />
          <div className="pf-title"><b>{CLUB_FORM_TITLE.replace(/ CLUB$/, '')}</b><span data-testid="paper-subtitle">{subtitle}</span></div>
          <img src="/shidokan-france-logo.webp" alt="" />
        </div>
        <div className="pf-fields">
          <div className="pf-box">Club :</div><div className="pf-box">Coach :</div><div className="pf-box">Téléphone :</div>
          <div className="pf-box">E-mail :</div>
          <div className="pf-box" style={{ gridColumn: 'span 2' }}>
            Le coach accepte d’avance les reclassements de ses combattants :&nbsp;<span style={{ fontWeight: 400 }}><Ck label="Oui" /><Ck label="Non" /></span>
          </div>
        </div>
        <table>
          <colgroup>
            {[10.5, 9, 4.5, 18.5, 5.5, 15.5, 6, 6.5, 10.5, 13.5].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Nom</th><th rowSpan={2}>Prénom</th><th rowSpan={2}>Sexe</th><th>Catégorie d’âge</th>
              <th rowSpan={2}>Poids actuel (kg)</th><th>Disciplines</th><th rowSpan={2}>Grade (si kata)</th><th>Règlement</th>
              <th>Si reclassement</th><th>Shobu : si reclassement, garder en priorité</th>
            </tr>
            <tr>
              <th className="sub">une seule case</th><th className="sub">kata et/ou une discipline de combat</th><th className="sub">combat</th>
              <th className="sub">autres disciplines, numéroter 1, 2</th><th className="sub">une seule case</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r} data-testid="paper-form-row">
                <td /><td />
                <td className="opts"><Ck label="F" /><br /><Ck label="M" /></td>
                <td>
                  <div className={ageRows > 2 ? 'ages dense' : 'ages'} style={{ gridTemplateColumns: `repeat(${ageColumns}, max-content)` }}>
                    {bands.map((b) => (
                      <span key={b.code} data-testid="paper-age-item"><span className="ck" /><span data-testid="paper-age">{abbreviations.get(b.code)}</span></span>
                    ))}
                  </div>
                </td>
                <td />
                <td className="opts"><Ck label="Karaté" /><Ck label="Boxing" /><Ck label="Mix" /><br /><Ck label="Triathlon" /><Ck label="Kata" /></td>
                <td />
                <td className="opts"><Ck label="Jiyu" /><br /><Ck label="Shobu" /></td>
                <td className="opts"><Num label="Karaté" /><Num label="Box." /><br /><Num label="Mix" /></td>
                <td className="opts"><Ck label="1. les règles shobu" /><br /><Ck label="2. la discipline" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pf-foot">
          <div>
            <b>Âges :</b> {legend}.<br />
            <b>Shobu, garder en priorité :</b> « les règles shobu » = changer de discipline plutôt que passer en jiyu ; « la discipline » = passer en jiyu plutôt que changer de discipline. Boxing = shido-boxing, Mix = shido-mix martial.
          </div>
          <span className="page">Page …… / ……</span>
        </div>
      </div>
    </div>
  );
}
