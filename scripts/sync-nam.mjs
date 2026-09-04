/**
 * Copies the bundled NAM captures into public/ and writes a manifest, so the amp
 * device can offer them as preset options without anyone touching a .nam file.
 *
 * The captures live in NAM/ at the repo root (grouped by amp), which the dev
 * server and build don't serve. This flattens them into public/nam/models/ with
 * generated names — the source folders have spaces and parentheses that make for
 * fragile URLs — and records the real category + display name in index.json, so
 * the picker reads well while the fetch stays simple.
 *
 * Generated, not committed (public/nam is gitignored), the same arrangement as
 * the wasm binaries: NAM/ is the source of truth, this rebuilds public/nam from
 * it on every predev/prebuild so a capture added or removed can't go stale.
 */
import { readdir, mkdir, rm, cp, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";

const SRC = "NAM";
const OUT = "public/nam";

/*
 * IRs above this are skipped. A cab IR is a few hundred KB; the huge ones are
 * long, high-resolution, multi-channel reverb captures (the Lexicon pack runs
 * 4-channel 32-bit float, ~9MB each) — too heavy to ship as web assets and the
 * wrong channel shape for the convolver. Trim/convert them before dropping them
 * in if you want them; the built-in Reverb covers reverb in the meantime.
 */
const MAX_IR_BYTES = 2 * 1024 * 1024;

if (!existsSync(SRC)) {
  // Not fatal: an install without the captures folder still builds; the picker
  // just shows no presets.
  console.log(`• ${SRC}/ not present — no NAM presets to sync`);
  process.exit(0);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".nam") || lower.endsWith(".wav")) files.push(full);
    }
  }
  return files;
}

const found = await walk(SRC);
const nam = found.filter((f) => f.toLowerCase().endsWith(".nam")).sort();

const allIrs = found.filter((f) => f.toLowerCase().endsWith(".wav")).sort();
const irs = [];
const skipped = [];
for (const f of allIrs) {
  if ((await stat(f)).size <= MAX_IR_BYTES) irs.push(f);
  else skipped.push(f);
}
if (skipped.length > 0) {
  console.log(`• skipped ${skipped.length} oversized IR(s) (> ${MAX_IR_BYTES / 1024 / 1024}MB): ${skipped.map((f) => basename(f)).join(", ")}`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, "models"), { recursive: true });
await mkdir(join(OUT, "ir"), { recursive: true });

/** Copies files into a subfolder with generated names and returns the manifest. */
async function collect(files, subdir, ext) {
  const manifest = [];
  for (const [i, file] of files.entries()) {
    const category = relative(SRC, file).split(sep)[0];
    const name = basename(file).replace(new RegExp(`\\${ext}$`, "i"), "");
    const out = `${subdir}/${String(i).padStart(3, "0")}${ext}`;
    await cp(file, join(OUT, out));
    manifest.push({ category, name, file: out });
  }
  // Grouped and alphabetical, so each dropdown reads amp-by-amp / pack-by-pack.
  manifest.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return manifest;
}

// Amps (NAM) and impulse responses (cab + reverb .wav) — two manifests, so the
// amp device offers models and the convolver offers IRs.
const amps = await collect(nam, "models", ".nam");
const impulses = await collect(irs, "ir", ".wav");

await writeFile(join(OUT, "index.json"), JSON.stringify(amps));
await writeFile(join(OUT, "ir.json"), JSON.stringify(impulses));

console.log(`✓ ${amps.length} NAM presets and ${impulses.length} IRs synced to ${OUT}`);
