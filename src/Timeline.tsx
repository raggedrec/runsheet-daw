/**
 * The timeline: a bar ruler, one waveform lane per stem, and a playhead.
 *
 * Everything is drawn into a single canvas rather than one canvas per lane.
 * The grid and the playhead run the full height, and splitting them across
 * stacked canvases means either clipping them or overlaying a third canvas to
 * carry them. One surface, one paint, no alignment to keep in sync.
 *
 * Waveforms come from openDAW's own peaks — a multi-resolution overview built
 * during import. Drawing from those is what lets a four-minute stereo stem
 * render in a frame; walking the samples themselves would be ~23 million reads
 * per lane per paint.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { LoadedLane } from "./opendaw/loadSong";
import { font, laneColorFor, size, type Skin } from "./theme";

const RULER_HEIGHT = 26;
/** Room for the name and the mute/solo pair, left of the waveforms. */
export const GUTTER = 116;

export interface TimelineProps {
  lanes: ReadonlyArray<LoadedLane>;
  skin: Skin;
  accent: string;
  laneHeight: number;
  /** Seconds. The playhead's position. */
  position: number;
  /** Seconds. The longest lane — what the full width represents. */
  duration: number;
  bpm: number | null;
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
  onScrub: (seconds: number) => void;
}

export function Timeline({
  lanes, skin, accent, laneHeight, position, duration, bpm, muted, soloed, onScrub,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const height = RULER_HEIGHT + lanes.length * laneHeight;

  /*
   * Whether each lane is audible, which is not the same as "not muted": one
   * soloed lane silences every other lane. Computed here because the waveform
   * has to show it — a soloed-out lane that still looks fully present is the
   * commonest way to spend five minutes wondering why you can't hear a part.
   */
  const audible = useMemo(() => {
    const anySolo = soloed.size > 0;
    return new Map(
      lanes.map((l) => [l.fileId, anySolo ? soloed.has(l.fileId) : !muted.has(l.fileId)]),
    );
  }, [lanes, muted, soloed]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const width = wrap.clientWidth;
    if (width <= GUTTER) return;

    // Canvas pixels are device pixels; CSS pixels are what the layout uses.
    // Without this the waveform is soft on any retina display.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const trackX = GUTTER;
    const trackW = width - GUTTER;
    const secondsToX = (s: number) => trackX + (duration > 0 ? (s / duration) * trackW : 0);

    // --- lanes ------------------------------------------------------------
    lanes.forEach((lane, i) => {
      const top = RULER_HEIGHT + i * laneHeight;
      const on = audible.get(lane.fileId) !== false;

      ctx.fillStyle = i % 2 === 0 ? skin.lane : skin.laneAlt;
      ctx.fillRect(trackX, top, trackW, laneHeight);

      /*
       * A lane's own audio ends where the file ends, which is not always the
       * end of the song. Drawing the waveform only that far — rather than
       * stretching it to the full width — is what makes a short stem look
       * short instead of slow.
       */
      const laneW = duration > 0 ? (lane.seconds / duration) * trackW : trackW;
      const { peaks } = lane;
      const channels = Math.min(peaks.numChannels, 2);
      const pad = 3;
      const usable = laneHeight - pad * 2;
      const chHeight = usable / channels;

      ctx.save();
      ctx.beginPath();
      ctx.rect(trackX, top, trackW, laneHeight);
      ctx.clip();
      ctx.fillStyle = on ? skin.wave : skin.waveMuted;
      ctx.strokeStyle = on ? skin.wave : skin.waveMuted;

      for (let ch = 0; ch < channels; ch++) {
        const y0 = top + pad + ch * chHeight;
        ctx.beginPath();
        PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
          // Units are sample frames; the whole file maps onto its own width.
          u0: 0,
          u1: peaks.numFrames,
          // Peaks are normalised to ±1.
          v0: -1,
          v1: 1,
          x0: trackX,
          x1: trackX + Math.max(1, laneW),
          y0,
          y1: y0 + chHeight,
        });
        ctx.fill();
      }
      ctx.restore();

      // Separator under every lane but the last.
      if (i < lanes.length - 1) {
        ctx.fillStyle = skin.laneLine;
        ctx.fillRect(trackX, top + laneHeight - 1, trackW, 1);
      }
    });

    // --- grid, over the waveforms so bar lines stay findable ---------------
    if (bpm && duration > 0) {
      const secondsPerBeat = 60 / bpm;
      const secondsPerBar = secondsPerBeat * 4;
      const pxPerBar = (secondsPerBar / duration) * trackW;
      // Below ~9px a beat line per beat is a grey wash, so only bars are drawn.
      const drawBeats = pxPerBar / 4 > 9;
      const top = RULER_HEIGHT;
      const bottom = height;

      for (let bar = 0; secondsPerBar * bar <= duration; bar++) {
        const x = Math.round(secondsToX(secondsPerBar * bar)) + 0.5;
        ctx.strokeStyle = skin.gridBar;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();

        if (drawBeats) {
          for (let beat = 1; beat < 4; beat++) {
            const bx = Math.round(secondsToX(secondsPerBar * bar + secondsPerBeat * beat)) + 0.5;
            ctx.strokeStyle = skin.gridBeat;
            ctx.beginPath();
            ctx.moveTo(bx, top);
            ctx.lineTo(bx, bottom);
            ctx.stroke();
          }
        }
      }
    }

    // --- ruler ------------------------------------------------------------
    ctx.fillStyle = skin.surface;
    ctx.fillRect(0, 0, width, RULER_HEIGHT);
    ctx.fillStyle = skin.laneLine;
    ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

    if (bpm && duration > 0) {
      const secondsPerBar = (60 / bpm) * 4;
      const pxPerBar = (secondsPerBar / duration) * trackW;
      // Label every bar, or every 2/4/8/… so labels never collide.
      const step = Math.max(1, 2 ** Math.ceil(Math.log2(46 / Math.max(pxPerBar, 1))));
      ctx.font = `600 10px ${font.mono}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = skin.fgSubtle;
      for (let bar = 0; secondsPerBar * bar <= duration; bar += step) {
        const x = secondsToX(secondsPerBar * bar);
        ctx.fillText(String(bar + 1), x + 4, RULER_HEIGHT / 2);
        ctx.fillRect(Math.round(x) + 0.5, RULER_HEIGHT - 7, 1, 6);
      }
    }

    // --- lane labels ------------------------------------------------------
    lanes.forEach((lane, i) => {
      const top = RULER_HEIGHT + i * laneHeight;
      ctx.fillStyle = skin.surface;
      ctx.fillRect(0, top, GUTTER, laneHeight);
      // A role stripe: drums always red, vocals always yellow, whatever order
      // the stems happen to be in.
      ctx.fillStyle = laneColorFor(lane.name);
      ctx.fillRect(0, top, 4, laneHeight);
      ctx.fillStyle = audible.get(lane.fileId) === false ? skin.fgSubtle : skin.fg;
      ctx.font = `500 ${size.xs}px ${font.body}`;
      ctx.textBaseline = "middle";
      ctx.fillText(lane.name.toUpperCase(), 14, top + laneHeight / 2);
      ctx.fillStyle = skin.laneLine;
      ctx.fillRect(0, top + laneHeight - 1, GUTTER, 1);
    });
    ctx.fillStyle = skin.laneLine;
    ctx.fillRect(GUTTER - 1, 0, 1, height);

    // --- playhead, last so nothing covers it ------------------------------
    const px = Math.round(secondsToX(Math.min(position, duration))) + 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
  }, [lanes, skin, accent, laneHeight, position, duration, bpm, audible, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on resize: the canvas is sized from its container, and a window
  // resize otherwise leaves a stretched bitmap until the next position tick.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  /** Click or drag anywhere on the timeline to move the playhead. */
  const seekFrom = useCallback(
    (clientX: number) => {
      const wrap = wrapRef.current;
      if (!wrap || duration <= 0) return;
      const rect = wrap.getBoundingClientRect();
      const x = clientX - rect.left - GUTTER;
      const w = rect.width - GUTTER;
      if (w <= 0) return;
      onScrub(Math.min(duration, Math.max(0, (x / w) * duration)));
    },
    [duration, onScrub],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Capture so a drag that leaves the canvas keeps scrubbing, which is how
      // every DAW behaves and how nobody expects a web page to.
      e.currentTarget.setPointerCapture(e.pointerId);
      seekFrom(e.clientX);
    },
    [seekFrom],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons === 1) seekFrom(e.clientX);
    },
    [seekFrom],
  );

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      style={{
        position: "relative",
        width: "100%",
        height,
        cursor: "text",
        userSelect: "none",
        touchAction: "none",
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />
    </div>
  );
}
