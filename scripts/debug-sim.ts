import { RallyRuntime } from "../src/runtime.ts";

const runtime = new RallyRuntime({ theme: "day", totalLaps: 3 });
const world = runtime.world;
console.log("track segments:", world.track.segments.length, "length:", world.track.length);
for (let second = 0; second < 20; second++) {
  for (let i = 0; i < 60; i++) world.update(1 / 60);
  const w = world;
  console.log(
    `t=${String(second).padStart(2)}s spd=${String(w.speedKmh).padStart(3)}km/h x=${w.playerX.toFixed(2)} ` +
      `off=${w.offRoad ? "Y" : "n"} nitro=${w.nitro.toFixed(2)} crash=${w.crashTimer.toFixed(2)} ` +
      `crashes=${w.stats.crashes} overtakes=${w.stats.overtakes} dist=${w.stats.distance.toFixed(0)}m ` +
      `pos=${w.position.toFixed(0)} seg=${Math.floor(w.position / 200)}`,
  );
}
