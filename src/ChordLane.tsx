/**
 * The detected-chords lane — a timeline bar of chord blocks.
 *
 * Shares the timeline's coordinate maths exactly (visible window is
 * `duration / zoom` from `scroll`), like the marker strip, so a chord block
 * stays glued to its moment as you zoom and scroll. Lives in the same gutter-0
 * column as the timeline canvas, so x here is x there.
 *
 * Each chord sounds from its `at` until the next one's; the blocks tile that
 * way. The one under the playhead is picked out with the accent, the same chord
 * Run Sheet would highlight — both use `chordIndexAt`.
 *
 * Double-click a block to rename it. The edit writes back to the shared
 * analysis column (see DawApp.renameChord), so it lands in Run Sheet too.
 */
import { useEffect, useRef, useState } from "react";
import { chordIndexAt, type DetectedChord } from "./chords";
import { font, radius, size, type Skin } from "./theme";

export const CHORD_LANE_HEIGHT = 30;

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
  /** Where the chords came from, shown as the lane's label. */
  sourceName: string;
  /** Rename chord `index` to `label`. Null disables editing. */
  onRename: ((index: number, label: string) => void) | null;
}

export function ChordLane({
  chords, duration, zoom, scroll, playheadSeconds, skin, accent, sourceName, onRename,
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
      {/* Label pinned left, over the blocks — says what this bar is and where
          its chords came from, without moving with the timeline. */}
      <span
        style={{
          position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", zIndex: 2,
          padding: "2px 6px", background: skin.surface, borderRadius: radius.sm,
          border: `1px solid ${skin.border}`,
          font: `700 ${size.xs}px ${font.body}`, letterSpacing: ".06em",
          color: skin.fgSubtle, pointerEvents: "none", whiteSpace: "nowrap",
        }}
        title={`Detected chords — ${sourceName}`}
      >
        CHORDS
      </span>

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
            title={onRename ? `${chord.label} — double-click to rename` : chord.label}
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
