/**
 * 3x5 pixel font. Every glyph is five rows of three cells; "#" is an ink pixel.
 * Drawn directly into the framebuffer so HUD text is part of the pixel art.
 */

import type { Framebuffer } from "./fb.ts";

const GLYPHS: Record<string, string> = {
  A: ".#./#.#/###/#.#/#.#",
  B: "##./#.#/##./#.#/##.",
  C: ".##/#../#../#../.##",
  D: "##./#.#/#.#/#.#/##.",
  E: "###/#../##./#../###",
  F: "###/#../##./#../#..",
  G: ".##/#../#.#/#.#/.##",
  H: "#.#/#.#/###/#.#/#.#",
  I: "###/.#./.#./.#./###",
  J: "..#/..#/..#/#.#/.#.",
  K: "#.#/#.#/##./#.#/#.#",
  L: "#../#../#../#../###",
  M: "#.#/###/###/#.#/#.#",
  N: "#.#/###/###/###/#.#",
  O: ".#./#.#/#.#/#.#/.#.",
  P: "##./#.#/##./#../#..",
  Q: ".#./#.#/#.#/###/..#",
  R: "##./#.#/##./#.#/#.#",
  S: ".##/#../.#./..#/##.",
  T: "###/.#./.#./.#./.#.",
  U: "#.#/#.#/#.#/#.#/###",
  V: "#.#/#.#/#.#/#.#/.#.",
  W: "#.#/#.#/###/###/#.#",
  X: "#.#/#.#/.#./#.#/#.#",
  Y: "#.#/#.#/.#./.#./.#.",
  Z: "###/..#/.#./#../###",
  "0": "###/#.#/#.#/#.#/###",
  "1": ".#./##./.#./.#./###",
  "2": "###/..#/###/#../###",
  "3": "###/..#/###/..#/###",
  "4": "#.#/#.#/###/..#/..#",
  "5": "###/#../###/..#/###",
  "6": "###/#../###/#.#/###",
  "7": "###/..#/..#/..#/..#",
  "8": "###/#.#/###/#.#/###",
  "9": "###/#.#/###/..#/###",
  " ": ".../.../.../.../...",
  ".": ".../.../.../.../.#.",
  ",": ".../.../.../.#./.#.",
  ":": ".../.#./.../.#./...",
  "-": ".../.../###/.../...",
  "+": ".../.#./###/.#./...",
  "/": "..#/..#/.#./#../#..",
  "!": ".#./.#./.#./.../.#.",
  "?": "###/..#/.##/.../.#.",
  "*": "#.#/.#./###/.#./#.#",
  "%": "#.#/..#/.#./#../#.#",
  "(": ".#./#../#../#../.#.",
  ")": ".#./..#/..#/..#/.#.",
  "[": "###/#../#../#../###",
  "]": "###/..#/..#/..#/###",
  "<": "..#/.#./#../.#./..#",
  ">": "#../.#./..#/.#./#..",
  "=": ".../###/.../###/...",
  "'": ".#./.#./.../.../...",
  '"': "#.#/#.#/.../.../...",
  "#": "#.#/###/#.#/###/#.#",
  "|": ".#./.#./.#./.#./.#.",
  "^": ".#./###/#.#/.../...",
  "_": ".../.../.../.../###",
};

const GLYPH_WIDTH = 3;
const GLYPH_HEIGHT = 5;
const LETTER_SPACING = 1;

const parsed = new Map<string, boolean[][]>();
for (const [char, spec] of Object.entries(GLYPHS)) {
  parsed.set(char, spec.split("/").map((row) => row.split("").map((c) => c === "#")));
}
const FALLBACK = parsed.get("?")!;

export function glyphRows(char: string): boolean[][] {
  return parsed.get(char) ?? parsed.get(char.toUpperCase()) ?? FALLBACK;
}

export function textWidth(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return (text.length * (GLYPH_WIDTH + LETTER_SPACING) - LETTER_SPACING) * scale;
}

export function drawText(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  color: number,
  scale = 1,
): void {
  let cursor = Math.round(x);
  const top = Math.round(y);
  for (const char of text) {
    const rows = glyphRows(char);
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      const bits = rows[row]!;
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (!bits[col]) continue;
        if (scale <= 1) {
          fb.set(cursor + col, top + row, color);
        } else {
          fb.fillRect(cursor + col * scale, top + row * scale, scale, scale, color);
        }
      }
    }
    cursor += (GLYPH_WIDTH + LETTER_SPACING) * scale;
  }
}

/** Text with a 1px drop shadow, for readability over road/sky. */
export function drawTextShadow(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  color: number,
  shadow: number,
  scale = 1,
): void {
  drawText(fb, text, x + scale, y + scale, shadow, scale);
  drawText(fb, text, x, y, color, scale);
}
