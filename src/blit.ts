/**
 * Framebuffer -> terminal lines.
 *
 * Each character cell carries two pixels: the upper half-block uses the
 * foreground color, the lower half the background color. That doubles vertical
 * resolution and keeps pixels square, which is what makes the scene read as
 * pixel art instead of text.
 */

import type { Framebuffer } from "./fb.ts";

const UPPER_HALF = "\u2580"; // ▀
const RESET = "\x1b[0m";

export interface BlitOptions {
  /** Pad every line out to this many visible columns. */
  padTo?: number;
  /** Color used for padding columns. */
  padColor?: number;
  /** Columns of leading padding (centers a narrow scene). */
  leftPad?: number;
}

function colorPairEscape(fg: number, bg: number): string {
  return `\x1b[38;5;${fg};48;5;${bg}m`;
}

export function framebufferToLines(fb: Framebuffer, options: BlitOptions = {}): string[] {
  const { padTo, padColor, leftPad = 0 } = options;
  const rowPairs = Math.floor(fb.height / 2);
  const lines: string[] = [];

  const padLeft = leftPad > 0 ? colorPairEscape(padColor ?? 0, padColor ?? 0) + " ".repeat(leftPad) : "";
  let padRight = "";
  if (padTo !== undefined && padTo > fb.width + leftPad) {
    padRight = colorPairEscape(padColor ?? 0, padColor ?? 0) + " ".repeat(padTo - fb.width - leftPad);
  }

  for (let row = 0; row < rowPairs; row++) {
    const topRow = row * 2;
    const bottomRow = topRow + 1;
    let line = padLeft;
    let currentFg = -1;
    let currentBg = -1;
    for (let x = 0; x < fb.width; x++) {
      const fg = fb.pixels[topRow * fb.width + x]!;
      const bg = fb.pixels[bottomRow * fb.width + x]!;
      if (fg !== currentFg || bg !== currentBg) {
        line += colorPairEscape(fg, bg);
        currentFg = fg;
        currentBg = bg;
      }
      line += fg === bg ? " " : UPPER_HALF;
    }
    lines.push(line + padRight + RESET);
  }

  return lines;
}

/** Visible width of a rendered line, ignoring ANSI escape sequences. */
export function visibleWidthOf(line: string): number {
  let visible = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\x1b") {
      const end = line.indexOf("m", index);
      index = end === -1 ? line.length : end + 1;
      continue;
    }
    index++;
    visible++;
  }
  return visible;
}

/** Truncate a rendered line to a visible width without breaking escape codes. */export function clipLine(line: string, width: number): string {
  let visible = 0;
  let index = 0;
  while (index < line.length && visible < width) {
    if (line[index] === "\x1b") {
      const end = line.indexOf("m", index);
      index = end === -1 ? line.length : end + 1;
      continue;
    }
    index++;
    visible++;
  }
  // Keep any trailing escape sequence (padding/reset) intact.
  const tail = line.slice(index).replace(/[^\x1b]*$/, "");
  return line.slice(0, index) + tail;
}
