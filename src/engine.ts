/**
 * Pseudo-3D road renderer.
 *
 * Projects track segments to the pixel framebuffer near-to-far (so hills and
 * curves occlude correctly), then blits roadside scenery and traffic far-to-
 * near with per-segment clipping.
 */

import type { Framebuffer } from "./fb.ts";
import {
  CAMERA_ANGLE,
  CAMERA_HEIGHT,
  DRAW_DISTANCE,
  LANES,
  ROAD_WIDTH,
  RUMBLE_LENGTH,
  SEGMENT_LENGTH,
  findSegment,
  interpolate,
  rumbleWidth,
  type Point,
  type Segment,
  type Track,
} from "./track.ts";
import type { Sprite } from "./sprites.ts";
import { TRANSPARENT } from "./sprites.ts";
import { FOG_LEVELS, fogLevel, type ThemeRuntime } from "./palette.ts";

/** World units per sprite pixel; keeps trees/cars proportional to the road. */
export const SPRITE_PIXEL_SIZE = 80;
/** Traffic cars are drawn slightly smaller than roadside props. */
export const TRAFFIC_SPRITE_SCALE = 0.42;
/**
 * How far ahead of the camera the player's car sits. With a 45° camera and a
 * focal length equal to the frame height this lands the car on the bottom row.
 */
export const PLAYER_Z = CAMERA_HEIGHT / 3;

export interface SceneCar {
  z: number;
  offset: number;
  sprite: Sprite;
}

export interface RoadRenderResult {
  playerSegment: Segment;
  maxy: number;
}

/**
 * Project a world point with a camera that looks down at CAMERA_ANGLE.
 *
 * `focal` is the projection scale in pixels; the renderer passes the frame
 * height, which keeps the framing identical at every resolution.
 */
export function project(
  p: Point,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  focal: number,
  width: number,
  height: number,
  roadWidth: number,
): void {
  const dx = p.world.x - cameraX;
  const dy = p.world.y - cameraY; // negative: the road plane sits below the camera
  const dz = p.world.z - cameraZ;

  const sin = Math.sin(CAMERA_ANGLE);
  const cos = Math.cos(CAMERA_ANGLE);
  // Rotate into camera space: distance along the view axis, height above it.
  const depth = dz * cos - dy * sin;
  const heightAboveAxis = dz * sin + dy * cos;

  p.camera.x = dx;
  p.camera.z = depth;
  p.screen.scale = focal / depth;
  p.screen.x = width / 2 + dx * p.screen.scale;
  p.screen.y = height / 2 - heightAboveAxis * p.screen.scale;
  p.screen.w = (p.screen.scale * roadWidth) / 2;
}

function fogged(rt: ThemeRuntime, color: number, level: number): number {
  return rt.fog[color * FOG_LEVELS + level] ?? color;
}

function renderSegment(
  fb: Framebuffer,
  rt: ThemeRuntime,
  segment: Segment,
  width: number,
  y1: number,
  w1: number,
  x1: number,
  y2: number,
  w2: number,
  x2: number,
): void {
  const theme = rt.theme;
  const fog = segment.fog;
  // Far segments project to sub-pixel heights; dropping the alternating band
  // there stops the distance turning into moire noise.
  const projectedHeight = Math.abs(y2 - y1);
  const band = projectedHeight < 2 ? 0 : segment.band;
  const grassColor = fogged(rt, theme.grass[band]!, fog);
  const grassTop = Math.min(y1, y2);
  const grassBottom = Math.max(y1, y2);
  fb.fillRect(0, grassTop, width, grassBottom - grassTop + 1, grassColor);
  // Start/finish line: checkered band across the road.
  if (segment.index < RUMBLE_LENGTH * 2) {
    const a = fogged(rt, theme.startLine[0]!, fog);
    const b = fogged(rt, theme.startLine[1]!, fog);
    const rows = Math.max(1, Math.round((grassBottom - grassTop) / 2));
    for (let i = 0; i < rows; i++) {
      const color = Math.floor(i / 2) % 2 === 0 ? a : b;
      const top = grassTop + Math.floor((i * (grassBottom - grassTop)) / rows);
      const bottom = grassTop + Math.floor(((i + 1) * (grassBottom - grassTop)) / rows);
      fb.fillTrapezoid(top, bottom, x1 - w1, x1 + w1, x2 - w2, x2 + w2, color);
    }
    return;
  }

  const r1 = rumbleWidth(w1);
  const r2 = rumbleWidth(w2);
  const rumbleColor = fogged(rt, theme.rumble[band]!, fog);
  fb.fillTrapezoid(y1, y2, x1 - w1 - r1, x1 - w1, x2 - w2 - r2, x2 - w2, rumbleColor);
  fb.fillTrapezoid(y1, y2, x1 + w1, x1 + w1 + r1, x2 + w2, x2 + w2 + r2, rumbleColor);

  const roadColor = fogged(rt, theme.road[band]!, fog);
  fb.fillTrapezoid(y1, y2, x1 - w1, x1 + w1, x2 - w2, x2 + w2, roadColor);
  addTexture(fb, rt, segment, grassTop, grassBottom, Math.min(x1 - w1 - r1, x2 - w2 - r2), Math.max(x1 + w1 + r1, x2 + w2 + r2), theme.grassDry);
}

/** Deterministic speckle so flat fills read as textured pixel art. */
function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function addTexture(
  fb: Framebuffer,
  rt: ThemeRuntime,
  segment: Segment,
  yTop: number,
  yBottom: number,
  xLeft: number,
  xRight: number,
  colors: [number, number],
): void {
  const span = yBottom - yTop;
  const width = xRight - xLeft;
  if (span < 2 || width < 3) return;
  const count = Math.min(8, 1 + Math.floor(span / 4));
  for (let i = 0; i < count; i++) {
    const y = yTop + 1 + Math.floor(hash2(segment.index * 31 + i, 7) * (span - 1));
    const x = xLeft + Math.floor(hash2(segment.index * 17 + i, 13) * width);
    const color = colors[(segment.index + i) % 2]!;
    fb.set(x, y, rt.fog[color * FOG_LEVELS + segment.fog] ?? color);
  }
}

/**
 * Draws the road plus all roadside sprites and traffic cars for the current
 * camera position. Traffic cars are supplied by the caller and are bucketed by
 * segment so occlusion ordering matches the scenery pass.
 */
export function renderRoad(
  fb: Framebuffer,
  track: Track,
  rt: ThemeRuntime,
  position: number,
  playerX: number,
  cars: SceneCar[],
  drawDistance: number = DRAW_DISTANCE,
): RoadRenderResult {
  const width = fb.width;
  const height = fb.height;
  // Focal length in pixels: using the frame height makes the framing
  // resolution independent (the same number of segments is in shot).
  const focal = height;
  const segments = track.segments;
  const count = segments.length;

  const baseSegment = findSegment(track, position);
  const basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
  const playerSegment = findSegment(track, position + PLAYER_Z);
  const playerPercent = ((position + PLAYER_Z) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
  const playerY = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

  // A 45° camera puts the horizon above the frame, so the whole frame is
  // ground. Pre-fill with the most-fogged grass as a safety net.
  fb.fillRect(0, 0, width, height, fogged(rt, rt.theme.grass[1]!, FOG_LEVELS - 1));

  const carsBySegment = new Map<number, SceneCar[]>();
  for (const car of cars) {
    const index = Math.floor(car.z / SEGMENT_LENGTH) % count;
    const list = carsBySegment.get(index);
    if (list) list.push(car);
    else carsBySegment.set(index, [car]);
  }

  let maxy = height;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);

  // Lane markings are collected for every segment in front of the camera and
  // drawn afterwards as connected 1px lines. Collecting them separately from the
  // fill pass matters: distant segments project to sub-pixel heights and get
  // skipped by the coverage test, which used to leave the markings only near
  // the car.
  interface LaneLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    clip: number;
    fog: number;
  }
  const laneLines: LaneLine[] = [];

  for (let n = 0; n < drawDistance; n++) {
    const segment = segments[(baseSegment.index + n) % count]!;
    segment.looped = segment.index < baseSegment.index;
    segment.fog = fogLevel(n / drawDistance);
    segment.clip = maxy;

    project(
      segment.p1,
      playerX * ROAD_WIDTH - x,
      CAMERA_HEIGHT + playerY,
      position,
      focal,
      width,
      height,
      ROAD_WIDTH,
    );
    project(
      segment.p2,
      playerX * ROAD_WIDTH - x - dx,
      CAMERA_HEIGHT + playerY,
      position,
      focal,
      width,
      height,
      ROAD_WIDTH,
    );

    x += dx;
    dx += segment.curve;

    const inFront = segment.p1.camera.z > 1 && segment.p2.screen.y < segment.p1.screen.y;

    // Lane markings, for every segment that is in front of the camera.
    if (inFront && segment.index >= RUMBLE_LENGTH * 2) {
      for (let lane = 1; lane < LANES; lane++) {
        const t = (lane / LANES) * 2 - 1;
        laneLines.push({
          x1: segment.p1.screen.x + segment.p1.screen.w * t,
          y1: segment.p1.screen.y,
          x2: segment.p2.screen.x + segment.p2.screen.w * t,
          y2: segment.p2.screen.y,
          clip: segment.clip,
          fog: segment.fog,
        });
      }
    }

    if (!inFront || segment.p2.screen.y >= maxy) {
      continue;
    }

    renderSegment(
      fb,
      rt,
      segment,
      width,
      segment.p1.screen.y,
      segment.p1.screen.w,
      segment.p1.screen.x,
      segment.p2.screen.y,
      segment.p2.screen.w,
      segment.p2.screen.x,
    );

    maxy = segment.p2.screen.y;
  }

  // Markings far-to-near, each clipped by the geometry in front of it.
  for (let i = laneLines.length - 1; i >= 0; i--) {
    const line = laneLines[i]!;
    fb.drawLine(line.x1, line.y1, line.x2, line.y2, fogged(rt, rt.theme.lane, line.fog), line.clip);
  }

  // Far-to-near pass for scenery and traffic so nearer things overlap.
  for (let n = drawDistance - 1; n > 0; n--) {
    const segment = segments[(baseSegment.index + n) % count]!;
    if (segment.fog >= FOG_LEVELS - 1) continue;
    const scale = segment.p1.screen.scale;
    if (!Number.isFinite(scale) || scale <= 0) continue;
    const remap = (color: number) => fogged(rt, color, segment.fog);

    for (const roadside of segment.sprites) {
      const sprite = roadside.sprite;
      const destW = sprite.width * scale * SPRITE_PIXEL_SIZE * roadside.scale;
      const destH = sprite.height * scale * SPRITE_PIXEL_SIZE * roadside.scale;
      const anchorX = segment.p1.screen.x + scale * roadside.offset * ROAD_WIDTH;
      const anchorY = segment.p1.screen.y + destH * roadside.lift;
      const destX = anchorX + (roadside.offset < 0 ? -destW : 0);
      const destY = anchorY - destH;
      fb.blit(sprite, destX, destY, destW, destH, segment.clip, TRANSPARENT, remap);
    }

    const bucket = carsBySegment.get(segment.index);
    if (!bucket) continue;
    for (const car of bucket) {
      const destW = car.sprite.width * scale * SPRITE_PIXEL_SIZE * TRAFFIC_SPRITE_SCALE;
      const destH = car.sprite.height * scale * SPRITE_PIXEL_SIZE * TRAFFIC_SPRITE_SCALE;
      const anchorX = segment.p1.screen.x + scale * car.offset * ROAD_WIDTH;
      const destY = segment.p1.screen.y - destH;
      fb.blit(car.sprite, anchorX - destW / 2, destY, destW, destH, segment.clip, TRANSPARENT, remap);
    }
  }

  return { playerSegment, maxy };
}
