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

import workersMainUrl from "@opendaw/studio-core/workers-main.js?url";
import processorsUrl from "@opendaw/studio-core/processors.js?url";
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?url";

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

  await Workers.install(workersMainUrl);
  AudioWorklets.install(processorsUrl);

  /*
   * wasmUrl is a directory, not a file: the engine fetches engine.wasm and
   * plugins/*.wasm beneath it at runtime.
   *
   * That means the bundler never sees them, so they have to be served as
   * static files. scripts/sync-wasm.mjs copies them from the package into
   * public/opendaw-wasm before every dev run and build — deriving the URL from
   * the processor's bundled path instead gives a directory that doesn't exist
   * in dist, and the app then builds cleanly and 404s at boot.
   */
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: `${import.meta.env.BASE_URL}opendaw-wasm/wasm`,
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

  const wasmUrl = `${import.meta.env.BASE_URL}opendaw-wasm/wasm/engine.wasm`;
  let wasmFetch: string;
  try {
    const res = await fetch(wasmUrl, { method: "HEAD" });
    const size = res.headers.get("content-length");
    wasmFetch = `${res.status} ${res.ok ? `(${Number(size ?? 0).toLocaleString()} bytes)` : "NOT FOUND"}`;
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
