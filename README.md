# Run Sheet DAW

Recording and playback for [Run Sheet](https://raggedcompanyrecordings.com),
built on the [openDAW SDK](https://opendaw.org).

Separate from Run Sheet on purpose, for two reasons that happen to point the
same way: openDAW is AGPL, so keeping it in its own app means only this app is
publishable; and it needs `SharedArrayBuffer`, which needs cross-origin
isolation, which would break every Supabase signed URL if applied to Run
Sheet's origin.

## Running it

```bash
cp .env.example .env      # fill in the Supabase URL and anon key
npm install
npm run dev
```

The dev server sets `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` itself — without them the engine cannot start.
`vercel.json` does the same in production.

`npm run dev` and `npm run build` both sync openDAW's prebuilt WASM binaries
into `public/opendaw-wasm` first. They're fetched at runtime rather than
imported, so the bundler never sees them; skip that step and the app builds
cleanly and then 404s at boot.

## What's here

Phase 1: the engine boots and reports what came up — isolation, workers,
worklets, Rust engine or TypeScript fallback, sample rate — plus whether the
session arrived from Run Sheet.

No timeline, no recording, no saving yet. Those are Phases 3 to 5.

## Secrets

The anon key belongs here and is safe to publish; row level security is what
protects the data. The service role key must never appear in this repository —
it bypasses RLS entirely.

## Licence

GNU AGPL v3 or later. See `NOTICE`, and `LICENSE` once added.
