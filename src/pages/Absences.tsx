import { useEffect, useMemo, useState } from "react";
import Avatar from "../components/Avatar";
import EmptyState from "../components/EmptyState";
import { Copy, FileSpreadsheet, FileText, MessageCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import { loadStats, goudiStreaks, fmtDate, type Streak } from "../lib/stats";
import { downloadExcel, downloadPdf, type Sheet } from "../lib/report";

const DEFAULT_MESSAGE =
  "Salam {prenom} 😊,\n\nNous avons remarqué ton absence à {absences} GOUDI ALJUMAH consécutifs et nous voulions prendre de tes nouvelles. Nous espérons que tu vas bien, in cha Allah.\n\n 🤲🏽❤️La commission administrative aimerait simplement connaître les raisons de tes absences, afin de mieux comprendre ta situation.\n\n Tu nous manques et nous espérons te retrouver parmi nous lors de la prochaine séance, in cha Allah. Qu’Allah te préserve et te facilite ! 🤲🏽";
const STORAGE_KEY = "mj_absence_whatsapp_message";

/** Numéro au format international sans « + » (9 chiffres = Sénégal, indicatif 221). */
function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = "221" + digits;
  return digits.length >= 11 ? digits : null;
}

export default function Absences() {
  const [list, setList] = useState<Streak[] | null>(null);
  const [sessions, setSessions] = useState(0);
  const [n, setN] = useState(3);
  const [mode, setMode] = useState<"current" | "ever">("current");
  const [error, setError] = useState("");

  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [phonesLoaded, setPhonesLoaded] = useState(false);
  const [template, setTemplate] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_MESSAGE;
    } catch {
      return DEFAULT_MESSAGE;
    }
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    loadStats().then((d) => {
      setList(goudiStreaks(d));
      setSessions(d.acts.filter((a) => a.typeName === "GOUDI ALJUMAH" && a.marked).length);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    supabase.from("members").select("id,phone").then(({ data }) => {
      const map: Record<string, string | null> = {};
      ((data || []) as { id: string; phone: string | null }[]).forEach((r) => { map[r.id] = r.phone; });
      setPhones(map);
      setPhonesLoaded(true);
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, template);
    } catch {
      /* le message n'est simplement pas mémorisé */
    }
  }, [template]);

  const rows = useMemo(() => (list || [])
    .filter((s) => (mode === "current" ? s.current : s.max) >= n)
    .sort((a, b) => (mode === "current" ? b.current - a.current : b.max - a.max)), [list, n, mode]);

  // ----- WhatsApp -----
  const absencesOf = (s: Streak) => (mode === "current" ? s.current : s.max);
  const fill = (s: Streak) => template
    .replaceAll("{prenom}", s.member.first_name)
    .replaceAll("{nom}", s.member.last_name)
    .replaceAll("{absences}", String(absencesOf(s)));
  const number = (s: Streak) => waNumber(phones[s.member.id]);
  const link = (s: Streak) => {
    const num = number(s);
    return num ? `https://wa.me/${num}?text=${encodeURIComponent(fill(s))}` : null;
  };

  const queue = rows.filter((s) => !excluded.has(s.member.id) && number(s));
  const pending = queue.filter((s) => !sent.has(s.member.id));
  const allSelected = rows.length > 0 && rows.every((s) => !excluded.has(s.member.id));

  function markSent(id: string) {
    setSent((prev) => new Set(prev).add(id));
  }
  function openNext() {
    const s = pending[0];
    const url = s ? link(s) : null;
    if (!s || !url) return;
    window.open(url, "_blank", "noopener");
    markSent(s.member.id);
  }
  function toggleOne(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setExcluded(allSelected ? new Set(rows.map((s) => s.member.id)) : new Set());
  }
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      alert("Copie impossible sur ce navigateur.");
    }
  }

  const sheet: Sheet = {
    name: `Absents ${n} Goudi consécutifs`,
    head: ["Nom", "Prénom", "Absences consécutives (en cours)", "Plus longue série", "Dates d'absence (Goudi)"],
    rows: rows.map((s) => [s.member.last_name, s.member.first_name, s.current, s.max, s.absentDates.slice(-Math.max(s.current, n)).map(fmtDate).join(", ")]),
  };

  if (error) return <div className="error-box">{error}</div>;
  if (!list) return <div className="center-screen">Chargement…</div>;

  return (
    <>
      <PageHeader title="Absences GOUDI ALJUMAH" description={`Membres absents ${n} GOUDI ALJUMAH consécutifs (${sessions} séance(s) avec appel).`}
        action={<div className="att-actions">
          <button className="secondary" onClick={() => downloadExcel("absents-goudi", [sheet])}><FileSpreadsheet size={18} /> Excel</button>
          <button className="secondary" onClick={() => downloadPdf("absents-goudi", `Absents ${n} GOUDI ALJUMAH consécutifs`, [sheet])}><FileText size={18} /> PDF</button>
        </div>} />

      <div className="panel" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
        <label>Nombre d'absences consécutives
          <input type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 120 }} />
        </label>
        <div className="type-tabs" style={{ margin: 0 }}>
          <button className={`type-tab ${mode === "current" ? "on" : ""}`} onClick={() => setMode("current")}>Série en cours</button>
          <button className={`type-tab ${mode === "ever" ? "on" : ""}`} onClick={() => setMode("ever")}>Déjà arrivé (historique)</button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>Message WhatsApp</h2>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          Modifiez le message. {"{prenom}"}, {"{nom}"} et {"{absences}"} sont remplacés pour chaque membre. Il est mémorisé sur cet appareil.
        </p>
        <textarea rows={4} style={{ width: "100%" }} value={template} onChange={(e) => setTemplate(e.target.value)} />
        {rows[0] && (
          <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
            Aperçu pour {rows[0].member.first_name} : « {fill(rows[0])} »
          </p>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
          <button className="primary" disabled={!pending.length} onClick={openNext}>
            <MessageCircle size={18} />
            {!queue.length
              ? "Aucun membre avec un numéro"
              : !sent.size
                ? `Envoyer à tous (${queue.length})`
                : pending.length
                  ? `Suivant (${pending.length} restant${pending.length > 1 ? "s" : ""})`
                  : "Tous les messages ont été ouverts"}
          </button>
          {sent.size > 0 && <button className="secondary" onClick={() => setSent(new Set())}>Recommencer</button>}
          <button
            className="secondary"
            disabled={!queue.length}
            onClick={() => copy(queue.map((s) => "+" + number(s)).join("\n"), "numéros")}
          >
            <Copy size={16} /> {copied === "numéros" ? "Numéros copiés" : "Copier les numéros"}
          </button>
          <button className="secondary" onClick={() => setTemplate(DEFAULT_MESSAGE)}>Message par défaut</button>
        </div>

        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
          WhatsApp n'autorise pas l'envoi automatique à plusieurs personnes depuis un site. Le bouton ouvre WhatsApp avec le message déjà écrit pour le
          premier membre : appuyez sur Envoyer dans WhatsApp, revenez ici, puis cliquez sur « Suivant ». Les membres cochés sans numéro sont ignorés.
        </p>
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 18, height: 18, padding: 0 }} aria-label="Tout sélectionner" />
              </th>
              <th>Nom</th><th>Prénom</th><th>Absences consécutives</th><th>Plus longue série</th><th>Téléphone</th><th>WhatsApp</th>
            </tr>
          </thead>
          <tbody>{rows.map((s) => {
            const id = s.member.id;
            const url = link(s);
            return (
              <tr key={id} style={{ opacity: excluded.has(id) ? 0.5 : 1 }}>
                <td>
                  <input type="checkbox" checked={!excluded.has(id)} onChange={() => toggleOne(id)} style={{ width: 18, height: 18, padding: 0 }} aria-label={`Sélectionner ${s.member.first_name} ${s.member.last_name}`} />
                </td>
                <td>{s.member.last_name}</td>
                <td><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><Avatar first={s.member.first_name} last={s.member.last_name} />{s.member.first_name}</span></td>
                <td><span className="badge inactive">{s.current}</span></td>
                <td>{s.max}</td>
                <td>{phonesLoaded ? (phones[id] || "—") : "…"}</td>
                <td>
                  {url ? (
                    <a className="secondary" style={{ textDecoration: "none", minHeight: 36, padding: "6px 12px" }} href={url} target="_blank" rel="noreferrer" onClick={() => markSent(id)}>
                      <MessageCircle size={16} /> {sent.has(id) ? "Renvoyer" : "WhatsApp"}
                    </a>
                  ) : (
                    <span className="muted">{phonesLoaded ? "Pas de numéro" : "…"}</span>
                  )}
                  {sent.has(id) && <span className="badge active" style={{ marginLeft: 8 }}>✓ ouvert</span>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
        {!rows.length && <EmptyState tone="ok" icon="ok" title="Aucun membre dans ce cas" hint="Personne n'atteint ce nombre d'absences consécutives." />}
      </div>
      <p className="muted">« Série en cours » = absences à la suite jusqu'à la dernière séance. Dans une séance où l'appel a été fait, un membre non marqué est compté absent .</p>
    </>
  );
}