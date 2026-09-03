/**
 * Creating an openDAW Project and getting its engine running.
 *
 * A Project needs six things (see ProjectEnv in the package). Four of them are
 * plumbing that only exists so the engine can find audio again after a reload:
 *
 *   sampleService     imports files and writes them to openDAW's own store
 *   sampleManager     hands decoded audio to the engine when it asks
 *   soundfontService  same idea for soundfonts, which this app never uses
 *   soundfontManager  ditto
 *
 * The two managers each take a "provider" — a single `fetch(uuid, progress)`
 * that returns the audio for an id. Ours reads back from the store the import
 * wrote to, which closes the loop: import once, and the engine can find it
 * whenever it needs it.
 *
 * Every name here was read out of the installed type definitions. The package
 * has no documentation for this, and its README has already been wrong three
 * times.
 */
import {
  AudioWorklets,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  Project,
  SampleService,
  SampleStorage,
  SoundfontService,
  SoundfontStorage,
  type SampleProvider,
  type SoundfontProvider,
} from "@opendaw/studio-core";
import { BpmDetector } from "@opendaw/studio-adapters";
import type { BootResult } from "../opendawBoot";
import { withVisibleTimeout } from "./withTimeout";

export interface DawSession {
  project: Project;
  audioContext: AudioContext;
  sampleService: SampleService;
}

/**
 * Reads back what importFile wrote.
 *
 * SampleStorage.load returns [audio, peaks, meta]; the manager wants
 * [audio, meta]. The peaks are the waveform overview, which openDAW draws
 * itself and this app doesn't need yet.
 */
const sampleProvider: SampleProvider = {
  async fetch(uuid, progress) {
    const [audio, , meta] = await SampleStorage.get().load(uuid);
    progress(1);
    return [audio, meta];
  },
};

/**
 * Required by ProjectEnv, never exercised.
 *
 * This app has no soundfont instruments. Rejecting loudly rather than
 * returning something empty means that if a code path ever does ask for one,
 * it says so instead of playing silence.
 */
const soundfontProvider: SoundfontProvider = {
  async fetch(uuid) {
    const [buffer, meta] = await SoundfontStorage.get().load(uuid);
    void uuid;
    return [buffer, meta];
  },
};

/**
 * The six things a Project needs, assembled once.
 *
 * Both a fresh project (`Project.new`) and a reopened one
 * (`Project.loadAnyVersion`) take the identical env — the only difference is
 * whether the box graph is built empty or from a saved buffer. Extracting it
 * keeps the two paths from drifting: a provider fixed for one is fixed for both.
 */
function buildProjectEnv(audioContext: AudioContext): {
  env: Parameters<typeof Project.new>[0];
  sampleService: SampleService;
} {
  /*
   * BpmDetector.Unknown rather than the WASM detector.
   *
   * openDAW can analyse an imported file for tempo, but Run Sheet already
   * stores the BPM for every song — it's typed in or detected there. Running a
   * second detector would cost a WASM module and a pass over the audio to
   * produce a worse answer than the one we already have.
   */
  const sampleService = new SampleService(audioContext, BpmDetector.Unknown);
  const sampleManager = new GlobalSampleLoaderManager(sampleProvider);
  const soundfontService = new SoundfontService();
  const soundfontManager = new GlobalSoundfontLoaderManager(soundfontProvider);

  return {
    env: {
      audioContext,
      audioWorklets: AudioWorklets.get(audioContext),
      sampleManager,
      soundfontManager,
      sampleService,
      soundfontService,
    },
    sampleService,
  };
}

/**
 * Brings a Project's worklet up and waits for it to report ready.
 *
 * openDAW connects the worklet to the destination itself — the last lines of
 * Project.startAudioWorklet do `worklet.connect(worklet.context.destination)`.
 *
 * An earlier version of this file connected it again, on the theory that a
 * dead Play button meant an unconnected engine. That was wrong twice over:
 * the node was already connected, and connecting a second time sums the
 * engine with itself, +6 dB. Removed.
 *
 * The `restart` parameter is not a graph-change hook either. Reading the
 * source: it is only invoked from the worklet's `error` and `processorerror`
 * listeners — crash recovery, not a rebuild on record.
 */
export async function startSessionEngine(project: Project): Promise<void> {
  project.startAudioWorklet();
  // engine — the EngineFacade with play/stop/record — is only usable once the
  // worklet has reported ready. Bounded by *visible* time: the readiness signal
  // rides the AnimationFrame pump, which is paused while the tab is hidden, so a
  // backgrounded load waits rather than fails; a real stall (tab in front,
  // engine still silent) trips the ceiling and says so.
  await withVisibleTimeout(
    project.engine.isReady(),
    30000,
    "The audio engine didn't start. If the tab was in the background while loading, bring it to the front and open the song again.",
  );
}

export async function createSession(boot: BootResult): Promise<DawSession> {
  const { audioContext } = boot;
  const { env, sampleService } = buildProjectEnv(audioContext);
  const project = Project.new(env);
  await startSessionEngine(project);
  return { project, audioContext, sampleService };
}

/**
 * Reopens a saved session's graph — WITHOUT starting its audio worklet.
 *
 * `loadAnyVersion` rather than `load`: it runs openDAW's version migrations, so
 * a session saved by an older SDK still opens rather than throwing on a format
 * bump. It is async for exactly that reason.
 *
 * The worklet is deliberately NOT started here. The AudioContext is shared, and
 * startAudioWorklet connects a node to its single destination; starting one for
 * a reopened project that then turns out to be unusable (its samples were never
 * imported in this browser, so there is nothing to draw or play) would leave a
 * second engine running when the fresh path starts its own — two engines on one
 * context, which deadlocks the loader. So the caller reads the graph first with
 * `lanesFromProject`, and only if that yields lanes does it call
 * `startSessionEngine`; otherwise it `terminate()`s this project, which never
 * touched the audio graph, and falls back to a fresh load.
 *
 * The buffer carries the whole box graph — faders, pans, effects, regions — but
 * NOT the audio. The engine finds audio through the sampleProvider, which reads
 * SampleStorage by uuid; those uuids only exist on a browser that imported the
 * stems. Re-importing missing stems on reopen is the gap still to close.
 */
export async function loadSessionProject(
  boot: BootResult,
  buffer: ArrayBuffer,
): Promise<DawSession> {
  const { audioContext } = boot;
  const { env, sampleService } = buildProjectEnv(audioContext);
  const project = await Project.loadAnyVersion(env, buffer);
  return { project, audioContext, sampleService };
}
