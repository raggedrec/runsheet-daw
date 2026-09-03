/**
 * The panel shown while a song's stems are fetched and decoded.
 *
 * This is a wait with a known length — N files, one after another — so it gets a
 * real progress display rather than a line of text: a ring that fills as the
 * parts land, and a waveform that colours in behind it. The point isn't
 * decoration; several minutes of audio takes a moment, and a screen that's
 * visibly moving is the difference between "loading" and "hung".
 *
 * The percentage is parts-done over parts-total, the same count the heading
 * says in words, because two numbers for one fact drift apart. The waveform is
 * cosmetic and says so — a fixed shape, coloured to the same fraction — not a
 * render of the audio, which isn't decoded yet to draw.
 */
import { useMemo } from "react";
import { font, radius, size, space, type Skin } from "./theme";
import type { LoadProgress } from "./opendaw/loadSong";

export interface LoadingPanelProps {
  skin: Skin;
  accent: string;
  /** null before the first file — the engine is still starting. */
  progress: LoadProgress | null;
}

const BARS = 72;

export function LoadingPanel({ skin, accent, progress }: LoadingPanelProps) {
  // index counts the part being worked on (1-based), so index/total is the
  // share underway — 1 of 6 reads as 17%, matching the words beside it.
  const fraction = progress ? Math.min(1, progress.index / progress.total) : 0;
  const percent = Math.round(fraction * 100);

  /*
   * A stable waveform shape. Seeded from the bar index so it never reshuffles
   * between renders (a progress bar that twitches its own outline looks broken),
   * and fuller in the middle like a real part, so it reads as a waveform rather
   * than a bar chart.
   */
  const heights = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        const noise = Math.sin(i * 12.9898) * 43758.5453;
        const r = noise - Math.floor(noise);
        const envelope = 0.3 + 0.7 * Math.sin((i / (BARS - 1)) * Math.PI);
        return 0.14 + 0.86 * r * envelope;
      }),
    [],
  );

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        padding: space[5],
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: space[5],
          padding: space[5],
          background: skin.surfaceSunken,
          border: `1px solid ${skin.border}`,
          borderRadius: radius.md,
          flexWrap: "wrap",
        }}
      >
        <Ring skin={skin} accent={accent} fraction={fraction} percent={percent} indeterminate={!progress} />

        <div style={{ flex: 1, minWidth: 240 }}>
          <p
            style={{
              font: `500 ${size.lg}px ${font.body}`, color: skin.fg,
              margin: `0 0 ${space[3]}px`,
            }}
          >
            {progress ? (
              <>
                Loading {progress.index} of {progress.total} —{" "}
                <span style={{ color: skin.fgMuted }}>{progress.name}</span>
              </>
            ) : (
              "Starting the engine…"
            )}
          </p>

          <Waveform skin={skin} accent={accent} heights={heights} fraction={fraction} />

          <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: `${space[3]}px 0 0` }}>
            Audio is decoded in this browser. Nothing is uploaded.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The progress ring: a faint track with the accent arc drawn over it. */
function Ring({
  skin, accent, fraction, percent, indeterminate,
}: {
  skin: Skin;
  accent: string;
  fraction: number;
  percent: number;
  indeterminate: boolean;
}) {
  const size2 = 116;
  const stroke = 7;
  const r = (size2 - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A sliver of arc while the engine starts, so the ring isn't a dead circle
  // before the first file gives it a real number.
  const shown = indeterminate ? 0.08 : fraction;

  return (
    <div style={{ position: "relative", width: size2, height: size2, flex: "0 0 auto" }}>
      <svg width={size2} height={size2} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size2 / 2} cy={size2 / 2} r={r} fill="none" stroke={skin.slot} strokeWidth={stroke} />
        <circle
          cx={size2 / 2}
          cy={size2 / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{
            transition: "stroke-dashoffset .3s ease",
            animation: indeterminate ? "load-ring-spin 1s linear infinite" : undefined,
            transformOrigin: "center",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}
      >
        <span
          style={{
            font: `600 ${size.xl}px ${font.mono}`, color: skin.fg,
            fontVariantNumeric: "tabular-nums", lineHeight: 1,
          }}
        >
          {indeterminate ? "—" : `${percent}%`}
        </span>
        <span
          style={{
            font: `600 9px ${font.body}`, letterSpacing: ".14em",
            textTransform: "uppercase", color: skin.fgSubtle, marginTop: 3,
          }}
        >
          Loading
        </span>
      </div>
      <style>{`@keyframes load-ring-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

/** A cosmetic waveform, coloured in to the same fraction as the ring. */
function Waveform({
  skin, accent, heights, fraction,
}: {
  skin: Skin;
  accent: string;
  heights: number[];
  fraction: number;
}) {
  const filledUpTo = Math.round(fraction * heights.length);
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 2,
        height: 44, width: "100%",
      }}
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            height: `${Math.round(h * 100)}%`,
            minWidth: 1,
            borderRadius: 1,
            background: i < filledUpTo ? accent : skin.waveMuted,
          }}
        />
      ))}
    </div>
  );
}
