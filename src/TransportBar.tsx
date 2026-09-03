/**
 * One control cluster: rewind, play, record, and what the engine says.
 *
 * Record used to live in its own panel, several inches from Play, driving a
 * separate code path. Both of those were mistakes — the second one caused
 * real bugs, because "start playing" and "start recording while playing" were
 * written as if they were unrelated operations. They sit together here for the
 * same reason they sit together on every desk ever built.
 *
 * Everything displayed comes from the engine via useTransport. Nothing here
 * keeps its own idea of whether the song is moving.
 */
import { Circle, Play, SkipBack, Square } from "lucide-react";
import { accents, control, font, radius, size, space, LANE_HEIGHT, type AccentName, type Look, type Skin } from "./theme";
import { formatKey } from "./naming";
import { CLICK_MIN_DB } from "./useMetronome";

export interface TransportBarProps {
  skin: Skin;
  accent: string;
  accentFg: string;
  position: number;
  duration: number;
  bpm: number | null;
  songKey: string | null;
  isPlaying: boolean;
  isRecording: boolean;
  isCountingIn: boolean;
  /** Null when no track is armed — Record is then unavailable, with a reason. */
  armedTrackName: string | null;
  countIn: boolean;
  /** Metronome: audible click through playback, not just the count-in. */
  metronome: boolean;
  onMetronome: (on: boolean) => void;
  /** Click level, in dB (≤ 0). */
  clickGainDb: number;
  onClickGain: (db: number) => void;
  busy: boolean;
  look: Look;
  onLook: (patch: Partial<Look>) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPlay: () => void;
  /** Stops whatever is happening — a take in progress, or plain playback. */
  onStop: () => void;
  onRewind: () => void;
  onRecord: () => void;
  onCountIn: (on: boolean) => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  onSave: () => void;
  bouncing: boolean;
  onBounce: () => void;
}

export function TransportBar(p: TransportBarProps) {
  const { skin, accent, accentFg } = p;

  const square: React.CSSProperties = {
    width: 34, height: 34, display: "grid", placeItems: "center",
    background: "transparent", color: skin.fg,
    border: `1px solid ${skin.border}`, borderRadius: radius.md, cursor: "pointer",
  };

  const recordable = p.armedTrackName !== null && !p.busy;

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
      <button onClick={p.onRewind} title="Back to start" style={square} aria-label="Back to start">
        <SkipBack size={15} fill="currentColor" />
      </button>

      <button
        onClick={p.onPlay}
        aria-label="Play"
        title="Play"
        style={{
          width: 46, height: 46, borderRadius: radius.pill,
          display: "grid", placeItems: "center",
          background: accent, color: accentFg, border: "none", cursor: "pointer",
        }}
      >
        <Play size={16} fill="currentColor" />
      </button>

      {/*
        One Stop for everything. Play, Stop and Record each do exactly one thing
        now — no button that means "start" one moment and "stop" the next. Stop
        finalises a take when one is running and otherwise just halts playback,
        so ending a recording is always the same click in the same place, which
        is what makes a recorded lane land reliably.
      */}
      {(() => {
        const active = p.isPlaying || p.isRecording || p.isCountingIn;
        return (
          <button
            onClick={p.onStop}
            disabled={!active}
            aria-label="Stop"
            title="Stop"
            style={{
              width: 46, height: 46, borderRadius: radius.pill,
              display: "grid", placeItems: "center",
              background: skin.surfaceSunken, color: skin.fg,
              border: `1px solid ${skin.border}`,
              cursor: active ? "pointer" : "default",
              opacity: active ? 1 : 0.4,
            }}
          >
            <Square size={15} fill="currentColor" />
          </button>
        );
      })()}

      {/*
        Record sits next to Play because it is the same gesture with one more
        thing switched on: the song rolls either way. It only starts a take now;
        Stop ends it.
      */}
      <button
        onClick={p.onRecord}
        disabled={!recordable || p.isRecording || p.isCountingIn}
        title={p.armedTrackName ? `Record onto ${p.armedTrackName}` : "Add a track to record onto"}
        aria-label="Record"
        style={{
          width: 46, height: 46, borderRadius: radius.pill,
          display: "grid", placeItems: "center",
          background: p.isRecording || p.isCountingIn ? "#8E2C24" : "#C0453B",
          border: "none",
          cursor: recordable && !p.isRecording && !p.isCountingIn ? "pointer" : "default",
          opacity: recordable || p.isRecording || p.isCountingIn ? 1 : 0.35,
        }}
      >
        {/*
          Blinks only while something is actually happening. A blinking dot on
          an idle button is decoration pretending to be status.
        */}
        <Circle
          size={15}
          fill="#fff"
          color="#fff"
          style={{
            animation: p.isRecording || p.isCountingIn ? "rec-blink 1s steps(2,start) infinite" : undefined,
          }}
        />
      </button>

      <label
        style={{
          display: "flex", alignItems: "center", gap: 5, height: 34,
          font: `${size.sm}px ${font.body}`, color: skin.fgMuted, cursor: "pointer",
        }}
        title="Four beats before recording starts"
      >
        <input
          type="checkbox"
          checked={p.countIn}
          disabled={p.isRecording || p.isCountingIn}
          onChange={(e) => p.onCountIn(e.target.checked)}
        />
        Count-in
      </label>

      {/*
        The click. Its own toggle rather than riding on Count-in, because they're
        different wants — count me in, versus keep time the whole way through —
        and a level beside it, since a click has to be heard over the mix without
        drowning it. dB, not a 0..1 knob, to match the engine's own scale.
      */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: 34 }}>
        <button
          onClick={() => p.onMetronome(!p.metronome)}
          aria-pressed={p.metronome}
          title={p.metronome ? "Click on — playing through the song" : "Click off"}
          style={{
            display: "flex", alignItems: "center", gap: 5, height: 26, paddingInline: 8,
            font: `700 ${size.xs}px ${font.body}`, letterSpacing: ".04em",
            color: p.metronome ? "#fff" : skin.fgSubtle,
            background: p.metronome ? control.solo : "transparent",
            border: `1px solid ${p.metronome ? control.solo : skin.border}`,
            borderRadius: radius.sm, cursor: "pointer",
          }}
        >
          <ClickGlyph on={p.metronome} />
          Click
        </button>
        <input
          type="range"
          min={CLICK_MIN_DB}
          max={0}
          step={1}
          value={Math.max(CLICK_MIN_DB, Math.round(p.clickGainDb))}
          disabled={!p.metronome}
          onChange={(e) => p.onClickGain(Number(e.target.value))}
          title={`Click level ${Math.round(p.clickGainDb)} dB`}
          aria-label="Click level"
          style={{ width: 64, accentColor: control.solo, opacity: p.metronome ? 1 : 0.4 }}
        />
      </div>

      {/* Tabular figures, or the whole bar shifts once a second as digits
          change width. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: space[3], marginLeft: space[2] }}>
        <span style={{ font: `600 ${size.lg}px ${font.mono}`, fontVariantNumeric: "tabular-nums", color: skin.fg }}>
          {formatTime(p.position)}
        </span>
        <span style={{ font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle, fontVariantNumeric: "tabular-nums" }}>
          / {formatTime(p.duration)}
        </span>
        {p.bpm && (
          <span
            style={{
              display: "flex", alignItems: "baseline", gap: 5,
              paddingLeft: space[3], borderLeft: `1px solid ${skin.border}`,
            }}
          >
            <span style={{ font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em", color: skin.fgSubtle }}>
              BAR
            </span>
            <span
              style={{
                font: `600 ${size.sm}px ${font.mono}`, color: skin.fgMuted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatBars(p.position, p.bpm)}
            </span>
          </span>
        )}
      </div>

      <span style={{ font: `500 ${size.xs}px ${font.body}`, letterSpacing: ".08em", color: skin.fgSubtle }}>
        {[p.bpm ? `${p.bpm} BPM` : null, "4/4", formatKey(p.songKey)].filter(Boolean).join(" · ")}
      </span>

      <div style={{ flex: 1 }} />

      <button
        onClick={p.onSave}
        disabled={p.saveState === "saving"}
        title="Save this session so the mix is here next time"
        style={{
          height: 32, paddingInline: 12,
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em", textTransform: "uppercase",
          color: p.saveState === "failed" ? "#C0453B" : skin.fg,
          background: "transparent",
          border: `1px solid ${p.saveState === "failed" ? "#C0453B" : skin.border}`,
          borderRadius: radius.md,
          cursor: p.saveState === "saving" ? "default" : "pointer",
        }}
      >
        {p.saveState === "saving" ? "Saving…" : p.saveState === "saved" ? "Saved" : p.saveState === "failed" ? "Retry save" : "Save"}
      </button>

      <button
        onClick={p.onBounce}
        disabled={p.bouncing}
        title="Render the whole mix to a WAV in Idea Drop"
        style={{
          height: 32, paddingInline: 12,
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em", textTransform: "uppercase",
          color: skin.fg, background: "transparent",
          border: `1px solid ${skin.border}`, borderRadius: radius.md,
          cursor: p.bouncing ? "default" : "pointer",
          opacity: p.bouncing ? 0.6 : 1,
        }}
      >
        {p.bouncing ? "Bouncing…" : "Bounce"}
      </button>

      <LookControls skin={skin} look={p.look} onLook={p.onLook} zoom={p.zoom} onZoom={p.onZoom} />

      <style>{`@keyframes rec-blink { to { opacity: .25 } }`}</style>
    </div>
  );
}

function LookControls({
  skin, look, onLook, zoom, onZoom,
}: {
  skin: Skin;
  look: Look;
  onLook: (p: Partial<Look>) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  const chip = (active: boolean): React.CSSProperties => ({
    font: `500 ${size.xs}px ${font.body}`,
    letterSpacing: ".08em", textTransform: "uppercase",
    padding: "5px 9px", borderRadius: radius.md, cursor: "pointer",
    border: `1px solid ${active ? skin.borderStrong : skin.border}`,
    background: active ? skin.bg : "transparent",
    color: active ? skin.fg : skin.fgSubtle,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
      <button style={chip(look.skin === "light")} onClick={() => onLook({ skin: "light" })}>Light</button>
      <button style={chip(look.skin === "dark")} onClick={() => onLook({ skin: "dark" })}>Dark</button>

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

      {/*
        Zoom and Height sit together on the right — both shape the view rather
        than the sound. Zoom is powers of two: a timeline that lands on 3.7x is
        one you can't return to, and each step halves what's on screen.
      */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 6, marginLeft: space[2],
          font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em",
          textTransform: "uppercase", color: skin.fgSubtle,
        }}
      >
        Zoom
        <input
          type="range"
          min={0} max={6} step={1}
          value={Math.round(Math.log2(zoom))}
          onChange={(e) => onZoom(2 ** Number(e.target.value))}
          onDoubleClick={() => onZoom(1)}
          title="Zoom — double-click to fit the song"
          style={{ width: 70, accentColor: skin.fgMuted }}
        />
        <span style={{ font: `500 ${size.xs}px ${font.mono}`, width: 24, color: skin.fgMuted }}>
          {zoom}×
        </span>
      </label>

      {/* Labelled, unlike the mystery slider this replaces. */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 6, marginLeft: space[2],
          font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em",
          textTransform: "uppercase", color: skin.fgSubtle,
        }}
      >
        Height
        <input
          type="range"
          min={LANE_HEIGHT.min}
          max={LANE_HEIGHT.max}
          value={look.laneHeight}
          onChange={(e) => onLook({ laneHeight: Number(e.target.value) })}
          style={{ width: 70, accentColor: skin.fgMuted }}
        />
      </label>

      {/* Waveforms default to the skin's own colour; this tints each one its
          track's role colour instead. */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 5, marginLeft: space[2],
          font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em",
          textTransform: "uppercase", color: skin.fgSubtle, cursor: "pointer",
        }}
        title="Colour each waveform by its track"
      >
        <input
          type="checkbox"
          checked={look.colorWaveforms}
          onChange={(e) => onLook({ colorWaveforms: e.target.checked })}
        />
        Colour
      </label>
    </div>
  );
}

/** A little metronome: a wedge with a pendulum, leaning when it's on. */
function ClickGlyph({ on }: { on: boolean }) {
  return (
    <svg width={11} height={13} viewBox="0 0 11 13" fill="none" aria-hidden>
      <path d="M3 1.5 L8 1.5 L10 11.5 L1 11.5 Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <line
        x1={5.5} y1={10} x2={on ? 7.5 : 5.5} y2={3.5}
        stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
      />
    </svg>
  );
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Bar and beat, both counted from one, because musicians do.
 *
 * Assumes 4/4 and says so in the bar beside it — Run Sheet has no time
 * signature field, and pretending to know better would be a lie dressed as a
 * feature.
 */
export function formatBars(seconds: number, bpm: number): string {
  const beats = Math.max(0, seconds) * (bpm / 60);
  return `${Math.floor(beats / 4) + 1}|${Math.floor(beats % 4) + 1}`;
}
