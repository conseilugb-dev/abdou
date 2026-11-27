import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import OrgHeader from "../components/OrgHeader";
import Footer from "../components/Footer";
import EmptyState from "../components/EmptyState";

type Status = "Présent" | "Absent" | "Excusé";
type Row = { id: string; first_name: string; last_name: string; status: Status | null };
type Sheet = {
  found: boolean;
  name?: string;
  start?: string;
  state?: "ok" | "early" | "late" | "cancelled";
  members?: Row[];
};

const CLOSED_MESSAGE: Record<string, string> = {
  early: "Le lien s'ouvre 1 heure avant le début de l'activité.",
  late: "Ce lien a expiré : l'activité est terminée.",
  cancelled: "Cette activité est annulée.",
};

const BUTTONS: { value: Status; label: string; color: string }[] = [
  { value: "Présent", label: "Présent", color: "#18794e" },
  { value: "Absent", label: "Absent", color: "#b42318" },
  { value: "Excusé", label: "Excusé", color: "#b54708" },
];

export default function ManagerLink() {
  const { token = "" } = useParams();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);
  const [busyId, setBusyId] = useState("");

  // Le lien est secret : on empêche son indexation et son envoi à d'autres sites.
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    const ref = document.createElement("meta");
    ref.name = "referrer";
    ref.content = "no-referrer";
    document.head.append(robots, ref);
    return () => {
      robots.remove();
      ref.remove();
    };
  }, []);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("ml_sheet", { p_token: token });
    if (rpcError) {
      setError("Impossible de charger la feuille d'appel : " + rpcError.message);
      setBooting(false);
      return;
    }
    const result = data as Sheet;
    setSheet(result);
    setRows(result?.members || []);
    setError("");
    setBooting(false);
  }, [token]);

  useEffect(() => {
    void load();
    // Rafraîchit toutes les 20 s pour voir aussi les pointages du 2e responsable.
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function mark(member: Row, status: Status) {
    if (busyId) return;
    setBusyId(member.id);
    setError("");
    const previous = rows;
    setRows((list) => list.map((r) => (r.id === member.id ? { ...r, status } : r)));
    try {
      const { data, error: rpcError } = await supabase.rpc("ml_mark", {
        p_token: token,
        p_member_id: member.id,
        p_status: status,
      });
      const result = data as { ok: boolean; message?: string } | null;
      if (rpcError || !result?.ok) {
        setRows(previous);
        setError(result?.message || rpcError?.message || "Enregistrement impossible.");
      }
    } catch {
      setRows(previous);
      setError("Connexion impossible. Vérifie ton réseau et réessaie.");
    } finally {
      setBusyId("");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => `${m.first_name} ${m.last_name} ${m.last_name} ${m.first_name}`.toLowerCase().includes(q));
  }, [rows, query]);

  const present = rows.filter((r) => r.status === "Présent").length;
  const dateText = sheet?.start
    ? new Date(sheet.start).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "";

  return (
    <div className="login-screen" style={{ alignItems: "flex-start" }}>
      <div className="login-card" style={{ width: "min(560px, 100%)" }}>
        <img className="login-logo" src="/logo.png" alt="Conseil UGB" />
        <h1>Feuille d'appel</h1>
        <OrgHeader />

        {booting && <p role="status">Chargement…</p>}

        {!booting && sheet && !sheet.found && (
          <div className="error-box" role="alert">Lien invalide ou désactivé. Demande un nouveau lien à l'administrateur.</div>
        )}

        {!booting && sheet?.found && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, textAlign: "center" }}>{sheet.name}</h2>
            <p style={{ margin: "0 0 8px", textAlign: "center" }}>{dateText}</p>
          </>
        )}

        {!booting && sheet?.found && sheet.state && sheet.state !== "ok" && (
          <div className="error-box" role="alert">{CLOSED_MESSAGE[sheet.state]}</div>
        )}

        {!booting && sheet?.found && sheet.state === "ok" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 10px" }}>
              <strong style={{ color: "#18794e" }}>{present} présent{present > 1 ? "s" : ""} / {rows.length}</strong>
              <button type="button" className="secondary" style={{ minHeight: 34, padding: "5px 12px" }} onClick={() => void load()}>
                <RefreshCw size={15} /> Actualiser
              </button>
            </div>

            <div className="input-icon">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Chercher un membre"
                autoComplete="off"
                aria-label="Chercher un membre"
              />
            </div>

            {filtered.map((m) => (
              <div
                key={m.id}
                style={{ padding: "10px 0", borderBottom: "1px solid #e6e8ec", opacity: busyId === m.id ? 0.6 : 1 }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{m.last_name} {m.first_name}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {BUTTONS.map((b) => {
                    const on = m.status === b.value;
                    return (
                      <button
                        key={b.value}
                        type="button"
                        disabled={!!busyId}
                        onClick={() => void mark(m, b.value)}
                        aria-pressed={on}
                        style={{
                          flex: 1,
                          minHeight: 40,
                          borderRadius: 8,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: `2px solid ${b.color}`,
                          background: on ? b.color : "#fff",
                          color: on ? "#fff" : b.color,
                        }}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {!filtered.length && <EmptyState compact icon="search" title="Aucun membre trouvé" hint="Vérifie l'orthographe." />}
          </>
        )}

        {error && <div className="error-box" role="alert">{error}</div>}
        <Footer />
      </div>
    </div>
  );
}