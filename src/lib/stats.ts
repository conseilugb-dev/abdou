import { supabase } from "./supabase";

export const TYPE_ORDER = ["GOUDI ALJUMAH", "KHADARA", "SPORT", "CELLULE FÉMININ", "TOUR MJ", "AUTRE"];
export const GOUDI = "GOUDI ALJUMAH";

export type Mem = { id: string; first_name: string; last_name: string };
export type ActStat = {
  id: string; name: string; start: string; typeName: string; marked: boolean;
  present: number; absent: number; total: number; rate: number;
};
export type TypeStat = {
  typeName: string; created: number; held: number;
  present: number; absent: number; rate: number; avgPresent: number;
};
export type Streak = { member: Mem; current: number; max: number; absentDates: string[] };
export type Row = { activity_id: string; member_id: string; status: string };

async function fetchAll<T>(table: string, cols: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...((data as unknown as T[]) || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type StatsData = {
  members: Mem[];
  acts: ActStat[];
  types: TypeStat[];
  rows: Row[];
  status: Map<string, string>; // "activityId|memberId" -> statut
};

export async function loadStats(): Promise<StatsData> {
  const [{ data: m, error: me }, { data: t, error: te }, actsRaw, rows] = await Promise.all([
    supabase.rpc("public_member_names"),
    supabase.from("activity_types").select("id,name"),
    fetchAll<any>("activities", "id,name,start_datetime,status,activity_type_id", "start_datetime"),
    fetchAll<Row>("attendance", "activity_id,member_id,status", "activity_id"),
  ]);
  if (me) throw me;
  if (te) throw te;
  const members = (m as Mem[]) || [];
  const active = new Set(members.map((x) => x.id));
  const typeName = new Map<string, string>(((t as any[]) || []).map((x) => [x.id, x.name]));
  const N = members.length;

  const status = new Map<string, string>();
  const byAct = new Map<string, Row[]>();
  rows.filter((r) => active.has(r.member_id)).forEach((r) => {
    status.set(`${r.activity_id}|${r.member_id}`, r.status);
    byAct.set(r.activity_id, [...(byAct.get(r.activity_id) || []), r]);
  });

  const acts: ActStat[] = actsRaw
    .filter((a) => a.status !== "annulée")
    .map((a) => {
      const r = byAct.get(a.id) || [];
      const marked = r.length > 0;
      const present = r.filter((x) => x.status === "Présent").length;
      // Dans une activité où l'appel a été fait, tout membre non « Présent » est compté absent.
      const absent = marked ? Math.max(0, N - present) : 0;
      const total = marked ? N : 0;
      return {
        id: a.id, name: a.name, start: a.start_datetime,
        typeName: typeName.get(a.activity_type_id) || "AUTRE",
        marked, present, absent, total,
        rate: total ? Math.round((present / total) * 100) : 0,
      };
    });

  const names = [...TYPE_ORDER, ...[...new Set(acts.map((a) => a.typeName))].filter((n) => !TYPE_ORDER.includes(n))];
  const types: TypeStat[] = names.map((n) => {
    const l = acts.filter((a) => a.typeName === n);
    const h = l.filter((a) => a.marked);
    const present = h.reduce((s, a) => s + a.present, 0);
    const absent = h.reduce((s, a) => s + a.absent, 0);
    const tot = present + absent;
    return {
      typeName: n, created: l.length, held: h.length, present, absent,
      rate: tot ? Math.round((present / tot) * 100) : 0,
      avgPresent: h.length ? Math.round((present / h.length) * 10) / 10 : 0,
    };
  });
  return { members, acts, types, rows, status };
}

/** Membres absents plusieurs GOUDI ALJUMAH d'affilée. */
export function goudiStreaks(d: StatsData): Streak[] {
  const sessions = d.acts.filter((a) => a.typeName === GOUDI && a.marked)
    .sort((a, b) => a.start.localeCompare(b.start));
  return d.members.map((member) => {
    let cur = 0, max = 0;
    const absentDates: string[] = [];
    sessions.forEach((s) => {
      const st = d.status.get(`${s.id}|${member.id}`);
      if (st === "Présent") cur = 0;
      else { cur++; max = Math.max(max, cur); absentDates.push(s.start); }
    });
    return { member, current: cur, max, absentDates };
  });
}

export const fmtDate = (v: string) => new Date(v).toLocaleDateString("fr-FR");