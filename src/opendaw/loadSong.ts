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
import { laneName, tempoOf } from "../naming";

export { laneName, tempoOf };

/**
 * Transient detection finds the attack points used to time-stretch audio.
 * These regions aren't stretched — they play at their recorded speed against
 * a backing track — so there is nothing for it to do.
 */
const noTransients: TransientProtocol = {
  detect: async () => [],
};

/**
 * Which openDAW sample an Idea Drop file was imported as.
 *
 * Without this, every reload fetches ~9 MB per stem, decodes it, and writes a
 * FRESH copy into openDAW's storage under a new id. Nothing ever removes the
 * old ones, so the store grows on every reload and each write gets slower —
 * which is exactly the loader getting slower and eventually appearing to hang.
 *
 * Idea Drop file ids are stable, so remembering the mapping means the second
 * open of a song does no network and no decoding at all: the audio and its
 * peaks are read straight back out of the store.
 *
 * localStorage rather than the database: it describes what this browser has
 * cached, which is not true of any other browser and not worth syncing.
 */
const CACHE_KEY = "runsheet-daw-samples";

function readCache(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberSample(fileId: string, sampleUuid: string): void {
  try {
    const cache = readCache();
    cache[fileId] = sampleUuid;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private browsing, or the quota is full. Losing the cache costs a slow
    // load, not a broken one.
  }
}

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

    /*
     * Already imported in this browser? Then skip the download and the decode
     * entirely — the audio, its peaks and its metadata are all in the store.
     */
    const cachedUuid = readCache()[file.id];
    if (cachedUuid !== undefined) {
      const uuid = UUID.parse(cachedUuid);
      if (await SampleStorage.get().exists(uuid)) {
        const [audio, peaks, meta] = await SampleStorage.get().load(uuid);
        prepared.push({
          file,
          // The store's own metadata, so a cached sample and a fresh one carry
          // the same shape downstream.
          sample: { uuid: cachedUuid, name: meta.name, duration: meta.duration, bpm: meta.bpm } as Sample,
          audio,
          peaks,
          uuid,
        });
        continue;
      }
    }

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
    rememberSample(file.id, sample.uuid);
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
