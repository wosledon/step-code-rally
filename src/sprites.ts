/**
 * Pixel-art sprite definitions and baking.
 *
 * Sprites are authored as character grids; each character maps to a theme
 * color. Baking turns a grid into a flat palette-index array that the
 * renderer blits with nearest-neighbor scaling, so the art keeps its chunky
 * pixel look at every distance.
 */

import { Framebuffer as FB } from "./fb.ts";
import { drawText, textWidth } from "./font.ts";
import type { Theme } from "./palette.ts";

export const TRANSPARENT = 0xffff;

export interface Sprite {
  name: string;
  width: number;
  height: number;
  pixels: Uint16Array;
}

type ColorName = {
  [K in keyof Theme]: Theme[K] extends number ? K : never;
}[keyof Theme];

export interface SpriteDef {
  name: string;
  rows: string[];
  colors: Record<string, ColorName>;
}

function colorOf(theme: Theme, name: ColorName | undefined, fallback: ColorName): number {
  if (!name) return theme[fallback];
  const value = theme[name];
  return typeof value === "number" ? value : theme[fallback];
}

function bake(def: SpriteDef, theme: Theme, shift = (row: number) => 0): Sprite {
  const height = def.rows.length;
  const width = def.rows[0]?.length ?? 0;
  const pixels = new Uint16Array(width * height).fill(TRANSPARENT);
  for (let row = 0; row < height; row++) {
    const line = def.rows[row]!;
    const offset = shift(row);
    for (let col = 0; col < line.length; col++) {
      const char = line[col]!;
      if (char === "." || char === " ") continue;
      const color = colorOf(theme, def.colors[char], "white");
      const x = col + offset;
      if (x < 0 || x >= width) continue;
      pixels[row * width + x] = color;
    }
  }
  return { name: def.name, width, height, pixels };
}

/* ------------------------------------------------------------------ *
 * Player car (rear view). 15x10.
 * B body, S shade, L light, g glass, k tire, c chrome, b brake light.
 * ------------------------------------------------------------------ */
const PLAYER_CAR: SpriteDef = {
  name: "player",
  rows: [
    "..b.........b..",
    "..BBBBBBBBBBB..",
    "..BSSSSSSSSSB..",
    "..BSgggggggSB..",
    "..BSgggggggSB..",
    "..BSSSSSSSSSB..",
    "..BbbbBBBbbbB..",
    "..BBBBBBBBBBB..",
    ".kkK.......Kkk.",
    ".kkK.......Kkk.",
  ],
  colors: {
    B: "carBody",
    S: "carShade",
    L: "carLight",
    g: "glass",
    k: "tire",
    K: "black",
    c: "chrome",
    b: "brake",
  },
};

/** Traffic car (rear view). 15x8. */
const TRAFFIC_CAR: SpriteDef = {
  name: "traffic",
  rows: [
    "....TTTTTTT....",
    "..TTTTTTTTTTT..",
    "..TtttttttttT..",
    "..TlllllllllT..",
    "..TtttttttttT..",
    "..TTTTTTTTTTT..",
    ".KKK.......KKK.",
    ".KKK.......KKK.",
  ],
  colors: {
    T: "trafficBody",
    t: "trafficShade",
    l: "trafficLight",
    k: "tire",
    s: "shadow",
    K: "tire",
  },
};

/* ------------------------------------------------------------------ *
 * Scenery
 * ------------------------------------------------------------------ */
const PINE: SpriteDef = {
  name: "pine",
  rows: [
    "....D....",
    "...DMD...",
    "..DMMMD..",
    ".DMMLMMD.",
    ".DMMLMMD.",
    "..DMMMD..",
    "...DMD...",
    "....r....",
    "....r....",
  ],
  colors: { D: "treeDark", M: "treeMid", L: "treeLight", r: "trunk" },
};

const BUSH: SpriteDef = {
  name: "bush",
  rows: ["..MMM..", ".MMLMM.", "MMMMMMM", ".MMMMM."],
  colors: { M: "treeMid", L: "treeLight" },
};

const PYLON: SpriteDef = {
  name: "pylon",
  rows: [".YYY.", ".YYY.", "..W..", "..W..", "..W..", "..W.."],
  colors: { Y: "hudAccent", W: "white" },
};

const SIGN_POST: SpriteDef = {
  name: "sign",
  rows: [
    ".WWWWW.",
    "WFFFFFW",
    "WFYYTFW",
    "WFFFFFW",
    "..W.W..",
    "..W.W..",
    "..WWW..",
  ],
  colors: { W: "white", F: "billboardFrame", Y: "hudAccent", T: "billboardText" },
};

const CACTUS: SpriteDef = {
  name: "cactus",
  rows: ["..M..", "MMM.M", ".MMM.", "..M..", "..M..", "..M.."],
  colors: { M: "treeMid" },
};

/* ------------------------------------------------------------------ *
 * Generated sprites (sun, clouds, mountains, billboards, gantry)
 * ------------------------------------------------------------------ */

export function makeSun(radius: number, theme: Theme): Sprite {
  const size = radius * 2 + 1;
  const pixels = new Uint16Array(size * size).fill(TRANSPARENT);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius * 0.45) pixels[y * size + x] = theme.sunCore;
      else if (distance <= radius) pixels[y * size + x] = theme.sun;
    }
  }
  return { name: "sun", width: size, height: size, pixels };
}

const CLOUD_SHAPES: string[][] = [
  [
    ".....WWWWWW.....",
    "...WWWWWWWWWW...",
    "..WWWWWWWWWWWW..",
    ".WWWWWWWWWWWWWW.",
    "..WWWWWWWWWWWW..",
    "....s......s....",
  ],
  [
    "....WWWW....",
    "..WWWWWWWW..",
    ".WWWWWWWWWW.",
    "WWWWWWWWWWWW",
    ".WWWWWWWWWW.",
    "..s......s..",
  ],
];

export function makeCloud(index: number, theme: Theme): Sprite {
  const rows = CLOUD_SHAPES[index % CLOUD_SHAPES.length]!;
  const height = rows.length;
  const width = rows[0]!.length;
  const pixels = new Uint16Array(width * height).fill(TRANSPARENT);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const char = rows[y]![x]!;
      if (char === "W") pixels[y * width + x] = theme.cloud;
      else if (char === "s") pixels[y * width + x] = theme.cloudShade;
    }
  }
  return { name: `cloud${index}`, width, height, pixels };
}

/** Jagged mountain silhouette. Deterministic for a given seed. */
export function makeMountains(width: number, height: number, seed: number, color: number): Sprite {
  const pixels = new Uint16Array(width * height).fill(TRANSPARENT);
  let state = seed * 2654435761;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // Ridge line built from a few peaks with random heights.
  const peakCount = Math.max(3, Math.floor(width / 14));
  const peaks: number[] = [];
  for (let i = 0; i <= peakCount; i++) peaks.push(0.25 + rand() * 0.75);
  const ridgeAt = (x: number) => {
    const t = (x / width) * peakCount;
    const i = Math.floor(t);
    const f = t - i;
    const a = peaks[Math.min(peakCount, i)]!;
    const b = peaks[Math.min(peakCount, i + 1)]!;
    // Smooth-ish interpolation with a slight peak in the middle of each span.
    const blend = f * f * (3 - 2 * f);
    return a + (b - a) * blend;
  };
  for (let x = 0; x < width; x++) {
    const top = Math.round((1 - ridgeAt(x)) * height);
    for (let y = top; y < height; y++) pixels[y * width + x] = color;
  }
  return { name: "mountains", width, height, pixels };
}

/** Billboard with pixel-font slogan. */
export function makeBillboard(text: string, theme: Theme): Sprite {
  const boardHeight = 13;
  const legHeight = 5;
  const width = Math.max(21, textWidth(text) + 8);
  const height = boardHeight + legHeight;
  const fb = new FB(width, height);
  fb.fillRect(0, 0, width, 2, theme.billboardFrame);
  fb.fillRect(0, 2, width, boardHeight - 2, theme.billboardBg);
  fb.fillRect(0, boardHeight - 2, width, 2, theme.billboardFrame);
  fb.fillRect(2, 0, width - 4, boardHeight, theme.billboardFrame);
  fb.fillRect(3, 1, width - 6, boardHeight - 2, theme.billboardBg);
  drawText(fb, text, Math.floor((width - textWidth(text)) / 2), 4, theme.billboardText);
  // Legs.
  fb.fillRect(3, boardHeight, 2, legHeight, theme.trunk);
  fb.fillRect(width - 5, boardHeight, 2, legHeight, theme.trunk);
  return { name: `billboard:${text}`, width, height, pixels: fb.pixels };
}

/** Start/finish gantry with a checkered banner. */
export function makeGantry(theme: Theme): Sprite {
  const width = 29;
  const height = 14;
  const fb = new FB(width, height);
  fb.fillRect(0, 0, width, 1, theme.white);
  fb.fillRect(0, 1, width, 3, theme.black);
  // Checker row.
  for (let x = 0; x < width; x++) {
    const on = Math.floor(x / 2) % 2 === 0;
    fb.fillRect(x, 1, 1, 3, on ? theme.white : theme.black);
  }
  fb.fillRect(0, 4, width, 1, theme.white);
  // Banner plate.
  fb.fillRect(1, 5, width - 2, 4, theme.billboardBg);
  fb.fillRect(1, 5, width - 2, 1, theme.billboardFrame);
  drawText(fb, "START", Math.floor((width - textWidth("START")) / 2), 6, theme.billboardText);
  // Posts.
  fb.fillRect(1, 9, 2, height - 9, theme.frame);
  fb.fillRect(width - 3, 9, 2, height - 9, theme.frame);
  return { name: "gantry", width, height, pixels: fb.pixels };
}

/* ------------------------------------------------------------------ *
 * Sprite bank
 * ------------------------------------------------------------------ */

export interface CarVariant {
  straight: Sprite;
  left: Sprite;
  right: Sprite;
  braking: Sprite;
}

export interface SpriteBank {
  player: CarVariant;
  traffic: Sprite;
  trafficAlt: Sprite;
  pine: Sprite;
  bush: Sprite;
  pylon: Sprite;
  sign: Sprite;
  cactus: Sprite;
  sun: Sprite;
  clouds: Sprite[];
  mountainsFar: Sprite;
  mountainsNear: Sprite;
  gantry: Sprite;
  billboards: Sprite[];
}

function shearCar(def: SpriteDef, theme: Theme, tilt: number): Sprite {
  return bake(def, theme, (row) => Math.round((row / (def.rows.length - 1)) * tilt));
}

function brakingCar(theme: Theme): Sprite {
  const def: SpriteDef = {
    ...PLAYER_CAR,
    rows: PLAYER_CAR.rows.map((row) => row.replace(/b/g, "B")),
    colors: { ...PLAYER_CAR.colors, B: "brake" },
  };
  return bake(def, theme);
}

export function buildSpriteBank(theme: Theme, mountainWidth: number): SpriteBank {
  const billboardTexts = ["STEP", "RALLY", "GT", "FUEL", "SHIP", "NOBUG"];
  return {
    player: {
      straight: bake(PLAYER_CAR, theme),
      left: shearCar(PLAYER_CAR, theme, -2),
      right: shearCar(PLAYER_CAR, theme, 2),
      braking: brakingCar(theme),
    },
    traffic: bake(TRAFFIC_CAR, theme),
    trafficAlt: bake(
      {
        ...TRAFFIC_CAR,
        colors: { ...TRAFFIC_CAR.colors, T: "carBody", t: "carShade", l: "carLight" },
      },
      theme,
    ),
    pine: bake(PINE, theme),
    bush: bake(BUSH, theme),
    pylon: bake(PYLON, theme),
    sign: bake(SIGN_POST, theme),
    cactus: bake(CACTUS, theme),
    sun: makeSun(7, theme),
    clouds: [makeCloud(0, theme), makeCloud(1, theme)],
    mountainsFar: makeMountains(mountainWidth, 26, 7, theme.mountainFar),
    mountainsNear: makeMountains(mountainWidth, 18, 23, theme.mountainNear),
    gantry: makeGantry(theme),
    billboards: billboardTexts.map((text) => makeBillboard(text, theme)),
  };
}
