# DAW layout — Shayne's mockup, 29 Aug 2026

The target to build toward. Recorded here so it survives the session it was
shown in, and so the audio work can carry on without it being re-litigated.

## Layout

Five regions, all visible at once, no tabs:

```
┌──────────────────────────────────────────────────────────────┐
│ Title · Autosaved                                            │
├──────────────────────────────────────────────────────────────┤
│ Transport: ⏮ ▶ 3:44 / 3:50 │ 113|2 │ 120 BPM │ 4/4 │ Amaj    │
│                        Save · Light/Dark · accents · zoom    │
├──────────────────────────────────────────────────────────────┤
│ New track [name] [Add] │ Input [select] [meter] │ ☑ Count-in │
│                                                    [Record]  │
├───────────┬──────────────────────────────────┬───────────────┤
│ TRACKS    │            TIMELINE              │   BROWSER     │
│ per track │  ruler, playhead + bar badge     │  file tree    │
│ M S R     │  one lane per track              │               │
├───────────┴──────────────────────────────────┴───────────────┤
│ MIXER: vertical strips + MASTER          │    EFFECTS        │
│ pan knob, meter w/ dB scale, fader, dB   │    OUTPUT + LUFS  │
├──────────────────────────────────────────────────────────────┤
│ 44.1 kHz · 24-bit · 00:03:44 · CPU 18%          licence      │
└──────────────────────────────────────────────────────────────┘
```

## What's in it that the current build doesn't have

- **Per-track R (record arm)** in the track header, beside M and S.
- **Left track list** as its own column, separate from the timeline gutter.
- **Right browser** — a file tree of stems, grouped into folders.
- **Vertical mixer strips** with real meters and a dB scale, plus a MASTER strip.
- **Effects panel** — a chain list (Compressor, EQ, Tape Saturator, Stereo
  Widener) with "Add effect", and an output section with a LUFS meter.
- **Status bar** — sample rate, bit depth, elapsed, CPU.
- **Key** in the transport (Run Sheet already stores it).
- **Bar-number badge** riding on the playhead.
- **Autosave**, rather than only a manual Save.
- **Zoom** in the transport, where the lane-height slider currently sits.

## Open questions to settle before building it

1. **Autosave and a Save button together.** If it autosaves, Save means nothing;
   if Save matters, "Autosaved" is a lie. Pick one. [Suggest: autosave the
   session, and make the explicit button "Save mix to Idea Drop" — that's a
   different act with a real consequence.]

2. **Per-track R vs exclusive arming.** The current code arms one input
   exclusively, on the reasoning that one interface and one pair of hands
   rarely means four armed tracks. A per-track R button implies multi-arm.
   Multi-arm is what the mockup shows and openDAW supports it — but it needs
   an input assigned per track, not one global Input picker in the header.
   These two can't both be right.

3. **The browser shows "Project Files" with folders.** Our files come from
   Idea Drop and have roles, not folders. Either this panel is Idea Drop
   (grouped by role — stems, mixes, references) or it's a real file tree we
   don't have and would have to invent.

4. **24-bit in the status bar.** Takes are currently written as 16-bit WAV.
   Either the status bar reports what's true, or the encoder changes.

5. **CPU 18%.** `engine.cpuLoad` exists as an ObservableValue, so this is real
   rather than decorative. Worth wiring — it's the honest early warning before
   audio starts breaking up.

## Fit with the existing theme

The mockup is the dark skin. Colours line up with `theme.ts` already: role
stripes per track (BGV teal, BASS orange, KEYS teal, LV blue, ACO yellow,
DRUMS red), dark surfaces, one accent for the transport. The light skin needs
the same layout with the light palette — no second design.
