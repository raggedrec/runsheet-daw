/**
 * The screen before the engine starts.
 *
 * It exists for a real reason rather than as a splash: several minutes of
 * audio have to be fetched and decoded, and a browser will not start an
 * AudioContext without a gesture. So there has to be a button, and the button
 * may as well say what it's about to do.
 *
 * What it shows is what a musician needs to confirm they opened the right
 * thing: the song, its tempo and key, and the parts that are about to become
 * lanes. The old version said "3 files ready" followed by a comma-separated
 * list of filenames, which is a log line, not a screen.
 */
import { Play } from "lucide-react";
import { font, laneColorFor, radius, size, space, type Skin } from "./theme";
import { laneName } from "./opendaw/loadSong";
import { formatKey } from "./naming";
import type { Song, SongFile } from "./runsheet";

export interface StartScreenProps {
  skin: Skin;
  accent: string;
  accentFg: string;
  song: Song;
  files: ReadonlyArray<SongFile>;
  onOpen: () => void;
  /** True once the load has begun — the button locks and the loader shows below. */
  loading?: boolean;
}

export function StartScreen({ skin, accent, accentFg, song, files, onOpen, loading = false }: StartScreenProps) {
  /*
   * The key is NOT uppercased with the others. "Cm" is C minor and "CM" is a
   * typo; "Bb" is B flat and "BB" is nothing. Case is meaning here.
   */
  const chips: Array<{ text: string; shout: boolean }> = [
    song.sceneName ? { text: song.sceneName, shout: true } : null,
    song.bpm ? { text: `${song.bpm} BPM`, shout: true } : null,
    formatKey(song.key) ? { text: formatKey(song.key)!, shout: false } : null,
  ].filter(Boolean) as Array<{ text: string; shout: boolean }>;

  if (files.length === 0) {
    return (
      <section style={card(skin)}>
        <h2 style={{ font: `600 ${size.md}px ${font.body}`, color: skin.fg, margin: `0 0 ${space[2]}px` }}>
          Nothing to play yet
        </h2>
        <p style={{ font: `${size.base}px ${font.body}`, color: skin.fgMuted, margin: 0, maxWidth: 460 }}>
          This song has no stems or mixes in Idea Drop — only links, MIDI or notes. Add audio in Run
          Sheet and open it again.
        </p>
      </section>
    );
  }

  return (
    <section style={card(skin)}>
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", marginBottom: space[4] }}>
        {chips.map((c) => (
          <span
            key={c.text}
            style={{
              font: `600 ${size.xs}px ${font.body}`,
              letterSpacing: ".07em",
              textTransform: c.shout ? "uppercase" : "none",
              color: skin.fgMuted,
              background: skin.surfaceSunken,
              border: `1px solid ${skin.border}`,
              borderRadius: radius.pill,
              padding: "4px 10px",
            }}
          >
            {c.text}
          </span>
        ))}
      </div>

      {/*
        The parts, as they'll appear as lanes — same names, same role colours.
        Recognising the session before it opens is the whole job of this list.
      */}
      <ul style={{ listStyle: "none", margin: `0 0 ${space[5]}px`, padding: 0 }}>
        {files.map((f) => {
          const name = laneName(f.name);
          return (
            <li
              key={f.id}
              style={{
                display: "flex", alignItems: "center", gap: space[3],
                padding: `${space[2]}px 0`,
                borderBottom: `1px solid ${skin.laneLine}`,
              }}
            >
              <span
                style={{
                  width: 3, height: 22, borderRadius: 2,
                  background: laneColorFor(name), flex: "0 0 auto",
                }}
              />
              <span style={{ font: `600 ${size.base}px ${font.body}`, color: skin.fg, minWidth: 74 }}>
                {name.toUpperCase()}
              </span>
              <span
                style={{
                  font: `${size.sm}px ${font.body}`, color: skin.fgSubtle,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                title={f.name}
              >
                {f.name}
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".07em",
                  textTransform: "uppercase", color: skin.fgSubtle,
                }}
              >
                {f.role}
              </span>
            </li>
          );
        })}
      </ul>

      <div style={{ display: "flex", alignItems: "center", gap: space[4], flexWrap: "wrap" }}>
        <button
          onClick={onOpen}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: space[2],
            height: 42, paddingInline: 20,
            font: `600 ${size.md}px ${font.body}`,
            background: accent, color: accentFg,
            border: "none", borderRadius: radius.sm,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <Play size={15} fill="currentColor" />
          {loading ? "Opening…" : "Open the session"}
        </button>

        {/*
          Said before it happens, not after. A four-minute stem takes a moment
          to fetch and decode, and silence during that reads as a broken app.
        */}
        <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0, maxWidth: 380 }}>
          {files.length} {files.length === 1 ? "part" : "parts"} will be downloaded and decoded in
          this browser. Nothing is uploaded.
        </p>
      </div>
    </section>
  );
}

function card(skin: Skin): React.CSSProperties {
  return {
    background: skin.surface,
    border: `1px solid ${skin.border}`,
    borderRadius: radius.md,
    padding: space[5],
  };
}
