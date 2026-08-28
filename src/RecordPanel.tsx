/**
 * Add a track, choose an input, arm it, record.
 *
 * Laid out as the four steps in order, left to right, because that is the
 * order they have to happen in and a panel that shows them any other way
 * invites you to press Record before anything is armed.
 *
 * The record button is the only red thing on the screen. That's deliberate:
 * it's the one control here that changes the world rather than the view.
 */
import { useCallback, useState } from "react";
import { font, radius, size, space, type Skin } from "./theme";
import type { InputDevice } from "./opendaw/recording";

export interface RecordPanelProps {
  skin: Skin;
  accent: string;
  accentFg: string;
  /** Null until a track has been added and armed. */
  armedTrackName: string | null;
  devices: InputDevice[];
  deviceId: string | null;
  isRecording: boolean;
  countIn: boolean;
  busy: boolean;
  error: { message: string; remedy: string } | null;
  onAddTrack: (name: string) => void;
  onChooseDevice: (deviceId: string) => void;
  onCountIn: (on: boolean) => void;
  onRecord: () => void;
  onStop: () => void;
}

export function RecordPanel({
  skin, accent, accentFg, armedTrackName, devices, deviceId, isRecording,
  countIn, busy, error, onAddTrack, onChooseDevice, onCountIn, onRecord, onStop,
}: RecordPanelProps) {
  const [name, setName] = useState("");

  const add = useCallback(() => {
    const trimmed = name.trim();
    // A default rather than a blocked button: the point is to get recording,
    // and a take called "Take" is renameable later.
    onAddTrack(trimmed.length > 0 ? trimmed : "Take");
    setName("");
  }, [name, onAddTrack]);

  const label: React.CSSProperties = {
    font: `600 ${size.xs}px ${font.body}`,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: skin.fgSubtle,
    display: "block",
    marginBottom: 5,
  };
  const field: React.CSSProperties = {
    font: `${size.base}px ${font.body}`,
    color: skin.fg,
    background: skin.surfaceSunken,
    border: `1px solid ${skin.border}`,
    borderRadius: radius.sm,
    padding: "6px 8px",
    height: 32,
    boxSizing: "border-box",
  };

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        padding: space[4],
        marginBottom: space[4],
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: space[3], flexWrap: "wrap" }}>
        <div>
          <label style={label} htmlFor="take-name">
            New track
          </label>
          <div style={{ display: "flex", gap: space[2] }}>
            <input
              id="take-name"
              value={name}
              placeholder="Vox 2"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              style={{ ...field, width: 150 }}
            />
            <button
              onClick={add}
              disabled={busy || isRecording}
              style={{
                ...field,
                background: accent,
                color: accentFg,
                border: "none",
                cursor: busy || isRecording ? "default" : "pointer",
                opacity: busy || isRecording ? 0.5 : 1,
                fontWeight: 600,
                paddingInline: 12,
              }}
            >
              Add &amp; arm
            </button>
          </div>
        </div>

        <div>
          <label style={label} htmlFor="take-input">
            Input
          </label>
          <select
            id="take-input"
            value={deviceId ?? ""}
            onChange={(e) => onChooseDevice(e.target.value)}
            disabled={devices.length === 0 || isRecording}
            style={{ ...field, minWidth: 190 }}
          >
            {devices.length === 0 && <option value="">Allow the microphone…</option>}
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <label
          style={{
            display: "flex", alignItems: "center", gap: 6, height: 32,
            font: `${size.base}px ${font.body}`, color: skin.fgMuted, cursor: "pointer",
          }}
          title="Four beats before recording starts"
        >
          <input
            type="checkbox"
            checked={countIn}
            disabled={isRecording}
            onChange={(e) => onCountIn(e.target.checked)}
          />
          Count-in
        </label>

        <div style={{ flex: 1 }} />

        <button
          onClick={isRecording ? onStop : onRecord}
          disabled={busy || (!isRecording && armedTrackName === null)}
          title={armedTrackName ? `Record onto ${armedTrackName}` : "Add a track first"}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            height: 36, paddingInline: 16,
            font: `600 ${size.base}px ${font.body}`,
            color: "#fff",
            background: isRecording ? "#8E2C24" : "#C0453B",
            border: "none",
            borderRadius: radius.sm,
            cursor: busy || (!isRecording && armedTrackName === null) ? "default" : "pointer",
            opacity: busy || (!isRecording && armedTrackName === null) ? 0.45 : 1,
          }}
        >
          <span
            style={{
              width: 10, height: 10, borderRadius: radius.pill, background: "#fff",
              // Only while it's actually recording — a blinking dot on an idle
              // button is decoration pretending to be status.
              animation: isRecording ? "rec-blink 1s steps(2, start) infinite" : undefined,
            }}
          />
          {isRecording ? "Stop" : "Record"}
        </button>
      </div>

      {armedTrackName && !isRecording && (
        <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgMuted, margin: `${space[3]}px 0 0` }}>
          Armed: <strong style={{ color: skin.fg }}>{armedTrackName}</strong>. The song plays while you record.
        </p>
      )}

      {error && (
        <p style={{ font: `${size.sm}px ${font.body}`, color: "#C0453B", margin: `${space[3]}px 0 0` }}>
          <strong>{error.message}</strong> {error.remedy}
        </p>
      )}

      <style>{`@keyframes rec-blink { to { opacity: .25 } }`}</style>
    </section>
  );
}
