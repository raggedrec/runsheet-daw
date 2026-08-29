/**
 * The marker lane, above the timeline.
 *
 * It shares the timeline's coordinate maths exactly — visible window is
 * `duration / zoom`, starting at `scroll` — so a flag stays glued to its bar as
 * you zoom and scroll. It lives in the same full-width column as the timeline
 * canvas (the gutter is 0), so x here and x on the canvas are the same x.
 *
 * HTML rather than canvas, unlike the waveforms: a marker is something you
 * click, drag, rename and delete, and those are what elements are good at.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { font, radius, size, type Skin } from "./theme";
import { SECTIONS, hueFor, type MarkerInfo } from "./opendaw/markers";
import type { MarkerBox } from "@opendaw/studio-boxes";

export const STRIP_HEIGHT = 26;

export interface MarkerStripProps {
  markers: ReadonlyArray<MarkerInfo>;
  duration: number;
  zoom: number;
  scroll: number;
  playheadSeconds: number;
  skin: Skin;
  onAdd: (seconds: number, label: string, hue: number) => void;
  onMove: (box: MarkerBox, seconds: number) => void;
  onRename: (box: MarkerBox, label: string) => void;
  onDelete: (box: MarkerBox) => void;
}

export function MarkerStrip({
  markers, duration, zoom, scroll, playheadSeconds, skin, onAdd, onMove, onRename, onDelete,
}: MarkerStripProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ uuid: string; x: number } | null>(null);

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
  const xToSeconds = (x: number) => from + (width > 0 ? (x / width) * visible : 0);

  const startDrag = useCallback(
    (uuid: string, box: MarkerBox) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = ref.current?.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const x = Math.max(0, Math.min(width, ev.clientX - (rect?.left ?? 0)));
        setDragging({ uuid, x });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const x = Math.max(0, Math.min(width, ev.clientX - (rect?.left ?? 0)));
        setDragging(null);
        onMove(box, xToSeconds(x));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    // xToSeconds/width close over the current window; fine for a drag gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, from, visible, onMove],
  );

  return (
    <div
      ref={ref}
      style={{
        position: "relative", height: STRIP_HEIGHT, flex: "0 0 auto",
        borderBottom: `1px solid ${skin.laneLine}`,
        background: skin.surfaceSunken, overflow: "hidden",
      }}
    >
      {/* Add-at-playhead, pinned left so it doesn't move with the timeline. */}
      <button
        onClick={() => setPicking((v) => !v)}
        title="Add a section marker at the playhead"
        style={{
          position: "absolute", left: 4, top: 3, zIndex: 3,
          height: STRIP_HEIGHT - 8, display: "flex", alignItems: "center", gap: 3,
          padding: "0 7px", background: skin.surface, color: skin.fgMuted,
          border: `1px solid ${skin.border}`, borderRadius: radius.sm,
          font: `600 ${size.xs}px ${font.body}`, cursor: "pointer",
        }}
      >
        <Plus size={12} /> Marker
      </button>

      {picking && (
        <div
          style={{
            position: "absolute", left: 4, top: STRIP_HEIGHT + 2, zIndex: 5,
            background: skin.surface, border: `1px solid ${skin.borderStrong}`,
            borderRadius: radius.sm, padding: 4, display: "flex", flexWrap: "wrap",
            gap: 3, width: 210, boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => { onAdd(playheadSeconds, s.label, s.hue); setPicking(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 8px", cursor: "pointer",
                background: "transparent", border: `1px solid ${skin.border}`,
                borderRadius: radius.sm, color: skin.fg, font: `500 ${size.xs}px ${font.body}`,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: `hsl(${s.hue} 65% 55%)` }} />
              {s.label}
            </button>
          ))}
          <button
            onClick={() => { onAdd(playheadSeconds, "Section", hueFor("Section")); setPicking(false); }}
            style={{
              padding: "4px 8px", cursor: "pointer", background: "transparent",
              border: `1px dashed ${skin.border}`, borderRadius: radius.sm,
              color: skin.fgMuted, font: `500 ${size.xs}px ${font.body}`,
            }}
          >
            Custom
          </button>
        </div>
      )}

      {markers.map((m) => {
        const x = dragging?.uuid === m.uuid ? dragging.x : secondsToX(m.seconds);
        // Off-screen markers just don't render; the window has scrolled past them.
        if (x < -2 || x > width + 2) return null;
        const colour = `hsl(${m.hue} 65% 55%)`;
        return (
          <div
            key={m.uuid}
            style={{ position: "absolute", left: x, top: 0, height: STRIP_HEIGHT, zIndex: 2 }}
          >
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: colour }} />
            {renaming === m.uuid ? (
              <input
                autoFocus
                defaultValue={m.label}
                onBlur={(e) => { onRename(m.box, e.target.value.trim() || m.label); setRenaming(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
                style={{
                  position: "absolute", left: 3, top: 3, width: 90,
                  font: `600 ${size.xs}px ${font.body}`, color: skin.fg,
                  background: skin.surface, border: `1px solid ${colour}`,
                  borderRadius: radius.sm, padding: "1px 4px",
                }}
              />
            ) : (
              <span
                onPointerDown={startDrag(m.uuid, m.box)}
                onDoubleClick={() => setRenaming(m.uuid)}
                title={`${m.label} — drag to move, double-click to rename`}
                style={{
                  position: "absolute", left: 3, top: 3, whiteSpace: "nowrap",
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "1px 5px", cursor: "grab", userSelect: "none",
                  background: colour, color: "#fff",
                  borderRadius: radius.sm, font: `600 ${size.xs}px ${font.body}`,
                }}
              >
                {m.label}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onDelete(m.box)}
                  title="Delete marker"
                  aria-label={`Delete ${m.label}`}
                  style={{
                    display: "grid", placeItems: "center", width: 12, height: 12,
                    background: "rgba(0,0,0,.25)", color: "#fff", border: "none",
                    borderRadius: 2, cursor: "pointer", padding: 0, lineHeight: 1,
                    font: `700 9px ${font.body}`,
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
