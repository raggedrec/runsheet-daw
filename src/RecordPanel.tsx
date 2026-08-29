/**
 * Add a track, and choose the input everything records from.
 *
 * Record and count-in used to live here too. They moved to the transport, and
 * this panel keeps only what it is actually for: making a track, and picking
 * the device. Two Record buttons on one screen is worse than none — you can't
 * tell which one is real.
 *
 * Arming is not here either. It belongs on the track, in the R button beside
 * mute and solo, because "am I recording this" is a property of a track.
 */
import { useCallback, useState } from "react";
import { useInputMeter } from "./useInputMeter";
import { font, radius, size, space, type Skin } from "./theme";
import type { InputDevice } from "./opendaw/recording";

export interface RecordPanelProps {
  skin: Skin;
  accent: string;
  accentFg: string;
  devices: InputDevice[];
  deviceId: string | null;
  isRecording: boolean;
  busy: boolean;
  error: { message: string; remedy: string } | null;
  onAddTrack: (name: string) => void;
  onChooseDevice: (deviceId: string) => void;
}

export function RecordPanel({
  skin, accent, accentFg, devices, deviceId, isRecording, busy, error,
  onAddTrack, onChooseDevice,
}: RecordPanelProps) {
  const [name, setName] = useState("");
  // Runs whenever a device is chosen — the point is to see signal BEFORE
  // committing to a take, not to discover afterwards that nothing arrived.
  const meter = useInputMeter(deviceId, devices.length > 0);

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
              Add
            </button>
          </div>
        </div>

        <div>
          <label style={label} htmlFor="take-input">
            Input
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
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
            <Meter skin={skin} level={meter.level} sawSignal={meter.sawSignal} error={meter.error} />
          </div>
        </div>

        <div style={{ flex: 1 }} />
      </div>

      {error && (
        <p style={{ font: `${size.sm}px ${font.body}`, color: "#C0453B", margin: `${space[3]}px 0 0` }}>
          <strong>{error.message}</strong> {error.remedy}
        </p>
      )}
    </section>
  );
}

/**
 * A peak meter for the chosen input.
 *
 * Vertical-ish bar rather than a number: a level is something you watch move,
 * and a figure updating sixty times a second is unreadable. Turns red near the
 * top because that's where you need to reach for the gain knob, and stays grey
 * until signal has actually been seen — "no signal yet" and "silence right
 * now" are different, and only the first is a problem worth flagging.
 */
function Meter({
  skin, level, sawSignal, error,
}: {
  skin: Skin;
  level: number;
  sawSignal: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <span style={{ font: `500 ${size.xs}px ${font.body}`, color: "#C0453B", width: 96 }}>
        {error}
      </span>
    );
  }

  // Peak in dB, mapped onto the bar. Linear amplitude spends almost all its
  // range in the top few dB, which makes a linear meter useless for anything
  // quiet — a vocal at a sane level would barely leave the left edge.
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const filled = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
  const hot = db > -3;

  return (
    <span
      title={sawSignal ? "Input level" : "No signal seen yet"}
      style={{ display: "flex", alignItems: "center", gap: 6, width: 108, flex: "0 0 auto" }}
    >
      <span
        style={{
          position: "relative", height: 8, flex: 1,
          background: skin.slot, borderRadius: 999, overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute", inset: 0,
            transformOrigin: "left center",
            transform: `scaleX(${filled})`,
            background: hot ? "#C0453B" : "#3B9E5A",
            // No transition: a meter that eases is lying about when the peak
            // happened.
          }}
        />
      </span>
      <span
        style={{
          font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle,
          width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums",
        }}
      >
        {Number.isFinite(db) && sawSignal ? Math.round(db) : "--"}
      </span>
    </span>
  );
}
