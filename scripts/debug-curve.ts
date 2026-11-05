import { RallyRuntime } from "../src/runtime.ts";
import { SEGMENT_LENGTH } from "../src/track.ts";

const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
const world = runtime.world;
const segments = world.track.segments;

// Hardest curve on the track.
let hardest = segments[0]!;
for (const s of segments) if (Math.abs(s.curve) > Math.abs(hardest.curve)) hardest = s;
console.log(`hardest curve: seg ${hardest.index} curve=${hardest.curve}`);

world.position = hardest.index * SEGMENT_LENGTH - 2000;
world.speed = 12000;
world.nitro = 1;
let offRoad = 0;
let maxAbs = 0;
const steps = 60 * 8;
for (let i = 0; i < steps; i++) {
  world.update(1 / 60);
  if (world.offRoad) offRoad++;
  maxAbs = Math.max(maxAbs, Math.abs(world.playerX));
  if (i % 30 === 0) {
    console.log(
      `t=${(i / 60).toFixed(1)}s x=${world.playerX.toFixed(2)} off=${world.offRoad ? "OFF" : "on "} ` +
        `curve=${segments[Math.floor(world.position / SEGMENT_LENGTH) % segments.length]!.curve.toFixed(1)} ` +
        `steer=${world.input.steer.toFixed(2)} spd=${world.speedKmh}`,
    );
  }
}
console.log(`off-road frames: ${offRoad}/${steps} (${((offRoad / steps) * 100).toFixed(0)}%), max |x| = ${maxAbs.toFixed(2)}`);
