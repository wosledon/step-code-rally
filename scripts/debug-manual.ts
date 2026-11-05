import { RallyRuntime } from "../src/runtime.ts";

const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
const world = runtime.world;

// Warm up on the autopilot, then hand over to a "driver" who holds full
// throttle and full steer into the edge and never lets go.
for (let i = 0; i < 60 * 5; i++) world.update(1 / 60);
world.auto = false;
world.input.throttle = 1;
world.input.steer = 1;
let worst = 0;
for (let i = 0; i < 60 * 10; i++) {
  // The driver keeps their foot down and the wheel pinned.
  world.input.throttle = 1;
  world.input.steer = 1;
  world.update(1 / 60);
  worst = Math.max(worst, Math.abs(world.playerX));
  if (i % 60 === 0) {
    console.log(`t=${(i / 60).toFixed(0)}s x=${world.playerX.toFixed(2)} off=${world.offRoad ? "OFF" : "on "} spd=${world.speedKmh}`);
  }
}
console.log(`worst |x| with the wheel pinned: ${worst.toFixed(2)} (road edge is 1.00)`);

// Now a collision at the edge, exactly the "knocked onto the grass" case.
world.auto = true;
for (let i = 0; i < 60 * 3; i++) world.update(1 / 60);
world.playerX = 0.95;
world.speed = 11500;
const car = world.traffic[0]!;
car.z = world.playerZ + 150;
car.offset = 0.7;
world.update(1 / 60);
console.log(`after edge crash: x=${world.playerX.toFixed(2)} off=${world.offRoad} crashes=${world.stats.crashes}`);
for (let i = 0; i < 60 * 3; i++) world.update(1 / 60);
console.log(`3s later:        x=${world.playerX.toFixed(2)} off=${world.offRoad} spd=${world.speedKmh}`);
