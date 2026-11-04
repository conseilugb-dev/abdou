
import { Link } from "react-router-dom";
import {
  BarChart3,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  SearchX,
  UserPlus,
  Users,
} from "lucide-react";

const ICONS = {
  activities: CalendarX,
  attendance: ClipboardList,
  stats: BarChart3,
  members: Users,
  guests: UserPlus,
  search: SearchX,
  ok: CheckCircle2,
} as const;

export type EmptyIcon = keyof typeof ICONS;

type EmptyAction =
  | {
      label: string;
      onClick: () => void;
      variant?: "primary" | "secondary";
      to?: never;
    }
  | {
      label: string;
      to: string;
      variant?: "primary" | "secondary";
      onClick?: never;
    };

// État vide illustré avec possibilité d'ajouter des actions.
export default function EmptyState({
  icon,
  title,
  hint,
  tone = "neutral",
  compact = false,
  actions = [],
}: {
  icon: EmptyIcon;
  title: string;
  hint?: string;
  tone?: "neutral" | "ok";
  compact?: boolean;
  actions?: EmptyAction[];
}) {
  const Icon = ICONS[icon];
  const size = compact ? 64 : 92;

  return (
    <div
      className={`empty-state ${tone} ${compact ? "compact" : ""}`}
      role="status"
    >
      <div
        className="empty-art"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="46" className="es-disc" />

          <g className="es-star" fill="none" strokeWidth="1.4">
            <rect x="24" y="24" width="52" height="52" rx="2" />
            <rect
              x="24"
              y="24"
              width="52"
              height="52"
              rx="2"
              transform="rotate(45 50 50)"
            />
          </g>

          <circle
            cx="50"
            cy="50"
            r="46"
            className="es-ring"
            fill="none"
            strokeDasharray="3 5"
          />

          <path
            className="es-spark"
            d="M86 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
          />

          <path
            className="es-spark"
            d="M12 70l1.5 3.5 3.5 1.5-3.5 1.5L12 80l-1.5-3.5L7 75l3.5-1.5z"
          />
        </svg>

        <span className="empty-icon">
          <Icon size={compact ? 22 : 30} strokeWidth={1.8} />
        </span>
      </div>

      <div className="empty-title">{title}</div>

      {hint && <div className="empty-hint">{hint}</div>}

      {actions.length > 0 && (
        <div className="empty-actions">
          {actions.map((action, index) => {
            const className = `empty-action ${
              action.variant === "secondary" ? "secondary" : "primary"
            }`;

            if (action.to) {
              return (
                <Link
                  key={index}
                  to={action.to}
                  className={className}
                >
                  {action.label}
                </Link>
              );
            }

            return (
              <button
                key={index}
                type="button"
                className={className}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
