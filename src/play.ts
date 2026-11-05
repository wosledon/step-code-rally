/**
 * Fullscreen racer: takes over the editor via ctx.ui.custom() and lets you
 * actually drive. The same world keeps running when you leave, so the widget
 * picks the race back up in autopilot.
 */

import { isKeyRelease, isKittyProtocolActive, Key, matchesKey } from "@step-harness/pi-tui";
import { framebufferToLines } from "./blit.ts";
import { drawText, textWidth } from "./font.ts";
import { drawPanel } from "./scene.ts";
import type { RallyRuntime } from "./runtime.ts";

export interface RallyGameHooks {
  onSave: () => void;
  onExit: () => void;
}

interface KeyState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  nitro: boolean;
}

function terminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns ?? 100,
    rows: process.stdout.rows ?? 30,
  };
}

export class RallyGame {
  wantsKeyRelease = true;

  private runtime: RallyRuntime;
  private hooks: RallyGameHooks;
  private keys: KeyState = { left: false, right: false, up: false, down: false, nitro: false };
  private cachedLines: string[] = [];
  private cachedWidth = -1;
  private cachedVersion = -1;
  private unsubscribe: (() => void) | null = null;
  private autoRelease: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(runtime: RallyRuntime, hooks: RallyGameHooks) {
    this.runtime = runtime;
    this.hooks = hooks;
    this.runtime.playing = true;
    this.runtime.world.auto = false;
    this.runtime.paused = false;
    this.unsubscribe = this.runtime.onTick(() => {
      this.cachedVersion = -1;
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearAutoRelease();
    this.runtime.playing = false;
    this.runtime.world.auto = true;
    this.runtime.world.input.steer = 0;
    this.runtime.world.input.throttle = 0.4;
    this.runtime.world.input.brake = 0;
    this.keys = { left: false, right: false, up: false, down: false, nitro: false };
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedVersion = -1;
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hooks.onSave();
    this.hooks.onExit();
  }

  handleInput(data: string): void {
    const released = isKeyRelease(data);

    if (matchesKey(data, Key.escape)) {
      this.close();
      return;
    }
    if (!released && (data === "q" || data === "Q")) {
      this.close();
      return;
    }
    if (!released && (data === "p" || data === "P")) {
      this.runtime.paused = !this.runtime.paused;
      this.cachedVersion = -1;
      this.applyInput();
      return;
    }
    if (!released && (data === "r" || data === "R")) {
      this.runtime.restart();
      this.runtime.paused = false;
      this.cachedVersion = -1;
      return;
    }

    if (matchesKey(data, Key.left) || data === "a" || data === "A") this.keys.left = !released;
    if (matchesKey(data, Key.right) || data === "d" || data === "D") this.keys.right = !released;
    if (matchesKey(data, Key.up) || data === "w" || data === "W") this.keys.up = !released;
    if (matchesKey(data, Key.down) || data === "s" || data === "S") this.keys.down = !released;
    if (matchesKey(data, Key.space) || data === " ") this.keys.nitro = !released;

    // Terminals without the Kitty keyboard protocol never send key releases,
    // so a tapped key would stay stuck down. Fall back to a short auto-release.
    if (!released && !isKittyProtocolActive()) this.scheduleAutoRelease();
    this.applyInput();
  }

  private clearAutoRelease(): void {
    if (this.autoRelease) {
      clearTimeout(this.autoRelease);
      this.autoRelease = null;
    }
  }

  private scheduleAutoRelease(): void {
    this.clearAutoRelease();
    this.autoRelease = setTimeout(() => {
      this.autoRelease = null;
      this.keys = { left: false, right: false, up: false, down: false, nitro: false };
      this.applyInput();
    }, 170);
    this.autoRelease.unref?.();
  }
  private applyInput(): void {
    const world = this.runtime.world;
    if (this.runtime.paused || world.finished) {
      world.input.steer = 0;
      world.input.throttle = 0;
      world.input.brake = 0;
      return;
    }
    world.input.steer = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    world.input.throttle = this.keys.up ? 1 : 0;
    world.input.brake = this.keys.down ? 1 : 0;
    world.braking = this.keys.down;
    if (this.keys.nitro && world.nitro > 0.02) {
      world.nitroTimer = Math.max(world.nitroTimer, 0.12);
    }
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.runtime.version) {
      return this.cachedLines;
    }

    const terminal = terminalSize();
    const cols = Math.max(8, Math.min(width, 128, terminal.columns));
    const rows = Math.max(20, Math.min(40, terminal.rows - 6));

    const fb = this.runtime.framebuffer(cols, rows * 2);

    if (this.runtime.paused) {
      const theme = this.runtime.theme;
      const message = "PAUSED";
      const x = Math.round((fb.width - textWidth(message, 2)) / 2);
      const panelY = Math.round(fb.height * 0.34) - 4;
      drawPanel(fb, x - 5, panelY, textWidth(message, 2) + 10, 16, theme);
      drawText(fb, message, x, panelY + 4, theme.hudAccent, 2);
      const hint = "P RESUME · ESC EXIT";
      drawText(fb, hint, Math.round((fb.width - textWidth(hint)) / 2), panelY + 12, theme.hudDim);
    }

    const leftPad = Math.max(0, Math.floor((width - fb.width) / 2));
    const lines = framebufferToLines(fb, { padTo: width, padColor: this.runtime.theme.frame, leftPad });
    lines.push(controlsLine(width, this.runtime));
    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.runtime.version;
    return this.cachedLines;
  }
}

function controlsLine(width: number, runtime: RallyRuntime): string {
  const theme = runtime.theme;
  const wrap = (color: number) => (text: string) => `\x1b[38;5;${color}m${text}\x1b[0m`;
  const dim = wrap(theme.hudDim);
  const accent = wrap(theme.hudAccent);
  const items: Array<[string, string]> = [
    ["←→", "steer"],
    ["↑", "gas"],
    ["↓", "brake"],
    ["SPACE", "nitro"],
    ["P", "pause"],
    ["R", "restart"],
    ["ESC", "exit"],
  ];
  let line = "";
  let visible = 0;
  for (const [key, label] of items) {
    const chunkVisible = key.length + 1 + label.length;
    if (visible + chunkVisible > width) break;
    line += `${accent(key)}${dim(` ${label}`)}`;
    visible += chunkVisible;
  }
  return line + " ".repeat(Math.max(0, width - visible));
}
