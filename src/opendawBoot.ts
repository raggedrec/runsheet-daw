/**
 * Bringing the openDAW engine up.
 *
 * The order matters and none of it is optional. Each step was read out of the
 * installed type definitions rather than recalled:
 *
 *   Workers.install(url)                — @opendaw/studio-core/workers-main.js
 *   AudioWorklets.install(url)          — @opendaw/studio-core/processors.js
 *   WasmEngine.install({...})           — the prebuilt Rust engine
 *   WasmEngine.ensureReady(context)     — false means NO engine, not a fallback
 *   AudioWorklets.createFor(context)    — async, one per context
 *   Project.new(env)                    — env needs six things, see ProjectEnv
 *   audioWorklets.createEngine({project}) -> EngineWorklet
 *   engine.setWorklet(worklet)          — EngineFacade is the public handle
 *
 * The asset URLs come from the package via Vite's `?url`, so a version bump
 * can't silently leave stale copies behind in `public/`.
 *
 * Nothing here touches Supabase. Booting the engine and loading a song are
 * separate concerns and separate failures.
 */
import { Workers, AudioWorklets, EngineFacade } from "@opendaw/studio-core";
import { WasmEngine } from "@opendaw/studio-core-wasm";
import { AnimationFrame } from "@opendaw/lib-dom";

import workersMainUrl from "@opendaw/studio-core/workers-main.js?url";
import processorsUrl from "@opendaw/studio-core/processors.js?url";
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?url";

/** Prefix only. The package appends "/wasm/engine.wasm" and "/wasm/plugins/*". */
const WASM_BASE = `${import.meta.env.BASE_URL}opendaw-wasm`.replace(/\/$/, "");

export interface BootResult {
  audioContext: AudioContext;
  audioWorklets: AudioWorklets;
  engine: EngineFacade;
  /**
   * False means NO ENGINE, not a fallback.
   *
   * The studio-sdk README says a false return leaves "the TypeScript engine
   * active". studio-core-wasm's own source says the opposite, in a comment on
   * the function itself: "There is no other engine to fall back to, so a
   * caller that gets false has no working engine and must say so rather than
   * carry on." Believe the implementation.
   */
  wasm: boolean;
  sampleRate: number;
}

export class BootError extends Error {
  constructor(
    message: string,
    /** What the user can actually do about it, if anything. */
    readonly remedy: string,
  ) {
    super(message);
    this.name = "BootError";
  }
}

/**
 * The one check worth making before anything else.
 *
 * Without cross-origin isolation there is no SharedArrayBuffer, and the engine
 * cannot start at all. Failing here with a clear message beats failing four
 * steps later inside a worklet.
 */
export function checkIsolation(): void {
  if (!self.crossOriginIsolated) {
    throw new BootError(
      "This page is not cross-origin isolated.",
      "The server must send Cross-Origin-Opener-Policy: same-origin and " +
        "Cross-Origin-Embedder-Policy: require-corp. In production that's " +
        "vercel.json; in dev it's the headers block in vite.config.ts.",
    );
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new BootError(
      "SharedArrayBuffer is unavailable.",
      "The isolation headers are set but the browser still isn't granting it.",
    );
  }
}

let booted: Promise<BootResult> | null = null;

/** Boots once and reuses it — the worklets and workers are process-wide. */
export function boot(): Promise<BootResult> {
  booted ??= bootOnce();
  return booted;
}

async function bootOnce(): Promise<BootResult> {
  checkIsolation();

  /*
   * Start openDAW's global animation-frame pump. THIS IS NOT OPTIONAL.
   *
   * The engine runs in the audio worklet and publishes its state — isPlaying,
   * isRecording, isCountingIn, position, bpm, cpuLoad — into a SharedArrayBuffer.
   * The main thread only sees those updates when it reads that buffer, and the
   * SDK does that read from a recurring callback registered with
   * `AnimationFrame.add` (see EngineWorklet). Those callbacks fire only while
   * `AnimationFrame` has a driver, which nothing sets until this call.
   *
   * Without it the buffer is written by the worklet and never read: play() rolls
   * the transport for real, but isPlaying never flips, position never advances,
   * and record's readiness checks wait forever on observables that can't change.
   * That single missing call is what made the transport look dead and defeated
   * every earlier record fix — they polled state that was never being pumped.
   * `start` is idempotent (same owner is a no-op), so booting once is enough.
   */
  AnimationFrame.start(window);

  await Workers.install(workersMainUrl);
  AudioWorklets.install(processorsUrl);

  /*
   * wasmUrl is a PREFIX, and it must not already end in /wasm.
   *
   * loadEngineModules builds `${base}/wasm/engine.wasm` and, for each of the
   * 29 devices, `${base}/wasm/plugins/device_*.wasm` — those paths are
   * hardcoded in the package. Passing ".../opendaw-wasm/wasm" produced
   * ".../opendaw-wasm/wasm/wasm/engine.wasm".
   *
   * The failure was thoroughly misleading. Vite's dev server answers a missing
   * file with index.html at status 200, so the library's own `response.ok`
   * check passed and it handed HTML to WebAssembly.compile, which reported
   * "expected magic word 00 61 73 6d, found 3c 21 64 6f" — the bytes of
   * "<!do". A 404 would have said which file was missing.
   *
   * The binaries are copied to public/opendaw-wasm/wasm by scripts/sync-wasm.mjs
   * before every dev run and build; the bundler never sees them because they're
   * fetched at runtime, not imported.
   */
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE,
  });

  const audioContext = new AudioContext();

  /*
   * The Rust engine is NOT started here.
   *
   * A browser creates an AudioContext suspended and won't run it until a user
   * gesture, so starting the engine is its own step behind a click.
   *
   * That turned out not to be the cause of the first failure — the context was
   * running and engine.wasm returned 200, and it still refused. Keeping the
   * split anyway: it's correct regardless, and it's what let the real reason
   * be captured instead of guessed at.
   */
  const audioWorklets = await AudioWorklets.createFor(audioContext);
  const engine = new EngineFacade();

  return {
    audioContext,
    audioWorklets,
    engine,
    wasm: false,
    sampleRate: audioContext.sampleRate,
  };
}

export interface AudioStart {
  /** False means no engine at all. See BootResult.wasm. */
  wasm: boolean;
  contextState: AudioContextState;
  /** HTTP status for engine.wasm, so a 404 is distinguishable from a refusal. */
  wasmFetch: string;
  /** Whatever ensureReady logged, captured rather than left in the console. */
  reason: string | null;
}

/**
 * Resumes the context and tries the Rust engine, on a user gesture.
 *
 * Reports enough to tell the two failure modes apart: the binaries not being
 * served where the engine looks for them, versus the engine declining to start
 * for some other reason. Guessing between those wasted a round trip once.
 */
export async function startAudio(result: BootResult): Promise<AudioStart> {
  await result.audioContext.resume();

  /*
   * Probe exactly what loadEngineModules will request, not something that
   * merely looks similar. The first version of this checked a path that
   * existed while the engine was asking for a different one, so it reported a
   * healthy 200 for a file the engine never fetched.
   *
   * Checks content-type too: under Vite's dev server a wrong path returns 200
   * with text/html, and that is the actual failure mode here.
   */
  const probeUrl = `${WASM_BASE}/wasm/engine.wasm`;
  let wasmFetch: string;
  try {
    const res = await fetch(probeUrl);
    const type = res.headers.get("content-type") ?? "?";
    const bytes = (await res.arrayBuffer()).byteLength;
    const magic = type.includes("html") ? " — HTML, not a binary: wrong path" : "";
    wasmFetch = `${res.status} ${type} ${bytes.toLocaleString()} bytes${magic}`;
  } catch (err) {
    wasmFetch = `unreachable — ${err instanceof Error ? err.message : "?"}`;
  }

  /*
   * ensureReady swallows the real error into a console.warn and returns false.
   * That's the only description of what actually went wrong, so it's captured
   * here and put on screen — hunting it in DevTools is a round trip per guess,
   * and two of my guesses have already been wrong.
   */
  let reason: string | null = null;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("WASM engine unavailable")) {
      const err = args[1];
      reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    warn(...args);
  };
  try {
    const wasm = await WasmEngine.ensureReady(result.audioContext);
    return { wasm, contextState: result.audioContext.state, wasmFetch, reason };
  } finally {
    console.warn = warn;
  }
}
