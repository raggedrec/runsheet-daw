/**
 * The DAW: one song from Run Sheet, its stems as lanes, and a transport.
 *
 * Loading is deliberate rather than automatic — several minutes of audio is
 * fetched, decoded and written to local storage, and nobody should pay that
 * just for following a link. The button also gives the browser the user
 * gesture it needs before an AudioContext will run.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { boot, startAudio, BootError, type BootResult } from "./opendawBoot";
import { createSession, type DawSession } from "./opendaw/session";
import { loadSongIntoProject, tempoOf, type LoadedLane, type LoadProgress } from "./opendaw/loadSong";
import { loadSong, playableFiles, LoadError, type Song } from "./runsheet";
import { isConfigured, requestedSong, supabase } from "./supabase";
import { useObservable } from "./useObservable";
import { S } from "./styles";
import { Timeline } from "./Timeline";
import { Transport } from "./Transport";
import { useLook } from "./useLook";
import { accents, skins } from "./theme";
import { RecordPanel } from "./RecordPanel";
import { StartScreen } from "./StartScreen";
import { Mixer, audibility } from "./Mixer";
import { useConsoleLog } from "./useConsoleLog";
import { collectTakes } from "./opendaw/take";
import { saveSession } from "./session";
import { uploadToIdeaDrop } from "./runsheet";
import { useTransportClock } from "./useTransportClock";
import {
  addRecordTrack, armTrack, listInputs, RecordingError,
  startRecording as beginRecording, stopRecording as endRecording,
  type InputDevice, type RecordTrack,
} from "./opendaw/recording";

type Stage =
  | { name: "booting" }
  | { name: "blocked"; message: string; remedy: string }
  | { name: "ready" }
  | { name: "loading"; progress: LoadProgress | null }
  | { name: "loaded" };

export default function DawApp() {
  const [stage, setStage] = useState<Stage>({ name: "booting" });
  const [bootResult, setBootResult] = useState<BootResult | null>(null);
  const [session, setSession] = useState<DawSession | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [lanes, setLanes] = useState<LoadedLane[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const params = useMemo(() => requestedSong(), []);
  const [look, setLook] = useLook();

  // --- recording ----------------------------------------------------------
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [recordTrack, setRecordTrack] = useState<RecordTrack | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<{ message: string; remedy: string } | null>(null);
  /** Takes recorded this visit that haven't reached Idea Drop yet. */
  const [unsaved, setUnsaved] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /*
   * Bumped after any mixer change. The mix lives in openDAW's boxes, not in
   * React state — this is only the nudge that tells React to re-read them, so
   * there's never a second copy to disagree with the graph.
   */
  const [mixRevision, setMixRevision] = useState(0);
  /*
   * openDAW reports failures through the console and nothing else — a
   * recording that never started and a take with no signal look identical
   * from outside. Captured from the first render so nothing is missed.
   */
  const logs = useConsoleLog(true);
  const [showLog, setShowLog] = useState(false);
  const skin = skins[look.skin];
  const accent = accents[look.accent];

  /*
   * The page background follows the skin. Set on <body> rather than a wrapper
   * because the timeline can be taller than the viewport, and a wrapper would
   * leave the page's own background showing past the end of it.
   */
  useEffect(() => {
    document.body.style.background = skin.bg;
    document.body.style.color = skin.fg;
    document.body.style.margin = "0";
  }, [skin]);

  // --- boot the engine, then fetch the song's details ----------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await boot();
        if (cancelled) return;
        setBootResult(result);

        if (!isConfigured) {
          setStage({
            name: "blocked",
            message: "This app isn't configured.",
            remedy: "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.",
          });
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSignedIn(Boolean(data.session));

        if (!params.sceneId || !params.trackId) {
          setStage({
            name: "blocked",
            message: "No song was named in the link.",
            remedy: "Open a song in Run Sheet and press DAW.",
          });
          return;
        }

        const loaded = await loadSong(params.sceneId, params.trackId);
        if (cancelled) return;
        setSong(loaded);
        setStage({ name: "ready" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BootError || err instanceof LoadError) {
          setStage({ name: "blocked", message: err.message, remedy: err.remedy });
        } else {
          setStage({
            name: "blocked",
            message: err instanceof Error ? err.message : "Something went wrong.",
            remedy: "Check the browser console for the underlying error.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.sceneId, params.trackId]);

  const files = useMemo(() => (song ? playableFiles(song) : []), [song]);

  /** Start the audio engine and pull the song's stems in. One gesture. */
  const open = useCallback(async () => {
    if (!bootResult || !song) return;
    setStage({ name: "loading", progress: null });
    try {
      const started = await startAudio(bootResult);
      if (!started.wasm) {
        throw new BootError(
          "The audio engine didn't start.",
          started.reason ?? "No reason was reported. Check the console.",
        );
      }
      const created = await createSession(bootResult);
      setSession(created);

      const result = await loadSongIntoProject(
        created.project,
        created.sampleService,
        song,
        files,
        (progress) => setStage({ name: "loading", progress }),
      );
      setLanes(result);
      setStage({ name: "loaded" });
    } catch (err) {
      setStage({
        name: "blocked",
        message: err instanceof Error ? err.message : "The song didn't load.",
        remedy: err instanceof BootError || err instanceof LoadError ? err.remedy : "",
      });
    }
  }, [bootResult, song, files]);

  /*
   * The song is as long as its longest stem. Taking the first lane's length
   * would cut the timeline short whenever a stem starts late or runs on.
   */
  const duration = useMemo(
    () => lanes.reduce((max, l) => Math.max(max, l.seconds), 0),
    [lanes],
  );

  /* eslint-disable-next-line react-hooks/exhaustive-deps -- mixRevision is the trigger */
  const audible = useMemo(() => audibility(lanes), [lanes, mixRevision]);

  const engine = session?.project.engine ?? null;

  /*
   * Two sources of truth about whether the transport is rolling, deliberately.
   *
   * `engine.isPlaying` is the engine's own answer and the one to trust — but
   * the position it publishes alongside it does not advance in this build, so
   * the clock can't be driven from it. `rolling` is what this app knows it
   * asked for. The clock follows `rolling`; the button follows the engine when
   * the engine is talking and falls back to `rolling` when it isn't.
   */
  const [rolling, setRolling] = useState(false);
  const enginePlaying = useObservable(engine?.isPlaying ?? null, false);
  const isPlaying = enginePlaying || rolling;
  const clock = useTransportClock(session?.audioContext ?? null, rolling, duration);
  const seconds = clock.seconds;

  const playStop = useCallback(() => {
    if (!session) return;
    if (rolling) {
      session.project.engine.stop();
      clock.stop(clock.seconds);
      setRolling(false);
    } else {
      /*
       * Position before play, always.
       *
       * play() on its own rolls the transport but produces silence until
       * something sets a position — which is why clicking the timeline
       * "fixed" it. Setting the position the playhead is already at costs
       * nothing and makes pressing Play behave the same as clicking.
       */
      session.project.engine.setPosition(
        session.project.tempoMap.secondsToPPQN(clock.seconds),
      );
      session.project.engine.play();
      clock.start(clock.seconds);
      setRolling(true);
    }
  }, [session, rolling, clock]);

  const rewind = useCallback(() => {
    if (!session) return;
    session.project.engine.setPosition(0);
    clock.seek(0);
  }, [session, clock]);

  const scrub = useCallback(
    (to: number) => {
      if (!session) return;
      // The engine positions in musical time, so a scrub in seconds goes back
      // through the tempo map rather than being scaled.
      session.project.engine.setPosition(session.project.tempoMap.secondsToPPQN(to));
      clock.seek(to);
    },
    [session, clock],
  );

  /** Add a track, ask for the microphone, arm it. One button, three steps. */
  const addTrack = useCallback(
    async (name: string) => {
      if (!session) return;
      setBusy(true);
      setRecError(null);
      try {
        const available = devices.length > 0 ? devices : await listInputs();
        setDevices(available);
        const chosen = deviceId ?? available[0]?.deviceId ?? null;
        setDeviceId(chosen);

        const track = addRecordTrack(session.project, name);
        armTrack(session.project, track.capture, chosen);
        setRecordTrack(track);
      } catch (err) {
        setRecError(
          err instanceof RecordingError
            ? { message: err.message, remedy: err.remedy }
            : { message: "The track couldn't be added.", remedy: String(err) },
        );
      } finally {
        setBusy(false);
      }
    },
    [session, devices, deviceId],
  );

  const chooseDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (session && recordTrack) armTrack(session.project, recordTrack.capture, id);
    },
    [session, recordTrack],
  );

  const record = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setRecError(null);
    try {
      session.project.engine.setPosition(
        session.project.tempoMap.secondsToPPQN(clock.seconds),
      );
      beginRecording(session.project, countIn);

      /*
       * Report what the engine actually did, a beat later. The log showed
       * "[RecordAudio] start" while nothing rolled, and there was no way to
       * see that from the outside — the on-screen clock is driven from the
       * AudioContext, so it counts up whether or not the transport moves.
       */
      window.setTimeout(() => {
        const e = session.project.engine;
        console.debug(
          "[RunSheet] engine after record:",
          JSON.stringify({
            isPlaying: e.isPlaying.getValue(),
            isRecording: e.isRecording.getValue(),
            isCountingIn: e.isCountingIn.getValue(),
            position: e.position.getValue(),
          }),
        );
      }, 800);
      clock.start(clock.seconds);
      setRolling(true);
      setIsRecording(true);
    } catch (err) {
      setRecError(
        err instanceof RecordingError
          ? { message: err.message, remedy: err.remedy }
          : { message: "Recording didn't start.", remedy: String(err) },
      );
    } finally {
      setBusy(false);
    }
  }, [session, countIn, clock]);

  const stopRecord = useCallback(async () => {
    if (!session || !recordTrack || !song) return;
    /*
     * The UI leaves the recording state immediately, before any waiting.
     * Previously this flag was cleared only after the take had been collected
     * and uploaded, so if openDAW never finalised, the button stayed on "Stop"
     * and pressing it again did nothing — the app looked frozen mid-take.
     * Whether openDAW stops is openDAW's problem; whether the button works is
     * ours.
     */
    setIsRecording(false);
    setRolling(false);
    // Waits for openDAW to finalise the take. It does that asynchronously,
    // from a subscriber on isRecording — reading the regions before that has
    // happened is what produced "Nothing was recorded" on good takes.
    await endRecording(session.project, recordTrack.capture);
    session.project.engine.stop();
    clock.stop(clock.seconds);
    setRolling(false);
    setIsRecording(false);

    /*
     * The take is already in the engine — it's a region on the track that was
     * armed. What's missing is that `lanes` was built once at load time, so
     * nothing tells the canvas to draw it.
     *
     * Reading it back locally rather than round-tripping through Idea Drop:
     * the peaks were computed during recording and the audio is in memory.
     * Uploading and re-downloading to see what we already have would cost a
     * WAV upload and a download to display bytes we're holding.
     */
    try {
      const takes = await collectTakes(recordTrack.capture, recordTrack.name);
      if (takes.length === 0) {
        setRecError({
          message: "Nothing was recorded.",
          remedy: "The input produced no audio. Check the device is passing signal.",
        });
        return;
      }

      setLanes((current) => [
        ...current,
        ...takes.map((t) => ({
          name: t.name,
          // No Idea Drop row exists yet, so the lane is keyed by something
          // stable and local until the upload gives it a real id.
          fileId: `take:${crypto.randomUUID()}`,
          seconds: t.seconds,
          peaks: t.peaks,
          // The take's lane is the track it was recorded onto, so its mixer
          // strip is that track's audio unit.
          unit: recordTrack.capture.audioUnitBox,
        })),
      ]);
      setUnsaved((n) => n + takes.length);

      // Upload after the lane appears, not before: the take is visible and
      // playable while it uploads, and a failed upload doesn't hide it.
      for (const take of takes) {
        await uploadToIdeaDrop(song, new File([take.wav], `${take.name}.wav`), "stem");
        setUnsaved((n) => Math.max(0, n - 1));
      }
    } catch (err) {
      setRecError({
        message: "The take didn't reach Idea Drop.",
        remedy:
          err instanceof Error
            ? `${err.message} The recording is still here — don't close the tab.`
            : "The recording is still here — don't close the tab.",
      });
    }
  }, [session, recordTrack, song, clock]);

  /** Saves the whole session: tracks, faders, pans, effects, arrangement. */
  const save = useCallback(async () => {
    if (!session || !song) return;
    setSaveState("saving");
    try {
      await saveSession(song, session.project.toArrayBuffer());
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, [session, song]);

  /*
   * A take that hasn't uploaded exists only in this tab. The browser only
   * allows a generic warning — the wording is the browser's, not ours — but a
   * generic warning beats losing a performance to a stray Cmd-W.
   */
  useEffect(() => {
    if (unsaved === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return (
    <main style={{ ...S.page, color: skin.fg, maxWidth: 1180 }}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>{song?.name ?? "Run Sheet — DAW"}</h1>
          <p style={S.sub}>
            {song
              ? [song.sceneName, song.bpm ? `${song.bpm} BPM` : null, song.key]
                  .filter(Boolean)
                  .join(" · ")
              : "Loading…"}
          </p>
        </div>
      </header>

      {stage.name === "booting" && <p style={S.note}>Starting…</p>}

      {stage.name === "blocked" && (
        <section style={S.panelBad}>
          <p style={S.badTitle}>{stage.message}</p>
          {stage.remedy && <p style={S.note}>{stage.remedy}</p>}
          {signedIn === false && (
            <p style={S.note}>
              You don't appear to be signed in on this address.{" "}
              <a href="https://raggedcompanyrecordings.com/runsheet/" style={S.a}>
                Sign in to Run Sheet
              </a>{" "}
              and press DAW again.
            </p>
          )}
        </section>
      )}

      {stage.name === "ready" && song && (
        <StartScreen
          skin={skin}
          accent={accent.solid}
          accentFg={accent.fg}
          song={song}
          files={files}
          onOpen={() => void open()}
        />
      )}

      {stage.name === "loading" && (
        <section style={S.panel}>
          <p style={S.note}>
            {stage.progress
              ? `Loading ${stage.progress.index} of ${stage.progress.total} — ${stage.progress.name}`
              : "Starting the engine…"}
          </p>
          <p style={S.noteFaint}>
            Audio is decoded in this browser. Nothing is uploaded.
          </p>
        </section>
      )}

      {stage.name === "loaded" && session && (
        <>
          <Transport
            skin={skin}
            accent={accent.solid}
            accentFg={accent.fg}
            isPlaying={isPlaying}
            position={seconds}
            duration={duration}
            bpm={song?.bpm ? tempoOf(song.bpm) : null}
            look={look}
            onLook={setLook}
            onPlayStop={playStop}
            onRewind={rewind}
            saveState={saveState}
            onSave={() => void save()}
          />

          <RecordPanel
            skin={skin}
            accent={accent.solid}
            accentFg={accent.fg}
            armedTrackName={recordTrack?.name ?? null}
            devices={devices}
            deviceId={deviceId}
            isRecording={isRecording}
            countIn={countIn}
            busy={busy}
            error={recError}
            onAddTrack={(name) => void addTrack(name)}
            onChooseDevice={chooseDevice}
            onCountIn={setCountIn}
            onRecord={() => void record()}
            onStop={() => void stopRecord()}
          />

          {logs.length > 0 && (
            <section
              style={{
                background: skin.surface,
                border: `1px solid ${skin.border}`,
                borderRadius: 6,
                marginBottom: 16,
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setShowLog((v) => !v)}
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer",
                  background: "transparent", border: "none", padding: "10px 16px",
                  font: "600 11px ui-sans-serif, system-ui", letterSpacing: ".08em",
                  textTransform: "uppercase", color: skin.fgSubtle,
                }}
              >
                {showLog ? "▾" : "▸"} Engine log · {logs.length}
                {logs.some((l) => l.level === "error" || l.level === "warn") && (
                  <span style={{ color: "#C0453B" }}>
                    {" "}· {logs.filter((l) => l.level === "error" || l.level === "warn").length} problem
                    {logs.filter((l) => l.level === "error" || l.level === "warn").length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
              {showLog && (
                <div
                  style={{
                    maxHeight: 220, overflowY: "auto",
                    borderTop: `1px solid ${skin.border}`,
                    padding: "8px 16px 12px",
                    font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {logs.map((line) => (
                    <div
                      key={line.id}
                      style={{
                        color:
                          line.level === "error" || line.level === "warn"
                            ? "#C0453B"
                            : skin.fgMuted,
                        padding: "2px 0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <Timeline
            lanes={lanes}
            skin={skin}
            accent={accent.solid}
            laneHeight={look.laneHeight}
            position={seconds}
            duration={duration}
            bpm={song?.bpm ? tempoOf(song.bpm) : null}
            muted={audible.muted}
            soloed={audible.soloed}
            onScrub={scrub}
          />

          <Mixer
            project={session.project}
            lanes={lanes}
            skin={skin}
            accent={accent.solid}
            revision={mixRevision}
            onChanged={() => setMixRevision((n) => n + 1)}
          />
        </>
      )}

      {/*
        AGPL §13: anyone using this over a network is entitled to its source.
        A LICENSE file in the repo doesn't discharge that — the running app has
        to offer it, which is what this link is.
      */}
      <footer style={S.footer}>
        Run Sheet DAW is free software under the{" "}
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" style={S.a}>
          GNU AGPL v3
        </a>
        .{" "}
        <a href="https://github.com/raggedrec/runsheet-daw" style={S.a}>
          Source code
        </a>
        . Built on{" "}
        <a href="https://opendaw.org" style={S.a}>
          openDAW
        </a>
        .
      </footer>
    </main>
  );
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
