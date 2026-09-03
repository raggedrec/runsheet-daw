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
}

export function ChordsPanel({ skin, text }: ChordsPanelProps) {
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

      {/* flex:1 + minHeight:0 makes THIS the scroll box: the panel fills the
          column and a long chart scrolls up and down inside it, rather than
          sizing to its content and dragging the whole page around. */}
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
    </section>
  );
}
