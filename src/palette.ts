/**
 * 256-color palette + fog lookup tables for the racer.
 *
 * Everything is drawn as palette indices into a pixel framebuffer (see fb.ts),
 * which keeps the art limited-palette/pixel-art and makes fog cheap: a color is
 * fogged by looking up a pre-banded table instead of blending per pixel.
 */

/** xterm-256 6x6x6 color cube index from component levels (0..5). */
export function cube(r: number, g: number, b: number): number {
  return 16 + 36 * r + 6 * g + b;
}

/** xterm-256 grayscale ramp index (0..23). */
export function gray(level: number): number {
  return 232 + Math.max(0, Math.min(23, level));
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const BASE16: Array<[number, number, number]> = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

/** RGB triplet for every xterm-256 index (used for fog mixing and PNG export). */
export const XTERM_RGB: Array<[number, number, number]> = (() => {
  const table: Array<[number, number, number]> = [];
  for (let i = 0; i < 256; i++) table.push([0, 0, 0]);
  for (let i = 0; i < 16; i++) table[i] = BASE16[i]!;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table[16 + 36 * r + 6 * g + b] = [CUBE_LEVELS[r]!, CUBE_LEVELS[g]!, CUBE_LEVELS[b]!];
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + 10 * i;
    table[232 + i] = [v, v, v];
  }
  return table;
})();

export function rgbOf(index: number): [number, number, number] {
  return XTERM_RGB[index] ?? [0, 0, 0];
}

export const FOG_LEVELS = 6;

/**
 * Build a color -> [fog level] lookup table. Level 0 is untouched, the last
 * level is fully fog. Colors are snapped back to the supplied palette so fog
 * stays banded like the rest of the art.
 */
export function buildFogTable(palette: number[], fogColor: number): Uint16Array {
  const fog = rgbOf(fogColor);
  const table = new Uint16Array(256 * FOG_LEVELS);
  for (const color of palette) {
    const [r0, g0, b0] = rgbOf(color);
    for (let level = 0; level < FOG_LEVELS; level++) {
      const t = level / (FOG_LEVELS - 1);
      const r = Math.round(r0 + (fog[0] - r0) * t);
      const g = Math.round(g0 + (fog[1] - g0) * t);
      const b = Math.round(b0 + (fog[2] - b0) * t);
      table[color * FOG_LEVELS + level] = snapToPalette(palette, r, g, b);
    }
  }
  return table;
}

function snapToPalette(palette: number[], r: number, g: number, b: number): number {
  let best = palette[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const [cr, cg, cb] = rgbOf(candidate);
    // Weighted for perceptual closeness.
    const dr = r - cr;
    const dg = g - cg;
    const db = b - cb;
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Named color slots every theme must provide. */
export interface Theme {
  name: string;
  /** Sky gradient, top -> horizon. */
  sky: [number, number, number, number];
  fog: number;
  sun: number;
  sunCore: number;
  cloud: number;
  cloudShade: number;
  mountainFar: number;
  mountainNear: number;
  star: number;
  grass: [number, number];
  grassDry: [number, number];
  road: [number, number];
  roadPatch: number;
  rumble: [number, number];
  lane: number;
  startLine: [number, number];
  treeDark: number;
  treeMid: number;
  treeLight: number;
  trunk: number;
  billboardBg: number;
  billboardFrame: number;
  billboardText: number;
  pylon: [number, number];
  carBody: number;
  carShade: number;
  carLight: number;
  trafficBody: number;
  trafficShade: number;
  trafficLight: number;
  tire: number;
  glass: number;
  chrome: number;
  shadow: number;
  brake: number;
  headlight: number;
  hudText: number;
  hudDim: number;
  hudAccent: number;
  hudWarn: number;
  hudBarBg: number;
  hudBarFg: number;
  hudPanel: number;
  frame: number;
  frameAccent: number;
  nitro: number;
  white: number;
  black: number;
}

export const THEMES: Record<string, Theme> = {
  day: {
    name: "day",
    sky: [cube(0, 1, 3), cube(1, 2, 4), cube(2, 3, 5), cube(3, 4, 5)],
    fog: cube(3, 4, 5),
    sun: cube(5, 4, 0),
    sunCore: cube(5, 5, 1),
    cloud: cube(5, 5, 5),
    cloudShade: cube(3, 4, 5),
    mountainFar: cube(2, 2, 4),
    mountainNear: cube(1, 1, 3),
    star: cube(5, 5, 5),
    grass: [cube(2, 4, 1), cube(1, 3, 0)],
    grassDry: [cube(3, 4, 1), cube(2, 4, 0)],
    road: [cube(3, 3, 3), cube(2, 2, 2)],
    roadPatch: cube(4, 4, 4),
    rumble: [cube(4, 0, 0), cube(5, 5, 5)],
    lane: cube(5, 5, 5),
    startLine: [cube(5, 5, 5), cube(2, 2, 2)],
    treeDark: cube(0, 2, 0),
    treeMid: cube(1, 3, 0),
    treeLight: cube(2, 4, 1),
    trunk: cube(2, 1, 0),
    billboardBg: cube(5, 5, 5),
    billboardFrame: cube(4, 0, 0),
    billboardText: cube(4, 0, 0),
    pylon: [cube(5, 3, 0), cube(5, 5, 5)],
    carBody: cube(5, 0, 0),
    carShade: cube(3, 0, 0),
    carLight: cube(5, 2, 2),
    trafficBody: cube(0, 2, 5),
    trafficShade: cube(0, 1, 3),
    trafficLight: cube(2, 3, 5),
    tire: gray(3),
    glass: cube(2, 2, 4),
    chrome: gray(14),
    shadow: gray(2),
    brake: cube(5, 1, 0),
    headlight: cube(5, 5, 2),
    hudText: cube(5, 5, 5),
    hudDim: cube(3, 3, 3),
    hudAccent: cube(5, 5, 0),
    hudWarn: cube(5, 2, 0),
    hudBarBg: gray(4),
    hudBarFg: cube(5, 5, 0),
    hudPanel: cube(0, 0, 1),
    frame: gray(6),
    frameAccent: cube(5, 0, 0),
    nitro: cube(1, 5, 5),
    white: cube(5, 5, 5),
    black: gray(0),
  },
  sunset: {
    name: "sunset",
    sky: [cube(3, 0, 2), cube(4, 1, 1), cube(5, 3, 0), cube(5, 4, 1)],
    fog: cube(5, 4, 1),
    sun: cube(5, 5, 1),
    sunCore: cube(5, 5, 4),
    cloud: cube(5, 3, 3),
    cloudShade: cube(4, 1, 2),
    mountainFar: cube(3, 1, 3),
    mountainNear: cube(2, 0, 2),
    star: cube(5, 5, 4),
    grass: [cube(2, 3, 0), cube(1, 2, 0)],
    grassDry: [cube(3, 3, 0), cube(2, 3, 0)],
    road: [cube(3, 2, 2), cube(2, 1, 1)],
    roadPatch: cube(4, 3, 3),
    rumble: [cube(4, 0, 0), cube(5, 4, 1)],
    lane: cube(5, 5, 4),
    startLine: [cube(5, 5, 4), cube(2, 1, 1)],
    treeDark: cube(1, 2, 0),
    treeMid: cube(2, 3, 0),
    treeLight: cube(3, 4, 1),
    trunk: cube(2, 1, 0),
    billboardBg: cube(5, 5, 4),
    billboardFrame: cube(4, 0, 0),
    billboardText: cube(4, 0, 0),
    pylon: [cube(5, 3, 0), cube(5, 5, 4)],
    carBody: cube(5, 1, 0),
    carShade: cube(3, 0, 0),
    carLight: cube(5, 3, 1),
    trafficBody: cube(3, 0, 4),
    trafficShade: cube(2, 0, 3),
    trafficLight: cube(4, 1, 5),
    tire: gray(3),
    glass: cube(3, 2, 4),
    chrome: gray(14),
    shadow: gray(2),
    brake: cube(5, 0, 0),
    headlight: cube(5, 5, 3),
    hudText: cube(5, 5, 4),
    hudDim: cube(4, 3, 3),
    hudAccent: cube(5, 5, 0),
    hudWarn: cube(5, 1, 0),
    hudBarBg: gray(4),
    hudBarFg: cube(5, 5, 0),
    hudPanel: cube(1, 0, 1),
    frame: gray(6),
    frameAccent: cube(5, 1, 0),
    nitro: cube(1, 5, 5),
    white: cube(5, 5, 4),
    black: gray(0),
  },
  night: {
    name: "night",
    sky: [cube(0, 0, 1), cube(0, 0, 2), cube(1, 0, 3), cube(2, 1, 4)],
    fog: cube(2, 1, 4),
    sun: cube(4, 4, 5),
    sunCore: cube(5, 5, 5),
    cloud: cube(1, 1, 3),
    cloudShade: cube(0, 0, 2),
    mountainFar: cube(1, 0, 3),
    mountainNear: cube(0, 0, 2),
    star: cube(5, 5, 5),
    grass: [cube(0, 2, 1), cube(0, 1, 0)],
    grassDry: [cube(1, 2, 0), cube(0, 2, 0)],
    road: [cube(2, 2, 2), cube(1, 1, 1)],
    roadPatch: cube(3, 3, 3),
    rumble: [cube(4, 0, 0), cube(4, 4, 4)],
    lane: cube(4, 4, 4),
    startLine: [cube(4, 4, 4), cube(1, 1, 1)],
    treeDark: cube(0, 1, 0),
    treeMid: cube(0, 2, 0),
    treeLight: cube(1, 3, 0),
    trunk: cube(2, 1, 0),
    billboardBg: cube(1, 1, 3),
    billboardFrame: cube(5, 5, 0),
    billboardText: cube(5, 5, 0),
    pylon: [cube(5, 3, 0), cube(4, 4, 4)],
    carBody: cube(4, 0, 0),
    carShade: cube(2, 0, 0),
    carLight: cube(5, 2, 2),
    trafficBody: cube(0, 2, 5),
    trafficShade: cube(0, 1, 3),
    trafficLight: cube(2, 3, 5),
    tire: gray(3),
    glass: cube(2, 2, 4),
    chrome: gray(14),
    shadow: gray(1),
    brake: cube(5, 1, 0),
    headlight: cube(5, 5, 3),
    hudText: cube(4, 4, 5),
    hudDim: cube(2, 2, 3),
    hudAccent: cube(1, 5, 5),
    hudWarn: cube(5, 1, 0),
    hudBarBg: gray(3),
    hudBarFg: cube(1, 5, 5),
    hudPanel: gray(0),
    frame: gray(5),
    frameAccent: cube(5, 5, 0),
    nitro: cube(1, 5, 5),
    white: cube(5, 5, 5),
    black: gray(0),
  },
};

export interface ThemeRuntime {
  theme: Theme;
  /** color index -> fogged color index per level. */
  fog: Uint16Array;
  /** All colors used by the theme, for palette snapping. */
  palette: number[];
}

export function buildThemeRuntime(theme: Theme): ThemeRuntime {
  const palette: number[] = [];
  const seen = new Set<number>();
  for (const value of Object.values(theme)) {
    if (typeof value === "number") {
      if (!seen.has(value)) {
        seen.add(value);
        palette.push(value);
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "number" && !seen.has(entry)) {
          seen.add(entry);
          palette.push(entry);
        }
      }
    }
  }
  return { theme, fog: buildFogTable(palette, theme.fog), palette };
}

/** Map 0..1 distance-through-draw-distance to a banded fog level. */
export function fogLevel(fraction: number): number {
  const t = Math.max(0, Math.min(1, fraction));
  // Bias so nearby segments stay crisp.
  const curved = Math.pow(t, 1.6);
  return Math.max(0, Math.min(FOG_LEVELS - 1, Math.round(curved * (FOG_LEVELS - 1))));
}

/** Snap an arbitrary RGB triple to the nearest xterm-256 index. */
export function snapRgb256(r: number, g: number, b: number): number {
  const toLevel = (value: number) => {
    if (value < 48) return 0;
    if (value < 115) return 1;
    return Math.max(2, Math.min(5, Math.round((value - 35) / 40)));
  };
  const cubeIndex = 16 + 36 * toLevel(r) + 6 * toLevel(g) + toLevel(b);
  const cubeRgb = XTERM_RGB[cubeIndex]!;

  const average = (r + g + b) / 3;
  const grayLevel = Math.max(0, Math.min(23, Math.round((average - 8) / 10)));
  const grayIndex = 232 + grayLevel;
  const grayRgb = XTERM_RGB[grayIndex]!;

  const cubeDistance =
    (r - cubeRgb[0]) ** 2 + (g - cubeRgb[1]) ** 2 + (b - cubeRgb[2]) ** 2;
  const grayDistance =
    (r - grayRgb[0]) ** 2 + (g - grayRgb[1]) ** 2 + (b - grayRgb[2]) ** 2;
  return cubeDistance <= grayDistance ? cubeIndex : grayIndex;
}

/** Linear blend of two xterm-256 colors, snapped back to the palette. */
export function mixColors(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return snapRgb256(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
