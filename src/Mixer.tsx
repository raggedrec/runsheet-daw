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
import { useCallback } from "react";
import type { Project } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { LoadedLane } from "./opendaw/loadSong";
import { font, laneColorFor, radius, size, space, type Skin } from "./theme";

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
   * The output unit, found by asking rather than assuming an index. Track
   * order changes as takes are added; "the last one" would silently become
   * the wrong strip.
   */
  const master = project.rootBoxAdapter.audioUnits
    .adapters()
    .find((a) => a.isOutput);

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        marginTop: space[4],
        overflow: "hidden",
      }}
    >
      <h2
        style={{
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em", textTransform: "uppercase",
          color: skin.fgSubtle,
          margin: 0, padding: `${space[3]}px ${space[4]}px`,
          borderBottom: `1px solid ${skin.border}`,
        }}
      >
        Mixer
      </h2>

      {/* Scrolls sideways rather than shrinking strips to unusable widths —
          a 30px fader is a decoration. */}
      <div style={{ display: "flex", gap: 1, overflowX: "auto", padding: space[3], background: skin.surfaceSunken }}>
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
    flex: 1, height: 22,
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
      <div style={{ display: "flex", gap: 4, width: "100%" }}>
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
      {!isMaster && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
          <input
            type="range"
            min={-1} max={1} step={0.01}
            value={panning}
            onChange={(e) => write(() => unit.panning.setValue(Number(e.target.value)))}
            onDoubleClick={() => write(() => unit.panning.setValue(0))}
            title="Pan — double-click to centre"
            style={{ flex: 1, minWidth: 0, height: 3, accentColor: skin.fgMuted }}
          />
          <span
            style={{
              font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle,
              width: 26, textAlign: "right", flex: "0 0 auto",
            }}
          >
            {panLabel(panning)}
          </span>
        </label>
      )}

      {/*
        A vertical fader, via a rotated range input.
        writing-mode is the modern way and Safari has been slow to it, so the
        rotation is the fallback that works everywhere today. Ugly in the
        markup, correct on screen.
      */}
      <div style={{ height: 150, display: "grid", placeItems: "center", width: "100%" }}>
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
            width: 150,
            transform: "rotate(-90deg)",
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
