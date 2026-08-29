/**
 * The tracks column, beside the timeline.
 *
 * Names, mute, solo and record-arm, at the same row heights as the lanes they
 * belong to. Previously these were painted inside the timeline canvas, which
 * meant text in a bitmap: unselectable, unclickable, and re-rendered on every
 * playhead frame for no reason. Real elements here, waveforms in the canvas —
 * each doing what it's good at.
 *
 * Row height is `laneHeight` exactly, because two columns that disagree by a
 * pixel per row are visibly wrong by the fourth track.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { font, laneColorFor, radius, size, type Skin } from "./theme";
import type { LoadedLane } from "./opendaw/loadSong";

/** Matches the timeline's ruler, so row one starts level with bar one. */
const RULER_HEIGHT = 26;
export const TRACK_COLUMN = 168;

export interface TrackListProps {
  lanes: ReadonlyArray<LoadedLane>;
  skin: Skin;
  accent: string;
  laneHeight: number;
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
  /** fileId of the armed track, or null. */
  armed: string | null;
  onMute: (lane: LoadedLane) => void;
  onSolo: (lane: LoadedLane) => void;
  onArm: (lane: LoadedLane) => void;
  onSelect: (lane: LoadedLane) => void;
  onRename: (lane: LoadedLane, name: string) => void;
  onRemove: (lane: LoadedLane) => void;
  onAddTrack: () => void;
  /** Disables Add while a track is being created or a take is running. */
  addBusy: boolean;
  selected: string | null;
}

export function TrackList({
  lanes, skin, accent, laneHeight, muted, soloed, armed, onMute, onSolo, onArm, onSelect, onRename, onRemove, onAddTrack, addBusy, selected,
}: TrackListProps) {
  return (
    <div
      style={{
        width: TRACK_COLUMN,
        flex: "0 0 auto",
        background: skin.surface,
        borderRight: `1px solid ${skin.border}`,
      }}
    >
      {/* Spacer that lines the first track up with the first bar. */}
      <div style={{ height: RULER_HEIGHT, borderBottom: `1px solid ${skin.laneLine}` }} />

      {lanes.map((lane) => {
        const isMuted = muted.has(lane.fileId);
        const isSoloed = soloed.has(lane.fileId);
        const anySolo = soloed.size > 0;
        // Audible is not the same as unmuted: one solo silences everything else.
        const audible = anySolo ? isSoloed : !isMuted;

        return (
          <div
            key={lane.fileId}
            style={{
              height: laneHeight,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 6,
              padding: "0 10px 0 0",
              borderBottom: `1px solid ${skin.laneLine}`,
              background: selected === lane.fileId ? skin.surfaceSunken : "transparent",
              position: "relative",
              boxSizing: "border-box",
            }}
          >
            {/* Role stripe: drums always red, vocals always amber, whatever
                order the stems arrived in. */}
            <span
              style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                background: laneColorFor(lane.name),
              }}
            />

            {/* Remove the lane. Top-right, out of the way of the controls you
                use constantly — this one you reach for rarely and on purpose. */}
            <button
              onClick={() => onRemove(lane)}
              title={`Remove ${lane.name}`}
              aria-label={`Remove ${lane.name}`}
              style={{
                position: "absolute", top: 4, right: 4,
                width: 18, height: 18, display: "grid", placeItems: "center",
                background: "transparent", color: skin.fgSubtle,
                border: "none", borderRadius: radius.sm, cursor: "pointer", padding: 0,
              }}
            >
              <X size={13} />
            </button>

            {/*
              Click selects, double-click renames. A stem arrives named after
              its file — "Aco" for an acoustic guitar — and the name a musician
              wants is rarely the one the exporter chose.
            */}
            <TrackName
              lane={lane}
              skin={skin}
              audible={audible}
              onSelect={() => onSelect(lane)}
              onRename={(name) => onRename(lane, name)}
            />

            <div style={{ display: "flex", gap: 4, paddingLeft: 14 }}>
              <Toggle
                label="M"
                title="Mute"
                on={isMuted}
                colour="#C0453B"
                skin={skin}
                onClick={() => onMute(lane)}
              />
              <Toggle
                label="S"
                title="Solo"
                on={isSoloed}
                colour={accent}
                skin={skin}
                onClick={() => onSolo(lane)}
              />
              {/*
                Arm lives on the track, which is the only place it makes sense
                — "which input am I recording" is a property of a track, not of
                the window. The input device itself is still chosen once in the
                transport, because one interface is the normal case.
              */}
              <Toggle
                label="R"
                title="Arm for recording"
                on={armed === lane.fileId}
                colour="#C0453B"
                skin={skin}
                onClick={() => onArm(lane)}
              />
            </div>
          </div>
        );
      })}

      {/* Add a track where the tracks are, not in a form across the page. It
          drops an empty armed lane straight in (see DawApp.addTrack), so the
          thing you're about to record onto appears the moment you ask for it. */}
      <button
        onClick={onAddTrack}
        disabled={addBusy}
        title="Add a track to record onto"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", margin: "8px 0 0", padding: "8px 10px",
          background: "transparent", color: skin.fgMuted,
          border: `1px dashed ${skin.border}`, borderRadius: radius.sm,
          font: `600 ${size.sm}px ${font.body}`,
          cursor: addBusy ? "default" : "pointer",
          opacity: addBusy ? 0.5 : 1,
        }}
      >
        <Plus size={14} />
        Add track
      </button>
    </div>
  );
}

function Toggle({
  label, title, on, colour, skin, onClick,
}: {
  label: string;
  title: string;
  on: boolean;
  colour: string;
  skin: Skin;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      style={{
        width: 24, height: 22,
        font: `700 ${size.xs}px ${font.body}`,
        color: on ? "#fff" : skin.fgSubtle,
        background: on ? colour : "transparent",
        border: `1px solid ${on ? colour : skin.border}`,
        borderRadius: radius.sm,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}

function TrackName({
  lane, skin, audible, onSelect, onRename,
}: {
  lane: LoadedLane;
  skin: Skin;
  audible: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lane.name);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    // An empty name is a track you can't find later, so it reverts instead.
    if (trimmed.length > 0 && trimmed !== lane.name) onRename(trimmed);
    else setDraft(lane.name);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          // Escape abandons the edit — the standard escape hatch, and without
          // it a mistyped name can only be fixed by typing the old one back.
          if (e.key === "Escape") {
            setDraft(lane.name);
            setEditing(false);
          }
        }}
        style={{
          marginLeft: 14, marginRight: 8,
          font: `600 ${size.sm}px ${font.body}`,
          color: skin.fg, background: skin.surfaceSunken,
          border: `1px solid ${skin.borderStrong}`,
          borderRadius: radius.sm, padding: "1px 4px", width: "calc(100% - 22px)",
        }}
      />
    );
  }

  return (
    <button
      onClick={onSelect}
      onDoubleClick={() => {
        setDraft(lane.name);
        setEditing(true);
      }}
      title={`${lane.name} — double-click to rename`}
      style={{
        textAlign: "left", background: "transparent", border: "none",
        cursor: "pointer", padding: "0 0 0 14px",
        font: `600 ${size.sm}px ${font.body}`, letterSpacing: ".05em",
        color: audible ? skin.fg : skin.fgSubtle,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      {lane.name.toUpperCase()}
    </button>
  );
}
