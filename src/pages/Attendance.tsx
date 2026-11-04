import { CSSProperties, useEffect, useMemo, useState } from "react";
import StatusBadge from "../components/StatusBadge";
import Avatar from "../components/Avatar";
import EmptyState from "../components/EmptyState";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Check, Clock, MapPin, QrCode, ScanLine, Search, UserPlus, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../lib/supabase";
import { siteUrl } from "../lib/site";
import PageHeader from "../components/PageHeader";
import ActivityGuests from "../components/ActivityGuests";
import type { Activity } from "../types";

type MemberName = { id: string; first_name: string; last_name: string };
type Mark = "Présent" | "Absent";

type Group = 0 | 1 | 2; // 0 = en cours, 1 = à venir, 2 = passée / annulée

// Règle unique (la même que le pointage QR et le statut en base) :
//  en cours = du début jusqu'à la fin (4 h après le début s'il n'y a pas de fin) ;
//  à venir = avant le début ; passée = après la fin, terminée ou annulée.
function groupOf(a: Activity, now: number): Group {
  if (a.status === "annulée" || a.status === "terminée") return 2;
  const start = new Date(a.start_datetime).getTime();
  const end = a.end_datetime ? new Date(a.end_datetime).getTime() : start + 4 * 3600_000;
  if (now > end) return 2;
  if (now >= start) return 0;
  return 1;
}

const bounds = (a: Activity) => {
  const start = new Date(a.start_datetime).getTime();
  const end = a.end_datetime ? new Date(a.end_datetime).getTime() : start + 4 * 3600_000;
  return { start, end };
};

const fmtDuration = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  const d = Math.round(h / 24);
  return `${d} jour${d > 1 ? "s" : ""}`;
};

// Texte de compte à rebours affiché sur les cartes d'activités
function countdown(a: Activity, now: number, g: Group): string {
  const { start, end } = bounds(a);
  if (a.status === "annulée") return "Annulée";
  if (g === 0) return now - start < 60_000 ? "Vient de commencer" : `Commencée il y a ${fmtDuration(now - start)} · fin dans ${fmtDuration(end - now)}`;
  if (g === 1) return `Commence dans ${fmtDuration(start - now)}`;
  return "Terminée";
}

const GROUP_LABEL: Record<Group, string> = { 0: "En cours", 1: "À venir", 2: "Passées" };

// Petite vibration sur téléphone (ignorée si le navigateur ne la gère pas)
const buzz = (pattern: number | number[]) => {
  try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch { /* sans effet */ }
};

// Icône qui se dessine au moment où on marque un membre
function DrawIcon({ kind }: { kind: "check" | "cross" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "check"
        ? <path className="draw-path" pathLength={1} d="M4.5 12.5l5 5L19.5 7" />
        : <path className="draw-path" pathLength={1} d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  left: 6 + i * 6.6, delay: (i % 5) * 0.08, color: ["#d9a066", "#18794e", "#a2443a", "#f3d9b1", "#2556a3"][i % 5], drift: (i % 2 ? 1 : -1) * (8 + (i % 4) * 6),
}));

export default function Attendance() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<MemberName[]>([]);
  const [selected, setSelected] = useState("");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [scanTimes, setScanTimes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState("");
  const [showGuests, setShowGuests] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set()); // membres qu'on vient de marquer (animation)
  const [celebrate, setCelebrate] = useState(false);

  // Rafraîchit le compte à rebours et le classement toutes les 30 secondes
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [guestCount, setGuestCount] = useState(0);

  useEffect(() => {
    supabase.from("activities").select("*").order("start_datetime", { ascending: false })
      .then(({ data }) => setActivities((data as Activity[]) || []));
    supabase.rpc("public_member_names")
      .then(({ data }) => setMembers((data as MemberName[]) || []));
  }, []);

  // Ordre : en cours, puis à venir (la plus proche d'abord), puis passées (la plus récente d'abord)
  const sortedActivities = useMemo(() => {
    const t = (a: Activity) => new Date(a.start_datetime).getTime();
    return activities
      .map((a) => ({ a, g: groupOf(a, now) }))
      .sort((x, y) => {
        if (x.g !== y.g) return x.g - y.g;
        return x.g === 1 ? t(x.a) - t(y.a) : t(y.a) - t(x.a);
      });
  }, [activities, now]);

  const current = activities.find((a) => a.id === selected);

  async function loadGuestCount() {
    if (!selected) { setGuestCount(0); return; }
    const { count } = await supabase.from("activity_guests")
      .select("id", { count: "exact", head: true }).eq("activity_id", selected);
    setGuestCount(count || 0);
  }

  useEffect(() => {
    setShowGuests(false);
    setShowQr(false);
    setCelebrate(false);
    setFresh(new Set());
    void loadGuestCount();
  }, [selected]);

  useEffect(() => {
    setMarks({});
    setScanTimes({});
    if (!selected) return;
    let cancelled = false;
    supabase.from("attendance").select("member_id,status,check_in_at").eq("activity_id", selected)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setInfo("Erreur de chargement : " + error.message); return; }
        const x: Record<string, Mark> = {};
        const t: Record<string, string> = {};
        (data || []).forEach((r: any) => {
          if (r.status === "Présent" || r.status === "Absent") x[r.member_id] = r.status;
          if (r.status === "Présent" && r.check_in_at) t[r.member_id] = r.check_in_at;
        });
        setMarks(x);
        setScanTimes(t);
      });
    return () => { cancelled = true; };
  }, [selected]);

  // Enregistre immédiatement (pas de bouton « Enregistrer »)
  async function setMany(ids: string[], value: Mark) {
    if (!selected || !ids.length) return;
    buzz(ids.length > 1 ? [30, 40, 30] : value === "Présent" ? 25 : 15);
    setFresh(new Set(ids));
    window.setTimeout(() => setFresh(new Set()), 800);
    const before = marks;
    const beforeTimes = scanTimes;
    const now = new Date().toISOString();
    // Un membre marqué « Présent » reçoit une heure d'arrivée (conservée si déjà scanné)
    const newTimes = { ...scanTimes };
    if (value === "Présent") ids.forEach((id) => { if (!newTimes[id]) newTimes[id] = now; });
    setScanTimes(newTimes);
    setMarks((m) => {
      const n = { ...m };
      ids.forEach((id) => (n[id] = value));
      return n;
    });
    const rows = ids.map((id) => {
      const row: Record<string, unknown> = { activity_id: selected, member_id: id, status: value, method: "manual" };
      if (value === "Présent") row.check_in_at = newTimes[id];
      return row;
    });
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "activity_id,member_id" });
    if (error) {
      setMarks(before);
      setScanTimes(beforeTimes);
      setInfo("Erreur : " + error.message);
    } else {
      setInfo("✓ Enregistré");
      setTimeout(() => setInfo(""), 1500);
      // Tout le monde est marqué : petit message de félicitations
      const after = { ...before };
      ids.forEach((id) => (after[id] = value));
      if (members.length > 0 && members.every((m) => after[m.id]) && !members.every((m) => before[m.id])) {
        buzz([70, 50, 70, 50, 120]);
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), 6000);
      }
    }
  }

  // Ordre : présents selon l'ordre de scan (1er arrivé en haut), puis les autres par ordre alphabétique
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? members.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q)) : members;
    const rank = (id: string) => (marks[id] === "Présent" && scanTimes[id] ? 0 : marks[id] === "Présent" ? 1 : 2);
    return [...list].sort((a, b) => {
      const ra = rank(a.id), rb = rank(b.id);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return scanTimes[a.id].localeCompare(scanTimes[b.id]);
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr");
    });
  }, [members, query, marks, scanTimes]);

  const scanOrder = useMemo(() => {
    const ids = Object.keys(scanTimes).filter((id) => marks[id] === "Présent").sort((a, b) => scanTimes[a].localeCompare(scanTimes[b]));
    return Object.fromEntries(ids.map((id, i) => [id, i + 1])) as Record<string, number>;
  }, [marks, scanTimes]);

  // Clôture : tous les membres encore non marqués (même cachés par la recherche) passent « Absent ».
  function closeRoll() {
    const ids = members.filter((m) => !marks[m.id]).map((m) => m.id);
    if (!ids.length) { setInfo("Tout le monde est déjà marqué."); return; }
    if (!confirm(`Clôturer l'appel ?\n\n${ids.length} membre(s) non marqué(s) seront enregistrés « Absent ». Les présents ne changent pas.`)) return;
    void setMany(ids, "Absent");
  }

  const present = members.filter((m) => marks[m.id] === "Présent").length;
  const absent = members.filter((m) => marks[m.id] === "Absent").length;
  const todo = members.length - present - absent;

  return (
    <>
      <PageHeader title="Présences" description="Touche une activité (celle en cours ou la plus proche est en haut), puis coche Présent ou Absent. L'enregistrement est automatique." />
      {!selected && (
        <div className="att-activities">
          {sortedActivities.map(({ a, g }, i) => (
            <div key={a.id}>
              {(i === 0 || sortedActivities[i - 1].g !== g) && (
                <h3 className="muted" style={{ margin: "16px 0 8px" }}>{GROUP_LABEL[g]}</h3>
              )}
              <button type="button" className={`act-card ${g === 0 ? "live" : g === 1 ? "soon" : "past"}`} onClick={() => setSelected(a.id)}>
                <div className="act-card-top">
                  <b>{a.name}</b>
                  {g === 0 && <span className="live-badge"><i className="live-dot" /> En cours</span>}
                  {a.status === "annulée" && <StatusBadge kind="cancelled" />}
                </div>
                <div className="act-card-meta">
                  <span><CalendarDays size={14} />{" "}
                    {new Date(a.start_datetime).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {a.location && <span><MapPin size={14} /> {a.location}</span>}
                </div>
                <div className="act-card-count"><Clock size={14} /> {countdown(a, now, g)}</div>
              </button>
            </div>
          ))}
          {!sortedActivities.length && <EmptyState icon="activities" title="Aucune activité" hint="Crée une activité depuis la page Activités pour faire l'appel." actions={[{ label: "Créer une activité", to: "/activities" }]} />}
        </div>
      )}

      {selected && (
        <div className="panel" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={() => { setSelected(""); setQuery(""); setInfo(""); }}>
            <ArrowLeft size={16} /> Toutes les activités
          </button>
          {current && (
            <div>
              <b>
                {current.name}
                {groupOf(current, now) === 0 && <span className="live-badge" style={{ marginLeft: 8 }}><i className="live-dot" /> En cours</span>}
              </b>
              <div className="muted">
                {new Date(current.start_datetime).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                {" · "}{countdown(current, now, groupOf(current, now))}
              </div>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to={`/scan?activity=${selected}`} className="primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "10px 14px", borderRadius: 10 }}>
              <ScanLine size={16} /> Scanner
            </Link>
            <button type="button" className="primary" onClick={() => setShowQr(true)}>
              <QrCode size={16} /> QR code
            </button>
            <button type="button" className="primary" onClick={() => setShowGuests(true)}>
              <UserPlus size={16} /> Invités{guestCount > 0 ? ` (${guestCount})` : ""}
            </button>
          </div>
        </div>
      )}

      {showQr && current && (() => {
        const link = `${siteUrl()}/checkin/${current.qr_token}`;
        return (
          <div className="modal-backdrop" onClick={() => setShowQr(false)}>
            <div className="modal" style={{ textAlign: "center", width: "min(480px,100%)" }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>{current.name}</h2>
                <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => setShowQr(false)}>×</button>
              </div>
              <div style={{ background: "#fff", padding: 16, display: "inline-block", borderRadius: 12, border: "1px solid #e6e8ec" }}>
                <QRCodeSVG value={link} size={300} level="M" />
              </div>
              <p className="muted">Les membres scannent ce code pour se marquer présents, de 30 minutes avant le début jusqu'à la fin de l'activité.</p>
              <p style={{ fontSize: 12, wordBreak: "break-all", color: "#667085", margin: "0 0 12px" }}>{link}</p>
              <button type="button" className="secondary full"
                onClick={() => navigator.clipboard.writeText(link).then(() => setInfo("Lien copié"), () => setInfo("Copie impossible"))}>
                Copier le lien
              </button>
            </div>
          </div>
        );
      })()}

      {showGuests && current && (
        <ActivityGuests activity={current} onClose={() => setShowGuests(false)} onChanged={loadGuestCount} />
      )}

      {selected && (
        <>
          <div className="att-bar">
            <div className="att-counts">
              <span className="c-p">Présents : {present}</span>
              <span className="c-a">Absents : {absent}</span>
              <span className="c-n">Non marqués : {todo}</span>
              {info && <span className="att-info">{info}</span>}
            </div>
            <div className="att-actions">
              <button className="secondary" onClick={() => setMany(shown.map((m) => m.id), "Présent")}>Tous présents</button>
              <button className="secondary" onClick={() => setMany(shown.map((m) => m.id), "Absent")}>Tous absents</button>
              <button className="primary" disabled={todo === 0} onClick={closeRoll}>Clôturer l'appel</button>
            </div>
          </div>

          {todo === 0 && members.length > 0 && (
            <div className={`att-done${celebrate ? " celebrate" : ""}`} role="status">
              {celebrate && <div className="confetti" aria-hidden="true">{CONFETTI.map((c, i) => (
                <i key={i} style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, "--drift": `${c.drift}px` } as CSSProperties} />
              ))}</div>}
              <span className="att-done-ico"><DrawIcon kind="check" /></span>
              <div>
                <b>{celebrate ? "Bravo, l'appel est terminé ! 🎉" : "Appel complet"}</b>
                <div>{present} présent{present > 1 ? "s" : ""} · {absent} absent{absent > 1 ? "s" : ""}</div>
              </div>
            </div>
          )}

          <div className="att-progress" role="progressbar" aria-valuemin={0} aria-valuemax={members.length} aria-valuenow={present}
            aria-label="Présents">
            <div className="att-progress-bar"><span style={{ width: `${members.length ? Math.round((present / members.length) * 100) : 0}%` }} /></div>
            <small>{present} / {members.length} présents{members.length ? ` (${Math.round((present / members.length) * 100)} %)` : ""}</small>
          </div>

          <div className="input-icon search" style={{ marginBottom: 14 }}>
            <Search size={18} />
            <input placeholder="Rechercher un membre…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="att-list">
            {shown.map((m) => {
              const v = marks[m.id];
              return (
                <div className={`att-row${v === "Présent" ? " is-p" : v === "Absent" ? " is-a" : ""}`} key={m.id}>
                  <span className="att-name" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <Avatar first={m.first_name} last={m.last_name} />
                    {scanOrder[m.id] ? <b style={{ marginRight: 8 }}>{scanOrder[m.id]}.</b> : null}
                    {m.last_name} {m.first_name}
                    {scanTimes[m.id] && v === "Présent" && (
                      <small className="muted" style={{ marginLeft: 8 }}>
                        {new Date(scanTimes[m.id]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </small>
                    )}
                  </span>
                  <div className="att-btns">
                    <button type="button" className={`att-btn p ${v === "Présent" ? "on" : ""}`}
                      aria-pressed={v === "Présent"} onClick={() => setMany([m.id], "Présent")}>
                      {fresh.has(m.id) && v === "Présent" ? <DrawIcon kind="check" /> : <Check size={18} />} Présent
                    </button>
                    <button type="button" className={`att-btn a ${v === "Absent" ? "on" : ""}`}
                      aria-pressed={v === "Absent"} onClick={() => setMany([m.id], "Absent")}>
                      {fresh.has(m.id) && v === "Absent" ? <DrawIcon kind="cross" /> : <X size={18} />} Absent
                    </button>
                  </div>
                </div>
              );
            })}
            {!shown.length && <EmptyState icon={query.trim() ? "search" : "members"} title={query.trim() ? "Aucun résultat" : "Aucun membre"} hint={query.trim() ? "Vérifie l'orthographe ou efface la recherche." : undefined} />}
          </div>
        </>
      )}
    </>
  );
}