/**
 * The detected-chords lane — a timeline bar of chord blocks.
 *
 * Shares the timeline's coordinate maths exactly (visible window is
 * `duration / zoom` from `scroll`), like the marker strip, so a chord block
 * stays glued to its moment as you zoom and scroll. Lives in the same gutter-0
 * column as the timeline canvas, so x here is x there.
 *
 * Each chord sounds from its `at` until the next one's; the blocks tile that
 * way. The one under the playhead is picked out with the accent (via
 * `chordIndexAt`, shared with Run Sheet). Status text (analysing, error, empty)
 * fills the wide strip; the controls live in the gutter (ChordLaneControls).
 *
 * Double-click a block to rename, right-click to delete. Both write back to the
 * shared analysis column, so the edit lands in Run Sheet and the Writer too.
 */
import { useEffect, useRef, useState } from "react";
import { Wand2, Plus, Music2 } from "lucide-react";
import { chordIndexAt, type DetectedChord } from "./chords";
import { font, radius, size, type Skin } from "./theme";

export const CHORD_LANE_HEIGHT = 30;
const RED = "#C0453B";

/** A source file the chords can come from. */
export interface ChordSource {
  id: string;
  name: string;
}

/**
 * The lane's controls, for the left gutter column: the source picker, add, and
 * the wand. Kept out of the blocks so nothing overlaps the first chords. The
 * gutter is narrow, so status text lives in the strip, not here.
 */
export function ChordLaneControls({
  chordCount, onAnalyse, analysing, error, sources, sourceId, onPickSource, onAddAtPlayhead, onMakeMidi, skin, accent,
}: {
  chordCount: number;
  onAnalyse: (() => void) | null;
  analysing: boolean;
  error: string | null;
  sources: ReadonlyArray<ChordSource>;
  sourceId: string;
  onPickSource: (id: string) => void;
  onAddAtPlayhead: (() => void) | null;
  /** Build a MIDI chord track from the chords. Null when there are none. */
  onMakeMidi: (() => void) | null;
  skin: Skin;
  accent: string;
}) {
  const iconBtn = (colour: string, enabled: boolean): React.CSSProperties => ({
    display: "grid", placeItems: "center", flex: "0 0 auto", width: 22, height: 20, padding: 0,
    background: "transparent", color: enabled ? colour : skin.fgSubtle,
    border: `1px solid ${enabled ? colour : skin.border}`, borderRadius: radius.sm,
    cursor: enabled ? "pointer" : "default",
  });

  return (
    <div
      style={{
        height: CHORD_LANE_HEIGHT, display: "flex", alignItems: "center", gap: 4,
        padding: "0 8px", boxSizing: "border-box", overflow: "hidden",
        borderBottom: `1px solid ${skin.laneLine}`, background: skin.surfaceSunken,
      }}
    >
      {/* Which track the chords come from — the single biggest lever on quality,
          so it's the primary control. A vocal or drum stem reads badly; point it
          at a keys or guitar part. */}
      <select
        value={sourceId}
        onChange={(e) => onPickSource(e.target.value)}
        title="Which track the chords are detected from"
        style={{
          flex: 1, minWidth: 0, height: 20,
          font: `${size.xs}px ${font.body}`, color: skin.fg,
          background: skin.surface, border: `1px solid ${skin.border}`,
          borderRadius: radius.sm, padding: "0 2px",
        }}
      >
        {sources.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>

      {onAddAtPlayhead && (
        <button onClick={onAddAtPlayhead} title="Add a chord at the playhead" aria-label="Add chord" style={iconBtn(accent, true)}>
          <Plus size={12} />
        </button>
      )}

      {onMakeMidi && (
        <button
          onClick={onMakeMidi}
          title="Build a MIDI chord track (block chords) from these chords"
          aria-label="Make MIDI chord track"
          style={iconBtn(accent, true)}
        >
          <Music2 size={12} />
        </button>
      )}

      {onAnalyse && (
        <button
          onClick={onAnalyse}
          disabled={analysing}
          title={error ?? `Detect chords from this track${chordCount ? " again" : ""} — runs in your browser`}
          aria-label="Detect chords"
          style={iconBtn(error ? RED : accent, !analysing)}
        >
          <Wand2 size={12} />
        </button>
      )}
    </div>
  );
}

export interface ChordLaneProps {
  chords: ReadonlyArray<DetectedChord>;
  /** Seconds. The longest lane — what the full width represents. */
  duration: number;
  zoom: number;
  scroll: number;
  /** Seconds. The playhead, for the current-chord highlight. */
  playheadSeconds: number;
  skin: Skin;
  accent: string;
  /** Rename chord `index` to `label`. Null disables editing. */
  onRename: ((index: number, label: string) => void) | null;
  /** Delete chord `index` (right-click). Null disables deleting. */
  onDelete: ((index: number) => void) | null;
  /** The wand is running — shown in the empty strip. */
  analysing: boolean;
}

export function ChordLane({
  chords, duration, zoom, scroll, playheadSeconds, skin, accent, onRename, onDelete, analysing,
}: ChordLaneProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The same window the timeline draws — see Timeline.draw.
  const visible = duration / Math.max(1, zoom);
  const from = Math.max(0, Math.min(scroll, Math.max(0, duration - visible)));
  const secondsToX = (s: number) => (visible > 0 ? ((s - from) / visible) * width : 0);

  const current = chordIndexAt(chords, playheadSeconds);

  return (
    <div
      ref={ref}
      style={{
        position: "relative", height: CHORD_LANE_HEIGHT, flex: "0 0 auto",
        borderBottom: `1px solid ${skin.laneLine}`,
        background: skin.surfaceSunken, overflow: "hidden",
      }}
    >
      {/* Empty lane: say how to fill it rather than looking broken. */}
      {chords.length === 0 && (
        <span
          style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            font: `${size.xs}px ${font.body}`, color: skin.fgSubtle,
          }}
        >
          {analysing
            ? "Analysing…"
            : "No chords — pick a source and press the wand, or + to add one."}
        </span>
      )}

      {chords.map((chord, i) => {
        const x0 = secondsToX(chord.at);
        const next = i + 1 < chords.length ? chords[i + 1].at : duration;
        const x1 = secondsToX(next);
        const w = Math.max(2, x1 - x0);
        // Off-screen either side — skip rather than paint a zero-strip.
        if (x1 <= 0 || x0 >= width) return null;

        const isCurrent = i === current;
        // A low-confidence guess reads fainter, so a shaky chord looks shaky.
        const conf = Math.max(0.35, Math.min(1, chord.confidence || 0.6));

        if (editing === i) {
          return (
            <ChordEditor
              key={i}
              left={x0}
              width={w}
              initial={chord.label}
              skin={skin}
              accent={accent}
              onCommit={(label) => {
                setEditing(null);
                const trimmed = label.trim();
                if (trimmed && trimmed !== chord.label) onRename?.(i, trimmed);
              }}
              onCancel={() => setEditing(null)}
            />
          );
        }

        return (
          <button
            key={i}
            onDoubleClick={() => onRename && setEditing(i)}
            onContextMenu={(e) => {
              if (!onDelete) return;
              // Right-click deletes — a chord block has no other obvious menu,
              // and a per-block ✕ would be unhittable on a narrow one.
              e.preventDefault();
              onDelete(i);
            }}
            title={
              onRename
                ? `${chord.label} — double-click to rename, right-click to delete`
                : chord.label
            }
            style={{
              position: "absolute", left: x0, top: 3, width: w, height: CHORD_LANE_HEIGHT - 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 4px", boxSizing: "border-box",
              background: isCurrent ? accent : skin.surface,
              color: isCurrent ? "#fff" : skin.fg,
              border: `1px solid ${isCurrent ? accent : skin.border}`,
              borderRadius: radius.sm, cursor: onRename ? "pointer" : "default",
              opacity: isCurrent ? 1 : conf,
              font: `600 ${size.xs}px ${font.body}`,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {/* Hide the label on a block too narrow to hold it, so bars don't
                turn into a row of clipped half-letters. */}
            {w >= 20 ? chord.label : ""}
          </button>
        );
      })}
    </div>
  );
}

/** Inline rename field for one chord block. */
function ChordEditor({
  left, width, initial, skin, accent, onCommit, onCancel,
}: {
  left: number;
  width: number;
  initial: string;
  skin: Skin;
  accent: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft);
        if (e.key === "Escape") onCancel();
      }}
      // A narrow block would be unusable to type in; give the field a floor
      // width without moving the block it belongs to.
      style={{
        position: "absolute", left, top: 3, width: Math.max(44, width), height: CHORD_LANE_HEIGHT - 6,
        textAlign: "center", padding: "0 2px", boxSizing: "border-box", zIndex: 4,
        background: skin.surface, color: skin.fg,
        border: `1px solid ${accent}`, borderRadius: radius.sm,
        font: `600 ${size.xs}px ${font.body}`,
      }}
    />
  );
}
