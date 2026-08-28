/**
 * Getting a Run Sheet song's stems into an openDAW project.
 *
 * The shape of this is dictated by two constraints that pull against each
 * other:
 *
 *   - fetching, importing and decoding audio is asynchronous
 *   - openDAW's `editing.modify()` takes a SYNCHRONOUS callback, and every box
 *     mutation has to happen inside one
 *
 * So it runs in two passes. Everything slow happens first and is collected;
 * then a single transaction creates the tracks and regions. That also means a
 * song either loads completely or not at all, rather than leaving a project
 * half-populated when the fourth stem fails.
 */
import {
  AudioFileBoxFactory,
  SampleStorage,
  type Project,
  type SampleService,
} from "@opendaw/studio-core";
import { InstrumentFactories, type Sample } from "@opendaw/studio-adapters";
import { UUID } from "@opendaw/lib-std";
import type { AudioData, TransientProtocol } from "@opendaw/lib-dsp";
import type { Peaks } from "@opendaw/lib-fusion";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { signedUrl, type Song, type SongFile } from "../runsheet";

/**
 * Transient detection finds the attack points used to time-stretch audio.
 * These regions aren't stretched — they play at their recorded speed against
 * a backing track — so there is nothing for it to do.
 */
const noTransients: TransientProtocol = {
  detect: async () => [],
};

export interface LoadedLane {
  name: string;
  fileId: string;
  seconds: number;
  /**
   * openDAW's multi-resolution waveform overview.
   *
   * Computed during import and kept rather than discarded: drawing from peaks
   * is what makes a four-minute stem render in a frame instead of walking
   * millions of samples. Peaks.nearest(unitsPerPixel) picks the right level of
   * detail for the current zoom.
   */
  peaks: Peaks;
  /**
   * The lane's audio unit — its fader, pan, mute and solo live here.
   *
   * Carried on the lane rather than looked up later because the mixer has to
   * write to the exact unit this waveform came from, and matching by name
   * breaks the moment two takes share one.
   */
  unit: AudioUnitBox;
}

export interface LoadProgress {
  /** 1-based, for "loading 2 of 4". */
  index: number;
  total: number;
  name: string;
}

interface Prepared {
  file: SongFile;
  sample: Sample;
  audio: AudioData;
  peaks: Peaks;
  uuid: UUID.Bytes;
}

/**
 * Loads every playable file for a song and returns what landed.
 *
 * `bpm` matters more than it looks: openDAW positions regions in musical time,
 * so a project at the wrong tempo puts a four-minute stem in the wrong place
 * even though the audio itself is untouched.
 */
export async function loadSongIntoProject(
  project: Project,
  sampleService: SampleService,
  song: Song,
  files: SongFile[],
  onProgress?: (p: LoadProgress) => void,
): Promise<LoadedLane[]> {
  const bpm = tempoOf(song.bpm) ?? 120;

  // --- Pass one: everything slow -------------------------------------------
  const prepared: Prepared[] = [];
  for (const [i, file] of files.entries()) {
    onProgress?.({ index: i + 1, total: files.length, name: file.name });

    const url = await signedUrl(file.storagePath);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${file.name} (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();

    /*
     * importFile decodes, writes to openDAW's own store and returns metadata.
     * The store is what the engine reads from later, which is why this can't
     * be skipped by handing the engine an AudioBuffer directly.
     */
    const sample = await sampleService.importFile({
      name: file.name,
      bpm,
      arrayBuffer,
      origin: "import",
    });

    const uuid = UUID.parse(sample.uuid);
    const [audio, peaks] = await SampleStorage.get().load(uuid);
    prepared.push({ file, sample, audio, peaks, uuid });
  }

  // The AudioFileBox has to be created inside the transaction, but building
  // its creator is async — so that's done out here and called in there.
  const creators = await Promise.all(
    prepared.map((p) =>
      AudioFileBoxFactory.createModifier(
        noTransients,
        project.boxGraph,
        p.audio,
        p.uuid,
        p.file.name,
      ),
    ),
  );

  // --- Pass two: one transaction -------------------------------------------
  const lanes: LoadedLane[] = [];
  project.editing.modify(() => {
    project.api.setBpm(bpm);

    prepared.forEach((p, i) => {
      /*
       * Tape is openDAW's audio playback device — the one that plays recorded
       * regions rather than synthesising. Each stem gets its own unit so it
       * has its own fader, mute and solo, which is the whole point of opening
       * stems rather than a mix.
       */
      const { trackBox, audioUnitBox } = project.api.createInstrument(InstrumentFactories.Tape, {
        name: laneName(p.file.name),
      });

      project.api.createNotStretchedRegion({
        boxGraph: project.boxGraph,
        targetTrack: trackBox,
        audioFileBox: creators[i](),
        sample: p.sample,
        position: 0,
        name: laneName(p.file.name),
      });

      lanes.push({
        name: laneName(p.file.name),
        fileId: p.file.id,
        seconds: p.sample.duration,
        peaks: p.peaks,
        unit: audioUnitBox,
      });
    });
  });

  await project.engine.queryLoadingComplete();
  return lanes;
}

/** A tempo openDAW can use, or null. Run Sheet's bpm is free text. */
export function tempoOf(bpm: string | null): number | null {
  if (!bpm) return null;
  const n = Number.parseFloat(bpm);
  if (!Number.isFinite(n) || n < 20 || n > 400) return null;
  return n;
}

/**
 * A readable lane name from an uploaded filename.
 *
 * Files are named things like "Touching Hands 112 DRUMS.mp3". The song name is
 * already at the top of the screen, so the useful part is the last word.
 */
export function laneName(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "").trim();
  const words = stem.split(/[\s_-]+/).filter(Boolean);
  const last = words[words.length - 1] ?? stem;
  // A trailing number is a version or a tempo, not a part name.
  if (/^\d+$/.test(last) && words.length > 1) return words[words.length - 2];
  return last.length <= 12 ? titleCase(last) : titleCase(stem);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
