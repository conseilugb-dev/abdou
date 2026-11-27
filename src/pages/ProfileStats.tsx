import { useEffect, useMemo, useState } from "react";
import { Eye, FileSpreadsheet, FileText } from "lucide-react";
import { supabase } from "../lib/supabase";
import { downloadExcel, downloadPdf, type Sheet } from "../lib/report";

type M = {
  id: string; status: string | null; member_number: string | null; first_name: string; last_name: string; phone: string | null; email: string | null;
  gender: string | null; scholarship: string | null; blood_group: string | null; function_name: string | null; ufr: string | null;
  medical_notes: string | null; study_level: string | null; locality: string | null;
};
type Field = { title: string; order: string[]; keepZero?: boolean; multi?: boolean; get: (m: M) => string };
type Sel = { title: string; label: string; members: M[]; field?: Field };

const SEXES = ["Masculin", "Féminin"];
const BOURSE = ["Oui", "Non"];
const SANG = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const UFRS = ["SAT", "SJP", "SEFS", "SEG", "S2ATA", "CRAC", "IPSL", "2S", "Formation", "LSH", "Autre"];
const NIVEAUX = ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2", "Doctorat 1", "Doctorat 2", "Doctorat 3", "Docteur", "Autre"];
const LOGEMENTS = [
  "HORS CAMPUS", "Village A", "Village B", "Village C", "Village D", "Village E", "Village F", "Village G", "Village H",
  "Village I", "Village J", "Village K", "Village L", "Village M", "Village N", "Village O", "Village P", "Village Q", "DAROUL MOURCHID",
];
const NR = "Non renseigné";

const clean = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
const fixSexe = (v: string) => { const k = key(v); return k === "M" || k === "H" ? "Masculin" : k === "F" ? "Féminin" : v; };
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 1000) / 10 : 0);

const FIELDS: Field[] = [
  { title: "Boursier", order: BOURSE, keepZero: true, get: (m) => clean(m.scholarship) },
  { title: "Sexe", order: SEXES, keepZero: true, get: (m) => fixSexe(clean(m.gender)) },
  { title: "Groupe sanguin", order: SANG, keepZero: true, get: (m) => clean(m.blood_group) },
  { title: "UFR", order: UFRS, get: (m) => clean(m.ufr) },
  { title: "Niveau d'étude", order: NIVEAUX, get: (m) => clean(m.study_level) },
  { title: "Logement au campus", order: LOGEMENTS, get: (m) => clean(m.locality) },
];

const SPLIT = /[,;/+&|]| et /i;
/** Libellés (canoniques) d'un membre pour un champ. Plusieurs pour un champ « multi » (ex. postes CA et CL). */
function labelsOf(m: M, f: Field): string[] {
  const v = f.get(m);
  const parts = !v ? [] : f.multi ? v.split(SPLIT).map(clean).filter(Boolean) : [v];
  if (!parts.length) return [NR];
  const out: string[] = [];
  parts.forEach((p) => { const l = f.order.find((o) => key(o) === key(p)) ?? p; if (!out.includes(l)) out.push(l); });
  return out;
}
const labelOf = (m: M, f: Field) => labelsOf(m, f).join(", ");

function countField(list: M[], f: Field): [string, number][] {
  const tally = new Map<string, number>();
  list.forEach((m) => labelsOf(m, f).forEach((l) => tally.set(l, (tally.get(l) ?? 0) + 1)));
  const known = f.order.filter((o) => f.keepZero || tally.has(o)).map((o) => [o, tally.get(o) ?? 0] as [string, number]);
  const others = [...tally.entries()].filter(([l]) => l !== NR && !f.order.includes(l)).sort((a, b) => b[1] - a[1]);
  const rows = [...known, ...others];
  if (tally.has(NR)) rows.push([NR, tally.get(NR)!]);
  return rows;
}

const FULL_HEAD = ["N° membre", "Nom", "Prénom", "Téléphone", "Email", "Sexe", "Boursier", "Groupe sanguin", "Poste (section de base)", "UFR", "Niveau d'étude", "Logement au campus", "Maladie chronique ou allergies"];
const fullRow = (m: M): string[] => [m.member_number || "", m.last_name, m.first_name, m.phone || "", m.email || "", fixSexe(clean(m.gender)), m.scholarship || "", m.blood_group || "",
  m.function_name || "", m.ufr || "", m.study_level || "", m.locality || "", m.medical_notes || ""];
const PDF_HEAD = ["N° membre", "Nom", "Prénom", "Téléphone", "Sexe", "Boursier", "UFR", "Niveau d'étude", "Logement au campus"];
const pdfRow = (m: M): string[] => [m.member_number || "", m.last_name, m.first_name, m.phone || "", fixSexe(clean(m.gender)), m.scholarship || "", m.ufr || "", m.study_level || "", m.locality || ""];
const byName = (a: M, b: M) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr");

export default function ProfileStats() {
  const [members, setMembers] = useState<M[] | null>(null);
  const [error, setError] = useState("");
  const [statut, setStatut] = useState<"active" | "all">("active");
  const [pop, setPop] = useState<"all" | "Oui" | "Non">("all");
  const [sel, setSel] = useState<Sel | null>(null);

  useEffect(() => {
    (async () => {
      const out: M[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: err } = await supabase.from("members")
          .select("id,status,member_number,first_name,last_name,phone,email,gender,scholarship,blood_group,function_name,ufr,medical_notes,study_level,locality")
          .order("id").range(from, from + 999);
        if (err) { setError(err.message); return; }
        out.push(...((data as unknown as M[]) || []));
        if (!data || data.length < 1000) break;
      }
      setMembers(out);
    })();
  }, []);

  const base = useMemo(() => (members || []).filter((m) => statut === "all" || m.status === "active"), [members, statut]);
  const list = useMemo(() => base.filter((m) => pop === "all" || m.scholarship === pop), [base, pop]);

  const total = list.length;
  const nbBoursiers = base.filter((m) => m.scholarship === "Oui").length;
  const nbNon = base.filter((m) => m.scholarship === "Non").length;
  const nbNR = base.length - nbBoursiers - nbNon;

  const fields = useMemo(() => FIELDS.filter((f) => pop === "all" || f.title !== "Boursier"), [pop]);
  const popLabel = pop === "all" ? "Tous les membres" : pop === "Oui" ? "Boursiers" : "Non boursiers";
  const filePart = pop === "all" ? "tous" : pop === "Oui" ? "boursiers" : "non-boursiers";

  const open = (title: string, label: string, pred: (m: M) => boolean) => setSel({ title, label, members: list.filter(pred).sort(byName) });
  const openAll = (f: Field) => {
    const order = countField(list, f).map(([l]) => l);
    const sorted = [...list].sort((a, b) => order.indexOf(labelsOf(a, f)[0]) - order.indexOf(labelsOf(b, f)[0]) || byName(a, b));
    setSel({ title: f.title, label: "toutes les valeurs", members: sorted, field: f });
  };
  const openField = (f: Field, label: string) => open(f.title, label, (m) => labelsOf(m, f).includes(label));

  // --- Exports ---
  function summarySheets(): Sheet[] {
    const s: Sheet[] = [{
      name: "Résumé", head: ["Indicateur", "Effectif", "%"],
      rows: [[`Population : ${popLabel}`, total, 100], ["Boursiers (tous membres)", nbBoursiers, pct(nbBoursiers, base.length)],
        ["Non boursiers", nbNon, pct(nbNon, base.length)], ["Boursier non renseigné", nbNR, pct(nbNR, base.length)]],
    }];
    fields.forEach((f) => s.push({ name: f.title.slice(0, 30), head: [f.title, "Effectif", "%"], rows: countField(list, f).map(([l, n]) => [l, n, pct(n, total)]) }));
    return s;
  }
  /** Liste complète des membres, regroupés par valeur du champ. */
  function fieldListSheet(f: Field): Sheet {
    const rows: (string | number)[][] = [];
    countField(list, f).forEach(([label]) => list.filter((m) => labelsOf(m, f).includes(label)).sort(byName).forEach((m) => rows.push([label, ...fullRow(m)])));
    return { name: "Liste", head: [f.title, ...FULL_HEAD], rows };
  }
  function selSheets(kind: "xlsx" | "pdf"): Sheet[] {
    if (!sel) return [];
    const f = sel.field;
    const head = kind === "xlsx" ? FULL_HEAD : PDF_HEAD, row = kind === "xlsx" ? fullRow : pdfRow;
    return [{ name: "Liste", head: f ? [f.title, ...head] : head, rows: sel.members.map((m) => (f ? [labelOf(m, f), ...row(m)] : row(m))) }];
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!members) return <div className="center-screen">Chargement…</div>;

  const Bars = ({ rows, onPick }: { rows: [string, number][]; onPick: (label: string) => void }) => {
    const max = Math.max(1, ...rows.map(([, n]) => n));
    return (
      <table>
        <thead><tr><th>Valeur</th><th style={{ width: 70 }}>Effectif</th><th style={{ width: 70 }}>%</th><th style={{ width: "34%" }}></th></tr></thead>
        <tbody>{rows.map(([l, n]) => (
          <tr key={l} onClick={n ? () => onPick(l) : undefined} style={{ cursor: n ? "pointer" : "default" }} title={n ? "Voir la liste" : ""}>
            <td>{l}</td><td><strong>{n}</strong></td><td>{pct(n, total)}%</td>
            <td><div style={{ background: "var(--line)", borderRadius: 6, height: 10, overflow: "hidden" }}>
              <div style={{ width: `${(n / max) * 100}%`, height: "100%", background: l === NR ? "#b5aaa4" : "var(--brand)", borderRadius: 6, transition: "width .5s ease" }} />
            </div></td>
          </tr>))}</tbody>
      </table>
    );
  };

  return (
    <>
      <div className="att-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 14, gap: 12 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div className="type-tabs" style={{ margin: 0 }}>
            {([["all", "Tous les membres"], ["Oui", "Boursiers"], ["Non", "Non boursiers"]] as const).map(([v, l]) => (
              <button key={v} className={`type-tab ${pop === v ? "on" : ""}`} onClick={() => setPop(v)}>{l}</button>))}
          </div>
          <div className="type-tabs" style={{ margin: 0 }}>
            {([["active", "Actifs"], ["all", "Actifs + inactifs"]] as const).map(([v, l]) => (
              <button key={v} className={`type-tab ${statut === v ? "on" : ""}`} onClick={() => setStatut(v)}>{l}</button>))}
          </div>
        </div>
        <div className="att-actions">
          <button className="secondary" onClick={() => downloadExcel(`profil-membres-${filePart}`, summarySheets())}><FileSpreadsheet size={18} /> Statistiques Excel</button>
          <button className="secondary" onClick={() => downloadPdf(`profil-membres-${filePart}`, `Profil des membres — ${popLabel}`, summarySheets())}><FileText size={18} /> PDF</button>
        </div>
      </div>

      <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 14 }}>Clique sur une ligne pour voir la liste des membres et la télécharger.</p>

      <div className="stats-grid">
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => open("Population", popLabel, () => true)}><div><span>Effectif : {popLabel}</span><strong>{total}</strong></div></div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setSel({ title: "Boursier", label: "Oui", members: base.filter((m) => m.scholarship === "Oui").sort(byName) })}><div><span>Boursiers</span><strong>{nbBoursiers} ({pct(nbBoursiers, base.length)}%)</strong></div></div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setSel({ title: "Boursier", label: "Non", members: base.filter((m) => m.scholarship === "Non").sort(byName) })}><div><span>Non boursiers</span><strong>{nbNon} ({pct(nbNon, base.length)}%)</strong></div></div>
        <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setSel({ title: "Boursier", label: NR, members: base.filter((m) => m.scholarship !== "Oui" && m.scholarship !== "Non").sort(byName) })}><div><span>Boursier non renseigné</span><strong>{nbNR}</strong></div></div>
      </div>

      {!total && <div className="panel"><div className="empty">Aucun membre dans cette sélection.</div></div>}

      {!!total && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 16 }}>
          {fields.map((f) => (
            <div className="panel table-wrap" key={f.title}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{f.title}{f.multi && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> (plusieurs possibles)</span>}</h2>
                <div className="att-actions">
                  <button className="secondary" title="Voir toutes les listes" onClick={() => openAll(f)}><Eye size={16} /> Voir</button>
                  <button className="secondary" title="Télécharger toutes les listes (Excel)" onClick={() => downloadExcel(`liste-${slug(f.title)}-${filePart}`, [fieldListSheet(f)])}><FileSpreadsheet size={16} /> Listes</button>
                  <button className="secondary" title="Télécharger toutes les listes (PDF)" onClick={() => { const s = fieldListSheet(f); downloadPdf(`liste-${slug(f.title)}-${filePart}`, `${f.title} — ${popLabel}`, [{ name: "Liste", head: [f.title, ...PDF_HEAD], rows: s.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[10], r[11], r[12]]) }]); }}><FileText size={16} /></button>
                </div>
              </div>
              <Bars rows={countField(list, f)} onPick={(l) => openField(f, l)} />
            </div>))}
        </div>)}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" style={{ width: "min(900px,100%)", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>{sel.title} : {sel.label}</h2>
                <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>{sel.members.length} membre(s) — {popLabel}</div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSel(null)}>×</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th>{sel.field && <th>{sel.field.title}</th>}<th>N°</th><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>UFR</th><th>Niveau</th><th>Logement</th></tr></thead>
                <tbody>{sel.members.map((m, i) => (
                  <tr key={m.id}><td>{i + 1}</td>{sel.field && <td><strong>{labelOf(m, sel.field)}</strong></td>}<td>{m.member_number}</td><td>{m.last_name}</td><td>{m.first_name}</td><td>{m.phone}</td><td>{m.ufr}</td><td>{m.study_level}</td><td>{m.locality}</td></tr>))}</tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => downloadExcel(`liste-${slug(sel.title)}-${slug(sel.label)}`, selSheets("xlsx"))}><FileSpreadsheet size={18} /> Excel</button>
              <button className="secondary" onClick={() => downloadPdf(`liste-${slug(sel.title)}-${slug(sel.label)}`, `${sel.title} : ${sel.label} (${sel.members.length})`, selSheets("pdf"))}><FileText size={18} /> PDF</button>
              <button className="primary" onClick={() => setSel(null)}>Fermer</button>
            </div>
          </div>
        </div>)}
    </>
  );
}
