/**
 * Scene composition: sky, parallax scenery, road, player car and the pixel HUD.
 *
 * Everything lands in one framebuffer, which blit.ts turns into half-block
 * terminal lines. The scene is resolution independent - the same code draws
 * the 56x32 background widget and a 120x60 fullscreen race.
 */

import type { Framebuffer } from "./fb.ts";
import { drawText, textWidth } from "./font.ts";
import { renderRoad } from "./engine.ts";
import type { Theme, ThemeRuntime } from "./palette.ts";
import { mixColors } from "./palette.ts";
import type { Sprite, SpriteBank } from "./sprites.ts";
import { TRANSPARENT } from "./sprites.ts";
import { formatTime, type RallyWorld } from "./game.ts";
import type { Track } from "./track.ts";

export interface SceneConfig {
  width: number;
  height: number;
  hud: "full" | "compact";
  runtime: ThemeRuntime;
  sprites: SpriteBank;
  track: Track;
}

/** Deterministic hash-based noise so skies and clouds never flicker. */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function blitTiledX(fb: Framebuffer, sprite: Sprite, offsetX: number, anchorBottom: number, scale: number): void {
  const destW = Math.max(1, Math.round(sprite.width * scale));
  const destH = Math.max(1, Math.round(sprite.height * scale));
  const destY = anchorBottom - destH;
  let start = Math.round(offsetX) % destW;
  if (start > 0) start -= destW;
  for (let x = start; x < fb.width; x += destW) {
    fb.blit(sprite, x, destY, destW, destH, fb.height, TRANSPARENT);
  }
}

function drawSky(fb: Framebuffer, theme: Theme, horizon: number, world: RallyWorld, night: boolean): void {
  // Smooth multi-stop gradient snapped to the palette: no dither noise, but
  // still visibly banded like hand-placed pixel art.
  const stops = theme.sky;
  const bands = Math.max(8, Math.round(horizon / 2));
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const y0 = Math.round(t0 * horizon);
    const y1 = Math.max(y0 + 1, Math.round(t1 * horizon));
    const mid = (t0 + t1) / 2;
    const position = mid * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    const color = mixColors(stops[index]!, stops[index + 1]!, position - index);
    fb.fillRect(0, y0, fb.width, y1 - y0, color);
  }

  if (night) {
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(hash01(i, 1) * fb.width);
      const y = Math.floor(hash01(i, 2) * horizon * 0.8);
      const twinkle = Math.sin(world.clock * 2 + i) > -0.2;
      if (twinkle) fb.set(x, y, theme.star);
    }
  }
}

function drawSunAndClouds(
  fb: Framebuffer,
  config: SceneConfig,
  theme: Theme,
  horizon: number,
  world: RallyWorld,
): void {
  const sprites = config.sprites;
  const sun = sprites.sun;
  // The sun/moon sits centred just above the mountains; the mountain layers
  // are drawn afterwards and occlude its lower half.
  const sunX = Math.round(fb.width / 2 - sun.width / 2 - world.skyOffset * 0.25);
  const sunY = horizon - sun.height - 1;
  fb.blit(sun, sunX, sunY, sun.width, sun.height, fb.height, TRANSPARENT);

  const cloudCount = Math.max(2, Math.floor(fb.width / 30));
  for (let i = 0; i < cloudCount; i++) {
    const sprite = sprites.clouds[i % sprites.clouds.length]!;
    const drift = world.clock * (1.2 + (i % 3) * 0.4) + i * 37;
    const x = ((drift - world.skyOffset * 0.6) % (fb.width + sprite.width * 2)) - sprite.width;
    const y = Math.round(horizon * (0.1 + hash01(i, 7) * 0.45));
    fb.blit(sprite, x, y, sprite.width, sprite.height, horizon - 2, TRANSPARENT);
  }
}

function drawMountains(fb: Framebuffer, config: SceneConfig, horizon: number, world: RallyWorld): void {
  const far = config.sprites.mountainsFar;
  const near = config.sprites.mountainsNear;
  const farScale = fb.width / far.width;
  const nearScale = (fb.width * 0.9) / near.width;
  blitTiledX(fb, far, -world.skyOffset * 1.2, horizon + 1, farScale);
  blitTiledX(fb, near, -world.skyOffset * 2.1 + fb.width * 0.13, horizon + 1, nearScale);
}

function drawBar(
  fb: Framebuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  background: number,
  fill: number,
): void {
  fb.fillRect(x, y, width, height, background);
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  for (let i = 0; i < filled; i++) {
    // Segmented pixel-art bar.
    if (i % 3 === 2) continue;
    fb.fillRect(x + i, y, 1, height, fill);
  }
}

/** Arcade-style HUD plate: keeps text readable over sky, road and sprites. */
export function drawPanel(fb: Framebuffer, x: number, y: number, width: number, height: number, theme: Theme): void {
  fb.fillRect(x, y, width, height, theme.hudPanel);
  fb.strokeRect(x, y, width, height, theme.frame);
  fb.fillRect(x, y, 1, 1, theme.hudAccent);
}

function drawPlayerCar(fb: Framebuffer, config: SceneConfig, world: RallyWorld, bottomInset: number): void {
  const theme = config.runtime.theme;
  const sprites = config.sprites;
  const carWidth = Math.max(8, Math.round(fb.width * 0.14));
  const carHeight = Math.round((carWidth * sprites.player.straight.height) / sprites.player.straight.width);
  const bob = Math.sin(world.clock * (6 + world.speed / 900)) * (world.offRoad ? 1.6 : 0.5);
  // Visual rumble: crash shake plus the off-road shake the assist is fighting.
  const shakeAmount = (world.crashTimer > 0 ? 2 : 0) + world.shake * 1.5;
  const shakeX = shakeAmount > 0 ? Math.round(Math.sin(world.clock * 47) * shakeAmount) : 0;  const x = Math.round(fb.width / 2 - carWidth / 2 + shakeX + world.steerVisual * carWidth * 0.05);
  const y = Math.round(fb.height - carHeight - 1 - bottomInset + bob);

  // Ground shadow.
  fb.fillRect(x + Math.round(carWidth * 0.12), y + carHeight - 1, Math.round(carWidth * 0.76), 1, theme.shadow);

  let sprite = sprites.player.straight;
  if (world.braking || world.input.brake > 0) sprite = sprites.player.braking;
  else if (world.steerVisual < -0.3) sprite = sprites.player.left;
  else if (world.steerVisual > 0.3) sprite = sprites.player.right;

  // Nitro exhaust: drawn before the sprite so the tires and body mask most of
  // it and only the gap under the rear deck glows.
  if (world.nitroTimer > 0) {
    const flameColors = [theme.nitro, theme.hudAccent, theme.white];
    for (let i = 0; i < 2; i++) {
      const flameX = x + Math.round(carWidth * (0.32 + i * 0.36));
      const flicker = Math.round(2 + Math.abs(Math.sin(world.clock * 30 + i * 2)) * 2);
      for (let f = 0; f < flicker; f++) {
        fb.fillRect(flameX - 1, y + carHeight - 3 + f, 3, 1, flameColors[f % flameColors.length]!);
      }
    }
  }

  fb.blit(sprite, x, y, carWidth, carHeight, fb.height, TRANSPARENT);

  if (theme.name === "night") {
    // Headlight glow pixels on the rear deck.
    fb.fillRect(x + Math.round(carWidth * 0.22), y + 1, 2, 1, theme.headlight);
    fb.fillRect(x + Math.round(carWidth * 0.72), y + 1, 2, 1, theme.headlight);
  }
}

function drawFullHud(fb: Framebuffer, config: SceneConfig, world: RallyWorld): void {
  const theme = config.runtime.theme;
  const pad = 3;
  const speed = String(world.speedKmh).padStart(3, "0");

  // Speed plate (top-left).
  const speedPlateWidth = textWidth("SPD") + textWidth(speed, 2) + textWidth("KM/H") + 12;
  drawPanel(fb, 1, 1, speedPlateWidth, 20, theme);
  drawText(fb, "SPD", pad + 1, pad + 1, theme.hudDim);
  drawText(fb, speed, pad + 1, pad + 7, theme.hudText, 2);
  drawText(fb, "KM/H", pad + 1 + textWidth(speed, 2) + 3, pad + 12, theme.hudDim);

  // Stats plate (top-right).
  const lapText = `LAP ${Math.min(world.lap, world.totalLaps)}/${world.totalLaps}`;
  const timeText = `TIME ${formatTime(world.lapTime * 1000)}`;
  const bestText = `BEST ${formatTime(world.stats.bestLapMs)}`;
  const statsWidth = Math.max(textWidth(lapText), textWidth(timeText), textWidth(bestText)) + 6;
  const statsX = fb.width - 1 - statsWidth;
  drawPanel(fb, statsX, 1, statsWidth, 21, theme);
  drawText(fb, lapText, statsX + 3, pad + 1, theme.hudAccent);
  drawText(fb, timeText, statsX + 3, pad + 7, theme.hudText);
  drawText(fb, bestText, statsX + 3, pad + 13, theme.hudDim);

  // Nitro plate (bottom-left) - kept narrow so it never covers the car.
  const barWidth = Math.max(12, Math.min(30, Math.round(fb.width * 0.26)));
  const nitroPlateWidth = Math.max(textWidth("NITRO"), barWidth) + 6;
  drawPanel(fb, 1, fb.height - 12, nitroPlateWidth, 11, theme);
  drawText(fb, "NITRO", pad + 1, fb.height - 10, theme.hudDim);
  drawBar(
    fb,
    pad + 1,
    fb.height - 5,
    barWidth,
    3,
    world.nitro,
    theme.hudBarBg,
    world.nitroTimer > 0 ? theme.nitro : theme.hudBarFg,
  );

  // Score plate (bottom-right).
  const scoreText = String(Math.floor(world.stats.score)).padStart(6, "0");
  const scorePlateWidth = Math.max(textWidth("SCORE"), textWidth(scoreText)) + 6;
  drawPanel(fb, fb.width - 2 - scorePlateWidth, fb.height - 15, scorePlateWidth, 14, theme);
  drawText(fb, "SCORE", fb.width - 4 - textWidth("SCORE"), fb.height - 13, theme.hudDim);
  drawText(fb, scoreText, fb.width - 4 - textWidth(scoreText), fb.height - 7, theme.hudText);

  if (world.crashTimer > 0) {
    const message = "CRASH!";
    const x = Math.round((fb.width - textWidth(message, 2)) / 2);
    drawPanel(fb, x - 4, Math.round(fb.height * 0.3) - 3, textWidth(message, 2) + 8, 14, theme);
    drawText(fb, message, x, Math.round(fb.height * 0.3), theme.hudWarn, 2);
  } else if (world.finished) {
    const message = "FINISH!";
    const x = Math.round((fb.width - textWidth(message, 2)) / 2);
    drawPanel(fb, x - 4, Math.round(fb.height * 0.3) - 3, textWidth(message, 2) + 8, 14, theme);
    drawText(fb, message, x, Math.round(fb.height * 0.3), theme.hudAccent, 2);
  } else if (world.offRoad) {
    const message = "OFF ROAD";
    const x = Math.round((fb.width - textWidth(message)) / 2);
    drawPanel(fb, x - 4, Math.round(fb.height * 0.28) - 2, textWidth(message) + 8, 10, theme);
    drawText(fb, message, x, Math.round(fb.height * 0.28), theme.hudWarn);
  }
}

function drawCompactHud(fb: Framebuffer, config: SceneConfig, world: RallyWorld): void {
  const theme = config.runtime.theme;
  const pad = 2;
  const lapText = `L${Math.min(world.lap, world.totalLaps)}/${world.totalLaps}`;
  drawPanel(fb, 1, 1, textWidth(lapText) + 5, 8, theme);
  drawText(fb, lapText, pad + 1, pad + 1, theme.hudAccent);

  const speed = String(world.speedKmh).padStart(3, "0");
  drawPanel(fb, fb.width - 1 - textWidth(speed) - 5, 1, textWidth(speed) + 5, 8, theme);
  drawText(fb, speed, fb.width - pad - textWidth(speed), pad + 1, theme.hudText);

  // Fuel strip along the very bottom; the car is drawn above it.
  drawPanel(fb, 1, fb.height - 8, fb.width - 2, 7, theme);
  drawText(fb, "FUEL", pad + 1, fb.height - 7, theme.hudDim);
  drawBar(
    fb,
    pad + 1 + textWidth("FUEL") + 3,
    fb.height - 6,
    Math.max(8, fb.width - 2 * (pad + 1) - textWidth("FUEL") - textWidth("000000") - 10),
    3,
    world.nitro,
    theme.hudBarBg,
    world.nitroTimer > 0 ? theme.nitro : theme.hudBarFg,
  );
  const scoreText = String(Math.floor(world.stats.score));
  drawText(fb, scoreText, fb.width - pad - textWidth(scoreText), fb.height - 7, theme.hudText);
}

/** Renders one complete frame of the race into the framebuffer. */
export function renderScene(fb: Framebuffer, config: SceneConfig, world: RallyWorld): void {
  const theme = config.runtime.theme;
  // A 45° camera looks down at the ground: the horizon sits above the frame,
  // so the whole frame is track. The sky block below only runs when the camera
  // is tilted back far enough for the horizon to be visible.
  const horizonY = fb.height / 2 - fb.height;

  if (horizonY > 0) {
    drawSky(fb, theme, horizonY, world, theme.name === "night");
    drawSunAndClouds(fb, config, theme, horizonY, world);
    drawMountains(fb, config, horizonY, world);
  }

  renderRoad(fb, config.track, config.runtime, world.position, world.playerX, world.sceneCars());

  const compact = config.hud === "compact";
  drawPlayerCar(fb, config, world, compact ? 9 : 0);
  if (compact) drawCompactHud(fb, config, world);
  else drawFullHud(fb, config, world);

  // Bezel frame last so nothing draws over it.
  fb.strokeRect(0, 0, fb.width, fb.height, theme.frame);
  fb.fillRect(0, 0, 2, 1, theme.frameAccent);
  fb.fillRect(fb.width - 2, fb.height - 1, 2, 1, theme.frameAccent);
}
