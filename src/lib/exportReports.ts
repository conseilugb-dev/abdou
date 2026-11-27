import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabase";
import { GOUDI, TYPE_ORDER } from "./stats";

/* ============================================================
   Types
   ============================================================ */
export type Cell = string | number;
export type ReportKind = "synthese" | "stats" | "attendance" | "roll" | "members" | "activities" | "matrix" | "absences";

export type RSheet = {
  name: string;          // nom de la feuille Excel
  title: string;         // titre affiché en tête de tableau
  head: string[];
  rows: Cell[][];
  totals?: Cell[];
  note?: string;
  statusCols?: number[]; // colonnes colorées (Présent / Absent / Excusé)
  matrix?: boolean;      // cellules P / A / E
  kv?: boolean;          // feuille « indicateur / valeur »
  pdf?: boolean;         // false = uniquement dans Excel
};
export type RChart = { title: string; kind: "bar" | "hbar"; items: { label: string; value: number }[]; unit?: string };
export type Report = {
  id: ReportKind; title: string; file: string; sheets: RSheet[]; kpis: [string, string][]; filters: string[];
  insights: string[]; charts: RChart[];
};

export type RMember = {
  id: string; member_number: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  gender?: string | null; birth_date?: string | null; locality: string | null; function_name: string | null; status: string;
  ufr?: string | null; study_field?: string | null; study_level?: string | null; join_year?: number | null;
  guardian_phone?: string | null; blood_group?: string | null; room_number?: string | null;
  scholarship?: string | null; medical_notes?: string | null;
};
export type RActivity = {
  id: string; name: string; description: string | null; location: string | null; start_datetime: string;
  end_datetime: string | null; status: string; activity_type_id: string | null;
};
export type RAttendance = { activity_id: string; member_id: string; status: string; method: string; check_in_at: string | null };
export type RGuest = { activity_id: string; first_name: string; last_name: string };
export type RType = { id: string; name: string };
export type ExportData = {
  members: RMember[]; activities: RActivity[]; attendance: RAttendance[]; guests: RGuest[]; types: RType[]; guestsAvailable: boolean;
};
export type Options = {
  from: string; to: string; type: string; includeInactive: boolean; includeUnmarked: boolean;
  memberFilter?: (m: RMember) => boolean;
};

export const REPORTS: { id: ReportKind; label: string; desc: string }[] = [
  { id: "synthese", label: "Rapport complet", desc: "Le dossier simple et complet : points clés en phrases, chiffres clés, graphiques, statistiques par type, par mois, par jour de la semaine et par activité, puis le détail de chaque membre (global, par type, par mois, par jour) et la liste des membres à relancer." },
  { id: "stats", label: "Statistiques & analyses", desc: "Analyse chiffrée avec graphiques : évolution par mois, jours de la semaine, types d'activité, profils des membres, classement d'assiduité, tendance et cas particuliers." },
  { id: "attendance", label: "Présences détaillées", desc: "Une ligne par membre et par activité : statut, méthode (QR / manuelle), heure d'arrivée, retard, ordre d'arrivée, invités." },
  { id: "roll", label: "Liste nominative", desc: "Pour chaque activité : la liste des noms des présents, des excusés, des absents et des invités, avec la ponctualité (première / dernière arrivée, retard moyen, part QR)." },
  { id: "members", label: "Membres", desc: "Fiche complète de chaque membre (contacts, âge, UFR, filière, niveau…) et ses statistiques de présence (QR, retard moyen, séries)." },
  { id: "activities", label: "Activités", desc: "Toutes les activités avec lieu, horaires, durée, type, présents, excusés, absents, invités et taux de présence, plus bilan par type et par mois." },
  { id: "matrix", label: "Matrice de présence", desc: "Tableau membres × activités (P = présent, A = absent, E = excusé) avec totaux et taux." },
  { id: "absences", label: "Absences", desc: "Membres classés par nombre d'absences, séries d'absences consécutives, membres à relancer, dates des absences." },
];

/* ============================================================
   Chargement des données (pagination : plus de limite à 1000 lignes)
   ============================================================ */
async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw error;
    const batch = (data ?? []) as unknown as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

export async function loadExportData(): Promise<ExportData> {
  const [members, activities, attendance, types] = await Promise.all([
    fetchAll<RMember>("members", "*"),
    fetchAll<RActivity>("activities", "id,name,description,location,start_datetime,end_datetime,status,activity_type_id"),
    fetchAll<RAttendance>("attendance", "activity_id,member_id,status,method,check_in_at"),
    fetchAll<RType>("activity_types", "id,name"),
  ]);
  let guests: RGuest[] = [];
  let guestsAvailable = false;
  try {
    guests = await fetchAll<RGuest>("activity_guests", "activity_id,first_name,last_name");
    guestsAvailable = true;
  } catch { /* table des invités absente : on ignore */ }
  return { members, activities, attendance, guests, types, guestsAvailable };
}

/* ============================================================
   Outils
   ============================================================ */
const D = (v?: string | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");
const DS = (v: string) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const T = (v?: string | null) => (v ? new Date(v).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const fullName = (m: { first_name: string; last_name: string }) => `${m.last_name} ${m.first_name}`.trim();
const STATUS_ACT: Record<string, string> = { "prévue": "Prévue", "en cours": "En cours", "terminée": "Terminée", "annulée": "Annulée" };
const sum = (l: number[]) => l.reduce((n, x) => n + x, 0);
const mins = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const fmtMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(Math.round(n % 60)).padStart(2, "0")}`;
const avg1 = (l: number[]) => (l.length ? Math.round((sum(l) / l.length) * 10) / 10 : 0);
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const t = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const delayMin = (checkIn: string | null, start: string) => {
  if (!checkIn) return null;
  const d = (new Date(checkIn).getTime() - new Date(start).getTime()) / 60000;
  return Math.abs(d) > 720 ? null : Math.round(d);
};
const listDates = (l: string[], max = 15) => (l.length > max ? `${l.slice(0, max).join(", ")} … (+${l.length - max})` : l.join(", "));

type ActInfo = {
  a: RActivity; type: string; marked: boolean; present: number; excused: number; absent: number; total: number;
  guests: number; rate: number; status: Map<string, string>; rows: RAttendance[]; byMember: Map<string, RAttendance>;
};

function compute(d: ExportData, o: Options) {
  const typeName = new Map(d.types.map((t) => [t.id, t.name]));
  const pool = d.members.filter((m) => (o.includeInactive || m.status === "active") && (!o.memberFilter || o.memberFilter(m)));
  const poolIds = new Set(pool.map((m) => m.id));

  const byAct = new Map<string, RAttendance[]>();
  d.attendance.forEach((r) => {
    if (!poolIds.has(r.member_id)) return;
    const list = byAct.get(r.activity_id) ?? [];
    list.push(r);
    byAct.set(r.activity_id, list);
  });
  const guestCount = new Map<string, number>();
  d.guests.forEach((g) => guestCount.set(g.activity_id, (guestCount.get(g.activity_id) ?? 0) + 1));

  const acts: ActInfo[] = d.activities
    .filter((a) => {
      const day = a.start_datetime.slice(0, 10);
      if (o.from && day < o.from) return false;
      if (o.to && day > o.to) return false;
      const tn = typeName.get(a.activity_type_id ?? "") ?? "AUTRE";
      return !o.type || tn === o.type;
    })
    .sort((x, y) => x.start_datetime.localeCompare(y.start_datetime))
    .map((a) => {
      const rows = byAct.get(a.id) ?? [];
      const marked = a.status !== "annulée" && rows.length > 0;
      const present = rows.filter((r) => r.status === "Présent").length;
      const excused = rows.filter((r) => r.status === "Excusé").length;
      const total = marked ? pool.length : 0;
      const absent = marked ? Math.max(0, total - present - excused) : 0;
      return {
        a, type: typeName.get(a.activity_type_id ?? "") ?? "AUTRE", marked, present: marked ? present : 0,
        excused: marked ? excused : 0, absent, total, guests: guestCount.get(a.id) ?? 0,
        rate: pct(marked ? present : 0, total), status: new Map(rows.map((r) => [r.member_id, r.status])), rows,
        byMember: new Map(rows.map((r) => [r.member_id, r])),
      };
    });
  return { pool, acts };
}

type MStat = {
  m: RMember; p: number; e: number; x: number; held: number; rate: number; last: string; first: string; streak: number; max: number;
  maxP: number; absDates: string[]; qr: number; manual: number; delay: number | null;
};
function memberStats(pool: RMember[], acts: ActInfo[]): MStat[] {
  const held = acts.filter((a) => a.marked);
  return pool.map((m) => {
    let p = 0, e = 0, x = 0, streak = 0, max = 0, last = "", first = "", pStreak = 0, maxP = 0, qr = 0, manual = 0;
    const delays: number[] = [];
    const absDates: string[] = [];
    held.forEach((a) => {
      const st = a.status.get(m.id);
      if (st === "Présent") {
        p++; last = a.a.start_datetime; if (!first) first = a.a.start_datetime; streak = 0; pStreak++; maxP = Math.max(maxP, pStreak);
        const r = a.byMember.get(m.id);
        if (r?.method === "qr") qr++; else manual++;
        const d = delayMin(r?.check_in_at ?? null, a.a.start_datetime);
        if (d !== null) delays.push(d);
      } else {
        if (st === "Excusé") e++; else x++;
        pStreak = 0; streak++; max = Math.max(max, streak); absDates.push(D(a.a.start_datetime));
      }
    });
    return {
      m, p, e, x, held: held.length, rate: pct(p, held.length), last, first, streak, max, maxP, absDates, qr, manual,
      delay: delays.length ? Math.round(sum(delays) / delays.length) : null,
    };
  });
}

/* ============================================================
   Feuilles
   ============================================================ */
function sheetTypes(acts: ActInfo[]): RSheet {
  const names = [...TYPE_ORDER, ...[...new Set(acts.map((a) => a.type))].filter((n) => !TYPE_ORDER.includes(n))];
  const rows: Cell[][] = [];
  names.forEach((n) => {
    const l = acts.filter((a) => a.type === n);
    if (!l.length) return;
    const h = l.filter((a) => a.marked);
    const P = sum(h.map((a) => a.present)), E = sum(h.map((a) => a.excused)), A = sum(h.map((a) => a.absent));
    rows.push([n, l.length, h.length, P, E, A, pct(P, P + E + A), h.length ? Math.round((P / h.length) * 10) / 10 : 0]);
  });
  const tc = sum(rows.map((r) => Number(r[1]))), th = sum(rows.map((r) => Number(r[2])));
  const tp = sum(rows.map((r) => Number(r[3]))), te = sum(rows.map((r) => Number(r[4]))), ta = sum(rows.map((r) => Number(r[5])));
  return {
    name: "Par type", title: "Statistiques par type d'activité",
    head: ["Type", "Activités", "Appels réalisés", "Présents", "Excusés", "Absents", "Taux de présence (%)", "Moy. présents / activité"],
    rows, totals: rows.length ? ["TOTAL", tc, th, tp, te, ta, pct(tp, tp + te + ta), th ? Math.round((tp / th) * 10) / 10 : 0] : undefined,
  };
}

function sheetActivities(acts: ActInfo[]): RSheet {
  const rows = acts.map((x) => [
    D(x.a.start_datetime), DAYS[new Date(x.a.start_datetime).getDay()], T(x.a.start_datetime), T(x.a.end_datetime),
    x.a.end_datetime ? Math.max(0, Math.round((new Date(x.a.end_datetime).getTime() - new Date(x.a.start_datetime).getTime()) / 60000)) : "",
    x.a.name, x.type, x.a.location ?? "",
    STATUS_ACT[x.a.status] ?? x.a.status, x.marked ? "Oui" : "Non", x.marked ? x.total : "", x.present, x.excused, x.absent, x.guests,
    x.marked ? x.rate : "", x.a.description ?? "",
  ] as Cell[]);
  const h = acts.filter((a) => a.marked);
  const P = sum(h.map((a) => a.present)), E = sum(h.map((a) => a.excused)), A = sum(h.map((a) => a.absent));
  return {
    name: "Activités", title: "Liste des activités",
    head: ["Date", "Jour", "Début", "Fin", "Durée (min)", "Activité", "Type", "Lieu", "Statut", "Appel fait", "Membres attendus", "Présents", "Excusés", "Absents", "Invités", "Taux (%)", "Description"],
    rows, totals: rows.length ? ["TOTAL", "", "", "", "", `${acts.length} activité(s)`, "", "", "", `${h.length}`, "", P, E, A, sum(acts.map((a) => a.guests)), pct(P, P + E + A), ""] : undefined,
  };
}

function sheetByActivity(acts: ActInfo[]): RSheet {
  const rows = acts.filter((a) => a.marked).map((x) => [D(x.a.start_datetime), x.a.name, x.type, x.a.location ?? "", x.present, x.excused, x.absent, x.guests, x.rate] as Cell[]);
  return {
    name: "Par activité", title: "Résultats par activité (appels réalisés)",
    head: ["Date", "Activité", "Type", "Lieu", "Présents", "Excusés", "Absents", "Invités", "Taux (%)"], rows,
  };
}

function sheetMemberStats(stats: MStat[]): RSheet {
  const sorted = [...stats].sort((a, b) => a.m.last_name.localeCompare(b.m.last_name, "fr") || a.m.first_name.localeCompare(b.m.first_name, "fr"));
  const rows = sorted.map((s) => [
    s.m.member_number, fullName(s.m), s.m.status === "active" ? "Actif" : "Inactif", s.m.function_name ?? "", s.m.ufr ?? "",
    s.held, s.p, s.e, s.x, s.held ? s.rate : "", s.qr, s.manual, s.delay ?? "", s.maxP, D(s.first), D(s.last), s.streak, s.max,
  ] as Cell[]);
  const P = sum(stats.map((s) => s.p)), E = sum(stats.map((s) => s.e)), X = sum(stats.map((s) => s.x));
  return {
    name: "Par membre", title: "Statistiques de présence par membre",
    head: ["N° membre", "Membre", "Statut", "Fonction", "UFR", "Appels concernés", "Présences", "Excusés", "Absences", "Taux (%)", "Présences QR", "Présences manuelles", "Retard moyen (min, − = en avance)", "Plus longue série de présences", "1re présence", "Dernière présence", "Absences d'affilée (en cours)", "Absences d'affilée (max)"],
    rows, totals: rows.length ? ["TOTAL", `${rows.length} membre(s)`, "", "", "", "", P, E, X, pct(P, P + E + X), sum(stats.map((s) => s.qr)), sum(stats.map((s) => s.manual)), "", "", "", "", "", ""] : undefined,
  };
}

function sheetMemberInfo(members: RMember[]): RSheet {
  const sorted = [...members].sort((a, b) => a.last_name.localeCompare(b.last_name, "fr") || a.first_name.localeCompare(b.first_name, "fr"));
  const rows = sorted.map((m) => [
    m.member_number, m.first_name, m.last_name, m.gender === "M" ? "Masculin" : m.gender === "F" ? "Féminin" : (m.gender ?? ""), D(m.birth_date), m.birth_date ? Math.floor((Date.now() - new Date(m.birth_date).getTime()) / 31557600000) : "", m.email ?? "", m.phone ?? "", m.locality ?? "",
    m.function_name ?? "", m.ufr ?? "", m.study_field ?? "", m.study_level ?? "", m.join_year ?? "", m.guardian_phone ?? "",
    m.blood_group ?? "", m.scholarship ?? "", m.medical_notes ?? "", m.room_number ?? "", m.status === "active" ? "Actif" : "Inactif",
  ] as Cell[]);
  const actifs = members.filter((m) => m.status === "active").length;
  return {
    name: "Fiches membres", title: "Fiches des membres",
    head: ["N° membre", "Prénom", "Nom", "Sexe", "Naissance", "Âge", "E-mail", "Téléphone", "Adresse", "Poste (section de base)", "UFR", "Filière", "Niveau", "Année d'adhésion", "Tél. tuteur", "Groupe sanguin", "Boursier", "Maladie chronique ou allergies", "Chambre", "Statut"],
    rows, note: `${members.length} membre(s) dont ${actifs} actif(s) et ${members.length - actifs} inactif(s).`,
  };
}

function sheetAttendance(pool: RMember[], acts: ActInfo[], includeUnmarked: boolean): RSheet {
  const byId = new Map(pool.map((m) => [m.id, m]));
  const rows: Cell[][] = [];
  acts.filter((a) => a.rows.length).forEach((a) => {
    const sorted = [...a.rows].sort((x, y) => (x.check_in_at && y.check_in_at ? x.check_in_at.localeCompare(y.check_in_at) : x.check_in_at ? -1 : y.check_in_at ? 1 : 0));
    let n = 0;
    sorted.forEach((r) => {
      const m = byId.get(r.member_id);
      if (!m) return;
      rows.push([r.check_in_at ? ++n : "", D(a.a.start_datetime), T(a.a.start_datetime), a.a.name, a.type, m.first_name, m.last_name, m.phone ?? "", m.function_name ?? "", r.status, r.method === "qr" ? "QR Code" : "Manuelle", T(r.check_in_at), r.status === "Présent" ? (delayMin(r.check_in_at, a.a.start_datetime) ?? "") : ""]);
    });
    if (includeUnmarked && a.marked) {
      pool.filter((m) => !a.status.has(m.id)).forEach((m) => rows.push(["", D(a.a.start_datetime), T(a.a.start_datetime), a.a.name, a.type, m.first_name, m.last_name, m.phone ?? "", m.function_name ?? "", "Absent", "Non marqué", "", ""]));
    }
  });
  const count = (s: string) => rows.filter((r) => r[9] === s).length;
  return {
    name: "Détail présences", title: "Détail des présences",
    head: ["Ordre", "Date", "Début", "Activité", "Type", "Prénom", "Nom", "Téléphone", "Fonction", "Présence", "Méthode", "Arrivée", "Retard (min)"],
    rows, statusCols: [9],
    note: `${rows.length} ligne(s) : ${count("Présent")} présent(s), ${count("Excusé")} excusé(s), ${count("Absent")} absent(s).`,
  };
}

function sheetMatrix(pool: RMember[], acts: ActInfo[]): RSheet {
  const held = acts.filter((a) => a.marked);
  const sorted = [...pool].sort((a, b) => a.last_name.localeCompare(b.last_name, "fr") || a.first_name.localeCompare(b.first_name, "fr"));
  const rows = sorted.map((m) => {
    let p = 0, x = 0;
    const cells = held.map((a) => {
      const st = a.status.get(m.id);
      if (st === "Présent") { p++; return "P"; }
      x++;
      return st === "Excusé" ? "E" : "A";
    });
    return [fullName(m), ...cells, p, x, pct(p, held.length)] as Cell[];
  });
  const totals: Cell[] = ["Présents / activité", ...held.map((a) => a.present), sum(held.map((a) => a.present)), sum(held.map((a) => a.absent + a.excused)), ""];
  return {
    name: "Matrice", title: "Matrice de présence (P = présent, A = absent, E = excusé)",
    head: ["Membre", ...held.map((a) => `${DS(a.a.start_datetime)} ${a.a.name.slice(0, 16)}`), "Présences", "Absences", "Taux (%)"],
    rows, totals: rows.length ? totals : undefined, matrix: true,
  };
}

function sheetAbsences(stats: MStat[]): RSheet {
  const rows = stats.filter((s) => s.x + s.e > 0).sort((a, b) => b.x + b.e - (a.x + a.e) || b.streak - a.streak)
    .map((s) => [fullName(s.m), s.m.phone ?? "", s.x, s.e, s.held, s.rate, s.streak, s.max, listDates(s.absDates)] as Cell[]);
  return {
    name: "Absences", title: "Membres avec absences (classés par nombre d'absences)",
    head: ["Membre", "Téléphone", "Absences", "Excusés", "Appels réalisés", "Taux de présence (%)", "Série en cours", "Série max", "Dates des absences"], rows,
  };
}

function sheetGoudi(pool: RMember[], acts: ActInfo[]): RSheet | null {
  const g = acts.filter((a) => a.type === GOUDI && a.marked);
  if (!g.length) return null;
  const rows = memberStats(pool, g).filter((s) => s.x + s.e > 0)
    .sort((a, b) => b.streak - a.streak || b.max - a.max || b.x - a.x)
    .map((s) => [fullName(s.m), s.m.phone ?? "", s.held, s.p, s.x + s.e, s.streak, s.max] as Cell[]);
  return {
    name: "Absences GOUDI", title: `Absences consécutives — ${GOUDI}`,
    head: ["Membre", "Téléphone", "Séances", "Présences", "Absences", "Série en cours", "Série max"], rows,
  };
}

function sheetGuests(d: ExportData, acts: ActInfo[]): RSheet | null {
  if (!d.guests.length) return null;
  const byId = new Map(acts.map((a) => [a.a.id, a]));
  const rows = d.guests.filter((g) => byId.has(g.activity_id)).map((g) => {
    const a = byId.get(g.activity_id)!;
    return [D(a.a.start_datetime), a.a.name, a.type, g.first_name, g.last_name] as Cell[];
  }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  if (!rows.length) return null;
  return { name: "Invités", title: "Invités (personnes extérieures)", head: ["Date", "Activité", "Type", "Prénom", "Nom"], rows };
}

function sheetMonthly(acts: ActInfo[]): RSheet {
  const keys = [...new Set(acts.map((a) => a.a.start_datetime.slice(0, 7)))].sort();
  let prev: number | null = null;
  const rows: Cell[][] = keys.map((k) => {
    const l = acts.filter((a) => a.a.start_datetime.slice(0, 7) === k);
    const h = l.filter((a) => a.marked);
    const P = sum(h.map((a) => a.present)), E = sum(h.map((a) => a.excused)), A = sum(h.map((a) => a.absent));
    const rate = pct(P, P + E + A);
    const evo: Cell = h.length && prev !== null ? rate - prev : "";
    if (h.length) prev = rate;
    return [monthLabel(k), l.length, h.length, P, E, A, sum(l.map((a) => a.guests)), h.length ? rate : "", h.length ? avg1(h.map((a) => a.present)) : "", evo];
  });
  return {
    name: "Par mois", title: "Évolution mensuelle de la présence",
    head: ["Mois", "Activités", "Appels réalisés", "Présents", "Excusés", "Absents", "Invités", "Taux (%)", "Moy. présents / activité", "Évolution (points)"], rows,
  };
}

function sheetWeekday(acts: ActInfo[]): RSheet {
  const rows: Cell[][] = [];
  [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
    const l = acts.filter((a) => new Date(a.a.start_datetime).getDay() === d);
    if (!l.length) return;
    const h = l.filter((a) => a.marked);
    const P = sum(h.map((a) => a.present)), E = sum(h.map((a) => a.excused)), A = sum(h.map((a) => a.absent));
    rows.push([DAYS[d], l.length, h.length, P, E, A, h.length ? pct(P, P + E + A) : "", h.length ? avg1(h.map((a) => a.present)) : ""]);
  });
  return {
    name: "Par jour", title: "Présence selon le jour de la semaine",
    head: ["Jour", "Activités", "Appels réalisés", "Présents", "Excusés", "Absents", "Taux (%)", "Moy. présents / activité"], rows,
  };
}

function sheetProfile(stats: MStat[], key: "function_name" | "ufr" | "study_level" | "gender" | "scholarship" | "blood_group" | "locality", name: string, label: string): RSheet | null {
  const groups = new Map<string, MStat[]>();
  stats.forEach((s) => {
    const raw = String((s.m as unknown as Record<string, unknown>)[key] ?? "").trim();
    // Le poste peut être multiple (« CA, CL ») : le membre est compté dans chaque poste
    const parts = key === "function_name" ? raw.split(/[,;/+&|]| et /i).map((x) => x.trim()).filter(Boolean) : raw ? [raw] : [];
    (parts.length ? parts : ["Non renseigné"]).forEach((v) => groups.set(v, [...(groups.get(v) ?? []), s]));
  });
  if (!stats.length || (groups.size === 1 && groups.has("Non renseigné"))) return null;
  const rows: Cell[][] = [...groups.entries()].map(([g, l]) => {
    const P = sum(l.map((s) => s.p)), E = sum(l.map((s) => s.e)), X = sum(l.map((s) => s.x));
    const withCalls = l.filter((s) => s.held > 0);
    return [g, l.length, P, E, X, pct(P, P + E + X), withCalls.length ? avg1(withCalls.map((s) => s.rate)) : "", l.filter((s) => s.held > 0 && s.p === 0).length];
  }).sort((a, b) => Number(b[5]) - Number(a[5]) || String(a[0]).localeCompare(String(b[0]), "fr"));
  return {
    name, title: `Présence par ${label.toLowerCase()}`,
    head: [label, "Membres", "Présences", "Excusés", "Absences", "Taux global (%)", "Taux moyen par membre (%)", "Jamais présents"], rows,
  };
}

function sheetRanking(stats: MStat[]): RSheet {
  const rows = stats.filter((s) => s.held > 0)
    .sort((a, b) => b.rate - a.rate || b.p - a.p || a.m.last_name.localeCompare(b.m.last_name, "fr"))
    .map((s, i) => [i + 1, fullName(s.m), s.m.function_name ?? "", s.m.ufr ?? "", s.held, s.p, s.e, s.x, s.rate, s.maxP, s.streak] as Cell[]);
  return {
    name: "Classement", title: "Classement d'assiduité (du plus au moins présent)",
    head: ["Rang", "Membre", "Fonction", "UFR", "Appels concernés", "Présences", "Excusés", "Absences", "Taux (%)", "Plus longue série de présences", "Absences d'affilée (en cours)"], rows,
  };
}

function sheetHighlights(stats: MStat[]): RSheet {
  const withCalls = stats.filter((s) => s.held > 0);
  const row = (cat: string, s: MStat) => [cat, fullName(s.m), s.m.phone ?? "", s.m.function_name ?? "", s.held, s.p, s.x + s.e, s.rate, s.streak] as Cell[];
  const rows: Cell[][] = [];
  withCalls.filter((s) => s.rate === 100).forEach((s) => rows.push(row("Assiduité parfaite (100 %)", s)));
  withCalls.filter((s) => s.streak >= 3).sort((a, b) => b.streak - a.streak).forEach((s) => rows.push(row("À relancer : 3 absences d'affilée ou plus", s)));
  withCalls.filter((s) => s.p === 0).forEach((s) => rows.push(row("Jamais présent", s)));
  withCalls.filter((s) => s.p > 0 && s.rate < 50).sort((a, b) => a.rate - b.rate).forEach((s) => rows.push(row("Présence inférieure à 50 %", s)));
  return {
    name: "Cas particuliers", title: "Cas particuliers : assidus, à relancer, jamais présents",
    head: ["Catégorie", "Membre", "Téléphone", "Fonction", "Appels concernés", "Présences", "Absences + excusés", "Taux (%)", "Absences d'affilée (en cours)"], rows,
  };
}

/** Version courte : une ligne simple par membre. */
function sheetMemberSimple(stats: MStat[]): RSheet {
  const sorted = [...stats].sort((a, b) => a.m.last_name.localeCompare(b.m.last_name, "fr") || a.m.first_name.localeCompare(b.m.first_name, "fr"));
  const rows = sorted.map((s) => [fullName(s.m), s.held, s.p, s.e, s.x, s.held ? s.rate : "", s.last ? D(s.last) : "", s.streak] as Cell[]);
  return {
    name: "Par membre", title: "Présence de chaque membre",
    head: ["Membre", "Appels concernés", "Présences", "Excusés", "Absences", "Taux (%)", "Dernière présence", "Absences d'affilée (en cours)"], rows,
  };
}

/** Taux de présence de chaque membre, mois par mois. */
function sheetMemberByMonth(pool: RMember[], acts: ActInfo[]): RSheet | null {
  const held = acts.filter((a) => a.marked);
  const keys = [...new Set(held.map((a) => a.a.start_datetime.slice(0, 7)))].sort();
  if (!keys.length) return null;
  const sorted = [...pool].sort((a, b) => a.last_name.localeCompare(b.last_name, "fr") || a.first_name.localeCompare(b.first_name, "fr"));
  const rows = sorted.map((m) => {
    const cells = keys.map((k) => {
      const l = held.filter((a) => a.a.start_datetime.slice(0, 7) === k);
      return pct(l.filter((a) => a.status.get(m.id) === "Présent").length, l.length);
    });
    return [fullName(m), ...cells, pct(held.filter((a) => a.status.get(m.id) === "Présent").length, held.length)] as Cell[];
  });
  return {
    name: "Membre x mois", title: "Taux de présence de chaque membre par mois (%)",
    head: ["Membre", ...keys.map((k) => `${monthLabel(k)} (%)`), "Global (%)"], rows, pdf: false,
  };
}

/** Taux de présence de chaque membre selon le jour de la semaine. */
function sheetMemberByWeekday(pool: RMember[], acts: ActInfo[]): RSheet | null {
  const held = acts.filter((a) => a.marked);
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => held.some((a) => new Date(a.a.start_datetime).getDay() === d));
  if (days.length < 2) return null;
  const sorted = [...pool].sort((a, b) => a.last_name.localeCompare(b.last_name, "fr") || a.first_name.localeCompare(b.first_name, "fr"));
  const rows = sorted.map((m) => {
    const cells = days.map((d) => {
      const l = held.filter((a) => new Date(a.a.start_datetime).getDay() === d);
      return pct(l.filter((a) => a.status.get(m.id) === "Présent").length, l.length);
    });
    return [fullName(m), ...cells, pct(held.filter((a) => a.status.get(m.id) === "Présent").length, held.length)] as Cell[];
  });
  return {
    name: "Membre x jour", title: "Taux de présence de chaque membre par jour de la semaine (%)",
    head: ["Membre", ...days.map((d) => `${DAYS[d]} (%)`), "Global (%)"], rows, pdf: false,
  };
}

function sheetMemberByType(pool: RMember[], acts: ActInfo[]): RSheet | null {
  const held = acts.filter((a) => a.marked);
  const types = [...TYPE_ORDER, ...[...new Set(held.map((a) => a.type))].filter((n) => !TYPE_ORDER.includes(n))].filter((t) => held.some((a) => a.type === t));
  if (types.length < 2) return null;
  const sorted = [...pool].sort((a, b) => a.last_name.localeCompare(b.last_name, "fr") || a.first_name.localeCompare(b.first_name, "fr"));
  const rows = sorted.map((m) => {
    const cells = types.map((t) => {
      const l = held.filter((a) => a.type === t);
      return pct(l.filter((a) => a.status.get(m.id) === "Présent").length, l.length);
    });
    return [fullName(m), ...cells, pct(held.filter((a) => a.status.get(m.id) === "Présent").length, held.length)] as Cell[];
  });
  return {
    name: "Membre x type", title: "Taux de présence de chaque membre par type d'activité (%)",
    head: ["Membre", ...types.map((t) => `${t} (%)`), "Global (%)"], rows,
    pdf: types.length <= 6,
  };
}

function sheetArrivals(acts: ActInfo[]): RSheet {
  const rows: Cell[][] = [];
  acts.filter((a) => a.marked).forEach((a) => {
    const present = a.rows.filter((r) => r.status === "Présent");
    const times = present.filter((r) => r.check_in_at).map((r) => mins(r.check_in_at as string));
    const delays = present.map((r) => delayMin(r.check_in_at, a.a.start_datetime)).filter((d): d is number => d !== null);
    const qr = present.filter((r) => r.method === "qr").length;
    rows.push([
      D(a.a.start_datetime), a.a.name, a.type, T(a.a.start_datetime),
      times.length ? fmtMin(Math.min(...times)) : "", times.length ? fmtMin(Math.max(...times)) : "", times.length ? fmtMin(sum(times) / times.length) : "",
      delays.length ? Math.round(sum(delays) / delays.length) : "", delays.length ? delays.filter((d) => d > 10).length : "",
      qr, present.length - qr, present.length ? pct(qr, present.length) : "",
    ]);
  });
  return {
    name: "Ponctualité", title: "Ponctualité et mode de pointage par activité",
    head: ["Date", "Activité", "Type", "Début prévu", "1re arrivée", "Dernière arrivée", "Heure moyenne", "Retard moyen (min)", "Arrivées > 10 min de retard", "Présents QR", "Présents manuels", "Part QR (%)"], rows,
    note: "Retard = heure de pointage − heure de début prévue (négatif = en avance).",
  };
}

function sheetRoll(d: ExportData, pool: RMember[], acts: ActInfo[]): RSheet {
  const byId = new Map(pool.map((m) => [m.id, m]));
  const guestsBy = new Map<string, string[]>();
  d.guests.forEach((g) => guestsBy.set(g.activity_id, [...(guestsBy.get(g.activity_id) ?? []), fullName(g)]));
  const names = (ids: string[]) => ids.map((id) => byId.get(id)).filter((m): m is RMember => !!m).map(fullName).sort((a, b) => a.localeCompare(b, "fr")).join("; ");
  const rows = acts.filter((a) => a.marked).map((a) => {
    const ids = (st: string) => [...a.status.entries()].filter(([, v]) => v === st).map(([k]) => k);
    const absIds = pool.filter((m) => { const st = a.status.get(m.id); return st !== "Présent" && st !== "Excusé"; }).map((m) => m.id);
    const gl = guestsBy.get(a.a.id) ?? [];
    return [D(a.a.start_datetime), a.a.name, a.type, a.present, names(ids("Présent")), a.excused, names(ids("Excusé")), a.absent, names(absIds), gl.length, gl.sort().join("; ")] as Cell[];
  });
  return {
    name: "Liste nominative", title: "Liste nominative des présents, excusés, absents et invités par activité",
    head: ["Date", "Activité", "Type", "Présents", "Noms des présents", "Excusés", "Noms des excusés", "Absents", "Noms des absents", "Invités", "Noms des invités"], rows,
  };
}

/* ============================================================
   Analyse automatique : constats et graphiques
   ============================================================ */
function buildInsights(pool: RMember[], acts: ActInfo[], stats: MStat[]): string[] {
  const held = acts.filter((a) => a.marked);
  const out: string[] = [];
  if (!acts.length) return ["Aucune activité sur cette sélection."];
  const P = sum(held.map((a) => a.present)), E = sum(held.map((a) => a.excused)), A = sum(held.map((a) => a.absent));
  out.push(`${acts.length} activité(s) du ${D(acts[0].a.start_datetime)} au ${D(acts[acts.length - 1].a.start_datetime)}, dont ${held.length} avec appel réalisé, pour ${pool.length} membre(s).`);
  if (!held.length) return out;
  out.push(`Taux de présence global : ${pct(P, P + E + A)} % (${P} présences, ${E} excusés, ${A} absences). En moyenne ${avg1(held.map((a) => a.present))} présents par activité.`);
  const byRate = [...held].sort((x, y) => y.rate - x.rate);
  out.push(`Meilleure présence : « ${byRate[0].a.name} » du ${D(byRate[0].a.start_datetime)} avec ${byRate[0].rate} % (${byRate[0].present} présents).`);
  if (held.length > 1) out.push(`Présence la plus faible : « ${byRate[byRate.length - 1].a.name} » du ${D(byRate[byRate.length - 1].a.start_datetime)} avec ${byRate[byRate.length - 1].rate} % (${byRate[byRate.length - 1].present} présents).`);

  const typeRates = [...new Set(held.map((a) => a.type))].map((t) => {
    const l = held.filter((a) => a.type === t);
    const p = sum(l.map((a) => a.present)), tot = sum(l.map((a) => a.present + a.excused + a.absent));
    return { t, rate: pct(p, tot), n: l.length };
  }).sort((a, b) => b.rate - a.rate);
  if (typeRates.length > 1) out.push(`Type d'activité le plus suivi : ${typeRates[0].t} (${typeRates[0].rate} %, ${typeRates[0].n} appel(s)). Le moins suivi : ${typeRates[typeRates.length - 1].t} (${typeRates[typeRates.length - 1].rate} %).`);

  const months = [...new Set(held.map((a) => a.a.start_datetime.slice(0, 7)))].sort().map((k) => {
    const l = held.filter((a) => a.a.start_datetime.slice(0, 7) === k);
    return { k, rate: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
  });
  if (months.length > 1) {
    const b = [...months].sort((x, y) => y.rate - x.rate);
    out.push(`Meilleur mois : ${monthLabel(b[0].k)} (${b[0].rate} %). Mois le plus faible : ${monthLabel(b[b.length - 1].k)} (${b[b.length - 1].rate} %).`);
  }
  const days = [...new Set(held.map((a) => new Date(a.a.start_datetime).getDay()))].map((d) => {
    const l = held.filter((a) => new Date(a.a.start_datetime).getDay() === d);
    return { d, rate: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
  }).sort((a, b) => b.rate - a.rate);
  if (days.length > 1) out.push(`Jour le plus fréquenté : ${DAYS[days[0].d]} (${days[0].rate} %). Jour le moins fréquenté : ${DAYS[days[days.length - 1].d]} (${days[days.length - 1].rate} %).`);

  if (held.length >= 4) {
    const half = Math.floor(held.length / 2);
    const r1 = avg1(held.slice(0, half).map((a) => a.rate)), r2 = avg1(held.slice(held.length - half).map((a) => a.rate));
    const diff = Math.round((r2 - r1) * 10) / 10;
    out.push(`Tendance : ${diff > 1 ? `en hausse de ${diff} points` : diff < -1 ? `en baisse de ${Math.abs(diff)} points` : "stable"} (taux moyen ${r1} % sur la première moitié des activités, ${r2} % sur la seconde).`);
  }
  const wc = stats.filter((s) => s.held > 0);
  const top = [...wc].sort((a, b) => b.rate - a.rate || b.p - a.p).slice(0, 3);
  if (top.length) out.push(`Membres les plus assidus : ${top.map((s) => `${fullName(s.m)} (${s.rate} %)`).join(", ")}.`);
  out.push(`${wc.filter((s) => s.rate === 100).length} membre(s) à 100 % de présence · ${wc.filter((s) => s.p === 0).length} jamais présent(s) · ${wc.filter((s) => s.p > 0 && s.rate < 50).length} sous les 50 % · ${wc.filter((s) => s.streak >= 3).length} à relancer (3 absences d'affilée ou plus).`);
  const relance = wc.filter((s) => s.streak >= 3).sort((a, b) => b.streak - a.streak);
  if (relance.length) out.push(`À relancer en priorité : ${relance.slice(0, 5).map((s) => `${fullName(s.m)} (${s.streak} absences d'affilée)`).join(", ")}${relance.length > 5 ? ` … et ${relance.length - 5} autre(s)` : ""}.`);
  const allPres = held.flatMap((a) => a.rows.filter((r) => r.status === "Présent"));
  if (allPres.length) {
    const qr = allPres.filter((r) => r.method === "qr").length;
    const times = allPres.filter((r) => r.check_in_at).map((r) => mins(r.check_in_at as string));
    out.push(`Pointage : ${pct(qr, allPres.length)} % par QR Code, ${100 - pct(qr, allPres.length)} % en manuel${times.length ? `. Heure moyenne d'arrivée : ${fmtMin(sum(times) / times.length)}` : ""}.`);
  }
  const g = sum(acts.map((a) => a.guests));
  if (g) out.push(`${g} invité(s) extérieur(s) accueilli(s) sur la période.`);
  return out;
}

function buildCharts(acts: ActInfo[], stats: MStat[]): RChart[] {
  const held = acts.filter((a) => a.marked);
  const charts: RChart[] = [];
  if (held.length > 1) {
    const l = held.slice(-24);
    charts.push({
      title: `Taux de présence par activité (${l.length} dernière(s) activité(s))`, kind: "bar", unit: "%",
      items: l.map((a) => ({ label: new Date(a.a.start_datetime).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), value: a.rate })),
    });
  }
  const types = [...new Set(held.map((a) => a.type))];
  if (types.length > 1) {
    charts.push({
      title: "Taux de présence par type d'activité", kind: "hbar", unit: "%",
      items: types.map((t) => {
        const l = held.filter((a) => a.type === t);
        return { label: t, value: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
      }).sort((a, b) => b.value - a.value),
    });
  }
  const months = [...new Set(held.map((a) => a.a.start_datetime.slice(0, 7)))].sort();
  if (months.length > 1) {
    charts.push({
      title: "Taux de présence par mois", kind: "bar", unit: "%",
      items: months.map((k) => {
        const l = held.filter((a) => a.a.start_datetime.slice(0, 7) === k);
        return { label: k.slice(5) + "/" + k.slice(2, 4), value: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
      }),
    });
  }
  const dayKeys = [1, 2, 3, 4, 5, 6, 0].filter((d) => held.some((a) => new Date(a.a.start_datetime).getDay() === d));
  if (dayKeys.length > 1) {
    charts.push({
      title: "Taux de présence par jour de la semaine", kind: "bar", unit: "%",
      items: dayKeys.map((d) => {
        const l = held.filter((a) => new Date(a.a.start_datetime).getDay() === d);
        return { label: DAYS[d].slice(0, 3), value: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
      }),
    });
  }
  const top = stats.filter((s) => s.held > 0).sort((a, b) => b.rate - a.rate || b.p - a.p).slice(0, 10);
  if (top.length > 2) charts.push({ title: "Top 10 des membres les plus assidus", kind: "hbar", unit: "%", items: top.map((s) => ({ label: fullName(s.m), value: s.rate })) });
  return charts;
}

/* ============================================================
   Construction d'un rapport
   ============================================================ */
export function buildReport(kind: ReportKind, d: ExportData, opts: Options): Report {
  const o: Options = { ...opts, includeInactive: kind === "members" ? true : opts.includeInactive };
  const { pool, acts } = compute(d, o);
  const held = acts.filter((a) => a.marked);
  const P = sum(held.map((a) => a.present)), E = sum(held.map((a) => a.excused)), A = sum(held.map((a) => a.absent));
  const guestTotal = sum(acts.map((a) => a.guests));
  const stats = memberStats(pool, acts);
  const withCalls = stats.filter((s) => s.held > 0);
  const insights = buildInsights(pool, acts, stats);
  const charts = buildCharts(acts, stats);

  const kpis: [string, string][] = [
    ["Membres", String(pool.length)], ["Activités", String(acts.length)], ["Appels réalisés", String(held.length)],
    ["Présences", String(P)], ["Excusés", String(E)], ["Absences", String(A)], ["Taux de présence", `${pct(P, P + E + A)} %`],
    ["Moy. présents", held.length ? String(avg1(held.map((a) => a.present))) : "0"],
  ];

  const allPres = held.flatMap((a) => a.rows.filter((r) => r.status === "Présent"));
  const times = allPres.filter((r) => r.check_in_at).map((r) => mins(r.check_in_at as string));
  const delays = held.flatMap((a) => a.rows.filter((r) => r.status === "Présent").map((r) => delayMin(r.check_in_at, a.a.start_datetime))).filter((x): x is number => x !== null);
  const monthRates = [...new Set(held.map((a) => a.a.start_datetime.slice(0, 7)))].sort().map((k) => {
    const l = held.filter((a) => a.a.start_datetime.slice(0, 7) === k);
    return { k, rate: pct(sum(l.map((a) => a.present)), sum(l.map((a) => a.present + a.excused + a.absent))) };
  }).sort((x, y) => y.rate - x.rate);
  const best = held.length ? [...held].sort((x, y) => y.rate - x.rate)[0] : null;
  const worst = held.length ? [...held].sort((x, y) => x.rate - y.rate)[0] : null;
  const count = (st: string) => acts.filter((a) => a.a.status === st).length;

  const summary: RSheet = {
    name: "Résumé", title: "Résumé de la période", kv: true, head: ["Indicateur", "Valeur"],
    rows: [
      ["Membres pris en compte", pool.length], ["Membres actifs", pool.filter((m) => m.status === "active").length],
      ["Activités dans la période", acts.length], ["  dont prévues", count("prévue")], ["  dont en cours", count("en cours")],
      ["  dont terminées", count("terminée")], ["  dont annulées", count("annulée")],
      ["Activités avec appel réalisé", held.length],
      ["Activités terminées sans appel", acts.filter((a) => a.a.status === "terminée" && !a.marked).length],
      ["Total présences", P], ["Total excusés", E], ["Total absences (non excusées)", A],
      ["Taux de présence global (%)", pct(P, P + E + A)], ["Taux d'absence (%)", pct(A, P + E + A)], ["Taux d'excusés (%)", pct(E, P + E + A)],
      ["Moyenne de présents par activité", held.length ? avg1(held.map((a) => a.present)) : 0],
      ["Plus grand nombre de présents", held.length ? Math.max(...held.map((a) => a.present)) : 0],
      ["Plus petit nombre de présents", held.length ? Math.min(...held.map((a) => a.present)) : 0],
      ["Invités (personnes extérieures)", guestTotal],
      ["Première activité", acts.length ? D(acts[0].a.start_datetime) : ""], ["Dernière activité", acts.length ? D(acts[acts.length - 1].a.start_datetime) : ""],
      ["Meilleure présence", best ? `${best.a.name} (${D(best.a.start_datetime)}) — ${best.rate} %` : ""],
      ["Plus faible présence", worst ? `${worst.a.name} (${D(worst.a.start_datetime)}) — ${worst.rate} %` : ""],
      ["Meilleur mois", monthRates.length ? `${monthLabel(monthRates[0].k)} — ${monthRates[0].rate} %` : ""],
      ["Mois le plus faible", monthRates.length > 1 ? `${monthLabel(monthRates[monthRates.length - 1].k)} — ${monthRates[monthRates.length - 1].rate} %` : ""],
      ["Membres à 100 % de présence", withCalls.filter((s) => s.rate === 100).length],
      ["Membres jamais présents", withCalls.filter((s) => s.p === 0).length],
      ["Membres sous 50 % de présence", withCalls.filter((s) => s.p > 0 && s.rate < 50).length],
      ["Membres à relancer (3 absences d'affilée ou +)", withCalls.filter((s) => s.streak >= 3).length],
      ["Présences pointées par QR Code (%)", allPres.length ? pct(allPres.filter((r) => r.method === "qr").length, allPres.length) : ""],
      ["Heure moyenne d'arrivée", times.length ? fmtMin(sum(times) / times.length) : ""],
      ["Retard moyen (min)", delays.length ? Math.round(sum(delays) / delays.length) : ""],
    ],
  };
  const lean: RSheet = {
    name: "Chiffres clés", title: "Chiffres clés de la période", kv: true, head: ["Indicateur", "Valeur"],
    rows: [
      ["Membres pris en compte", pool.length], ["Activités dans la période", acts.length], ["Appels réalisés", held.length],
      ["Présences", P], ["Excusés", E], ["Absences (non excusées)", A], ["Taux de présence global (%)", pct(P, P + E + A)],
      ["Moyenne de présents par activité", held.length ? avg1(held.map((a) => a.present)) : 0],
      ["Meilleure présence", best ? `${best.a.name} (${D(best.a.start_datetime)}) : ${best.rate} %` : ""],
      ["Plus faible présence", worst ? `${worst.a.name} (${D(worst.a.start_datetime)}) : ${worst.rate} %` : ""],
      ["Meilleur mois", monthRates.length ? `${monthLabel(monthRates[0].k)} : ${monthRates[0].rate} %` : ""],
      ["Mois le plus faible", monthRates.length > 1 ? `${monthLabel(monthRates[monthRates.length - 1].k)} : ${monthRates[monthRates.length - 1].rate} %` : ""],
      ["Membres à 100 % de présence", withCalls.filter((s) => s.rate === 100).length],
      ["Membres jamais présents", withCalls.filter((s) => s.p === 0).length],
      ["Membres à relancer (3 absences d'affilée ou +)", withCalls.filter((s) => s.streak >= 3).length],
      ...(guestTotal ? [["Invités (personnes extérieures)", guestTotal] as Cell[]] : []),
    ],
  };
  const insightSheet: RSheet = { name: "Points clés", title: "Points clés de la période", head: ["N°", "Constat"], rows: insights.map((t, i) => [i + 1, t]) };

  const goudi = sheetGoudi(pool, acts);
  const guests = sheetGuests(d, acts);
  const profiles = [
    sheetProfile(stats, "function_name", "Par fonction", "Fonction"), sheetProfile(stats, "ufr", "Par UFR", "UFR"),
    sheetProfile(stats, "study_level", "Par niveau", "Niveau"), sheetProfile(stats, "gender", "Par sexe", "Sexe"),
    sheetProfile(stats, "scholarship", "Par boursier", "Boursier"), sheetProfile(stats, "blood_group", "Par groupe sanguin", "Groupe sanguin"),
    sheetProfile(stats, "locality", "Par logement", "Logement"),
  ].filter((x): x is RSheet => !!x);
  const byType = sheetMemberByType(pool, acts);
  const sheets: RSheet[] = [];
  const add = (...l: (RSheet | null)[]) => l.forEach((x) => { if (x) sheets.push(x); });
  let title = "Rapport";
  let reportCharts = charts;

  if (kind === "synthese") {
    title = "Rapport complet";
    // Dossier simple : points clés, chiffres clés, puis par type / mois / jour / activité, puis chaque membre
    add(insightSheet, lean, sheetTypes(acts), sheetMonthly(acts), sheetWeekday(acts), sheetByActivity(acts));
    add(sheetMemberSimple(stats), byType ? { ...byType, pdf: false } : null, sheetMemberByMonth(pool, acts), sheetMemberByWeekday(pool, acts), sheetHighlights(stats));
  } else if (kind === "stats") {
    title = "Statistiques et analyses";
    add(summary, insightSheet, sheetTypes(acts), sheetMonthly(acts), sheetWeekday(acts), ...profiles, sheetRanking(stats), sheetHighlights(stats), byType);
  } else if (kind === "attendance") {
    title = "Présences détaillées"; reportCharts = [];
    add(sheetAttendance(pool, acts, o.includeUnmarked), guests);
  } else if (kind === "roll") {
    title = "Liste nominative par activité"; reportCharts = [];
    add(sheetRoll(d, pool, acts), sheetArrivals(acts), guests);
  } else if (kind === "members") {
    title = "Liste et statistiques des membres"; reportCharts = [];
    add(sheetMemberInfo(pool), sheetMemberStats(stats), ...profiles);
  } else if (kind === "activities") {
    title = "Activités"; reportCharts = charts.filter((c) => c.title.includes("par activité") || c.title.includes("par type") || c.title.includes("par mois"));
    add(sheetActivities(acts), sheetTypes(acts), sheetMonthly(acts), sheetArrivals(acts));
  } else if (kind === "matrix") {
    title = "Matrice de présence"; reportCharts = [];
    add(sheetMatrix(pool, acts));
  } else {
    title = "Absences des membres"; reportCharts = [];
    add(sheetAbsences(stats), sheetHighlights(stats), goudi);
  }

  const filters = [
    o.from || o.to ? `Période : ${o.from ? `du ${D(o.from + "T12:00:00")}` : "depuis le début"} ${o.to ? `au ${D(o.to + "T12:00:00")}` : "à aujourd'hui"}` : "Période : toutes les dates",
    `Type : ${o.type || "tous les types"}`,
    kind === "members" ? "Membres : selon les filtres choisis" : o.includeInactive ? "Membres : actifs et anciens" : "Membres : actifs uniquement",
    ...(o.memberFilter && kind !== "members" ? ["Filtre membres appliqué"] : []),
  ];
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: kind, title, file: `moustarchidine-junior-${slug(title)}-${new Date().toISOString().slice(0, 10)}`,
    sheets, kpis, filters, insights: kind === "synthese" || kind === "stats" ? insights : [], charts: reportCharts,
  };
}

/* ============================================================
   Export Excel
   ============================================================ */
export function writeExcel(rep: Report, org: string) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const now = new Date().toLocaleString("fr-FR");
  const info: Cell[][] = [
    [org], [`Rapport : ${rep.title}`], [`Généré le ${now}`], [],
    ["Filtres appliqués"], ...rep.filters.map((f) => [f] as Cell[]), [],
    ["Indicateurs clés"], ...rep.kpis.map(([k, v]) => [k, v] as Cell[]), [],
    ...(rep.insights.length ? [["Points clés"] as Cell[], ...rep.insights.map((t, i) => [i + 1, t] as Cell[]), []] : []),
    ["Contenu du fichier"], ["Feuille", "Lignes", "Description"],
    ...rep.sheets.map((s) => [s.name, s.rows.length, s.title] as Cell[]), [],
    ["Définitions"],
    ["Taux de présence", "Présents ÷ (présents + excusés + absents) pour les activités dont l'appel a été réalisé."],
    ["Absent", "Membre sans présence enregistrée dans une activité dont l'appel a été fait (ou marqué Absent)."],
    ["Excusé", "Membre dont l'absence a été excusée ; il n'est pas compté comme présent."],
    ["Série d'absences", "Nombre d'activités consécutives (appels réalisés) sans présence."],
    ["Retard", "Heure de pointage − heure de début prévue, en minutes (négatif = arrivé en avance)."],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(info);
  wsInfo["!cols"] = [{ wch: 34 }, { wch: 60 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Informations");
  used.add("informations");
  rep.sheets.forEach((s) => {
    const top: Cell[][] = [[`${org} — ${rep.title} — ${s.title}`], [`${rep.filters.join("  |  ")}  |  Généré le ${now}`], s.note ? [s.note] : []];
    const aoa: Cell[][] = [...top, s.head, ...s.rows, ...(s.totals ? [s.totals] : [])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const last = Math.max(0, s.head.length - 1);
    const headRow = top.length;
    ws["!cols"] = s.head.map((h, c) => {
      if (s.matrix) return { wch: c === 0 ? 28 : c > s.head.length - 4 ? 11 : 9 };
      const longest = Math.max(h.length, ...s.rows.slice(0, 400).map((r) => String(r[c] ?? "").length), 6);
      return { wch: Math.min(48, longest + 2) };
    });
    ws["!merges"] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: last } }));
    if (s.rows.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headRow, c: 0 }, e: { r: headRow + s.rows.length, c: last } }) };
    let name = s.name.replace(/[[\]:*?/\\]/g, "").slice(0, 31) || "Feuille";
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${i++}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, `${rep.file}.xlsx`);
}

/* ============================================================
   Export PDF
   ============================================================ */
export type Brand = { org: string; section: string; conseil: string; comite: string; logo: string };

async function loadImage(url: string): Promise<{ data: string; fmt: "PNG" | "JPEG"; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data: string = await new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => ko(new Error("lecture"));
      r.readAsDataURL(blob);
    });
    if (!data.startsWith("data:image/png") && !data.startsWith("data:image/jpeg")) return null;
    const dim = await new Promise<{ w: number; h: number }>((ok) => {
      const im = new Image();
      im.onload = () => ok({ w: im.width || 1, h: im.height || 1 });
      im.onerror = () => ok({ w: 1, h: 1 });
      im.src = data;
    });
    return { data, fmt: data.startsWith("data:image/png") ? "PNG" : "JPEG", ...dim };
  } catch { return null; }
}

const BRAND: [number, number, number] = [162, 68, 58];
const GOLD: [number, number, number] = [217, 160, 102];
const TINT: [number, number, number] = [248, 235, 232];
const INK: [number, number, number] = [33, 26, 24];
const MUTED: [number, number, number] = [107, 95, 91];
const COLORS: Record<string, { fg: [number, number, number]; bg: [number, number, number] }> = {
  "Présent": { fg: [24, 121, 78], bg: [229, 245, 236] }, P: { fg: [24, 121, 78], bg: [229, 245, 236] },
  "Absent": { fg: [180, 35, 24], bg: [252, 235, 233] }, A: { fg: [180, 35, 24], bg: [252, 235, 233] },
  "Excusé": { fg: [181, 71, 8], bg: [254, 243, 224] }, E: { fg: [181, 71, 8], bg: [254, 243, 224] },
};

type Doc = InstanceType<typeof jsPDF>;
function drawChart(doc: Doc, c: RChart, x: number, y: number, w: number): number {
  doc.setTextColor(...BRAND); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  doc.text(c.title, x, y);
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(x, y + 1.5, x + Math.min(60, doc.getTextWidth(c.title)), y + 1.5);
  const unit = c.unit ?? "";
  const top = y + 6;
  if (c.kind === "bar") {
    const h = 44, left = x + 9, cw = w - 9, base = top + h;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setLineWidth(0.1);
    [0, 50, 100].forEach((g) => {
      const gy = base - (g / 100) * h;
      doc.setDrawColor(225, 215, 210); doc.line(left, gy, x + w, gy);
      doc.setTextColor(...MUTED); doc.text(`${g}${unit}`, left - 1.5, gy + 1, { align: "right" });
    });
    const n = c.items.length, slot = cw / n, bw = Math.min(11, slot * 0.68);
    c.items.forEach((it, i) => {
      const cx = left + slot * i + slot / 2, bh = (Math.max(0, Math.min(100, it.value)) / 100) * h;
      doc.setFillColor(...(it.value >= 70 ? [24, 121, 78] : it.value >= 40 ? BRAND : [180, 35, 24]) as [number, number, number]);
      if (bh > 0) doc.roundedRect(cx - bw / 2, base - bh, bw, bh, 0.8, 0.8, "F");
      doc.setTextColor(...INK); doc.setFontSize(6); doc.text(String(it.value), cx, base - bh - 1, { align: "center" });
      doc.setTextColor(...MUTED); doc.setFontSize(6);
      const tw = doc.getTextWidth(it.label);
      doc.text(it.label, cx + 1.1, base + 2 + tw, { angle: 90 });
    });
    return 6 + h + 16;
  }
  const rowH = 6.4, label = 58, left = x + label, cw = w - label - 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  c.items.forEach((it, i) => {
    const ry = top + i * rowH;
    doc.setTextColor(...INK);
    const t = doc.splitTextToSize(it.label, label - 3)[0] as string;
    doc.text(t, x, ry + 4);
    doc.setFillColor(244, 236, 232); doc.roundedRect(left, ry + 0.8, cw, 4.2, 1, 1, "F");
    const bw = (Math.max(0, Math.min(100, it.value)) / 100) * cw;
    doc.setFillColor(...(it.value >= 70 ? [24, 121, 78] : it.value >= 40 ? BRAND : [180, 35, 24]) as [number, number, number]);
    if (bw > 0.5) doc.roundedRect(left, ry + 0.8, bw, 4.2, 1, 1, "F");
    doc.setTextColor(...MUTED); doc.text(`${it.value}${unit}`, left + cw + 2, ry + 4);
  });
  return 6 + c.items.length * rowH + 6;
}

export async function writePdf(rep: Report, brand: Brand) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Bandeau d'en-tête
  doc.setFillColor(...BRAND); doc.rect(0, 0, W, 30, "F");
  doc.setFillColor(...GOLD); doc.rect(0, 30, W, 1.5, "F");
  const logo = await loadImage(brand.logo || "/logo.png");
  let tx = 14;
  if (logo) {
    const box = 20, k = Math.min(box / logo.w, box / logo.h);
    doc.addImage(logo.data, logo.fmt, 12 + (box - logo.w * k) / 2, 5 + (box - logo.h * k) / 2, logo.w * k, logo.h * k);
    tx = 36;
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(brand.org, tx, 13);
  doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.text(rep.title, tx, 20);
  doc.setFontSize(8.5);
  const sub = [brand.section, brand.conseil, brand.comite].filter(Boolean).join("  ·  ");
  if (sub) doc.text(sub, tx, 26);
  doc.setFontSize(8.5); doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, W - 12, 13, { align: "right" });

  // Filtres + indicateurs
  doc.setTextColor(...MUTED); doc.setFontSize(8.5);
  doc.text(rep.filters.join("   |   "), 12, 38);
  const n = rep.kpis.length, gap = 3, bw = (W - 24 - (n - 1) * gap) / n;
  rep.kpis.forEach(([label, value], i) => {
    const x = 12 + i * (bw + gap);
    doc.setFillColor(...TINT); doc.roundedRect(x, 42, bw, 17, 2, 2, "F");
    doc.setTextColor(...BRAND); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(value, x + bw / 2, 51, { align: "center" });
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text(label, x + bw / 2, 56, { align: "center" });
  });

  let y = 68;
  if (rep.charts.length) {
    doc.setTextColor(...BRAND); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("Graphiques", 12, y); y += 8;
    rep.charts.forEach((c) => {
      const need = c.kind === "bar" ? 66 : 12 + c.items.length * 6.4;
      if (y + need > H - 14) { doc.addPage(); y = 18; }
      y += drawChart(doc, c, 12, y, W - 24) + 4;
    });
    doc.addPage(); y = 18;
  }
  const sheets = rep.sheets.filter((s) => s.pdf !== false);
  const skipped = rep.sheets.filter((s) => s.pdf === false).map((s) => s.name);

  sheets.forEach((s) => {
    if (y > H - 45) { doc.addPage(); y = 16; }
    doc.setTextColor(...BRAND); doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
    doc.text(s.title, 12, y);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(12, y + 1.6, 12 + Math.min(70, doc.getTextWidth(s.title)), y + 1.6);
    y += 6;
    if (s.note) { doc.setTextColor(...MUTED); doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.text(s.note, 12, y); y += 4; }

    if (!s.rows.length) {
      doc.setTextColor(...MUTED); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
      doc.text("Aucune donnée pour cette sélection.", 12, y + 3); y += 14; return;
    }
    if (s.matrix && s.head.length > 26) {
      doc.setTextColor(...MUTED); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
      doc.text(`La matrice compte ${s.head.length - 1} colonnes : elle est trop large pour le PDF. Utilise l'export Excel.`, 12, y + 3); y += 14; return;
    }
    const dense = s.head.length > 12 || s.matrix;
    autoTable(doc, {
      startY: y, head: [s.head], body: s.rows.map((r) => r.map((c) => String(c))),
      foot: s.totals ? [s.totals.map((c) => String(c))] : undefined, showFoot: "lastPage", theme: "grid",
      styles: { fontSize: dense ? 6.5 : 8, cellPadding: dense ? 1.2 : 1.8, lineColor: [234, 223, 218], lineWidth: 0.1, overflow: "linebreak", textColor: INK },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", halign: "center" },
      footStyles: { fillColor: [246, 228, 208], textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 246, 244] },
      margin: { left: 10, right: 10, top: 12, bottom: 14 },
      didParseCell: (h) => {
        if (h.section !== "body") return;
        const text = String(h.cell.raw ?? "");
        const col = h.column.index;
        const isStatus = s.statusCols?.includes(col) || (s.matrix && col > 0 && col < s.head.length - 3);
        if (isStatus && COLORS[text]) {
          h.cell.styles.textColor = COLORS[text].fg; h.cell.styles.fontStyle = "bold";
          if (s.matrix) { h.cell.styles.fillColor = COLORS[text].bg; h.cell.styles.halign = "center"; }
        }
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  });

  if (skipped.length) {
    if (y > H - 30) { doc.addPage(); y = 16; }
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
    doc.text(`Feuilles complètes disponibles uniquement dans l'export Excel : ${skipped.join(", ")}.`, 12, y);
  }

  // Pied de page numéroté
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFillColor(...BRAND); doc.rect(0, 0, W, 7, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(brand.org, 10, 4.7);
      doc.setFont("helvetica", "normal"); doc.text(rep.title, W - 10, 4.7, { align: "right" });
    }
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.3); doc.line(10, H - 10, W - 10, H - 10);
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text(`${brand.org} — ${rep.title}`, 10, H - 6);
    doc.text(`Page ${i} / ${pages}`, W - 10, H - 6, { align: "right" });
  }
  doc.save(`${rep.file}.pdf`);
}