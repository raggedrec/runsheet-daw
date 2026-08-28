/**
 * The mixer: a strip per lane — fader, pan, mute, solo.
 *
 * These write straight to openDAW's boxes rather than to React state that
 * something else then applies. The box graph *is* the mix: the engine reads it,
 * `toArrayBuffer()` saves it, and a bounce renders it. Keeping a second copy in
 * React would give two answers to "how loud is the vocal" and guarantee they
 * eventually disagree.
 *
 * Every write goes inside `project.editing.modify()`. openDAW refuses box
 * writes outside a transaction — the graph is transactional so undo, and the
 * subscribers that rebuild the audio worklet, see whole changes rather than
 * half of one.
 */
import { useCallback } from "react";
import type { Project } from "@opendaw/studio-core";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { LoadedLane } from "./opendaw/loadSong";
import { font, laneColorFor, radius, size, space, type Skin } from "./theme";

export interface MixerProps {
  project: Project;
  lanes: ReadonlyArray<LoadedLane>;
  skin: Skin;
  accent: string;
  /** Bumped by the parent after any mix change, to force a re-read. */
  revision: number;
  onChanged: () => void;
}

export function Mixer({ project, lanes, skin, accent, revision, onChanged }: MixerProps) {
  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        padding: space[4],
        marginTop: space[4],
      }}
    >
      <h2
        style={{
          font: `600 ${size.xs}px ${font.body}`,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: skin.fgSubtle,
          margin: `0 0 ${space[3]}px`,
        }}
      >
        Mixer
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
        {lanes.map((lane) => (
          <Strip
            key={lane.fileId}
            project={project}
            lane={lane}
            skin={skin}
            accent={accent}
            revision={revision}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

function Strip({
  project, lane, skin, accent, revision, onChanged,
}: {
  project: Project;
  lane: LoadedLane;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
}) {
  const { unit } = lane;
  // Read straight from the boxes on every render. `revision` is what makes a
  // render happen after a change; the values themselves always come from the
  // graph, never from a cached copy.
  void revision;
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

  const button = (active: boolean, activeColor: string): React.CSSProperties => ({
    width: 26, height: 26,
    font: `700 ${size.xs}px ${font.body}`,
    color: active ? "#fff" : skin.fgSubtle,
    background: active ? activeColor : "transparent",
    border: `1px solid ${active ? activeColor : skin.border}`,
    borderRadius: radius.sm,
    cursor: "pointer",
    flex: "0 0 auto",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
      <span style={{ width: 3, height: 24, borderRadius: 2, background: laneColorFor(lane.name), flex: "0 0 auto" }} />

      <span
        style={{
          font: `600 ${size.sm}px ${font.body}`, letterSpacing: ".05em",
          color: muted ? skin.fgSubtle : skin.fg,
          width: 82, flex: "0 0 auto",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
        title={lane.name}
      >
        {lane.name.toUpperCase()}
      </span>

      <button
        onClick={() => write(() => unit.mute.setValue(!muted))}
        style={button(muted, "#C0453B")}
        title="Mute"
        aria-pressed={muted}
      >
        M
      </button>
      <button
        onClick={() => write(() => unit.solo.setValue(!soloed))}
        style={button(soloed, accent)}
        title="Solo"
        aria-pressed={soloed}
      >
        S
      </button>

      {/* Pan. Centre is 0; the label reads L/R rather than a signed number,
          because nobody thinks in "-0.42". */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
        <span style={{ font: `500 ${size.xs}px ${font.body}`, color: skin.fgSubtle, width: 30 }}>
          {panLabel(panning)}
        </span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={panning}
          onChange={(e) => write(() => unit.panning.setValue(Number(e.target.value)))}
          // Double-click to recentre: the standard gesture, and without it
          // returning to exact centre with a mouse is luck.
          onDoubleClick={() => write(() => unit.panning.setValue(0))}
          title="Pan — double-click to centre"
          style={{ width: 74, accentColor: skin.fgMuted }}
        />
      </label>

      {/*
        The fader is a unit value 0..1; the box stores gain. VolumeMapper is
        openDAW's own curve between the two, so the taper matches what the
        engine expects rather than being a linear guess.
      */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={AudioUnitBoxAdapter.VolumeMapper.x(volume)}
        onChange={(e) =>
          write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(Number(e.target.value))))
        }
        onDoubleClick={() => write(() => unit.volume.setValue(AudioUnitBoxAdapter.VolumeMapper.y(defaultFader)))}
        title="Volume — double-click for unity"
        style={{ flex: 1, minWidth: 90, accentColor: accent }}
      />

      <span
        style={{
          font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle,
          width: 52, textAlign: "right", fontVariantNumeric: "tabular-nums", flex: "0 0 auto",
        }}
      >
        {dbLabel(volume)}
      </span>
    </div>
  );
}

/**
 * Where unity sits on a 0..1 fader.
 *
 * Read back from the mapper rather than assumed: 0 dB is not at the top of a
 * volume curve, it's somewhere below it so there's headroom to push a part up.
 */
const defaultFader = AudioUnitBoxAdapter.VolumeMapper.x(0);

function dbLabel(db: number): string {
  if (!Number.isFinite(db) || db <= -60) return "-∞";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

function panLabel(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 2) return "C";
  return `${pan < 0 ? "L" : "R"}${amount}`;
}

/**
 * Which lanes are audible, for the timeline to grey out.
 *
 * Not the same as "not muted": any solo silences every unsoloed lane. A soloed
 * -out lane drawn at full strength is the commonest way to lose five minutes
 * wondering why a part can't be heard.
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
