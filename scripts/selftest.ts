/**
 * Self-test for the extension plumbing that does not need a real terminal:
 * widget rendering, fullscreen game input, code-fuel hooks, persistence and
 * theme switching.
 *
 *   npx tsx scripts/selftest.ts
 */

import assert from "node:assert/strict";

import { RallyRuntime } from "../src/runtime.ts";
import { RallyPanel } from "../src/panel.ts";
import { RallyGame } from "../src/play.ts";
import { visibleWidthOf } from "../src/blit.ts";
import { MAX_SPEED, RallyWorld } from "../src/game.ts";
import { buildThemeRuntime, THEMES } from "../src/palette.ts";
import { buildSpriteBank } from "../src/sprites.ts";
import { buildTrack } from "../src/track.ts";
import { Framebuffer } from "../src/fb.ts";
import { renderScene } from "../src/scene.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log("rally selftest\n");

  const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
  // Stand in for a live token stream (see the token-drive checks below).
  runtime.world.tokenDrive = 0.9;

  check("world starts on lap 1 with a full tank", () => {
    assert.equal(runtime.world.lap, 1);
    assert.equal(runtime.world.totalLaps, 3);
    assert.ok(runtime.world.nitro > 0 && runtime.world.nitro <= 1);
    assert.ok(runtime.track.segments.length > 200, "track has segments");
    assert.ok(runtime.track.length > 0);
  });

  check("track has curves, hills and scenery", () => {
    const curves = runtime.track.segments.filter((s) => Math.abs(s.curve) > 0.5).length;
    const hills = runtime.track.segments.filter((s) => Math.abs(s.p2.world.y - s.p1.world.y) > 0.001).length;
    const sprites = runtime.track.segments.reduce((sum, s) => sum + s.sprites.length, 0);
    assert.ok(curves > 50, `curves: ${curves}`);
    assert.ok(hills > 50, `hills: ${hills}`);
    assert.ok(sprites > 100, `sprites: ${sprites}`);
  });

  check("simulation moves the car and keeps it on the road", () => {
    const world = runtime.world;
    const startX = world.playerX;
    for (let i = 0; i < 240; i++) world.update(1 / 60);
    assert.ok(world.speed > 0, "car accelerated");
    assert.ok(world.position > 0, "car moved along the track");
    assert.ok(Math.abs(world.playerX) <= 2.2, "car stays within bounds");
    assert.ok(Math.abs(world.playerX - startX) < 2, "autopilot holds a line");
    assert.ok(world.stats.score > 0, "score accumulates");
  });

  check("code boosts add nitro, score and speed", () => {
    const world = runtime.world;
    world.nitro = 0.2;
    const score = world.stats.score;
    const speed = world.speed;
    world.codeBoost(3);
    assert.ok(world.nitro > 0.2, "nitro increased");
    assert.ok(world.stats.score > score, "score increased");
    assert.ok(world.speed > speed, "speed kicked");
    assert.equal(world.stats.codeBoosts, 3);
  });

  check("penalty kills the nitro burn", () => {
    const world = runtime.world;
    world.nitroTimer = 2;
    runtime.penalty();
    assert.equal(world.nitroTimer, 0);
  });

  check("lap wrap records a lap time", () => {
    const world = runtime.world;
    world.position = world.track.length - 50;
    world.speed = 6000;
    world.update(0.1);
    assert.equal(world.lap, 2, "lap incremented");
    assert.ok(world.stats.bestLapMs !== null, "best lap recorded");
    assert.ok(world.stats.score >= 500, "lap bonus awarded");
  });

  check("autopilot races a long stretch without constantly crashing", () => {
    const world = runtime.world;
    world.restart();
    world.nitro = 0.2;
    let offRoadFrames = 0;
    for (let i = 0; i < 60 * 30; i++) {
      world.update(1 / 60);
      if (world.offRoad) offRoadFrames++;
    }
    assert.ok(world.stats.crashes <= 5, `crashes in 30s: ${world.stats.crashes}`);
    assert.ok(offRoadFrames < 60 * 6, `off-road frames: ${offRoadFrames}`);
    assert.ok(world.stats.distance > 1000, `distance: ${world.stats.distance}`);
    assert.ok(world.stats.score > 50, `score: ${world.stats.score}`);
  });

  check("traction correction keeps the car on the road through hard corners", () => {
    const world = runtime.world;
    const segments = world.track.segments;
    // Find the tightest curve and throw the car into it flat out.
    let hardest = segments[0]!;
    for (const segment of segments) {
      if (Math.abs(segment.curve) > Math.abs(hardest.curve)) hardest = segment;
    }
    world.restart();
    world.position = hardest.index * 200 - 1500;
    world.speed = 12000;
    world.nitro = 1;
    let worst = 0;
    for (let i = 0; i < 60 * 10; i++) {
      world.update(1 / 60);
      worst = Math.max(worst, Math.abs(world.playerX));
    }
    assert.ok(worst < 1, `car left the road: |x| = ${worst.toFixed(2)}`);
  });

  check("traction assist holds the road even with the wheel pinned", () => {
    const world = runtime.world;
    world.restart();
    world.auto = false;
    let worst = 0;
    for (let i = 0; i < 60 * 8; i++) {
      // A driver who never lifts and never straightens up.
      world.input.throttle = 1;
      world.input.steer = 1;
      world.update(1 / 60);
      worst = Math.max(worst, Math.abs(world.playerX));
    }
    assert.ok(worst < 1, `assist let the car leave: |x| = ${worst.toFixed(2)}`);
    world.auto = true;
  });

  check("a crash cannot throw the car off the road", () => {
    const world = runtime.world;
    world.restart();
    world.auto = false;
    world.playerX = 0.9;
    world.speed = 11000;
    world.input.throttle = 1;
    const car = world.traffic[0]!;
    car.z = world.playerZ + 200;
    car.offset = 0.75;
    world.update(1 / 60);
    assert.equal(world.stats.crashes, 1, "crash registered");
    assert.ok(Math.abs(world.playerX) <= 1, `crash kicked the car off: x = ${world.playerX.toFixed(2)}`);
    world.auto = true;
  });

  check("serialize/restore round-trips the race", () => {
    const state = runtime.serialize();
    const fresh = new RallyRuntime({ theme: "day" });
    fresh.restore(state);
    assert.equal(fresh.world.lap, state.lap);
    assert.equal(fresh.world.position, state.position);
    assert.equal(fresh.world.stats.score, state.stats.score);
    assert.equal(fresh.world.totalLaps, state.totalLaps);
  });

  check("theme switching rebuilds art and keeps progress", () => {
    const lapBefore = runtime.world.lap;
    const positionBefore = runtime.world.position;
    runtime.setTheme("night");
    assert.equal(runtime.themeName, "night");
    assert.equal(runtime.theme.name, "night");
    assert.ok(runtime.track.segments.length > 200);
    assert.equal(runtime.world.lap, lapBefore, "lap preserved");
    assert.equal(runtime.world.position, positionBefore, "position preserved");
  });

  runtime.start();
  await delay(300);

  check("runtime ticks and bumps the version", () => {
    assert.ok(runtime.version > 0, `version=${runtime.version}`);
  });

  const panel = new RallyPanel(runtime);
  let renders = 0;
  const host = { requestRender: () => renders++ };
  panel.attach(host);

  for (const width of [34, 46, 60, 90]) {
    check(`panel renders within ${width} columns`, () => {
      const lines = panel.render(width);
      assert.ok(lines.length >= 10, `lines: ${lines.length}`);
      for (const line of lines) {
        assert.ok(visibleWidthOf(line) <= width, `line too wide: ${visibleWidthOf(line)} > ${width}`);
      }
    });
  }

  await delay(200);
  check("panel requests repaints while the race runs", () => {
    assert.ok(renders > 0, `renders: ${renders}`);
  });

  check("panel invalidate clears the cache", () => {
    panel.invalidate();
    const before = panel.render(60);
    assert.ok(before.length > 0);
  });

  check("status line reports the race", () => {
    const status = runtime.statusLine();
    assert.match(status, /RALLY \d+km\/h · \d+tok\/s · LAP \d+\/\d+ · SCORE \d+/);
  });

  /* ---------------------------- fullscreen ---------------------------- */

  let saved = 0;
  let exited = 0;
  const game = new RallyGame(runtime, {
    onSave: () => saved++,
    onExit: () => exited++,
  });

  check("game takes the wheel away from the autopilot", () => {
    assert.equal(runtime.world.auto, false);
    assert.equal(runtime.playing, true);
  });

  check("driving keys set throttle, brake and steering", () => {
    const RIGHT = "\x1b[C";
    const RIGHT_RELEASE = "\x1b[1;1:3C";
    const LEFT = "\x1b[D";
    const LEFT_RELEASE = "\x1b[1;1:3D";
    const UP = "\x1b[A";
    const DOWN = "\x1b[B";

    game.handleInput(UP);
    assert.equal(runtime.world.input.throttle, 1);
    game.handleInput(DOWN);
    assert.equal(runtime.world.input.brake, 1);

    game.handleInput(RIGHT);
    assert.equal(runtime.world.input.steer, 1, "right steers right");
    game.handleInput(RIGHT_RELEASE);
    assert.equal(runtime.world.input.steer, 0, "release centres");
    game.handleInput(LEFT);
    assert.equal(runtime.world.input.steer, -1, "left steers left");
    game.handleInput(LEFT_RELEASE);
    assert.equal(runtime.world.input.steer, 0);
  });

  check("holding both directions cancels out", () => {
    game.handleInput("\x1b[C");
    game.handleInput("\x1b[D");
    assert.equal(runtime.world.input.steer, 0);
    game.handleInput("\x1b[1;1:3C");
    game.handleInput("\x1b[1;1:3D");
  });

  check("space burns nitro while held", () => {
    runtime.world.nitro = 1;
    game.handleInput(" ");
    assert.ok(runtime.world.nitroTimer > 0, "nitro ignited");
  });

  check("pause toggles and freezes the input", () => {
    game.handleInput("p");
    assert.equal(runtime.paused, true);
    assert.equal(runtime.world.input.throttle, 0);
    game.handleInput("p");
    assert.equal(runtime.paused, false);
  });

  for (const width of [60, 100, 200]) {
    check(`game renders within ${width} columns`, () => {
      const lines = game.render(width);
      for (const line of lines) {
        assert.ok(visibleWidthOf(line) <= width, `line too wide: ${visibleWidthOf(line)} > ${width}`);
      }
    });
  }

  check("restart resets the race", () => {
    game.handleInput("r");
    assert.equal(runtime.world.lap, 1);
    assert.equal(runtime.world.position, 0);
  });

  check("escape saves and exits", () => {
    game.handleInput("\x1b");
    assert.equal(saved, 1);
    assert.equal(exited, 1);
    game.dispose();
    assert.equal(runtime.playing, false);
    assert.equal(runtime.world.auto, true, "autopilot resumes");
  });

  runtime.stop();

  /* ------------------------- pure module checks ------------------------ */

  check("every theme builds a palette and fog table", () => {
    for (const name of Object.keys(THEMES)) {
      const theme = THEMES[name]!;
      const palette = buildThemeRuntime(theme);
      assert.equal(palette.fog.length, 256 * 6);
      assert.ok(palette.palette.length > 20, `${name} palette`);
    }
  });

  check("traffic spawns on the road and moves", () => {
    const theme = THEMES.day!;
    const sprites = buildSpriteBank(theme, 160);
    const track = buildTrack({
      pine: sprites.pine,
      bush: sprites.bush,
      pylon: sprites.pylon,
      sign: sprites.sign,
      cactus: sprites.cactus,
      gantry: sprites.gantry,
      billboards: sprites.billboards,
    });
    const world = new RallyWorld(track, sprites, { auto: false, trafficCount: 8 });
    assert.equal(world.traffic.length, 8);
    for (const car of world.traffic) {
      assert.ok(Math.abs(car.offset) <= 1, "traffic on the road");
      assert.ok(car.speed > 0 && car.speed < 12001, "traffic speed sane");
    }
    const before = world.traffic[0]!.z;
    world.input.throttle = 1;
    for (let i = 0; i < 60; i++) world.update(1 / 60);
    assert.notEqual(world.traffic[0]!.z, before, "traffic moved");
  });

  check("off-road slows the car down, then the assist recovers it", () => {
    const theme = THEMES.day!;
    const sprites = buildSpriteBank(theme, 160);
    const track = buildTrack({
      pine: sprites.pine,
      bush: sprites.bush,
      pylon: sprites.pylon,
      sign: sprites.sign,
      cactus: sprites.cactus,
      gantry: sprites.gantry,
      billboards: sprites.billboards,
    });
    const world = new RallyWorld(track, sprites, { auto: false, trafficCount: 0 });
    world.tokenDrive = 0.9;
    world.input.throttle = 1;
    for (let i = 0; i < 180; i++) world.update(1 / 60);
    const onRoad = world.speed;
    // Shove it onto the grass: the off-road cap bites immediately.
    world.playerX = 1.6;
    for (let i = 0; i < 6; i++) world.update(1 / 60);
    assert.ok(world.speed < onRoad, `off-road slower: ${world.speed} < ${onRoad}`);
    assert.equal(world.offRoad, true, "car was out on the grass");
    // ...and the traction assist brings it back on its own.
    for (let i = 0; i < 180; i++) world.update(1 / 60);
    assert.equal(world.offRoad, false, "traction assist did not recover");
  });

  check("token throughput maps onto the speed ceiling", () => {
    const world = runtime.world;
    world.nitroTimer = 0;
    world.offRoad = false;
    world.tokenDrive = 0;
    assert.ok(world.speedLimit() <= MAX_SPEED * 0.1001, `idle ceiling: ${world.speedLimit()}`);
    world.tokenDrive = 0.5;
    assert.ok(Math.abs(world.speedLimit() - MAX_SPEED * 0.5) < 1, `half: ${world.speedLimit()}`);
    world.tokenDrive = 1;
    assert.ok(Math.abs(world.speedLimit() - MAX_SPEED) < 1, `full: ${world.speedLimit()}`);
    world.tokenDrive = 0.9;
  });

  check("manual driving keeps the full arcade speed range", () => {
    const world = runtime.world;
    world.auto = false;
    world.tokenDrive = 0;
    world.nitroTimer = 0;
    world.offRoad = false;
    assert.ok(world.speedLimit() >= MAX_SPEED, "manual ceiling is full speed");
    world.auto = true;
    world.tokenDrive = 0.9;
  });

  check("a stalled stream slows the car down", () => {
    const world = runtime.world;
    world.tokenDrive = 1;
    world.nitroTimer = 0;
    world.speed = MAX_SPEED;
    world.tokenDrive = 0;
    for (let i = 0; i < 90; i++) world.update(1 / 60);
    assert.ok(world.speedKmh < 60, `car still fast: ${world.speedKmh} km/h`);
    assert.ok(world.speed > 0, "car keeps creeping instead of stopping dead");
  });

  check("lane markings run the whole length of the road", () => {
    // Regression test: markings used to stop a few segments ahead of the car
    // because distant segments project to sub-pixel heights and were skipped.
    const theme = THEMES.day!;
    const palette = buildThemeRuntime(theme);
    const laneColors = new Set<number>();
    for (let level = 0; level < 6; level++) {
      laneColors.add(palette.fog[theme.lane * 6 + level]!);
    }

    const sprites = buildSpriteBank(theme, 160);
    const track = buildTrack({
      pine: sprites.pine,
      bush: sprites.bush,
      pylon: sprites.pylon,
      sign: sprites.sign,
      cactus: sprites.cactus,
      gantry: sprites.gantry,
      billboards: sprites.billboards,
    });
    const world = new RallyWorld(track, sprites, { auto: true, trafficCount: 0 });
    world.input.throttle = 1;
    for (let i = 0; i < 60 * 6; i++) world.update(1 / 60);
    world.crashTimer = 0;

    // Panel-sized frame: that is where the bug showed up, because at 44 pixel
    // rows almost the whole road projects to sub-pixel segments.
    const fb = new Framebuffer(46, 44);
    renderScene(
      fb,
      { width: 46, height: 44, hud: "compact", runtime: palette, sprites, track },
      world,
    );

    // Scan only the road area between the HUD plates: the plates use the same
    // white and would otherwise be counted as markings.
    const bands = 4;
    const counts = new Array<number>(bands).fill(0);
    const from = 10;
    const to = 34;
    for (let y = from; y < to; y++) {
      const band = Math.min(bands - 1, Math.floor(((y - from) / (to - from)) * bands));
      for (let x = 0; x < fb.width; x++) {
        if (laneColors.has(fb.get(x, y))) counts[band] = counts[band]! + 1;
      }
    }
    for (let band = 0; band < bands; band++) {
      assert.ok(counts[band]! > 0, `no lane markings in band ${band} (near->far): ${counts.join(",")}`);
    }
  });
  await checkAsync("streaming tokens raise the measured rate and the car's ceiling", async () => {
    const live = new RallyRuntime({ theme: "day" });
    live.start();
    try {
      // ~120 tokens/sec for a second.
      for (let i = 0; i < 10; i++) {
        live.onTokens(12);
        await delay(100);
      }
      assert.ok(live.tokenRate > 40, `measured rate: ${live.tokenRate.toFixed(1)} tok/s`);
      assert.ok(live.world.tokenDrive > 0.6, `drive: ${live.world.tokenDrive.toFixed(2)}`);

      // Stop streaming: the rate decays and the car is allowed to slow down.
      await delay(1300);
      assert.ok(live.tokenRate < 10, `rate after the stream stopped: ${live.tokenRate.toFixed(1)}`);
      assert.ok(live.world.tokenDrive < 0.2, `drive after the stream stopped: ${live.world.tokenDrive.toFixed(2)}`);
    } finally {
      live.stop();
    }
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
}
void main();
