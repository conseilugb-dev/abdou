import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import PageHeader from "../components/PageHeader";
import { supabase } from "../lib/supabase";

type MemberRow = {
  member_number: string; first_name: string; last_name: string; email: string | null;
  phone: string | null; locality: string | null; function_name: string | null; status: string;
};
type ActivityRow = {
  name: string; description: string | null; location: string | null; start_datetime: string;
  end_datetime: string | null; status: string;
};
type AttendanceRow = {
  status: string; method: string; check_in_at: string | null;
  members: { member_number: string; first_name: string; last_name: string; phone: string | null } | null;
  activities: { name: string; start_datetime: string } | null;
};
type ExportKind = "members" | "activities" | "attendance";

const dateText = (value?: string | null) => value ? new Date(value).toLocaleString("fr-FR") : "—";
const MEMBER_FILTER_FIELDS = [
  ["first_name", "Prénom"], ["last_name", "Nom"], ["email", "E-mail"],
  ["phone", "Téléphone"], ["locality", "Localité"], ["function_name", "Fonction"],
] as const;
type MemberFilters = Record<(typeof MEMBER_FILTER_FIELDS)[number][0], string> & { status: "" | "active" | "inactive" };
const EMPTY_MEMBER_FILTERS: MemberFilters = {
  first_name: "", last_name: "", email: "", phone: "", locality: "", function_name: "", status: "",
};
// Comparaison sans accents ni majuscules
const fold = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const errorText = (error: unknown) => error instanceof Error ? error.message : "Une erreur inattendue est survenue.";

export default function Exports() {
  const [kind, setKind] = useState<ExportKind>("attendance");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mf, setMf] = useState<MemberFilters>(EMPTY_MEMBER_FILTERS);

  const loadData = async () => {
    setLoading(true); setError(""); setNotice("");
    try {
      const [m, a, p] = await Promise.all([
        supabase.from("members").select("member_number,first_name,last_name,email,phone,locality,function_name,status").order("last_name"),
        supabase.from("activities").select("name,description,location,start_datetime,end_datetime,status").order("start_datetime", { ascending: false }),
        supabase.from("attendance").select("status,method,check_in_at,members(member_number,first_name,last_name,phone),activities(name,start_datetime)").order("created_at", { ascending: false }),
      ]);
      if (m.error) throw m.error;
      if (a.error) throw a.error;
      if (p.error) throw p.error;
      setMembers((m.data ?? []) as MemberRow[]);
      setActivities((a.data ?? []) as ActivityRow[]);
      setAttendance((p.data ?? []) as unknown as AttendanceRow[]);
    } catch (e) { setError(`Impossible de charger les données. Vérifie la connexion Supabase et les autorisations RLS. ${errorText(e)}`); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredAttendance = useMemo(() => attendance.filter(row => {
    const value = row.activities?.start_datetime;
    if (!value) return !from && !to;
    const day = value.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  }), [attendance, from, to]);

  const filteredMembers = useMemo(() => members.filter(m => {
    if (mf.status && m.status !== mf.status) return false;
    return MEMBER_FILTER_FIELDS.every(([key]) => {
      const wanted = fold(mf[key]);
      if (!wanted) return true;
      const value = key === "phone" ? String(m.phone ?? "").replace(/\s/g, "") : fold(m[key]);
      return key === "phone" ? value.includes(wanted.replace(/\s/g, "")) : value.includes(wanted);
    });
  }), [members, mf]);
  const memberFiltersActive = mf.status !== "" || MEMBER_FILTER_FIELDS.some(([key]) => mf[key].trim() !== "");

  const getRows = () => {
    if (kind === "members") return filteredMembers.map(m => ({
      "Prénom": m.first_name, "Nom": m.last_name,
      "E-mail": m.email ?? "", "Téléphone": m.phone ?? "", "Localité": m.locality ?? "",
      "Fonction": m.function_name ?? "", "Statut": m.status === "active" ? "Actif" : "Inactif",
    }));
    if (kind === "activities") return activities.map(a => ({
      "Activité": a.name, "Description": a.description ?? "", "Lieu": a.location ?? "",
      "Date de début": dateText(a.start_datetime), "Date de fin": dateText(a.end_datetime), "Statut": a.status,
    }));
    // Tri : par activité (récente d'abord), puis par ordre de scan (heure d'arrivée croissante)
    const sorted = [...filteredAttendance].sort((a, b) => {
      const da = a.activities?.start_datetime ?? "", db = b.activities?.start_datetime ?? "";
      if (da !== db) return db.localeCompare(da);
      const ta = a.check_in_at, tb = b.check_in_at;
      if (ta && tb) return ta.localeCompare(tb);
      if (ta) return -1;
      if (tb) return 1;
      return (a.members?.last_name ?? "").localeCompare(b.members?.last_name ?? "", "fr");
    });
    const counters: Record<string, number> = {};
    return sorted.map(p => ({
      "Ordre": p.check_in_at ? (counters[p.activities?.start_datetime ?? ""] = (counters[p.activities?.start_datetime ?? ""] ?? 0) + 1) : "",
      "Activité": p.activities?.name ?? "Activité supprimée", "Date activité": dateText(p.activities?.start_datetime),
      "Prénom": p.members?.first_name ?? "",
      "Nom": p.members?.last_name ?? "", "Téléphone": p.members?.phone ?? "",
      "Présence": p.status, "Méthode": p.method === "qr" ? "QR Code" : "Manuelle", "Enregistrée le": dateText(p.check_in_at),
    }));
  };

  const label = kind === "members" ? "Membres" : kind === "activities" ? "Activités" : "Présences";
  const exportExcel = () => {
    setError(""); setNotice("");
    const rows = getRows();
    if (!rows.length) { setError("Aucune donnée à exporter pour cette sélection."); return; }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = Object.keys(rows[0]).map(key => ({ wch: Math.min(Math.max(key.length + 4, 14), 32) }));
    XLSX.utils.book_append_sheet(workbook, sheet, label);
    XLSX.writeFile(workbook, `moustarchidine-junior-${kind}-${new Date().toISOString().slice(0,10)}.xlsx`);
    setNotice(`Le fichier Excel « ${label} » a été généré.`);
  };

  const exportPdf = () => {
    setError(""); setNotice("");
    const rows = getRows();
    if (!rows.length) { setError("Aucune donnée à exporter pour cette sélection."); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(16); doc.text("Moustarchidine Junior", 14, 15);
    doc.setFontSize(11); doc.text(`Rapport : ${label}`, 14, 22);
    doc.setFontSize(9); doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, 14, 28);
    const columns = Object.keys(rows[0]);
    const body = rows.map(row => columns.map(column => String((row as unknown as Record<string, unknown>)[column] ?? "—")));
    autoTable(doc, { startY: 34, head: [columns], body, styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [22, 101, 52] }, margin: { left: 10, right: 10 } });
    doc.save(`moustarchidine-junior-${kind}-${new Date().toISOString().slice(0,10)}.pdf`);
    setNotice(`Le rapport PDF « ${label} » a été généré.`);
  };

  return <>
    <PageHeader title="Exports Excel / PDF" description="Télécharge des rapports à partir des données enregistrées dans Supabase." />
    <div className="panel">
      <div className="form-grid">
        <label>Type de rapport
          <select value={kind} onChange={e => { setKind(e.target.value as ExportKind); setNotice(""); setError(""); }}>
            <option value="attendance">Présences</option><option value="members">Membres</option><option value="activities">Activités</option>
          </select>
        </label>
        {kind === "members" && <>
          {MEMBER_FILTER_FIELDS.map(([key, text]) => (
            <label key={key}>{text} (filtre)
              <input value={mf[key]} placeholder={`Contient…`} onChange={e => setMf({ ...mf, [key]: e.target.value })} />
            </label>
          ))}
          <label>Statut
            <select value={mf.status} onChange={e => setMf({ ...mf, status: e.target.value as MemberFilters["status"] })}>
              <option value="">Tous</option><option value="active">Actif</option><option value="inactive">Inactif</option>
            </select>
          </label>
        </>}
        {kind === "attendance" && <>
          <label>Date de début (facultatif)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>Date de fin (facultatif)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </>}
      </div>
      <div className="toolbar" style={{ marginTop: 18, flexWrap: "wrap" }}>
        <button className="button" onClick={exportExcel} disabled={loading}><FileSpreadsheet size={17} /> Exporter en Excel (.xlsx)</button>
        <button className="button secondary" onClick={exportPdf} disabled={loading}><FileText size={17} /> Exporter en PDF</button>
        <button className="button secondary" onClick={() => void loadData()} disabled={loading}><RefreshCw size={17} /> {loading ? "Chargement…" : "Actualiser les données"}</button>
      </div>
      {kind === "members" && (
        <p className="muted" style={{ marginTop: 14 }}>
          {filteredMembers.length} membre(s) sur {members.length} seront exportés.{" "}
          {memberFiltersActive && <button type="button" className="secondary" onClick={() => setMf(EMPTY_MEMBER_FILTERS)}>Réinitialiser les filtres</button>}
        </p>
      )}
      {error && <p role="alert" className="error-text" style={{ marginTop: 14 }}>{error}</p>}
      {notice && <p role="status" className="success-text" style={{ marginTop: 14 }}>{notice}</p>}
      <p className="muted" style={{ marginTop: 14 }}>Données disponibles : {members.length} membres · {activities.length} activités · {filteredAttendance.length} lignes de présence correspondant aux filtres. Les exports sont générés dans ton navigateur à partir des données accessibles avec ton compte.</p>
    </div>
  </>;
}