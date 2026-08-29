/**
 * A modal for the handful of actions that are worth a pause.
 *
 * Removing a lane and deleting a file are the two places this app can lose
 * something, so they ask first rather than acting on a single click. Everything
 * else stays a direct control — a confirm on a fader move would be noise. The
 * dialog takes a list of actions so one component covers both the two-way
 * "delete permanently?" and the three-way "remove, or remove and delete?".
 */
import { font, radius, size, space, type Skin } from "./theme";

export interface DialogAction {
  label: string;
  /** "danger" for anything irreversible; "primary" for the safe default. */
  variant?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

export interface DialogProps {
  skin: Skin;
  title: string;
  message?: string;
  actions: DialogAction[];
  onCancel: () => void;
}

export function Dialog({ skin, title, message, actions, onCancel }: DialogProps) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,.5)",
        display: "grid", placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{
          width: "min(440px, 92vw)",
          background: skin.surface,
          border: `1px solid ${skin.border}`,
          borderRadius: radius.md,
          padding: space[4],
          boxShadow: "0 12px 48px rgba(0,0,0,.4)",
        }}
      >
        <h2 style={{ font: `600 ${size.lg}px ${font.body}`, color: skin.fg, margin: `0 0 ${space[2]}px` }}>
          {title}
        </h2>
        {message && (
          <p style={{ font: `${size.base}px ${font.body}`, color: skin.fgMuted, margin: `0 0 ${space[4]}px`, lineHeight: 1.5 }}>
            {message}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: space[2], flexWrap: "wrap" }}>
          <button onClick={onCancel} style={btn(skin, "ghost")}>
            Cancel
          </button>
          {actions.map((a) => (
            <button key={a.label} onClick={a.onClick} style={btn(skin, a.variant ?? "primary")}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function btn(skin: Skin, variant: "primary" | "danger" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 34, paddingInline: 14,
    font: `600 ${size.sm}px ${font.body}`,
    borderRadius: radius.sm, cursor: "pointer",
  };
  if (variant === "danger") {
    return { ...base, background: "#C0453B", color: "#fff", border: "none" };
  }
  if (variant === "primary") {
    return { ...base, background: skin.surfaceSunken, color: skin.fg, border: `1px solid ${skin.borderStrong}` };
  }
  return { ...base, background: "transparent", color: skin.fgMuted, border: `1px solid ${skin.border}` };
}
