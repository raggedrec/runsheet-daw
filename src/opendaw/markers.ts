/**
 * Section markers on the timeline — Intro, Verse, Chorus, and the rest.
 *
 * openDAW keeps them as MarkerBoxes hung off the timeline's markerTrack, so they
 * are part of the box graph: `Project.toArrayBuffer()` saves them with the mix
 * and a reopen brings them back, no separate storage. Position is musical time
 * (ppqn), so a marker stays on its bar if the tempo is ever corrected.
 *
 * Every mutation goes through `editing.modify()`, like all box writes.
 */
import type { Project } from "@opendaw/studio-core";
import { MarkerBox } from "@opendaw/studio-boxes";
import { UUID, Option } from "@opendaw/lib-std";

export interface MarkerInfo {
  uuid: string;
  /** Seconds, converted from the box's ppqn for the timeline to place it. */
  seconds: number;
  label: string;
  hue: number;
  /** The box itself, so edits and deletes act on the exact marker. */
  box: MarkerBox;
}

/**
 * The section names offered, each with a fixed hue so a Chorus is the same
 * colour every time — the point of colour here is recognition, not decoration.
 */
export const SECTIONS: ReadonlyArray<{ label: string; hue: number }> = [
  { label: "Intro", hue: 210 },
  { label: "Verse", hue: 145 },
  { label: "Pre", hue: 95 },
  { label: "Chorus", hue: 35 },
  { label: "Bridge", hue: 280 },
  { label: "Solo", hue: 330 },
  { label: "Outro", hue: 0 },
];

export function hueFor(label: string): number {
  const known = SECTIONS.find((s) => label.toLowerCase().startsWith(s.label.toLowerCase()));
  return known ? known.hue : 210;
}

/** Every marker on the song, in the order the collection holds them. */
export function listMarkers(project: Project): MarkerInfo[] {
  return project.timelineBoxAdapter.markerTrack.events.asArray().map((m) => ({
    uuid: UUID.toString(m.uuid),
    seconds: project.tempoMap.ppqnToSeconds(m.position),
    label: m.label,
    hue: m.hue,
    box: m.box,
  }));
}

/** Subscribes to marker changes (add/move/rename/delete, and undo). */
export function subscribeMarkers(project: Project, onChange: () => void): { terminate: () => void } {
  return project.timelineBoxAdapter.markerTrack.subscribe(onChange);
}

export function addMarker(project: Project, seconds: number, label: string, hue: number): void {
  const ppqn = Math.max(0, Math.round(project.tempoMap.secondsToPPQN(Math.max(0, seconds))));
  project.editing.modify(() => {
    MarkerBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.position.setValue(ppqn);
      box.label.setValue(label);
      box.hue.setValue(hue);
      // Point the marker at the timeline's marker track, or it belongs to
      // nothing and never shows.
      box.track.targetVertex = Option.wrap(project.timelineBox.markerTrack.markers);
    });
  });
}

export function moveMarker(project: Project, box: MarkerBox, seconds: number): void {
  const ppqn = Math.max(0, Math.round(project.tempoMap.secondsToPPQN(Math.max(0, seconds))));
  project.editing.modify(() => box.position.setValue(ppqn));
}

export function renameMarker(project: Project, box: MarkerBox, label: string): void {
  project.editing.modify(() => box.label.setValue(label));
}

export function deleteMarker(project: Project, box: MarkerBox): void {
  project.editing.modify(() => box.delete());
}
