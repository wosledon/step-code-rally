/**
 * Procedural pseudo-3D track: a list of road segments with curve and
 * elevation, plus roadside scenery placement.
 *
 * The projection model follows the classic OutRun-style racer: each segment
 * stores world-space endpoints that are projected to screen space every frame
 * relative to the camera, and curves accumulate a horizontal drift while the
 * segments are drawn from near to far.
 */

import type { Sprite } from "./sprites.ts";

export const SEGMENT_LENGTH = 200;
export const ROAD_WIDTH = 2600;
export const RUMBLE_LENGTH = 3;
export const LANES = 3;
export const DRAW_DISTANCE = 52;
export const CAMERA_HEIGHT = 3000;
/** Camera tilt below the horizon: 45° gives a top-down racer view. */
export const CAMERA_ANGLE = Math.PI / 4;

export interface ScreenPoint {
  x: number;
  y: number;
  w: number;
  scale: number;
}

export interface Point {
  world: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  screen: ScreenPoint;
}

export interface RoadSprite {
  sprite: Sprite;
  /** Lateral offset in road-half-widths. 1 = right road edge. */
  offset: number;
  /** World-size multiplier for this sprite. */
  scale: number;
  /** Vertical lift in sprite heights (negative = above the road surface). */
  lift: number;
}

export interface Segment {
  index: number;
  p1: Point;
  p2: Point;
  curve: number;
  sprites: RoadSprite[];
  looped: boolean;
  fog: number;
  clip: number;
  /** Alternating band index, used for road/grass stripe shading. */
  band: number;
}

export interface Track {
  segments: Segment[];
  length: number;
  spriteBank: {
    pine: Sprite;
    bush: Sprite;
    pylon: Sprite;
    sign: Sprite;
    cactus: Sprite;
    gantry: Sprite;
    billboards: Sprite[];
  };
}

function makePoint(x: number, y: number, z: number): Point {
  return {
    world: { x, y, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

function easeIn(a: number, b: number, percent: number): number {
  return a + (b - a) * Math.pow(percent, 2);
}

function easeInOut(a: number, b: number, percent: number): number {
  return a + (b - a) * (-Math.cos(percent * Math.PI) / 2 + 0.5);
}

const CURVES = {
  none: 0,
  easy: 2,
  medium: 4,
  hard: 5.5,
};

const HILLS = {
  none: 0,
  low: 20,
  medium: 40,
  high: 60,
};

class TrackBuilder {
  segments: Segment[] = [];

  private lastY(): number {
    if (this.segments.length === 0) return 0;
    return this.segments[this.segments.length - 1]!.p2.world.y;
  }

  addSegment(curve: number, y: number): void {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: makePoint(0, this.lastY(), n * SEGMENT_LENGTH),
      p2: makePoint(0, y, (n + 1) * SEGMENT_LENGTH),
      curve,
      sprites: [],
      looped: false,
      fog: 0,
      clip: 0,
      band: Math.floor(n / RUMBLE_LENGTH) % 2,
    });
  }

  addRoad(enter: number, hold: number, leave: number, curve: number, hill: number): void {
    const startY = this.lastY();
    const endY = startY + hill * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    }
    for (let n = 0; n < hold; n++) {
      this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    }
    for (let n = 0; n < leave; n++) {
      this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    }
  }

  addStraight(length = 50): void {
    this.addRoad(length, length, length, 0, 0);
  }

  addCurve(length = 50, curve = CURVES.medium, hill = HILLS.none): void {
    this.addRoad(length, length, length, curve, hill);
  }

  addHill(length = 50, height = HILLS.medium): void {
    this.addRoad(length, length, length, 0, height);
  }

  addLowRollingHills(length = 40, height = HILLS.low): void {
    this.addRoad(length, length, length, 0, height / 2);
    this.addRoad(length, length, length, 0, -height);
    this.addRoad(length, length, length, CURVES.easy, height);
    this.addRoad(length, length, length, 0, 0);
    this.addRoad(length, length, length, -CURVES.easy, height / 2);
    this.addRoad(length, length, length, 0, 0);
  }

  addSCurves(): void {
    this.addRoad(40, 40, 40, -CURVES.easy, HILLS.none);
    this.addRoad(40, 40, 40, CURVES.medium, HILLS.medium);
    this.addRoad(40, 40, 40, CURVES.easy, -HILLS.low);
    this.addRoad(40, 40, 40, -CURVES.easy, HILLS.medium);
    this.addRoad(40, 40, 40, -CURVES.medium, -HILLS.medium);
  }

  addBumps(): void {
    const heights = [5, -2, -5, 8, 5, -7, 3, -2];
    for (const height of heights) this.addRoad(10, 10, 10, 0, height);
  }

  addDownhillToEnd(length = 60): void {
    this.addRoad(length, length, length, -CURVES.easy, -this.lastY() / (length * SEGMENT_LENGTH));
  }
}

type SpriteChoice = "pine" | "bush" | "pylon" | "sign" | "cactus" | "billboard";

/** World-size multipliers: scenery reads at a sensible size next to the road. */
const SPRITE_SCALES: Record<SpriteChoice, number> = {
  pine: 1,
  bush: 0.75,
  pylon: 0.5,
  sign: 0.7,
  cactus: 0.7,
  billboard: 0.9,
};

function pickSprite(bank: Track["spriteBank"], choice: SpriteChoice, index: number): Sprite {
  switch (choice) {
    case "pine":
      return bank.pine;
    case "bush":
      return bank.bush;
    case "pylon":
      return bank.pylon;
    case "sign":
      return bank.sign;
    case "cactus":
      return bank.cactus;
    case "billboard":
      return bank.billboards[index % bank.billboards.length]!;
  }
}

function scatterScenery(builder: TrackBuilder, bank: Track["spriteBank"]): void {
  const segments = builder.segments;
  const choices: SpriteChoice[] = ["pine", "pine", "pine", "bush", "pylon", "sign", "cactus"];
  let billboardIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    // Keep the start/finish straight clear.
    if (i < 12 || i > segments.length - 12) continue;

    const roll = Math.random();
    if (roll < 0.16) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const choice = choices[Math.floor(Math.random() * choices.length)]!;
      const offset = side * (1.35 + Math.random() * 2.6);
      segment.sprites.push({ sprite: pickSprite(bank, choice, billboardIndex++), offset, scale: SPRITE_SCALES[choice], lift: 0 });
    } else if (roll < 0.22) {
      const side = Math.random() < 0.5 ? -1 : 1;
      segment.sprites.push({
        sprite: pickSprite(bank, "billboard", billboardIndex++),
        offset: side * (1.6 + Math.random() * 0.9),
        scale: SPRITE_SCALES.billboard,
        lift: 0,
      });
    }
  }
}

export function buildTrack(bank: Track["spriteBank"]): Track {
  const builder = new TrackBuilder();

  // Start/finish straight with the gantry.
  builder.addStraight(30);
  const sections = 10;
  for (let i = 0; i < sections; i++) {
    const roll = Math.random();
    if (roll < 0.22) builder.addStraight(20 + Math.floor(Math.random() * 30));
    else if (roll < 0.44) builder.addCurve(30 + Math.floor(Math.random() * 30), Math.random() < 0.5 ? CURVES.easy : CURVES.medium, HILLS.none);
    else if (roll < 0.6) builder.addCurve(40, CURVES.hard, Math.random() < 0.5 ? HILLS.low : -HILLS.low);
    else if (roll < 0.72) builder.addHill(30, Math.random() < 0.5 ? HILLS.medium : HILLS.high);
    else if (roll < 0.84) builder.addLowRollingHills(25, HILLS.low);
    else if (roll < 0.94) builder.addSCurves();
    else builder.addBumps();
  }
  // Close the loop: flatten elevation and finish on a straight so the wrap
  // back to the start/finish line has no visible seam.
  builder.addDownhillToEnd(40);
  builder.addStraight(30);

  scatterScenery(builder, bank);

  // Gantry over the start/finish line, lifted so it arches above the road.
  builder.segments[0]!.sprites.push({ sprite: bank.gantry, offset: 0, scale: 1.1, lift: -1.15 });
  const mid = Math.floor(builder.segments.length / 2);
  builder.segments[mid]!.sprites.push({
    sprite: pickSprite(bank, "billboard", 3),
    offset: -1.8,
    scale: SPRITE_SCALES.billboard,
    lift: 0,
  });
  const segments = builder.segments;
  return { segments, length: segments.length * SEGMENT_LENGTH, spriteBank: bank };
}

export function findSegment(track: Track, z: number): Segment {
  const count = track.segments.length;
  const index = Math.floor(z / SEGMENT_LENGTH) % count;
  return track.segments[((index % count) + count) % count]!;
}

/** Interpolate a world y between two points. */
export function interpolate(a: number, b: number, percent: number): number {
  return a + (b - a) * percent;
}

export function rumbleWidth(projectedRoadWidth: number): number {
  return projectedRoadWidth / Math.max(6, 2 * LANES);
}

export function laneMarkerWidth(projectedRoadWidth: number): number {
  return projectedRoadWidth / Math.max(32, 8 * LANES);
}
