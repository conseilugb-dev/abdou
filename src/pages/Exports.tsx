import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useBranding } from "../lib/branding";
import { TYPE_ORDER } from "../lib/stats";
import {
  REPORTS, buildReport, loadExportData, writeExcel, writePdf,
  type ExportData, type ReportKind, type RMember, type RSheet, type Report,
} from "../lib/exportReports";

const MEMBER_FILTER_FIELDS = [
  ["first_name", "Prénom"], ["last_name", "Nom"], ["email", "E-mail"],
  ["phone", "Téléphone"], ["locality", "Adresse"], ["function_name", "Fonction"], ["ufr", "UFR"],
] as const;
type MemberFilters = Record<(typeof MEMBER_FILTER_FIELDS)[number][0], string> & { status: "" | "active" | "inactive" };
const EMPTY_MF: MemberFilters = { first_name: "", last_name: "", email: "", phone: "", locality: "", function_name: "", ufr: "", status: "" };
const fold = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Une erreur inattendue est survenue.");

/** Retire les colonnes décochées d'une feuille (en gardant totaux et couleurs alignés). */
function applyCols(s: RSheet, hidden: number[]): RSheet {
  if (!hidden.length || s.kv || s.matrix) return s;
  const keep = s.head.map((_, i) => i).filter((i) => !hidden.includes(i));
  if (!keep.length || keep.length === s.head.length) return s;
  return {
    ...s,
    head: keep.map((i) => s.head[i]),
    rows: s.rows.map((r) => keep.map((i) => r[i])),
    totals: s.totals ? keep.map((i) => s.totals![i]) : undefined,
    statusCols: s.statusCols?.map((c) => keep.indexOf(c)).filter((c) => c >= 0),
  };
}

export default function Exports() {
  const brand = useBranding();
  const [kind, setKind] = useState<ReportKind>("synthese");
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeUnmarked, setIncludeUnmarked] = useState(false);
  const [mf, setMf] = useState<MemberFilters>(EMPTY_MF);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [offSheets, setOffSheets] = useState<string[]>([]);              // feuilles décochées
  const [offCols, setOffCols] = useState<Record<string, number[]>>({});  // colonnes décochées par feuille

  const loadData = async () => {
    setLoading(true); setError(""); setNotice("");
    try { setData(await loadExportData()); }
    catch (e) { setError(`Impossible de charger les données. Vérifie la connexion Supabase et les autorisations. ${errorText(e)}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadData(); }, []);

  const memberFiltersActive = mf.status !== "" || MEMBER_FILTER_FIELDS.some(([key]) => mf[key].trim() !== "");
  const memberFilter = useMemo(() => {
    if (!memberFiltersActive) return undefined;
    return (m: RMember) => {
      if (mf.status && m.status !== mf.status) return false;
      return MEMBER_FILTER_FIELDS.every(([key]) => {
        const wanted = fold(mf[key]);
        if (!wanted) return true;
        if (key === "phone") return String(m.phone ?? "").replace(/\s/g, "").includes(wanted.replace(/\s/g, ""));
        return fold((m as unknown as Record<string, unknown>)[key]).includes(wanted);
      });
    };
  }, [memberFiltersActive, mf]);

  const rawReport = useMemo(
    () => (data ? buildReport(kind, data, { from, to, type, includeInactive, includeUnmarked, memberFilter }) : null),
    [data, kind, from, to, type, includeInactive, includeUnmarked, memberFilter],
  );
  // Rapport réellement exporté : uniquement les feuilles et colonnes choisies
  const report: Report | null = useMemo(() => {
    if (!rawReport) return null;
    const sheets = rawReport.sheets.filter((s) => !offSheets.includes(s.name)).map((s) => applyCols(s, offCols[s.name] ?? []));
    return { ...rawReport, sheets };
  }, [rawReport, offSheets, offCols]);
  const toggleSheet = (name: string) => setOffSheets((o) => (o.includes(name) ? o.filter((n) => n !== name) : [...o, name]));
  const toggleCol = (sheet: string, i: number) => setOffCols((c) => {
    const cur = c[sheet] ?? [];
    return { ...c, [sheet]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] };
  });
  const types = useMemo(() => {
    const extra = (data?.types ?? []).map((t) => t.name).filter((n) => !TYPE_ORDER.includes(n));
    return [...TYPE_ORDER, ...extra];
  }, [data]);

  const hasData = !!report && report.sheets.some((s) => s.rows.length > 0);
  const preview = report ? (report.sheets[Math.min(sheetIdx, report.sheets.length - 1)] ?? null) : null;
  const current = REPORTS.find((r) => r.id === kind)!;
  const brandInfo = { org: brand.organization_name, section: brand.section, conseil: brand.conseil, comite: brand.comite, logo: brand.logo_url };

  const exportExcel = () => {
    if (!report) return;
    setError(""); setNotice("");
    if (!report.sheets.length) { setError("Coche au moins une feuille à exporter."); return; }
    if (!hasData) { setError("Aucune donnée à exporter pour cette sélection."); return; }
    try { writeExcel(report, brand.organization_name); setNotice(`Le fichier Excel « ${report.title} » a été généré (${report.sheets.length} feuille(s)).`); }
    catch (e) { setError(errorText(e)); }
  };
  const exportPdf = async () => {
    if (!report) return;
    setError(""); setNotice("");
    if (!report.sheets.length) { setError("Coche au moins une feuille à exporter."); return; }
    if (!hasData) { setError("Aucune donnée à exporter pour cette sélection."); return; }
    setBusy("pdf");
    try { await writePdf(report, brandInfo); setNotice(`Le rapport PDF « ${report.title} » a été généré.`); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(""); }
  };

  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const setRange = (k: "month" | "lastMonth" | "year" | "30" | "all") => {
    const n = new Date();
    if (k === "all") { setFrom(""); setTo(""); return; }
    if (k === "month") { setFrom(iso(new Date(n.getFullYear(), n.getMonth(), 1))); setTo(iso(new Date(n.getFullYear(), n.getMonth() + 1, 0))); }
    if (k === "lastMonth") { setFrom(iso(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setTo(iso(new Date(n.getFullYear(), n.getMonth(), 0))); }
    if (k === "year") { setFrom(iso(new Date(n.getFullYear(), 0, 1))); setTo(iso(new Date(n.getFullYear(), 11, 31))); }
    if (k === "30") { setFrom(iso(new Date(n.getTime() - 30 * 86400000))); setTo(iso(n)); }
  };
  const showDates = kind !== "members";
  const showType = kind !== "members";

  return <>
    <PageHeader title="Exports Excel / PDF" description="Rapports détaillés avec statistiques, taux de présence, absences et détail par membre et par activité." />
    <div className="panel">
      <div className="type-tabs" style={{ marginBottom: 6 }}>
        {REPORTS.map((r) => (
          <button key={r.id} type="button" className={`type-tab${kind === r.id ? " on" : ""}`}
            onClick={() => { setKind(r.id); setNotice(""); setError(""); setSheetIdx(0); setOffSheets([]); setOffCols({}); }}>{r.label}</button>
        ))}
      </div>
      <p className="muted" style={{ margin: "8px 0 16px" }}>{current.desc}</p>

      <div className="form-grid">
        {showDates && <>
          <label>Date de début (facultatif)<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Date de fin (facultatif)<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
        {showType && (
          <label>Type d'activité
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        {kind === "members" && <>
          {MEMBER_FILTER_FIELDS.map(([key, text]) => (
            <label key={key}>{text} (filtre)
              <input value={mf[key]} placeholder="Contient…" onChange={(e) => setMf({ ...mf, [key]: e.target.value })} />
            </label>
          ))}
          <label>Statut
            <select value={mf.status} onChange={(e) => setMf({ ...mf, status: e.target.value as MemberFilters["status"] })}>
              <option value="">Tous</option><option value="active">Actif</option><option value="inactive">Inactif</option>
            </select>
          </label>
        </>}
      </div>

      {showDates && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>Raccourcis :</span>
          {([["month", "Ce mois"], ["lastMonth", "Mois dernier"], ["30", "30 derniers jours"], ["year", "Cette année"], ["all", "Toutes les dates"]] as const).map(([k, l]) => (
            <button key={k} type="button" className="secondary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
      )}

      {kind !== "members" && (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} style={{ width: "auto" }} />
            Inclure les anciens membres (inactifs)
          </label>
          {(kind === "attendance" || kind === "synthese") && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={includeUnmarked} onChange={(e) => setIncludeUnmarked(e.target.checked)} style={{ width: "auto" }} />
              Lister aussi les absents non marqués (fichier plus long)
            </label>
          )}
        </div>
      )}

      {rawReport && rawReport.sheets.length > 0 && (
        <div style={{ marginTop: 18, padding: 16, border: "1px solid var(--line)", borderRadius: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Que veux-tu exporter ?</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setOffSheets([])}>Tout cocher</button>
              <button type="button" className="secondary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setOffSheets(rawReport.sheets.map((x) => x.name))}>Tout décocher</button>
              <button type="button" className="secondary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => { setOffSheets([]); setOffCols({}); }}>Réinitialiser</button>
            </div>
          </div>
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Coche les feuilles voulues. Ouvre « Colonnes » pour choisir les colonnes à garder dans une feuille.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
            {rawReport.sheets.map((sh) => {
              const on = !offSheets.includes(sh.name);
              const hidden = offCols[sh.name] ?? [];
              const canPick = !sh.kv && !sh.matrix && sh.head.length > 1;
              return (
                <div key={sh.name} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", opacity: on ? 1 : 0.55 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                    <input type="checkbox" checked={on} onChange={() => toggleSheet(sh.name)} style={{ width: "auto" }} />
                    <span style={{ flex: 1 }}>{sh.name}</span>
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{sh.rows.length} ligne(s)</span>
                  </label>
                  {canPick && on && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--brand)" }}>Colonnes ({sh.head.length - hidden.length}/{sh.head.length})</summary>
                      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
                        <button type="button" className="secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOffCols((c) => ({ ...c, [sh.name]: [] }))}>Toutes</button>
                        <button type="button" className="secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOffCols((c) => ({ ...c, [sh.name]: sh.head.map((_, i) => i).slice(1) }))}>Seulement la 1re</button>
                      </div>
                      <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                        {sh.head.map((h, i) => (
                          <label key={`${h}-${i}`} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                            <input type="checkbox" checked={!hidden.includes(i)} onChange={() => toggleCol(sh.name, i)} style={{ width: "auto" }} />
                            {h}
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="toolbar" style={{ marginTop: 18, flexWrap: "wrap" }}>
        <button className="primary" onClick={exportExcel} disabled={loading || !!busy || !report || !report.sheets.length}><FileSpreadsheet size={17} /> Exporter en Excel (.xlsx)</button>
        <button className="secondary" onClick={() => void exportPdf()} disabled={loading || !!busy || !report || !report.sheets.length}><FileText size={17} /> {busy === "pdf" ? "Génération…" : "Exporter en PDF"}</button>
        <button className="secondary" onClick={() => void loadData()} disabled={loading || !!busy}><RefreshCw size={17} /> {loading ? "Chargement…" : "Actualiser les données"}</button>
        {kind === "members" && memberFiltersActive && <button type="button" className="secondary" onClick={() => setMf(EMPTY_MF)}>Réinitialiser les filtres</button>}
      </div>
      {error && <p role="alert" className="error-text" style={{ marginTop: 14 }}>{error}</p>}
      {notice && <p role="status" className="success-text" style={{ marginTop: 14 }}>{notice}</p>}
    </div>

    {report && <div className="panel" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Aperçu de ce qui sera exporté</h3>
      <p className="muted" style={{ margin: "0 0 12px" }}>{report.filters.join("  ·  ")}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {report.kpis.map(([label, value]) => (
          <div key={label} style={{ background: "var(--brand-tint)", borderRadius: 12, padding: "10px 16px", minWidth: 110, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>{value}</div>
            <div className="muted" style={{ fontSize: 12 }}>{label}</div>
          </div>
        ))}
      </div>
      {!report.sheets.length && <p className="muted">Aucune feuille cochée.</p>}
      {report.sheets.length > 0 && <>
        <div className="type-tabs" style={{ marginBottom: 10 }}>
          {report.sheets.map((sh, i) => (
            <button key={sh.name} type="button" className={`type-tab${Math.min(sheetIdx, report.sheets.length - 1) === i ? " on" : ""}`} onClick={() => setSheetIdx(i)}>{sh.name} ({sh.rows.length})</button>
          ))}
        </div>
        {preview && preview.rows.length > 0 && <>
          <p className="muted" style={{ margin: "0 0 6px" }}>{preview.title} — {preview.rows.length} ligne(s), aperçu des 8 premières :</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr>{preview.head.map((h, i) => <th key={`${h}-${i}`}>{h}</th>)}</tr></thead>
              <tbody>{preview.rows.slice(0, 8).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>}
      </>}
      {!hasData && !loading && report.sheets.length > 0 && <p className="muted">Aucune donnée pour cette sélection.</p>}
      <p className="muted" style={{ marginTop: 14 }}>
        Données chargées : {data?.members.length ?? 0} membres · {data?.activities.length ?? 0} activités · {data?.attendance.length ?? 0} lignes de présence.
        Un membre sans ligne de présence dans une activité dont l'appel a été fait est compté absent. Les exports sont générés dans ton navigateur.
      </p>
    </div>}
  </>;
}