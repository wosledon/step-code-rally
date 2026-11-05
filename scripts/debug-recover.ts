import { RallyRuntime } from "../src/runtime.ts";

const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
const world = runtime.world;

// Warm up, then forcibly shove the car onto the grass at speed.
for (let i = 0; i < 60 * 6; i++) world.update(1 / 60);
console.log(`before: x=${world.playerX.toFixed(2)} spd=${world.speedKmh} off=${world.offRoad}`);
world.playerX = 1.25;
world.crashTimer = 0.65;
for (let i = 0; i < 60 * 6; i++) {
  world.update(1 / 60);
  if (i % 15 === 0) {
    console.log(
      `t=${(i / 60).toFixed(2)}s x=${world.playerX.toFixed(2)} off=${world.offRoad ? "OFF" : "on "} ` +
        `steer=${world.input.steer.toFixed(2)} spd=${world.speedKmh} crash=${world.crashTimer.toFixed(2)} ` +
        `curve=${world.track.segments[Math.floor(world.position / 200) % world.track.segments.length]!.curve.toFixed(1)}`,
    );
  }
}
console.log(`after: x=${world.playerX.toFixed(2)} off=${world.offRoad}`);
