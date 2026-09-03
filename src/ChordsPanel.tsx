/**
 * The song's chords and lyrics, straight from Run Sheet.
 *
 * Read-only on purpose: this is the same `lyrics_chords` text Run Sheet owns,
 * shown here so you can play along without leaving the DAW. Editing stays in Run
 * Sheet — one field written by two apps is a field that loses work.
 *
 * Monospace and whitespace-preserved, because chord charts are laid out by
 * spaces: the chord sits above the syllable it lands on, and a proportional font
 * or collapsed spaces throws that alignment away.
 */
import { font, radius, size, space, type Skin } from "./theme";

export interface ChordsPanelProps {
  skin: Skin;
  text: string;
  /**
   * Start a drag on the bottom grip, or null for no grip.
   *
   * The panel doesn't own its own height. It fills the column it's in, so the
   * only way it gets taller is for that column's row to get taller — which is
   * the layout's business, not this panel's. The grip lives here because this is
   * the bottom edge the user reaches for; the resizing happens where the space
   * actually is. One source of truth for the height, as ever.
   */
  onGrab?: ((e: React.PointerEvent) => void) | null;
  /** Double-click the grip: back to filling the column. */
  onReset?: () => void;
}

export function ChordsPanel({ skin, text, onGrab, onReset }: ChordsPanelProps) {
  const has = text.trim().length > 0;
  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        // Fill the bounded wrapper exactly. Without an explicit height the
        // section sizes to its content and spills past its flex box — down over
        // the engine log, and dragging the page instead of scrolling in place.
        height: "100%",
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "baseline", gap: space[2],
          padding: `${space[3]}px ${space[4]}px`,
          borderBottom: `1px solid ${skin.border}`,
          flex: "0 0 auto",
        }}
      >
        <h2
          style={{
            font: `600 ${size.xs}px ${font.body}`,
            letterSpacing: ".08em", textTransform: "uppercase",
            color: skin.fgSubtle, margin: 0,
          }}
        >
          Chords &amp; Lyrics
        </h2>
      </header>

      {/* flex:1 + minHeight:0 makes THIS the scroll box. Without the flex it
          sizes to its content and the whole page scrolls instead, dragging the
          DAW around when you read down a long lyric. */}
      <div style={{ flex: 1, minHeight: 0, padding: space[3], overflow: "auto", overscrollBehavior: "contain" }}>
        {has ? (
          <pre
            style={{
              margin: 0,
              font: `${size.sm}px ${font.mono}`,
              color: skin.fg,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.5,
            }}
          >
            {text}
          </pre>
        ) : (
          <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0 }}>
            No chords or lyrics yet. Add them to this song in Run Sheet.
          </p>
        )}
      </div>

      {/* The grip. Drag down for more of the chart — the row grows and the page
          scrolls to it. On the bottom edge because that's the edge that moves. */}
      {onGrab && (
        <div
          onPointerDown={onGrab}
          onDoubleClick={onReset}
          title="Drag down for more lyrics — double-click to fit the window"
          style={{
            flex: "0 0 auto", height: 11,
            display: "grid", placeItems: "center",
            borderTop: `1px solid ${skin.border}`,
            background: skin.surfaceSunken,
            cursor: "ns-resize", touchAction: "none",
          }}
        >
          <span style={{ width: 26, height: 2, borderRadius: 1, background: skin.borderStrong }} />
        </div>
      )}
    </section>
  );
}
