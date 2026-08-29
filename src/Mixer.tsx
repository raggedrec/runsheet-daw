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
import { useCallback, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { LoadedLane } from "./opendaw/loadSong";
import { font, laneColorFor, radius, size, space, type Skin } from "./theme";
import { DeviceView } from "./DeviceView";

export interface MixerProps {
  project: Project;
  lanes: ReadonlyArray<LoadedLane>;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
}

export function Mixer({ project, lanes, skin, accent, revision, onChanged }: MixerProps) {
  /*
   * One panel, two views. Clicking a track name in the list swaps the strips
   * for that track's devices; clicking it again goes back. The mixer and the
   * devices are the same question asked at different resolutions — "how does
   * this track sound" — so they share the space rather than competing for it.
   */
  const [openTrack, setOpenTrack] = useState<string | null>(null);

  const master = project.rootBoxAdapter.audioUnits.adapters().find((a) => a.isOutput);
  const open = openTrack ? lanes.find((l) => l.fileId === openTrack) ?? null : null;
  const openAdapter = open
    ? project.rootBoxAdapter.audioUnits.adapters().find((a) => a.box === open.unit)
    : undefined;
  const devices = openAdapter?.audioEffects.mapOr((c) => c.adapters(), () => []) ?? [];

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
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
          {open ? "Devices" : "Mixer"}
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
      </div>

      <div style={{ flex: 1, minWidth: 0, background: skin.surfaceSunken }}>
        {open ? (
          <DeviceView
            project={project}
            devices={devices}
            trackName={open.name}
            skin={skin}
            accent={accent}
            revision={revision}
            onChanged={onChanged}
          />
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
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Strip({
  project, unit, name, colour, skin, accent, revision, onChanged, isMaster = false,
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
    color: on ? "#fff" : skin.fgSubtle,
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
        <button onClick={() => write(() => unit.mute.setValue(!muted))} style={toggle(muted, "#C0453B")} title="Mute">
          M
        </button>
        {!isMaster && (
          <button onClick={() => write(() => unit.solo.setValue(!soloed))} style={toggle(soloed, accent)} title="Solo">
            S
          </button>
        )}
      </div>

      {/*
        Pan sits on one line with its readout beside it. Full width with the
        label underneath read as a second fader at a glance, which is the one
        mistake a mixer strip must not make.
      */}
      {/*
        Master gets an empty row of the same height rather than a pan control.
        There is nothing to pan at the output, but a strip that is one control
        shorter puts its fader at a different height from every other strip,
        and a mixer whose faders don't line up is unreadable at a glance.
      */}
      {isMaster && <div style={{ height: 20, width: "100%" }} />}

      {!isMaster && (
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={panning}
          onChange={(e) => write(() => unit.panning.setValue(Number(e.target.value)))}
          onDoubleClick={() => write(() => unit.panning.setValue(0))}
          // The value lives in the tooltip rather than beside the slider: a
          // label on one side pushed the control off-centre, and every other
          // control in the strip is centred.
          title={`Pan ${panLabel(panning)} — double-click to centre`}
          style={{ width: "100%", height: 3, accentColor: skin.fgMuted }}
        />
      )}

      {/*
        A vertical fader, via a rotated range input.
        writing-mode is the modern way and Safari has been slow to it, so the
        rotation is the fallback that works everywhere today. Ugly in the
        markup, correct on screen.
      */}
      {/*
        The rotated input's LAYOUT box is still 150 wide and ~20 tall — the
        rotation is purely visual. Centring that box therefore does not centre
        what you see, which is why the fader sat off to one side of a strip
        whose other controls were centred. Positioning it from the middle and
        translating back by half its own size centres the thing on screen
        rather than the box the browser is reasoning about.
      */}
      <div style={{ height: 150, width: "100%", position: "relative" }}>
        <input
          type="range"
          min={0} max={1} step={0.001}
          value={AudioUnitBoxAdapter.VolumeMapper.x(volume)}
          onChange={(e) =>
            write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(Number(e.target.value))))
          }
          onDoubleClick={() => write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(UNITY)))}
          title="Volume — double-click for unity"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 150,
            margin: 0,
            transform: "translate(-50%, -50%) rotate(-90deg)",
            accentColor: isMaster ? skin.fgMuted : accent,
          }}
        />
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
