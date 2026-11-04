import { FormEvent, useEffect, useState } from "react";
import StatusBadge from "./StatusBadge";
import EmptyState from "./EmptyState";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";

type Template = {
  id: string;
  activity_type_id: string | null;
  name: string;
  location: string | null;
  weekday: number;
  start_time: string;
  duration_minutes: number | null;
  active: boolean;
};
type TypeItem = { id: string; name: string };

const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const friendly = (message: string) =>
  /row-level security|permission|droits insuffisants/i.test(message)
    ? "Droits insuffisants : seuls les administrateurs et les responsables peuvent gérer les récurrences."
    : /does not exist|schema cache|relation/i.test(message)
      ? "La table des récurrences n'existe pas encore : lancez recurring_activities.sql dans Supabase (SQL Editor)."
      : message;

const durationText = (minutes: number | null) => {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return ` · durée ${h ? `${h} h` : ""}${m ? ` ${m} min` : ""}`.replace("  ", " ");
};

export default function RecurringActivities({
  types,
  onClose,
  onChanged,
}: {
  types: TypeItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const empty = { activity_type_id: "", name: "", location: "", weekday: "4", time: "21:00", duration: "" };
  const [rows, setRows] = useState<Template[]>([]);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data, error: loadError } = await supabase.from("recurring_activities").select("*");
    if (loadError) {
      setError(friendly(loadError.message));
    } else {
      setRows((data as Template[]) || []);
      setError("");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const sorted = [...rows].sort(
    (a, b) => DAY_ORDER.indexOf(a.weekday) - DAY_ORDER.indexOf(b.weekday) || a.start_time.localeCompare(b.start_time)
  );

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("recurring_activities").insert({
      activity_type_id: form.activity_type_id || null,
      name: form.name.trim(),
      location: form.location.trim() || null,
      weekday: Number(form.weekday),
      start_time: `${form.time}:00`,
      duration_minutes: form.duration ? Number(form.duration) : null,
    });

    if (insertError) {
      setError(friendly(insertError.message));
      setBusy(false);
      return;
    }

    await supabase.rpc("generate_recurring_activities");
    setForm(empty);
    await load();
    onChanged();
    setBusy(false);
  }

  async function toggle(t: Template) {
    setError("");
    const { data, error: updateError } = await supabase
      .from("recurring_activities")
      .update({ active: !t.active })
      .eq("id", t.id)
      .select("id");

    if (updateError) {
      setError(friendly(updateError.message));
      return;
    }
    if (!data || !data.length) {
      setError(friendly("row-level security"));
      return;
    }
    if (!t.active) await supabase.rpc("generate_recurring_activities");
    await load();
    onChanged();
  }

  async function remove(t: Template) {
    const ok = confirm(
      `Supprimer la récurrence « ${t.name} » (${DAYS[t.weekday].toLowerCase()} à ${t.start_time.slice(0, 5)}) ?\n\n` +
        "Les activités à venir créées par elle et sans présences seront aussi supprimées. Les activités passées sont conservées."
    );
    if (!ok) return;

    setError("");
    const { error: deleteError } = await supabase.rpc("delete_recurring_activity", { p_id: t.id });
    if (deleteError) {
      setError(friendly(deleteError.message));
      return;
    }
    await load();
    onChanged();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: "min(760px,100%)", maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Activités récurrentes</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Créez une règle une seule fois : les activités des 4 prochaines semaines sont ajoutées automatiquement.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-box" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

        {loading && <p className="muted">Chargement…</p>}
        {!loading && !sorted.length && !error && <EmptyState compact icon="activities" title="Aucune récurrence" />}

        {sorted.length > 0 && (
          <div className="att-list" style={{ marginBottom: 22 }}>
            {sorted.map((t) => (
              <div className="att-row" key={t.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="att-name">{t.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Chaque {DAYS[t.weekday].toLowerCase()} à {t.start_time.slice(0, 5)}
                    {durationText(t.duration_minutes)}
                    {t.location ? ` · ${t.location}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {t.active ? <StatusBadge kind="member" label="Active" /> : <StatusBadge kind="paused" />}
                  <button type="button" className="secondary" onClick={() => toggle(t)}>
                    {t.active ? "Mettre en pause" : "Réactiver"}
                  </button>
                  <button type="button" className="icon-btn danger" title="Supprimer" onClick={() => remove(t)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={add}>
          <h3 style={{ margin: "0 0 12px" }}>Ajouter une récurrence</h3>
          <div className="form-grid">
            <label>
              Type d'activité
              <select
                required
                value={form.activity_type_id}
                onChange={(e) => {
                  const id = e.target.value;
                  setForm({ ...form, activity_type_id: id, name: form.name || types.find((t) => t.id === id)?.name || "" });
                }}
              >
                <option value="">— Choisir —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              Nom
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Jour de la semaine
              <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
                {DAY_ORDER.map((d) => (
                  <option key={d} value={d}>{DAYS[d]}</option>
                ))}
              </select>
            </label>
            <label>
              Heure de début
              <input required type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
            <label>
              Durée en minutes (facultatif)
              <input
                type="number"
                min={1}
                step={1}
                placeholder="ex. 120"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
            </label>
            <label>
              Lieu (facultatif)
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Fermer</button>
            <button className="primary" disabled={busy}>{busy ? "Ajout…" : "Ajouter la récurrence"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}