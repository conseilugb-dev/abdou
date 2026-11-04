import { FormEvent, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";

type Guest = {
  id: string;
  first_name: string;
  last_name: string;
  created_at: string;
};

const friendly = (message: string, code?: string) =>
  code === "23505" || /duplicate key|unique/i.test(message)
    ? "Cette personne est déjà dans la liste de cette activité."
    : /row-level security|permission/i.test(message)
      ? "Droits insuffisants : seuls les administrateurs et les responsables peuvent gérer les invités."
      : /does not exist|schema cache|relation/i.test(message)
        ? "La table des invités n'existe pas encore : lancez activity_guests.sql dans Supabase (SQL Editor)."
        : message;

// Invités = personnes qui ne font pas partie de l'organisation : on note seulement leur nom et leur prénom.
// Ils ne comptent pas dans les statistiques des membres.
export default function ActivityGuests({
  activity,
  onClose,
  onChanged,
}: {
  activity: { id: string; name: string; start_datetime: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const lastNameRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data, error: loadError } = await supabase
      .from("activity_guests")
      .select("id,first_name,last_name,created_at")
      .eq("activity_id", activity.id)
      .order("last_name")
      .order("first_name");
    if (loadError) setError(friendly(loadError.message, loadError.code));
    else {
      setGuests((data as Guest[]) || []);
      setError("");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activity.id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("activity_guests").insert({
      activity_id: activity.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });
    setBusy(false);
    if (insertError) {
      setError(friendly(insertError.message, insertError.code));
      return;
    }
    setLastName("");
    setFirstName("");
    await load();
    onChanged();
    lastNameRef.current?.focus(); // prêt pour la personne suivante
  }

  async function remove(g: Guest) {
    if (!confirm(`Retirer ${g.first_name} ${g.last_name} de cette activité ?`)) return;
    setError("");
    const { data, error: deleteError } = await supabase.from("activity_guests").delete().eq("id", g.id).select("id");
    if (deleteError) {
      setError(friendly(deleteError.message, deleteError.code));
      return;
    }
    if (!data || !data.length) {
      setError(friendly("row-level security"));
      return;
    }
    await load();
    onChanged();
  }

  async function copyList() {
    const text = guests.map((g, i) => `${i + 1}. ${g.last_name} ${g.first_name}`).join("\n");
    try {
      await navigator.clipboard.writeText(`Invités — ${activity.name}\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Copie impossible sur ce navigateur.");
    }
  }

  const dateText = new Date(activity.start_datetime).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(640px,100%)", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Invités de l'activité</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {activity.name} — {dateText}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>

        <p className="muted" style={{ margin: "0 0 14px", fontSize: 14 }}>
          Personnes qui ne font pas partie de l'organisation : on note seulement leur nom et leur prénom. Elles ne comptent pas dans les statistiques des membres.
        </p>

        {error && <div className="error-box" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

        <form onSubmit={add}>
          <div className="form-grid">
            <label>
              Nom
              <input ref={lastNameRef} required autoFocus value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
            <label>
              Prénom
              <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
          </div>
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy}>{busy ? "Ajout…" : "Ajouter l'invité"}</button>
          </div>
        </form>

        <h3 style={{ margin: "22px 0 8px" }}>Liste ({guests.length})</h3>
        {loading && <p className="muted">Chargement…</p>}
        {!loading && !guests.length && !error && <div className="empty" style={{ padding: "20px 0" }}>Aucun invité pour cette activité.</div>}

        {guests.length > 0 && (
          <div className="att-list">
            {guests.map((g) => (
              <div className="att-row" key={g.id}>
                <div className="att-name">{g.last_name} {g.first_name}</div>
                <button type="button" className="icon-btn danger" title="Retirer" onClick={() => remove(g)}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          {guests.length > 0 && (
            <button type="button" className="secondary" onClick={copyList}>{copied ? "Liste copiée" : "Copier la liste"}</button>
          )}
          <button type="button" className="secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}