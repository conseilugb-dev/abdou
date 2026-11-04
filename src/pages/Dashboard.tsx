import { ReactNode, useEffect, useMemo, useState } from "react";
import StatusBadge from "../components/StatusBadge";
import EmptyState from "../components/EmptyState";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, ClipboardList, QrCode, ScanLine, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import PageHeader from "../components/PageHeader";
import { fmtDate, goudiStreaks, loadStats, type StatsData } from "../lib/stats";

type Upcoming = {
  id: string;
  name: string;
  location: string | null;
  start_datetime: string;
  activity_type_id: string | null;
};

const GREEN = "#18794e";
const RED = "#b42318";
const ORANGE = "#b54708";
const GRAY = "var(--muted)";
const LINE = "var(--line-soft)";

const rateColor = (r: number) => (r >= 70 ? GREEN : r >= 40 ? ORANGE : RED);
const dateTime = (v: string) => new Date(v).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
const fullName = (m: { first_name: string; last_name: string }) => `${m.last_name} ${m.first_name}`;
const HOURS_3 = 3 * 3600 * 1000;

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 8, borderRadius: 99, background: "#eef2f6", overflow: "hidden" }}>
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: color }} />
    </div>
  );
}

// Anneau de progression animé (le trait se remplit au chargement)
function Ring({ value, color, center, size = 118 }: { value: number | null; color: string; center: ReactNode; size?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setOn(true), 60); return () => window.clearTimeout(t); }, []);
  const stroke = 11, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1e8e4" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={on ? c * (1 - pct / 100) : c}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.22,.8,.3,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", lineHeight: 1.1 }}>{center}</div>
    </div>
  );
}

// Courbe d'évolution : aire dégradée, points colorés selon le taux, dates en bas
function Trend({ items }: { items: { id: string; name: string; start: string; rate: number }[] }) {
  const W = 360, H = 170, padX = 22, top = 24, bottom = 26;
  const n = items.length;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const y = (rate: number) => top + (1 - rate / 100) * (H - top - bottom);
  const pts = items.map((a, i) => [x(i), y(a.rate)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)},${H - bottom} L${pts[0][0].toFixed(1)},${H - bottom} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Évolution du taux de présence" style={{ display: "block" }}>
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a2443a" stopOpacity=".28" />
          <stop offset="100%" stopColor="#a2443a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={padX} x2={W - padX} y1={y(g)} y2={y(g)} stroke="#eadfda" strokeDasharray="3 4" />
          <text x={4} y={y(g) + 3} fontSize="9" fill="#9b8c87">{g}%</text>
        </g>
      ))}
      {n > 1 && <path d={area} fill="url(#trend-fill)" />}
      {n > 1 && <path d={line} fill="none" stroke="#a2443a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      {items.map((a, i) => (
        <g key={a.id}>
          <title>{`${a.name} · ${fmtDate(a.start)} : ${a.rate}%`}</title>
          <circle cx={pts[i][0]} cy={pts[i][1]} r="5.5" fill="#fff" stroke={rateColor(a.rate)} strokeWidth="3" />
          <text x={pts[i][0]} y={pts[i][1] - 11} fontSize="10" fontWeight="700" textAnchor="middle" fill={rateColor(a.rate)}>{a.rate}%</text>
          <text x={pts[i][0]} y={H - 8} fontSize="9" textAnchor="middle" fill="#8a7b76">
            {new Date(a.start).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Box({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
        {link && (
          <Link to={link.to} style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ minWidth: 0 }}>{left}</div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

const Small = ({ children, color = GRAY }: { children: ReactNode; color?: string }) => (
  <div style={{ fontSize: 12, color, marginTop: 2 }}>{children}</div>
);

export default function Dashboard() {
  const [data, setData] = useState<StatsData | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [typeNames, setTypeNames] = useState<Map<string, string>>(new Map());
  const [inactive, setInactive] = useState(0);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => {
      const id = u.user?.id;
      if (!id) return;
      supabase.from("profiles").select("first_name").eq("id", id).maybeSingle()
        .then(({ data: p }) => setFirstName(((p as { first_name?: string } | null)?.first_name || "").trim()));
    });

    loadStats().then(setData).catch((e) => setError(e.message));

    const since = new Date(Date.now() - HOURS_3).toISOString();
    supabase
      .from("activities")
      .select("id,name,location,start_datetime,activity_type_id")
      .neq("status", "annulée")
      .gte("start_datetime", since)
      .order("start_datetime")
      .limit(5)
      .then(({ data: rows }) => setUpcoming((rows as Upcoming[]) || []));

    supabase
      .from("activity_types")
      .select("id,name")
      .then(({ data: rows }) =>
        setTypeNames(new Map(((rows || []) as { id: string; name: string }[]).map((t) => [t.id, t.name])))
      );

    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("status", "inactive")
      .then(({ count }) => setInactive(count || 0));
  }, []);

  const v = useMemo(() => {
    if (!data) return null;

    const held = data.acts.filter((a) => a.marked).sort((a, b) => a.start.localeCompare(b.start));
    const pct = (list: typeof held) => {
      const total = list.reduce((s, a) => s + a.total, 0);
      const present = list.reduce((s, a) => s + a.present, 0);
      return total ? Math.round((present / total) * 100) : null;
    };

    const now = new Date();
    const thisKey = monthKey(now);
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const thisMonth = held.filter((a) => monthKey(new Date(a.start)) === thisKey);
    const lastMonth = held.filter((a) => monthKey(new Date(a.start)) === prevKey);

    const toFix = data.acts
      .filter((a) => !a.marked && new Date(a.start).getTime() < Date.now() - HOURS_3)
      .sort((a, b) => b.start.localeCompare(a.start));

    const streaks = goudiStreaks(data)
      .filter((s) => s.current >= 3)
      .sort((a, b) => b.current - a.current);

    const assidus = data.members
      .map((m) => {
        const p = held.filter((a) => data.status.get(`${a.id}|${m.id}`) === "Présent").length;
        return { m, p, rate: held.length ? Math.round((p / held.length) * 100) : 0 };
      })
      .sort((a, b) => b.p - a.p || a.m.last_name.localeCompare(b.m.last_name))
      .slice(0, 5);

    return {
      held,
      global: pct(held),
      month: pct(thisMonth),
      prevMonth: pct(lastMonth),
      monthCount: thisMonth.length,
      toFix,
      streaks,
      assidus,
      last: held.length ? held[held.length - 1] : null,
      recent: held.slice(-8),
    };
  }, [data]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data || !v) return <div className="center-screen">Chargement…</div>;

  const delta = v.month !== null && v.prevMonth !== null ? v.month - v.prevMonth : null;
  const cards = [
    {
      label: "Membres actifs",
      value: data.members.length,
      sub: `${inactive} inactif${inactive > 1 ? "s" : ""}`,
      Icon: Users,
      color: undefined as string | undefined,
    },
    {
      label: "Appels à régulariser",
      value: v.toFix.length,
      sub: "activités passées sans présences",
      Icon: ClipboardList,
      color: v.toFix.length ? RED : GREEN,
    },
    {
      label: "Membres à relancer",
      value: v.streaks.length,
      sub: "3 GOUDI ou plus d'affilée",
      Icon: AlertTriangle,
      color: v.streaks.length ? RED : GREEN,
    },
  ];

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Salam${firstName ? `, ${firstName}` : ""} · ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}. Ce qui est à faire, ce qui arrive et comment évolue la présence.`}
      />

      <div className="dash-rings">
        {[
          {
            label: "Présence globale", value: v.global, color: v.global === null ? "#c9b8b2" : rateColor(v.global),
            center: <strong style={{ fontSize: 26, fontWeight: 800 }}>{v.global === null ? "—" : `${v.global}%`}</strong>,
            sub: `${v.held.length} appel${v.held.length > 1 ? "s" : ""} effectué${v.held.length > 1 ? "s" : ""}`,
          },
          {
            label: "Ce mois-ci", value: v.month, color: v.month === null ? "#c9b8b2" : rateColor(v.month),
            center: <strong style={{ fontSize: 26, fontWeight: 800 }}>{v.month === null ? "—" : `${v.month}%`}</strong>,
            sub: delta === null ? (v.monthCount ? `${v.monthCount} appel${v.monthCount > 1 ? "s" : ""}` : "Aucun appel ce mois-ci")
              : `${delta >= 0 ? "▲ +" : "▼ "}${delta} pts vs mois dernier`,
            subColor: delta === null ? undefined : delta >= 0 ? GREEN : RED,
          },
          {
            label: "Dernière activité", value: v.last ? v.last.rate : null, color: v.last ? rateColor(v.last.rate) : "#c9b8b2",
            center: v.last ? <div><strong style={{ fontSize: 22, fontWeight: 800 }}>{v.last.present}</strong><div style={{ fontSize: 12, color: GRAY }}>/ {v.last.total}</div></div> : <strong style={{ fontSize: 26 }}>—</strong>,
            sub: v.last ? v.last.name : "Aucun appel effectué",
          },
        ].map((r) => (
          <div className="dash-ring" key={r.label}>
            <Ring value={r.value} color={r.color} center={r.center} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>{r.label}</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: ("subColor" in r && r.subColor) || undefined, wordBreak: "break-word" }}>{r.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="stats-grid">
        {cards.map(({ label, value, sub, Icon, color }) => (
          <div className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <strong style={color ? { color } : undefined}>{value}</strong>
              <Small>{sub}</Small>
            </div>
            <Icon size={28} />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 16 }}>
        {[
          { to: "/scan", label: "Scanner l'entrée", sub: "Pointer les membres avec leur carte QR", Icon: ScanLine },
          { to: "/attendance", label: "Faire l'appel", sub: "Marquer les présences à la main", Icon: ClipboardCheck },
          { to: "/members", label: "Cartes de membre", sub: "Afficher et envoyer le QR d'un membre", Icon: QrCode },
        ].map(({ to, label, sub, Icon }) => (
          <Link key={to} to={to} className="panel" style={{ margin: 0, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
            <Icon size={30} color="var(--brand)" />
            <div>
              <div style={{ fontWeight: 800 }}>{label}</div>
              <div className="muted" style={{ fontSize: 13 }}>{sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}>
        <Box title="Prochaines activités" link={{ to: "/activities", label: "Toutes les activités" }}>
          {upcoming.length === 0 && <EmptyState compact icon="activities" title="Aucune activité prévue" actions={[{ label: "Créer une activité", to: "/activities" }]} />}
          {upcoming.map((a) => {
            const started = new Date(a.start_datetime).getTime() < Date.now();
            return (
              <Row
                key={a.id}
                left={
                  <>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <Small>
                      {dateTime(a.start_datetime)}
                      {a.location ? ` · ${a.location}` : ""}
                    </Small>
                  </>
                }
                right={
                  started ? (
                    <StatusBadge kind="live" />
                  ) : (
                    <span className="badge">{typeNames.get(a.activity_type_id || "") || "—"}</span>
                  )
                }
              />
            );
          })}
        </Box>

        <Box title="Dernière activité avec appel" link={{ to: "/statistics", label: "Statistiques" }}>
          {!v.last && <EmptyState compact icon="attendance" title="Aucun appel pour le moment" actions={[{ label: "Faire l'appel", to: "/attendance" }]} />}
          {v.last && (
            <>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{v.last.name}</div>
              <Small>
                {v.last.typeName} · {fmtDate(v.last.start)}
              </Small>
              <div className="att-counts" style={{ margin: "12px 0" }}>
                <span className="c-p">Présents {v.last.present}</span>
                <span className="c-a">Absents {v.last.absent}</span>
              </div>
              <Bar value={v.last.rate} color={rateColor(v.last.rate)} />
              <Small color={rateColor(v.last.rate)}>Taux de présence : {v.last.rate}%</Small>
            </>
          )}
        </Box>

        <Box title="Évolution de la présence (8 derniers appels)">
          {v.recent.length === 0 && <EmptyState compact icon="stats" title="Pas encore de données" />}
          {v.recent.length > 0 && (
            <Trend items={v.recent} />
          )}
        </Box>

        <Box title="Présence par type d'activité">
          {data.types.filter((t) => t.held > 0).length === 0 && <EmptyState compact icon="stats" title="Pas encore de données" />}
          {data.types
            .filter((t) => t.held > 0)
            .map((t) => (
              <div key={t.typeName} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontWeight: 600 }}>{t.typeName}</span>
                  <span style={{ fontWeight: 700, color: rateColor(t.rate) }}>{t.rate}%</span>
                </div>
                <Bar value={t.rate} color={rateColor(t.rate)} />
                <Small>
                  {t.held} appel{t.held > 1 ? "s" : ""} sur {t.created} · {t.avgPresent} présents en moyenne
                </Small>
              </div>
            ))}
        </Box>

        <Box title="Membres à relancer" link={{ to: "/absences", label: "Voir tout" }}>
          {v.streaks.length === 0 && (
            <EmptyState compact tone="ok" icon="ok" title="Aucune alerte" hint="Aucun membre n'a 3 absences consécutives aux GOUDI ALJUMAH." />
          )}
          {v.streaks.slice(0, 5).map((s) => (
            <Row
              key={s.member.id}
              left={<span style={{ fontWeight: 600 }}>{fullName(s.member)}</span>}
              right={<span className="badge inactive">{s.current} absences d'affilée</span>}
            />
          ))}
        </Box>

        <Box title="Appels à régulariser" link={{ to: "/attendance", label: "Saisir les présences" }}>
          {v.toFix.length === 0 && <EmptyState compact tone="ok" icon="ok" title="Tout est à jour" />}
          {v.toFix.slice(0, 5).map((a) => (
            <Row
              key={a.id}
              left={
                <>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <Small>{fmtDate(a.start)}</Small>
                </>
              }
              right={<span className="badge">{a.typeName}</span>}
            />
          ))}
          {v.toFix.length > 5 && <Small>+ {v.toFix.length - 5} autre(s) activité(s)</Small>}
        </Box>

        <Box title="Les plus assidus">
          {v.held.length === 0 && <EmptyState compact icon="stats" title="Pas encore de données" />}
          {v.held.length > 0 &&
            v.assidus.map((x, i) => (
              <Row
                key={x.m.id}
                left={
                  <span style={{ fontWeight: 600 }}>
                    {i + 1}. {fullName(x.m)}
                  </span>
                }
                right={
                  <span style={{ fontWeight: 700, color: rateColor(x.rate) }}>
                    {x.p}/{v.held.length} · {x.rate}%
                  </span>
                }
              />
            ))}
        </Box>
      </div>
    </>
  );
}