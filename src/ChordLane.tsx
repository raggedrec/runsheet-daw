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
import { Wand2, Plus, MoreHorizontal } from "lucide-react";
import { chordIndexAt, type DetectedChord } from "./chords";
import { snapToBeat } from "./grid";
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
  chordCount, onAnalyse, analysing, error, sources, sourceId, onPickSource, onAddAtPlayhead, onClearChords, onMakeMidi, onExportMidi, skin, accent,
}: {
  chordCount: number;
  onAnalyse: (() => void) | null;
  analysing: boolean;
  error: string | null;
  sources: ReadonlyArray<ChordSource>;
  sourceId: string;
  onPickSource: (id: string) => void;
  onAddAtPlayhead: (() => void) | null;
  /** Clear every chord. Null when there are none. */
  onClearChords: (() => void) | null;
  /** Build a MIDI chord track from the chords. Null when there are none. */
  onMakeMidi: (() => void) | null;
  /** Download the chords as a .mid file. Null when there are none. */
  onExportMidi: (() => void) | null;
  skin: Skin;
  accent: string;
}) {
  // The menu lives in the narrow gutter, so it opens as a fixed-position popover
  // anchored to the ⋯ button — otherwise the gutter's overflow:hidden clips it.
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const iconBtn = (colour: string, enabled: boolean): React.CSSProperties => ({
    display: "grid", placeItems: "center", flex: "0 0 auto", width: 19, height: 20, padding: 0,
    background: "transparent", color: enabled ? colour : skin.fgSubtle,
    border: `1px solid ${enabled ? colour : skin.border}`, borderRadius: radius.sm,
    cursor: enabled ? "pointer" : "default",
  });

  const item = (label: string, onClick: (() => void) | null, danger = false) => (
    <button
      onClick={() => { setMenuAt(null); onClick?.(); }}
      disabled={!onClick}
      style={{
        textAlign: "left", padding: "5px 8px", borderRadius: radius.sm, border: "none",
        background: "transparent", cursor: onClick ? "pointer" : "default",
        color: !onClick ? skin.fgSubtle : danger ? RED : skin.fg,
        font: `${size.sm}px ${font.body}`, whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        height: CHORD_LANE_HEIGHT, display: "flex", alignItems: "center", gap: 3,
        padding: "0 6px", boxSizing: "border-box", overflow: "hidden",
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

      {/* Secondary actions — MIDI out and clear — tucked in a menu so the gutter
          stays legible. */}
      <button
        ref={menuBtn}
        onClick={() => {
          const r = menuBtn.current?.getBoundingClientRect();
          setMenuAt(menuAt ? null : r ? { x: r.right, y: r.bottom + 2 } : null);
        }}
        title="More chord actions"
        aria-label="More chord actions"
        style={iconBtn(skin.fgMuted, true)}
      >
        <MoreHorizontal size={13} />
      </button>

      {menuAt && (
        <>
          <div onClick={() => setMenuAt(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: "fixed", left: menuAt.x - 170, top: menuAt.y, width: 170, zIndex: 41,
              background: skin.surface, border: `1px solid ${skin.borderStrong}`, borderRadius: radius.md,
              boxShadow: "0 8px 24px rgba(0,0,0,.4)", padding: 4, display: "flex", flexDirection: "column",
            }}
          >
            {item("Make MIDI chord track", onMakeMidi)}
            {item("Export chords as .mid", onExportMidi)}
            <div style={{ height: 1, background: skin.border, margin: "3px 4px" }} />
            {item("Clear all chords", onClearChords, true)}
          </div>
        </>
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
  /** Move chord `index` to a new time (drag). Null disables moving. */
  onMove: ((index: number, seconds: number) => void) | null;
  /** Tempo, for snapping drags to the beat. Null = no snap. */
  bpm: number | null;
  /** The wand is running — shown in the empty strip. */
  analysing: boolean;
}

export function ChordLane({
  chords, duration, zoom, scroll, playheadSeconds, skin, accent, onRename, onDelete, onMove, bpm, analysing,
}: ChordLaneProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  // Live preview while dragging a block, so it tracks the pointer before commit.
  const [drag, setDrag] = useState<{ index: number; at: number } | null>(null);

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
  const xToSeconds = (x: number) => Math.max(0, from + (width > 0 ? (x / width) * visible : 0));

  // Drag to set where a chord lands — a block body moves that chord, a boundary
  // handle moves the chord whose start it is (so it adjusts the previous block's
  // end). Snaps to the beat unless Alt is held. A small threshold keeps a plain
  // click (for rename/delete) from registering as a move.
  const startMove = (index: number) => (e: React.PointerEvent) => {
    if (!onMove || index < 0 || index >= chords.length) return;
    e.stopPropagation();
    e.preventDefault(); // stop the drag from selecting the chord labels
    const rect = ref.current?.getBoundingClientRect();
    const startX = e.clientX;
    let moved = false;
    const at = (clientX: number, alt: boolean) => {
      const x = Math.max(0, Math.min(width, clientX - (rect?.left ?? 0)));
      return snapToBeat(xToSeconds(x), bpm, alt);
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      setDrag({ index, at: at(ev.clientX, ev.altKey) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) onMove(index, at(ev.clientX, ev.altKey));
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const current = chordIndexAt(chords, playheadSeconds);

  return (
    <div
      ref={ref}
      style={{
        position: "relative", height: CHORD_LANE_HEIGHT, flex: "0 0 auto",
        borderBottom: `1px solid ${skin.laneLine}`,
        background: skin.surfaceSunken, overflow: "hidden",
        userSelect: "none", WebkitUserSelect: "none",
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
        // While dragging this block, follow the pointer; others stay put.
        const at = drag?.index === i ? drag.at : chord.at;
        const x0 = secondsToX(at);
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

        const dragging = drag?.index === i;
        return (
          <button
            key={i}
            onPointerDown={onMove ? startMove(i) : undefined}
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
                ? `${chord.label} — drag to move, double-click to rename, right-click to delete`
                : chord.label
            }
            style={{
              position: "absolute", left: x0, top: 3, width: w, height: CHORD_LANE_HEIGHT - 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 4px", boxSizing: "border-box",
              background: isCurrent ? accent : skin.surface,
              color: isCurrent ? "#fff" : skin.fg,
              border: `1px solid ${isCurrent ? accent : skin.border}`,
              borderRadius: radius.sm, cursor: onMove ? "grab" : onRename ? "pointer" : "default",
              opacity: dragging ? 1 : isCurrent ? 1 : conf,
              zIndex: dragging ? 5 : undefined,
              font: `600 ${size.xs}px ${font.body}`,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              touchAction: "none",
            }}
          >
            {/* Hide the label on a block too narrow to hold it, so bars don't
                turn into a row of clipped half-letters. */}
            {w >= 20 ? chord.label : ""}
          </button>
        );
      })}

      {/* A boundary handle at each chord's start (bar the first): drag it to set
          where this chord begins, i.e. where the previous block ends. */}
      {onMove &&
        chords.map((chord, i) => {
          if (i === 0) return null;
          const at = drag?.index === i ? drag.at : chord.at;
          const x = secondsToX(at);
          if (x < -3 || x > width + 3) return null;
          return (
            <div
              key={`b${i}`}
              onPointerDown={startMove(i)}
              title="Drag to adjust where this chord begins (and the one before ends)"
              style={{
                position: "absolute", left: x - 3, top: 3, width: 6, height: CHORD_LANE_HEIGHT - 6,
                cursor: "ew-resize", zIndex: 4, touchAction: "none",
              }}
            />
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
