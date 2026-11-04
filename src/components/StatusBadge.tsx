import { Ban, Check, CheckCheck, Clock, Pause, UserRound, Archive, X } from "lucide-react";
import type { ReactNode } from "react";

export type StatusKind =
  | "present" | "absent"                       // présences
  | "live" | "upcoming" | "done" | "cancelled" // activités
  | "member" | "former" | "paused";            // membres et activités récurrentes

const CONFIG: Record<StatusKind, { label: string; icon: ReactNode }> = {
  present:   { label: "Présent",       icon: <Check size={13} strokeWidth={3} /> },
  absent:    { label: "Absent",        icon: <X size={13} strokeWidth={3} /> },
  live:      { label: "En cours",      icon: <i className="sbadge-dot" /> },
  upcoming:  { label: "Prévue",        icon: <Clock size={13} strokeWidth={2.6} /> },
  done:      { label: "Terminée",      icon: <CheckCheck size={13} strokeWidth={2.6} /> },
  cancelled: { label: "Annulée",       icon: <Ban size={13} strokeWidth={2.6} /> },
  member:    { label: "Actif",         icon: <UserRound size={13} strokeWidth={2.6} /> },
  former:    { label: "Ancien membre", icon: <Archive size={13} strokeWidth={2.6} /> },
  paused:    { label: "En pause",      icon: <Pause size={13} strokeWidth={2.6} /> },
};

// Pastille de statut : petite icône + texte, couleur propre à chaque statut.
export default function StatusBadge({ kind, label }: { kind: StatusKind; label?: string }) {
  const c = CONFIG[kind];
  return (
    <span className={`sbadge sbadge-${kind}`}>
      {c.icon}
      {label ?? c.label}
    </span>
  );
}

// Correspondances pratiques avec les valeurs utilisées dans l'application
export const activityKind = (status: string): StatusKind =>
  status === "en cours" ? "live" : status === "terminée" ? "done" : status === "annulée" ? "cancelled" : "upcoming";