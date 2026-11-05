/**
 * Headless frame renderer for visual QA.
 *
 * Builds the real game modules, simulates the world, and writes PNG frames
 * (one screen pixel per art pixel, scaled up) plus an ASCII luminance preview
 * so the renderer can be checked without a terminal.
 *
 *   npx tsx scripts/render-frames.ts
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Framebuffer } from "../src/fb.ts";
import { buildThemeRuntime, THEMES, rgbOf, type ThemeRuntime } from "../src/palette.ts";
import { buildSpriteBank } from "../src/sprites.ts";
import { buildTrack } from "../src/track.ts";
import { RallyWorld } from "../src/game.ts";
import { renderScene, type SceneConfig } from "../src/scene.ts";
import { framebufferToLines } from "../src/blit.ts";
import { RallyRuntime } from "../src/runtime.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "frames");

/* ---------------------------- minimal PNG ---------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/* ---------------------------- rendering ---------------------------- */

const SCALE_X = 8;
const SCALE_Y = 16;

function writePng(name: string, fb: Framebuffer): void {
  const width = fb.width * SCALE_X;
  const height = fb.height * SCALE_Y;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const [r, g, b] = rgbOf(fb.get(x, y));
      for (let sy = 0; sy < SCALE_Y; sy++) {
        for (let sx = 0; sx < SCALE_X; sx++) {
          const px = (y * SCALE_Y + sy) * width * 4 + (x * SCALE_X + sx) * 4;
          rgba[px] = r;
          rgba[px + 1] = g;
          rgba[px + 2] = b;
          rgba[px + 3] = 255;
        }
      }
    }
  }
  writeFileSync(join(OUT_DIR, `${name}.png`), encodePng(width, height, rgba));
}

const PREVIEW_CHARS = " .:-=+*#%@";
function asciiPreview(name: string, fb: Framebuffer): void {
  const lines: string[] = [`--- ${name} (${fb.width}x${fb.height}px) ---`];
  for (let y = 0; y < fb.height; y += 2) {
    let line = "";
    for (let x = 0; x < fb.width; x++) {
      const [r, g, b] = rgbOf(fb.get(x, y));
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      line += PREVIEW_CHARS[Math.min(PREVIEW_CHARS.length - 1, Math.round(luminance * (PREVIEW_CHARS.length - 1)))];
    }
    lines.push(line);
  }
  console.log(lines.join("\n"));
}

function writeAnsi(name: string, fb: Framebuffer): void {
  const lines = framebufferToLines(fb);
  writeFileSync(join(OUT_DIR, `${name}.ansi.txt`), lines.join("\n") + "\n");
}

interface Rig {
  runtime: ThemeRuntime;
  config: SceneConfig;
  world: RallyWorld;
}

function makeRig(themeName: keyof typeof THEMES, width: number, height: number, hud: "full" | "compact"): Rig {
  const theme = THEMES[themeName]!;
  const runtime = buildThemeRuntime(theme);
  const sprites = buildSpriteBank(theme, Math.max(160, width));
  const track = buildTrack({
    pine: sprites.pine,
    bush: sprites.bush,
    pylon: sprites.pylon,
    sign: sprites.sign,
    cactus: sprites.cactus,
    gantry: sprites.gantry,
    billboards: sprites.billboards,
  });
  const world = new RallyWorld(track, sprites, { auto: true, totalLaps: 3 });
  const config: SceneConfig = { width, height, hud, runtime, sprites, track };
  return { runtime, config, world };
}

function simulate(world: RallyWorld, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) world.update(dt);
}

function renderFrame(rig: Rig): Framebuffer {
  const fb = new Framebuffer(rig.config.width, rig.config.height);
  renderScene(fb, rig.config, rig.world);
  return fb;
}

/* ---------------------------- frames ---------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const frames: Array<{ name: string; run: () => Framebuffer }> = [];

// Background widget view.
{
  const rig = makeRig("day", 56, 32, "compact");
  simulate(rig.world, 8);
  rig.world.auto = true;
  frames.push({ name: "widget-day", run: () => renderFrame(rig) });
}

// Fullscreen views at different points on the track.
{
  const rig = makeRig("day", 104, 60, "full");
  simulate(rig.world, 12);
  rig.world.crashTimer = 0;
  rig.world.speed = 10800;
  frames.push({ name: "full-day-straight", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("day", 104, 60, "full");
  // Jump to a hard right-hand curve.
  const segments = rig.world.track.segments;
  const target = segments.find((s) => s.curve > 5) ?? segments[10]!;
  rig.world.position = target.index * 200;
  rig.world.speed = 9000;
  rig.world.playerX = -0.3;
  simulate(rig.world, 1.5);
  rig.world.crashTimer = 0;
  frames.push({ name: "full-day-curve", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("day", 104, 60, "full");
  const segments = rig.world.track.segments;
  // Find a crest: p1 low, p2 high.
  let crestIndex = 10;
  for (let i = 4; i < segments.length - 4; i++) {
    const a = segments[i - 2]!;
    const b = segments[i + 2]!;
    if (b.p1.world.y - a.p2.world.y > 30) {
      crestIndex = i;
      break;
    }
  }
  rig.world.position = segments[crestIndex]!.index * 200;
  rig.world.speed = 10000;
  simulate(rig.world, 1);
  frames.push({ name: "full-day-hill", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("day", 104, 60, "full");
  simulate(rig.world, 6);
  // Put a traffic car a few thousand units ahead and light the nitro.
  const car = rig.world.traffic[0]!;
  car.z = rig.world.playerZ + 3200;
  car.offset = rig.world.playerX + 0.15;
  rig.world.auto = false;
  rig.world.nitro = 1;
  rig.world.speed = 11800;
  rig.world.input.throttle = 1;
  simulate(rig.world, 0.5);
  rig.world.nitroTimer = 4;
  rig.world.crashTimer = 0;
  frames.push({ name: "full-day-nitro", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("sunset", 104, 60, "full");
  simulate(rig.world, 10);
  frames.push({ name: "full-sunset", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("night", 56, 32, "compact");
  simulate(rig.world, 9);
  frames.push({ name: "widget-night", run: () => renderFrame(rig) });
}

{
  const rig = makeRig("night", 104, 60, "full");
  simulate(rig.world, 11);
  frames.push({ name: "full-night", run: () => renderFrame(rig) });
}

// Start/finish line close-up.
{
  const rig = makeRig("day", 104, 60, "full");
  rig.world.position = rig.world.track.length - 3000;
  rig.world.speed = 9500;
  simulate(rig.world, 0.8);
  frames.push({ name: "full-start-line", run: () => renderFrame(rig) });
}

// Floating side panel view (what `/rally on` shows).
{
  const panelRuntime = new RallyRuntime({ theme: "day", totalLaps: 3 });
  simulate(panelRuntime.world, 10);
  panelRuntime.world.crashTimer = 0;
  panelRuntime.world.speed = 10600;
  const panelCols = 46;
  const panelRows = panelRuntime.panelRows;
  const panelFb = new Framebuffer(panelCols, panelRows * 2);
  renderScene(panelFb, {
    width: panelCols,
    height: panelRows * 2,
    hud: "compact",
    runtime: panelRuntime.palette,
    sprites: panelRuntime.sprites,
    track: panelRuntime.track,
  }, panelRuntime.world);
  frames.push({ name: "panel-day", run: () => panelFb });
  // Also dump the exact ANSI lines the panel returns, for width checks.
  const panelLines = panelRuntime.panelLines(panelCols, panelRows);
  writeFileSync(join(OUT_DIR, "panel-day.ansi.txt"), panelLines.join("\n") + "\n");
}
const rendered = new Map<string, Framebuffer>();
for (const frame of frames) {
  const fb = frame.run();
  rendered.set(frame.name, fb);
  writePng(frame.name, fb);
  writeAnsi(frame.name, fb);
  if (process.argv.includes("--ascii")) asciiPreview(frame.name, fb);
  console.log(`rendered ${frame.name}.png (${fb.width}x${fb.height} art pixels)`);
}

// Zoom into a region: --crop <frame> <x> <y> <w> <h>
const cropIndex = process.argv.indexOf("--crop");
if (cropIndex !== -1) {
  const [name, cx, cy, cw, ch] = process.argv.slice(cropIndex + 1, cropIndex + 6);
  const source = rendered.get(name!);
  if (!source) {
    console.error(`unknown frame: ${name}`);
    process.exit(1);
  }
  const x = Number(cx);
  const y = Number(cy);
  const w = Math.min(source.width - x, Number(cw));
  const h = Math.min(source.height - y, Number(ch));
  const crop = new Framebuffer(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) crop.set(col, row, source.get(x + col, y + row));
  }
  writePng(`${name}-crop-${x}-${y}-${w}x${h}`, crop);
  console.log(`cropped ${name} at ${x},${y} ${w}x${h}`);
}

console.log(`\n${frames.length} frames written to ${OUT_DIR}`);
