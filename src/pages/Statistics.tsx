import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { FileSpreadsheet, FileText } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { loadStats, fmtDate, TYPE_ORDER, type StatsData } from "../lib/stats";
import { downloadExcel, downloadPdf, type Sheet } from "../lib/report";

export default function Statistics() {
  const [data, setData] = useState<StatsData | null>(null);
  const [type, setType] = useState("TOUS");
  const [error, setError] = useState("");

  useEffect(() => { loadStats().then(setData).catch((e) => setError(e.message)); }, []);

  const acts = useMemo(() => {
    if (!data) return [];
    return data.acts.filter((a) => type === "TOUS" || a.typeName === type).sort((a, b) => a.start.localeCompare(b.start));
  }, [data, type]);

  const held = acts.filter((a) => a.marked);
  const sum = (k: "present" | "absent") => held.reduce((n, a) => n + a[k], 0);
  const P = sum("present"), A = sum("absent");
  const rate = P + A ? Math.round((P / (P + A)) * 100) : 0;
  const chart = held.map((a) => ({ name: `${a.name} (${fmtDate(a.start)})`, Présent: a.present, Absent: a.absent }));

  function sheets(): Sheet[] {
    if (!data) return [];
    const nameOf = new Map(data.members.map((m) => [m.id, `${m.last_name} ${m.first_name}`]));
    const detail: (string | number)[][] = [];
    acts.filter((a) => a.marked).forEach((a) => data.members.forEach((m) => {
      detail.push([a.name, a.typeName, fmtDate(a.start), nameOf.get(m.id) || "", data.status.get(`${a.id}|${m.id}`) === "Présent" ? "Présent" : "Absent"]);
    }));
    return [
      { name: "Par type", head: ["Type", "Activités", "Tenues", "Présents", "Absents", "Taux %", "Moy. présents"],
        rows: data.types.filter((t) => type === "TOUS" || t.typeName === type).map((t) => [t.typeName, t.created, t.held, t.present, t.absent, t.rate, t.avgPresent]) },
      { name: "Par activité", head: ["Activité", "Type", "Date", "Présents", "Absents", "Taux %"],
        rows: acts.map((a) => [a.name, a.typeName, fmtDate(a.start), a.present, a.absent, a.rate]) },
      { name: "Détail présences", head: ["Activité", "Type", "Date", "Membre", "Statut"], rows: detail },
    ];
  }
  const label = type === "TOUS" ? "tous-types" : type.toLowerCase().replace(/\s+/g, "-");

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="center-screen">Chargement…</div>;

  return (
    <>
      <PageHeader title="Statistiques" description="Présents et absents par type d'activité et par activité."
        action={<div className="att-actions">
          <button className="secondary" onClick={() => downloadExcel(`rapport-${label}`, sheets())}><FileSpreadsheet size={18} /> Excel</button>
          <button className="secondary" onClick={() => downloadPdf(`rapport-${label}`, `Rapport — ${type === "TOUS" ? "tous les types" : type}`, sheets().slice(0, 2))}><FileText size={18} /> PDF</button>
        </div>} />

      <div className="type-tabs">
        {["TOUS", ...TYPE_ORDER].map((t) => (
          <button key={t} className={`type-tab ${type === t ? "on" : ""}`} onClick={() => setType(t)}>{t === "TOUS" ? "Tous" : t}</button>
        ))}
      </div>

      <div className="stats-grid">
        {([["Activités tenues", held.length], ["Présents", P], ["Absents", A], ["Taux de présence", `${rate}%`],
          ["Moyenne présents / activité", held.length ? (Math.round((P / held.length) * 10) / 10) : 0]] as const).map(([l, v]) => (
          <div className="stat-card" key={l}><div><span>{l}</span><strong>{v}</strong></div></div>
        ))}
      </div>

      <div className="panel" style={{ height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide={chart.length > 8} /><YAxis allowDecimals={false} /><Tooltip /><Legend />
            <Bar dataKey="Présent" fill="#18794e" /><Bar dataKey="Absent" fill="#b42318" />
          </BarChart>
        </ResponsiveContainer>
        {!chart.length && <div className="empty">Aucune activité avec présences enregistrées.</div>}
      </div>

      <div className="panel table-wrap">
        <h2 style={{ marginTop: 0 }}>Statistiques par type</h2>
        <table>
          <thead><tr><th>Type</th><th>Activités</th><th>Tenues</th><th>Présents</th><th>Absents</th><th>Taux</th><th>Moy. présents</th></tr></thead>
          <tbody>{data.types.map((t) => (
            <tr key={t.typeName} onClick={() => setType(t.typeName)} style={{ cursor: "pointer" }}>
              <td><strong>{t.typeName}</strong></td><td>{t.created}</td><td>{t.held}</td><td>{t.present}</td><td>{t.absent}</td><td>{t.rate}%</td><td>{t.avgPresent}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <div className="panel table-wrap">
        <h2 style={{ marginTop: 0 }}>Détail par activité</h2>
        <table>
          <thead><tr><th>Activité</th><th>Type</th><th>Date</th><th>Présents</th><th>Absents</th><th>Taux</th></tr></thead>
          <tbody>{[...acts].reverse().map((a) => (
            <tr key={a.id}><td>{a.name}</td><td>{a.typeName}</td><td>{fmtDate(a.start)}</td>
              <td>{a.marked ? a.present : "—"}</td><td>{a.marked ? a.absent : "—"}</td><td>{a.marked ? `${a.rate}%` : "pas d'appel"}</td></tr>))}</tbody>
        </table>
        {!acts.length && <div className="empty">Aucune activité.</div>}
      </div>
    </>
  );
}