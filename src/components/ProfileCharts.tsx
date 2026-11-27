import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type M = {
  gender: string | null; scholarship: string | null; blood_group: string | null;
  ufr: string | null; study_level: string | null; locality: string | null;
};
type Item = { label: string; value: number };

const COLORS = ["#a2443a", "#d9a066", "#18794e", "#3b6ea5", "#8e5ea2", "#b54708", "#5b8c85", "#c76b98", "#6b7a99"];
const GRAY = "#b5aaa4";
const NR = "Non renseigné";

const SEXES = ["Masculin", "Féminin"];
const BOURSE = ["Oui", "Non"];
const SANG = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const UFRS = ["SAT", "SJP", "SEFS", "SEG", "S2ATA", "CRAC", "IPSL", "2S", "Formation", "LSH", "Autre"];
const NIVEAUX = ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2", "Doctorat 1", "Doctorat 2", "Doctorat 3", "Docteur", "Autre"];
const LOGEMENTS = [
  "HORS CAMPUS", "Village A", "Village B", "Village C", "Village D", "Village E", "Village F", "Village G", "Village H",
  "Village I", "Village J", "Village K", "Village L", "Village M", "Village N", "Village O", "Village P", "Village Q", "DAROUL MOURCHID",
];

const clean = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
const fixSexe = (v: string) => { const k = key(v); return k === "M" || k === "H" ? "Masculin" : k === "F" ? "Féminin" : v; };
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);

/** Compte les valeurs ; connues d'abord (dans l'ordre), autres par effectif décroissant, « Non renseigné » à la fin. */
function tally(values: string[], order: string[], keepZero = false): Item[] {
  const t = new Map<string, number>();
  values.forEach((raw) => {
    const v = clean(raw);
    const label = !v ? NR : order.find((o) => key(o) === key(v)) ?? v;
    t.set(label, (t.get(label) ?? 0) + 1);
  });
  const known = order.filter((o) => keepZero || t.has(o)).map((o) => ({ label: o, value: t.get(o) ?? 0 }));
  const others = [...t.entries()].filter(([l]) => l !== NR && !order.includes(l)).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const out = [...known, ...others];
  if (t.has(NR)) out.push({ label: NR, value: t.get(NR)! });
  return out;
}

const colorFor = (label: string, i: number) => (label === NR ? GRAY : COLORS[i % COLORS.length]);

function useAppear() {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setOn(true), 80); return () => window.clearTimeout(t); }, []);
  return on;
}

// Camembert en anneau animé + légende
function Donut({ items }: { items: Item[] }) {
  const on = useAppear();
  const total = items.reduce((s, i) => s + i.value, 0);
  const size = 140, stroke = 24, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} role="img" aria-label="Répartition">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1e8e4" strokeWidth={stroke} />
          {items.map((it, i) => {
            const len = total ? (c * it.value) / total : 0;
            const seg = (
              <circle key={it.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colorFor(it.label, i)} strokeWidth={stroke}
                strokeDasharray={`${on ? len : 0} ${c}`} strokeDashoffset={-acc}
                style={{ transition: `stroke-dasharray .8s ${i * 0.08}s cubic-bezier(.22,.8,.3,1)` }}>
                <title>{`${it.label} : ${it.value} (${pct(it.value, total)}%)`}</title>
              </circle>
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", lineHeight: 1.1 }}>
          <div><strong style={{ fontSize: 24, fontWeight: 800 }}>{total}</strong><div style={{ fontSize: 11, color: "var(--muted)" }}>membres</div></div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 130 }}>
        {items.map((it, i) => (
          <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(it.label, i), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
            <strong>{it.value}</strong>
            <span style={{ color: "var(--muted)", width: 38, textAlign: "right" }}>{pct(it.value, total)}%</span>
          </div>))}
      </div>
    </div>
  );
}

// Barres horizontales animées
function Bars({ items }: { items: Item[] }) {
  const on = useAppear();
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      {items.map((it, i) => (
        <div key={it.label} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3, gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{it.label}</span>
            <span><strong>{it.value}</strong> <span style={{ color: "var(--muted)" }}>· {pct(it.value, total)}%</span></span>
          </div>
          <div style={{ height: 9, borderRadius: 99, background: "#f1e8e4", overflow: "hidden" }}>
            <div style={{ width: on ? `${(it.value / max) * 100}%` : 0, height: "100%", borderRadius: 99, background: colorFor(it.label, i),
              transition: `width .8s ${i * 0.04}s cubic-bezier(.22,.8,.3,1)` }} />
          </div>
        </div>))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 17 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function ProfileCharts() {
  const [members, setMembers] = useState<M[] | null>(null);

  useEffect(() => {
    (async () => {
      const out: M[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("members")
          .select("gender,scholarship,blood_group,ufr,study_level,locality")
          .eq("status", "active").order("id").range(from, from + 999);
        if (error) { setMembers([]); return; }
        out.push(...((data as unknown as M[]) || []));
        if (!data || data.length < 1000) break;
      }
      setMembers(out);
    })();
  }, []);

  const charts = useMemo(() => {
    const m = members || [];
    return {
      sexe: tally(m.map((x) => fixSexe(clean(x.gender))), SEXES, true),
      bourse: tally(m.map((x) => clean(x.scholarship)), BOURSE, true),
      sang: tally(m.map((x) => clean(x.blood_group)), SANG),
      ufr: tally(m.map((x) => clean(x.ufr)), UFRS),
      niveau: tally(m.map((x) => clean(x.study_level)), NIVEAUX),
      logement: tally(m.map((x) => clean(x.locality)), LOGEMENTS),
    };
  }, [members]);

  if (!members || members.length === 0) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Profil des membres actifs</h2>
        <Link to="/statistics" style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>Voir les listes et télécharger →</Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <Card title="Sexe"><Donut items={charts.sexe} /></Card>
        <Card title="Boursiers"><Donut items={charts.bourse} /></Card>
        <Card title="Groupe sanguin"><Donut items={charts.sang} /></Card>
        <Card title="UFR"><Bars items={charts.ufr} /></Card>
        <Card title="Niveau d'étude"><Bars items={charts.niveau} /></Card>
        <Card title="Logement au campus"><Bars items={charts.logement} /></Card>
      </div>
    </div>
  );
}