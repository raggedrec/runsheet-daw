/**
 * The comments lane — pins where people left notes on the song.
 *
 * Shares the timeline's coordinate maths exactly (visible window is
 * `duration / zoom` from `scroll`), like the marker and chord strips, so a pin
 * stays over the moment it's about. The gutter holds the add control; the strip
 * holds the pins. Click a pin to read it (and delete it); add one at the
 * playhead. The rows are the shared `feedback` table, so a note here is a note
 * in Run Sheet.
 */
import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { TRACK_COLUMN } from "./TrackList";
import { font, radius, size, type Skin } from "./theme";
import type { Comment } from "./runsheet";

export const COMMENT_LANE_HEIGHT = 24;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CommentStrip({
  comments, duration, zoom, scroll, playheadSeconds, skin, accent, onAdd, onDelete,
}: {
  comments: ReadonlyArray<Comment>;
  duration: number;
  zoom: number;
  scroll: number;
  playheadSeconds: number;
  skin: Skin;
  accent: string;
  onAdd: (atSeconds: number, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const visible = duration / Math.max(1, zoom);
  const from = Math.max(0, Math.min(scroll, Math.max(0, duration - visible)));
  const secondsToX = (s: number) => (visible > 0 ? ((s - from) / visible) * width : 0);

  const commit = () => {
    const text = draft.trim();
    if (text) onAdd(playheadSeconds, text);
    setDraft("");
    setAdding(false);
  };

  return (
    <div style={{ display: "flex", flex: "0 0 auto" }}>
      {/* Gutter: the add control, over the track column (not over the pins). */}
      <div
        style={{
          width: TRACK_COLUMN, flex: "0 0 auto", height: COMMENT_LANE_HEIGHT,
          display: "flex", alignItems: "center", gap: 6, padding: "0 6px", boxSizing: "border-box",
          background: skin.surfaceSunken, borderBottom: `1px solid ${skin.laneLine}`,
        }}
      >
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            placeholder={`Note at ${clock(playheadSeconds)}…`}
            style={{
              flex: 1, minWidth: 0, height: 18, font: `${size.xs}px ${font.body}`,
              color: skin.fg, background: skin.surface, border: `1px solid ${accent}`,
              borderRadius: radius.sm, padding: "0 4px",
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            title="Leave a note at the playhead"
            style={{
              display: "flex", alignItems: "center", gap: 4, height: 18, padding: "0 6px",
              font: `600 ${size.xs}px ${font.body}`, color: skin.fgMuted,
              background: "transparent", border: `1px solid ${skin.border}`, borderRadius: radius.sm, cursor: "pointer",
            }}
          >
            <MessageSquarePlus size={12} /> Note
          </button>
        )}
      </div>

      {/* Strip: the pins. overflow visible so a popover can rise above the lane. */}
      <div
        ref={ref}
        style={{
          position: "relative", flex: 1, minWidth: 0, height: COMMENT_LANE_HEIGHT,
          background: skin.surfaceSunken, borderBottom: `1px solid ${skin.laneLine}`, overflow: "visible",
        }}
      >
        {comments.map((c) => {
          const x = secondsToX(c.atSeconds);
          if (x < -6 || x > width + 6) return null;
          const open = openId === c.id;
          return (
            <div key={c.id} style={{ position: "absolute", left: x, top: 0 }}>
              <button
                onClick={() => setOpenId(open ? null : c.id)}
                title={`${c.author}: ${c.text}`}
                style={{
                  transform: "translateX(-50%)",
                  display: "grid", placeItems: "center", width: 16, height: COMMENT_LANE_HEIGHT,
                  background: "transparent", border: "none", cursor: "pointer", padding: 0, color: accent,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50% 50% 50% 0", transform: "rotate(45deg)", background: accent, display: "block" }} />
              </button>

              {open && (
                <>
                  <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div
                    style={{
                      position: "absolute", left: 0, bottom: COMMENT_LANE_HEIGHT + 2, transform: "translateX(-50%)",
                      width: 220, zIndex: 41, background: skin.surface,
                      border: `1px solid ${skin.borderStrong}`, borderRadius: radius.md,
                      boxShadow: "0 8px 24px rgba(0,0,0,.4)", padding: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ font: `600 ${size.xs}px ${font.body}`, color: skin.fg }}>{c.author}</span>
                      <span style={{ font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle }}>{clock(c.atSeconds)}</span>
                    </div>
                    <p style={{ margin: 0, font: `${size.sm}px ${font.body}`, color: skin.fg, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {c.text}
                    </p>
                    <button
                      onClick={() => { onDelete(c.id); setOpenId(null); }}
                      title="Delete this note (removes it in Run Sheet too)"
                      style={{
                        marginTop: 6, display: "flex", alignItems: "center", gap: 4,
                        font: `${size.xs}px ${font.body}`, color: "#C0453B",
                        background: "transparent", border: "none", cursor: "pointer", padding: 0,
                      }}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
