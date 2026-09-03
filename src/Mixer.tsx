/**
 * The mixer: a vertical strip per track, plus master.
 *
 * Vertical because that is what a desk looks like and what a mix engineer's
 * hands expect — and because comparing six faders is a glance across a row of
 * columns, not a scan down a list of horizontal sliders.
 *
 * Every control writes straight to openDAW's boxes. The box graph IS the mix:
 * the engine reads it, toArrayBuffer() saves it, a bounce renders it. A second
 * copy in React would give two answers to "how loud is the vocal" and they
 * would eventually disagree. `revision` only tells React to re-read.
 *
 * Writes go inside project.editing.modify(), because openDAW refuses box
 * writes outside a transaction.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { EffectFactories } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { LoadedLane } from "./opendaw/loadSong";
import type { InputDevice } from "./opendaw/recording";
import { useInputMeter } from "./useInputMeter";
import { useMasterMeter } from "./useEngineMeter";
import { control, font, laneColorFor, radius, readableOn, size, space, type Skin } from "./theme";
import { DeviceView } from "./DeviceView";
import { EffectsRack } from "./EffectsRack";
import { PanelBoundary } from "./PanelBoundary";

export interface MixerProps {
  project: Project;
  lanes: ReadonlyArray<LoadedLane>;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
  /** Recording input — chosen here now that the old form is gone. */
  inputDevices: InputDevice[];
  deviceId: string | null;
  onChooseDevice: (deviceId: string) => void;
}

/** Sentinel for "the master's device chain is open", since master isn't a lane. */
const MASTER_KEY = "__master__";

/**
 * Whether an effect adapter is a Maximizer.
 *
 * By openDAW's static ClassName, never constructor.name — that returns a single
 * minified letter in production, so a name check would pass in dev and quietly
 * fail once shipped.
 */
function isMaximizer(effect: unknown): boolean {
  const ctor = (effect as { box?: { constructor?: { ClassName?: string } } })?.box?.constructor;
  return (ctor?.ClassName ?? "").startsWith("Maximizer");
}

export function Mixer({ project, lanes, skin, accent, revision, onChanged, inputDevices, deviceId, onChooseDevice }: MixerProps) {
  /*
   * One panel, two views. Clicking a track name in the list swaps the strips
   * for that track's devices; clicking it again goes back. The mixer and the
   * devices are the same question asked at different resolutions — "how does
   * this track sound" — so they share the space rather than competing for it.
   */
  const [openTrack, setOpenTrack] = useState<string | null>(null);
  const masterLevel = useMasterMeter(project);

  const master = project.rootBoxAdapter.audioUnits.adapters().find((a) => a.isOutput);

  // A track's device panel, or the master's — the master is reachable so a
  // limiter (the Maximizer) can sit on the mix bus, which is where it belongs.
  const openLane = openTrack && openTrack !== MASTER_KEY ? lanes.find((l) => l.fileId === openTrack) ?? null : null;
  const openAdapter = openLane
    ? project.rootBoxAdapter.audioUnits.adapters().find((a) => a.box === openLane.unit)
    : openTrack === MASTER_KEY
      ? master
      : undefined;
  const openUnit = openLane?.unit ?? (openTrack === MASTER_KEY ? master?.box ?? null : null);
  const openName = openLane?.name ?? (openTrack === MASTER_KEY ? "Master" : null);
  const isOpen = openUnit !== null;
  const devices = openAdapter?.audioEffects.mapOr((c) => c.adapters(), () => []) ?? [];

  /*
   * The master limiter (openDAW's Maximizer). It ships ON by default — a mix bus
   * without a ceiling clips the moment two loud parts land together — but stays
   * a choice: the LIM button on the master strip removes it or puts it back. We
   * insert it once, the first time a master with an empty chain is seen; after
   * that its presence is just whatever the graph (and any saved session) holds.
   */
  const masterEffects = master?.audioEffects.mapOr((c) => c.adapters(), () => []) ?? [];
  const limiter = masterEffects.find(isMaximizer) ?? null;
  const ensuredLimiter = useRef(false);
  useEffect(() => {
    if (!master || ensuredLimiter.current) return;
    ensuredLimiter.current = true;
    if (master.audioEffects.mapOr((c) => c.adapters().length, () => 0) > 0) return;
    const field = master.audioEffectsField;
    if (field.isEmpty()) return;
    project.editing.modify(() => project.api.insertEffect(field.unwrap(), EffectFactories.Maximizer as never));
    onChanged();
  }, [master, project, onChanged]);

  const toggleLimiter = useCallback(() => {
    if (!master) return;
    const field = master.audioEffectsField;
    const existing = master.audioEffects.mapOr((c) => c.adapters().find(isMaximizer), () => undefined);
    project.editing.modify(() => {
      if (existing) (existing.box as unknown as { delete: () => void }).delete();
      else if (!field.isEmpty()) project.api.insertEffect(field.unwrap(), EffectFactories.Maximizer as never);
    });
    onChanged();
  }, [master, project, onChanged]);

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
        // Fills the space left of the Idea Drop column, so the mixer's right
        // edge lands on the timeline's. minWidth:0 is what lets the strips
        // scroll inside it instead of forcing the panel wider than its slot.
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* The track list, always present, so the way back is where the way in
          was. */}
      <div
        style={{
          width: 130, flex: "0 0 auto",
          borderRight: `1px solid ${skin.border}`,
          background: skin.surfaceSunken,
          padding: space[2],
          overflowY: "auto",
        }}
      >
        <h2
          style={{
            font: `600 ${size.xs}px ${font.body}`,
            letterSpacing: ".08em", textTransform: "uppercase",
            color: skin.fgSubtle, margin: `${space[1]}px 0 ${space[2]}px ${space[2]}px`,
          }}
        >
          {isOpen ? "Devices" : "Mixer"}
        </h2>

        {lanes.map((lane) => {
          const isOpen = openTrack === lane.fileId;
          return (
            <button
              key={lane.fileId}
              onClick={() => setOpenTrack(isOpen ? null : lane.fileId)}
              title={isOpen ? "Back to the mixer" : `Devices on ${lane.name}`}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", textAlign: "left",
                padding: "5px 8px", marginBottom: 1,
                background: isOpen ? skin.surface : "transparent",
                border: "none", borderRadius: radius.sm, cursor: "pointer",
                font: `600 ${size.sm}px ${font.body}`,
                color: isOpen ? skin.fg : skin.fgMuted,
              }}
            >
              <span
                style={{
                  width: 3, height: 14, borderRadius: 2, flex: "0 0 auto",
                  background: laneColorFor(lane.name),
                }}
              />
              {lane.name.toUpperCase()}
            </button>
          );
        })}

        {/* The master's own device chain — a limiter belongs on the mix bus, so
            the master has to be reachable the same way a track is. */}
        {master && (
          <button
            onClick={() => setOpenTrack(openTrack === MASTER_KEY ? null : MASTER_KEY)}
            title={openTrack === MASTER_KEY ? "Back to the mixer" : "Devices on the master bus"}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", textAlign: "left",
              padding: "5px 8px", marginTop: 4,
              background: openTrack === MASTER_KEY ? skin.surface : "transparent",
              border: "none", borderRadius: radius.sm, cursor: "pointer",
              font: `600 ${size.sm}px ${font.body}`,
              color: openTrack === MASTER_KEY ? skin.fg : skin.fgMuted,
            }}
          >
            <span style={{ width: 3, height: 14, borderRadius: 2, flex: "0 0 auto", background: skin.borderStrong }} />
            MASTER
          </button>
        )}

        <InputPicker skin={skin} devices={inputDevices} deviceId={deviceId} onChoose={onChooseDevice} />
      </div>

      <div style={{ flex: 1, minWidth: 0, background: skin.surfaceSunken }}>
        {isOpen && openUnit ? (
          /* One place for a track's devices: the chain (add/remove) on top, the
             parameters below. This replaced a separate Effects panel that
             floated over the lyrics — clicking a track name here is the way in. */
          <div style={{ display: "flex", flexDirection: "column", gap: space[3], padding: space[3], overflow: "auto" }}>
            <EffectsRack
              project={project}
              unit={openUnit}
              trackName={openName}
              skin={skin}
              accent={accent}
              revision={revision}
              onChanged={onChanged}
            />
            <PanelBoundary skin={skin} label="device">
              <DeviceView
                project={project}
                devices={devices}
                trackName={openName ?? "this track"}
                skin={skin}
                accent={accent}
                revision={revision}
                onChanged={onChanged}
              />
            </PanelBoundary>
          </div>
        ) : (
          /* Scrolls sideways rather than shrinking strips to unusable widths —
             a 30px fader is a decoration. */
          <div style={{ display: "flex", gap: 1, overflowX: "auto", padding: space[3] }}>
            {lanes.map((lane) => (
              <Strip
                key={lane.fileId}
                project={project}
                unit={lane.unit}
                name={lane.name}
                colour={laneColorFor(lane.name)}
                skin={skin}
                accent={accent}
                revision={revision}
                onChanged={onChanged}
              />
            ))}

            {master && (
              <Strip
                project={project}
                unit={master.box}
                name="Master"
                colour={skin.borderStrong}
                skin={skin}
                accent={accent}
                revision={revision}
                onChanged={onChanged}
                isMaster
                meterLevel={masterLevel}
                limiterOn={limiter !== null}
                onToggleLimiter={toggleLimiter}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Strip({
  project, unit, name, colour, skin, accent, revision, onChanged, isMaster = false, meterLevel, limiterOn, onToggleLimiter,
}: {
  project: Project;
  unit: AudioUnitBox;
  name: string;
  colour: string;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
  isMaster?: boolean;
  /** Master output peak, 0..1, when this is the master strip. */
  meterLevel?: number;
  /** Master only: whether the Maximizer is on the bus, and the toggle for it. */
  limiterOn?: boolean;
  onToggleLimiter?: () => void;
}) {
  void revision; // the trigger to re-read; values always come from the graph
  const volume = unit.volume.getValue();
  const panning = unit.panning.getValue();
  const muted = unit.mute.getValue();
  const soloed = unit.solo.getValue();

  const write = useCallback(
    (fn: () => void) => {
      project.editing.modify(fn);
      onChanged();
    },
    [project, onChanged],
  );

  const toggle = (on: boolean, activeColour: string): React.CSSProperties => ({
    // Fixed width, not flex. Stretching meant the master's single M filled the
    // strip while every other strip split the row in two — so nothing lined up
    // down the column.
    width: 34, height: 22,
    font: `700 ${size.xs}px ${font.body}`,
    // Readable ink on the state colour — white washes out on the yellow solo.
    color: on ? readableOn(activeColour) : skin.fgSubtle,
    background: on ? activeColour : "transparent",
    border: `1px solid ${on ? activeColour : skin.border}`,
    borderRadius: radius.sm,
    cursor: "pointer", padding: 0,
  });

  return (
    <div
      style={{
        width: 104, flex: "0 0 auto",
        background: skin.surface,
        borderTop: `3px solid ${colour}`,
        padding: `${space[3]}px ${space[2]}px`,
        display: "flex", flexDirection: "column", alignItems: "center", gap: space[2],
      }}
    >
      <span
        style={{
          width: "100%", textAlign: "center",
          font: `600 ${size.sm}px ${font.body}`, letterSpacing: ".05em",
          color: muted ? skin.fgSubtle : skin.fg,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
        title={name}
      >
        {name.toUpperCase()}
      </span>

      {/* Master has no solo — soloing the output is meaningless, and a control
          that does nothing is worse than one that isn't there. */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center", width: "100%" }}>
        <button onClick={() => write(() => unit.mute.setValue(!muted))} style={toggle(muted, control.mute)} title="Mute">
          M
        </button>
        {!isMaster && (
          <button onClick={() => write(() => unit.solo.setValue(!soloed))} style={toggle(soloed, control.solo)} title="Solo">
            S
          </button>
        )}
        {isMaster && onToggleLimiter && (
          <button
            onClick={onToggleLimiter}
            style={toggle(limiterOn === true, accent)}
            title={limiterOn ? "Limiter on the mix bus — click to remove" : "Add a limiter (Maximizer) to the mix bus"}
          >
            LIM
          </button>
        )}
      </div>

      {/*
        Pan is a knob, one fixed-height slot so the fader below starts at the
        same y in every strip. Master has nothing to pan and leaves the slot
        empty — but the same height, or the faders stop lining up down the row.
      */}
      <div style={{ height: 32, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!isMaster && (
          <PanKnob
            value={panning}
            onChange={(v) => write(() => unit.panning.setValue(v))}
            onReset={() => write(() => unit.panning.setValue(0))}
            skin={skin}
            accent={accent}
          />
        )}
      </div>

      {/* Fader (grooved cap + dB scale) with the master meter beside it. */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, width: "100%", height: FADER_H }}>
        <Fader
          value01={AudioUnitBoxAdapter.VolumeMapper.x(volume)}
          onChange01={(v) => write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(v)))}
          onReset={() => write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(UNITY)))}
          skin={skin}
          accent={isMaster ? skin.fgMuted : accent}
        />
        {isMaster && meterLevel !== undefined && <MasterMeterVertical skin={skin} level={meterLevel} />}
      </div>

      <span
        style={{
          font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {dbLabel(volume)}
      </span>
    </div>
  );
}

/**
 * Unity on a 0..1 fader, read from the mapper rather than assumed.
 *
 * 0 dB is not the top of a volume curve — it sits below it, so there is
 * headroom to push a part up.
 */
const UNITY = AudioUnitBoxAdapter.VolumeMapper.x(0);

function dbLabel(db: number): string {
  if (!Number.isFinite(db) || db <= -60) return "-∞";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}

function panLabel(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 2) return "C";
  return `${pan < 0 ? "L" : "R"}${amount}`;
}

const FADER_H = 150;
const CAP_H = 20;

/**
 * A real fader: a grooved cap on a rail, with a dB scale beside it.
 *
 * Custom rather than a styled range input — a native thumb can't carry a grooved
 * cap, a centre line and a drop shadow across the rotation the vertical trick
 * needs, and the maths for "which dB is this pixel" wants to be ours anyway. The
 * scale ticks sit exactly where the cap's centre lands for each mark (through
 * the same VolumeMapper the cap uses), so the numbers mean what they say.
 */
function Fader({
  value01, onChange01, onReset, skin, accent,
}: {
  value01: number;
  onChange01: (v: number) => void;
  onReset: () => void;
  skin: Skin;
  accent: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const travel = FADER_H - CAP_H;
  const capTop = (1 - value01) * travel;

  const setFromClientY = useCallback(
    (clientY: number) => {
      const r = railRef.current?.getBoundingClientRect();
      if (!r) return;
      onChange01(1 - Math.max(0, Math.min(1, (clientY - r.top - CAP_H / 2) / travel)));
    },
    [onChange01, travel],
  );

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setFromClientY(e.clientY);
      const move = (ev: PointerEvent) => setFromClientY(ev.clientY);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setFromClientY],
  );

  const marks = [6, 0, -6, -12, -24, -48]
    .map((db) => ({ db, x: AudioUnitBoxAdapter.VolumeMapper.x(db) }))
    .filter((m) => m.x >= 0 && m.x <= 1);

  return (
    <div style={{ display: "flex", gap: 5, height: FADER_H }}>
      <div
        ref={railRef}
        onPointerDown={onDown}
        onDoubleClick={onReset}
        title="Volume — double-click for unity"
        style={{ position: "relative", width: 30, height: FADER_H, cursor: "ns-resize", touchAction: "none" }}
      >
        {/* rail, then the accent fill from the cap down */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 4, transform: "translateX(-50%)", background: skin.slot, borderRadius: 999 }} />
        <div style={{ position: "absolute", left: "50%", top: capTop + CAP_H / 2, bottom: 0, width: 4, transform: "translateX(-50%)", background: accent, borderRadius: 999 }} />
        {/* grooved cap with a centre line and a real drop shadow */}
        <div
          style={{
            position: "absolute", left: "50%", top: capTop, transform: "translateX(-50%)",
            width: 30, height: CAP_H, borderRadius: 3, border: "1px solid #0b0d10",
            boxShadow: "0 2px 5px rgba(0,0,0,.55)",
            backgroundImage:
              "repeating-linear-gradient(180deg, rgba(255,255,255,.09) 0 1px, transparent 1px 3px), linear-gradient(180deg, #3d434a, #14171b)",
          }}
        >
          <div style={{ position: "absolute", left: 2, right: 2, top: "50%", height: 2, transform: "translateY(-50%)", background: "#e8edf3", borderRadius: 1 }} />
        </div>
      </div>

      {/* dB scale, aligned to where the cap centre sits for each mark */}
      <div style={{ position: "relative", width: 22, height: FADER_H }}>
        {marks.map(({ db, x }) => (
          <div
            key={db}
            style={{
              position: "absolute", top: (1 - x) * travel + CAP_H / 2, left: 0, right: 0,
              transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <span style={{ width: 4, height: 1, background: skin.border }} />
            <span style={{ font: `500 9px ${font.mono}`, color: skin.fgMuted, fontVariantNumeric: "tabular-nums" }}>
              {db > 0 ? `+${db}` : db}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A pan knob, dragged vertically. A knob is what a hand expects for pan, and
 * unlike a slider it can't be mistaken for a second, tiny fader. The indicator
 * points straight up at centre and swings ±135° to the extremes.
 */
function PanKnob({
  value, onChange, onReset, skin, accent,
}: {
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
  skin: Skin;
  accent: string;
}) {
  const start = useRef<{ y: number; v: number } | null>(null);
  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      start.current = { y: e.clientY, v: value };
      const move = (ev: PointerEvent) => {
        if (!start.current) return;
        // ~120px of travel spans the whole range; up is right, down is left.
        const dv = (start.current.y - ev.clientY) / 120;
        onChange(Math.max(-1, Math.min(1, start.current.v + dv)));
      };
      const up = () => {
        start.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [value, onChange],
  );
  return (
    <div
      onPointerDown={onDown}
      onDoubleClick={onReset}
      title={`Pan ${panLabel(value)} — drag, double-click to centre`}
      style={{ position: "relative", width: 28, height: 28, cursor: "ns-resize", touchAction: "none" }}
    >
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: 999,
          border: `1px solid ${skin.border}`,
          backgroundImage: "linear-gradient(180deg, #30353b, #16191d)",
          boxShadow: "0 1px 3px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
        }}
      />
      <div
        style={{
          position: "absolute", left: "50%", top: "50%", width: 2, height: 11,
          background: accent, borderRadius: 1,
          transformOrigin: "bottom center",
          transform: `translate(-50%, -100%) rotate(${value * 135}deg)`,
        }}
      />
    </div>
  );
}

/**
 * The recording input, now that the standalone form is gone.
 *
 * It lives in the mixer because choosing what you record from is a mixing
 * question, and the level meter belongs next to the faders it will sit among.
 * The device list is empty until a track has been added (adding one asks the
 * browser for the microphone); before that the picker says so rather than
 * offering nothing.
 */
function InputPicker({
  skin, devices, deviceId, onChoose,
}: {
  skin: Skin;
  devices: InputDevice[];
  deviceId: string | null;
  onChoose: (id: string) => void;
}) {
  const meter = useInputMeter(deviceId, devices.length > 0);
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${skin.border}` }}>
      <label
        style={{
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em", textTransform: "uppercase",
          color: skin.fgSubtle, display: "block", marginBottom: 5,
        }}
      >
        Input
      </label>
      <select
        value={deviceId ?? ""}
        onChange={(e) => onChoose(e.target.value)}
        disabled={devices.length === 0}
        style={{
          width: "100%", boxSizing: "border-box",
          font: `${size.sm}px ${font.body}`, color: skin.fg,
          background: skin.surface, border: `1px solid ${skin.border}`,
          borderRadius: radius.sm, padding: "5px 6px",
        }}
      >
        {devices.length === 0 && <option value="">Add a track first…</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 6 }}>
        <InputMeterBar skin={skin} level={meter.level} sawSignal={meter.sawSignal} error={meter.error} />
      </div>
    </div>
  );
}

/** The master output peak, vertical, beside the fader — fills from the bottom. */
function MasterMeterVertical({ skin, level }: { skin: Skin; level: number }) {
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const filled = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
  const hot = db > -3;
  return (
    <span
      title="Master output"
      style={{
        position: "relative", width: 8, height: FADER_H, flex: "0 0 auto",
        background: skin.slot, borderRadius: 999, overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          height: `${filled * 100}%`,
          background: hot ? control.arm : control.mute,
        }}
      />
    </span>
  );
}

/** A slim peak bar for the chosen input — dB mapped, red near clipping. */
function InputMeterBar({
  skin, level, sawSignal, error,
}: {
  skin: Skin;
  level: number;
  sawSignal: boolean;
  error: string | null;
}) {
  if (error) {
    return <span style={{ font: `500 ${size.xs}px ${font.body}`, color: "#C0453B" }}>{error}</span>;
  }
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const filled = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
  const hot = db > -3;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          position: "relative", height: 6, flex: 1,
          background: skin.slot, borderRadius: 999, overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute", inset: 0,
            transformOrigin: "left center", transform: `scaleX(${filled})`,
            background: hot ? "#C0453B" : "#3B9E5A",
          }}
        />
      </span>
      <span
        style={{
          font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle,
          width: 26, textAlign: "right", fontVariantNumeric: "tabular-nums",
        }}
      >
        {Number.isFinite(db) && sawSignal ? Math.round(db) : "--"}
      </span>
    </span>
  );
}

/**
 * Which lanes can actually be heard, for the timeline and the track list.
 *
 * Not the same as "not muted": any solo silences every unsoloed lane. A
 * soloed-out lane drawn at full strength is the commonest way to lose five
 * minutes wondering why a part is missing.
 */
export function audibility(lanes: ReadonlyArray<LoadedLane>): {
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
} {
  const muted = new Set<string>();
  const soloed = new Set<string>();
  for (const lane of lanes) {
    if (lane.unit.mute.getValue()) muted.add(lane.fileId);
    if (lane.unit.solo.getValue()) soloed.add(lane.fileId);
  }
  return { muted, soloed };
}
