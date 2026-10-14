/**
 * Snap a time to the beat grid.
 *
 * Shared by everything draggable on the timeline — the playhead, chord blocks
 * and their ends — so they all land on the same grid. The beat, not the bar,
 * because chords and edits routinely fall mid-bar; bars are every fourth beat.
 * `bypass` (hold Alt while dragging) returns the exact time for fine control.
 */
export function snapToBeat(seconds: number, bpm: number | null, bypass = false): number {
  if (bypass || !bpm || bpm <= 0) return Math.max(0, seconds);
  const beat = 60 / bpm;
  return Math.max(0, Math.round(seconds / beat) * beat);
}
