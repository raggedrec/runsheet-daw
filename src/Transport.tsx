/**
 * The transport bar, in the label player's language.
 *
 * The site's player puts a large circular Play between smaller square
 * controls, with the title block to its left. Same arrangement here, with the
 * things a DAW needs and a music player doesn't: a bar|beat readout beside the
 * clock, the tempo, and the look controls.
 *
 * Bar and beat sit next to minutes and seconds rather than replacing them.
 * Musicians ask both questions — "where are we in the arrangement" and "how
 * long is this" — and a DAW that answers only one makes you do arithmetic.
 */
import { accents, font, radius, size, space, type AccentName, type Look, type Skin, LANE_HEIGHT } from "./theme";

export interface TransportProps {
  skin: Skin;
  accent: string;
  accentFg: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  bpm: number | null;
  look: Look;
  onLook: (patch: Partial<Look>) => void;
  onPlayStop: () => void;
  onRewind: () => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  onSave: () => void;
}

export function Transport({
  skin, accent, accentFg, isPlaying, position, duration, bpm, look, onLook, onPlayStop, onRewind,
  saveState, onSave,
}: TransportProps) {
  const square: React.CSSProperties = {
    width: 34, height: 34,
    display: "grid", placeItems: "center",
    background: "transparent",
    color: skin.fg,
    border: `1px solid ${skin.border}`,
    borderRadius: radius.md,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: space[3],
        padding: `${space[3]}px ${space[4]}px`,
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        marginBottom: space[4],
        flexWrap: "wrap",
      }}
    >
      <button onClick={onRewind} title="Back to start" style={square} aria-label="Back to start">
        <Rewind />
      </button>

      <button
        onClick={onPlayStop}
        aria-label={isPlaying ? "Stop" : "Play"}
        style={{
          width: 46, height: 46, borderRadius: radius.pill,
          display: "grid", placeItems: "center",
          background: accent, color: accentFg,
          border: "none", cursor: "pointer",
        }}
      >
        {isPlaying ? <StopIcon /> : <PlayIcon />}
      </button>

      {/*
        Tabular figures, or the clock jitters as digits change width and the
        whole bar shifts with it once a second.
      */}
      <div style={{ display: "flex", alignItems: "baseline", gap: space[3], marginLeft: space[2] }}>
        <span style={{ font: `600 ${size.lg}px ${font.mono}`, fontVariantNumeric: "tabular-nums", color: skin.fg }}>
          {formatTime(position)}
        </span>
        <span style={{ font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle, fontVariantNumeric: "tabular-nums" }}>
          / {formatTime(duration)}
        </span>
        {bpm && (
          <span
            style={{
              font: `600 ${size.sm}px ${font.mono}`, color: skin.fgMuted,
              fontVariantNumeric: "tabular-nums",
              paddingLeft: space[3], borderLeft: `1px solid ${skin.border}`,
            }}
            title="Bar | beat"
          >
            {formatBars(position, bpm)}
          </span>
        )}
      </div>

      {bpm && (
        <span style={{ font: `500 ${size.xs}px ${font.body}`, letterSpacing: '.08em', color: skin.fgSubtle }}>
          {bpm} BPM · 4/4
        </span>
      )}

      <div style={{ flex: 1 }} />

      {/*
        Saves the whole session — tracks, faders, pans, effects, arrangement.
        Those aren't a settings file we invented; they're openDAW's own graph,
        so saving the project saves them by construction.
      */}
      <button
        onClick={onSave}
        disabled={saveState === "saving"}
        title="Save this session so the mix is here next time"
        style={{
          height: 32, paddingInline: 12,
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em", textTransform: "uppercase",
          color: saveState === "failed" ? "#C0453B" : skin.fg,
          background: "transparent",
          border: `1px solid ${saveState === "failed" ? "#C0453B" : skin.border}`,
          borderRadius: radius.md,
          cursor: saveState === "saving" ? "default" : "pointer",
        }}
      >
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "failed" ? "Retry save" : "Save"}
      </button>

      <LookControls skin={skin} look={look} onLook={onLook} />
    </div>
  );
}

function LookControls({ skin, look, onLook }: { skin: Skin; look: Look; onLook: (p: Partial<Look>) => void }) {
  const chip = (active: boolean): React.CSSProperties => ({
    font: `500 ${size.xs}px ${font.body}`,
    letterSpacing: '.08em',
    textTransform: "uppercase",
    padding: "5px 9px",
    borderRadius: radius.md,
    cursor: "pointer",
    border: `1px solid ${active ? skin.borderStrong : skin.border}`,
    background: active ? skin.bg : "transparent",
    color: active ? skin.fg : skin.fgSubtle,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
      <button style={chip(look.skin === "light")} onClick={() => onLook({ skin: "light" })}>
        Light
      </button>
      <button style={chip(look.skin === "dark")} onClick={() => onLook({ skin: "dark" })}>
        Dark
      </button>

      {/* Only the three brand accents — each ships its own foreground, so an
          unreadable pairing can't be selected. */}
      <div style={{ display: "flex", gap: 4, marginLeft: space[2] }}>
        {(Object.keys(accents) as AccentName[]).map((key) => (
          <button
            key={key}
            onClick={() => onLook({ accent: key })}
            title={accents[key].name}
            aria-label={accents[key].name}
            style={{
              width: 18, height: 18, borderRadius: radius.pill,
              background: accents[key].solid,
              border: look.accent === key ? `2px solid ${skin.fg}` : `1px solid ${skin.border}`,
              cursor: "pointer", padding: 0,
            }}
          />
        ))}
      </div>

      {/* Bounded by LANE_HEIGHT: below the minimum a stereo waveform is a
          smear, above the maximum the transport scrolls off a laptop screen. */}
      <input
        type="range"
        min={LANE_HEIGHT.min}
        max={LANE_HEIGHT.max}
        value={look.laneHeight}
        onChange={(e) => onLook({ laneHeight: Number(e.target.value) })}
        title="Lane height"
        style={{ width: 74, marginLeft: space[2], accentColor: skin.fgMuted }}
      />
    </div>
  );
}

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4 2.5v11l9-5.5-9-5.5Z" />
  </svg>
);
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3" y="3" width="10" height="10" rx="1" />
  </svg>
);
const Rewind = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4 3h1.6v10H4V3Zm8.4 0v10l-6.2-5 6.2-5Z" />
  </svg>
);

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Bar and beat, both counted from one.
 *
 * Musicians count from bar 1 beat 1, not bar 0 beat 0. Assumes 4/4 — Run Sheet
 * has no time signature field, so pretending to know better would be a lie
 * dressed as a feature.
 */
export function formatBars(seconds: number, bpm: number): string {
  const beats = Math.max(0, seconds) * (bpm / 60);
  const bar = Math.floor(beats / 4) + 1;
  const beat = Math.floor(beats % 4) + 1;
  return `${bar}|${beat}`;
}
