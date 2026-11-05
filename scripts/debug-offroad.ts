import { RallyRuntime } from "../src/runtime.ts";

/** How often does the autopilot end up on the grass, over several random tracks? */
let worst = 0;
for (let run = 0; run < 6; run++) {
  const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
  const world = runtime.world;
  let offRoad = 0;
  let crashes = 0;
  const steps = 60 * 60;
  for (let i = 0; i < steps; i++) {
    world.update(1 / 60);
    if (world.offRoad) offRoad++;
    if (world.stats.crashes > crashes) crashes = world.stats.crashes;
  }
  const pct = (offRoad / steps) * 100;
  worst = Math.max(worst, pct);
  console.log(
    `run ${run}: off-road ${pct.toFixed(1)}% of 60s · crashes ${crashes} · ` +
      `topSpeed ${world.stats.topSpeed}km/h · score ${Math.floor(world.stats.score)}`,
  );
}
console.log(`worst off-road share: ${worst.toFixed(1)}%`);
