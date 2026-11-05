/**
 * Shared race runtime.
 *
 * One world instance is owned here and driven by a single timer, so the
 * background widget, the fullscreen game and the coding-activity hooks all
 * see the same race. The race keeps running while you write code.
 */

import { Framebuffer } from "./fb.ts";
import { buildThemeRuntime, THEMES, type Theme, type ThemeRuntime } from "./palette.ts";
import { buildSpriteBank, type SpriteBank } from "./sprites.ts";
import { buildTrack, type Track } from "./track.ts";
import { RallyWorld, TOKENS_AT_FULL_SPEED, type SaveState } from "./game.ts";
import { renderScene } from "./scene.ts";
import { framebufferToLines } from "./blit.ts";

export const RALLY_SAVE_TYPE = "step-rally-save";
export const DEFAULT_THEME = "day";
export const TICK_MS = 45;

export type ThemeName = keyof typeof THEMES;

export interface RallyRuntimeOptions {
  theme?: ThemeName;
  totalLaps?: number;
  panelRows?: number;
}

type Listener = (runtime: RallyRuntime) => void;

export class RallyRuntime {
  themeName: ThemeName;
  theme: Theme;
  palette: ThemeRuntime;
  sprites: SpriteBank;
  track: Track;
  world: RallyWorld;
  panelRows: number;

  /** Bumped every simulation tick so views can cache cheaply. */
  version = 0;
  paused = false;
  /** Set while the fullscreen game owns the car. */
  playing = false;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private listeners = new Set<Listener>();
  private frame: Framebuffer | null = null;

  constructor(options: RallyRuntimeOptions = {}) {
    this.themeName = options.theme ?? DEFAULT_THEME;
    this.panelRows = options.panelRows ?? 22;
    this.theme = THEMES[this.themeName]!;
    this.palette = buildThemeRuntime(this.theme);
    this.sprites = buildSpriteBank(this.theme, 160);
    this.track = buildTrack(this.sprites);
    this.world = new RallyWorld(this.track, this.sprites, {
      auto: true,
      totalLaps: options.totalLaps ?? 3,
    });
  }

  /* ---------------------------- lifecycle ---------------------------- */

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.12, (now - this.lastTick) / 1000);
      this.lastTick = now;
      this.updateTokenRate(now);
      this.applyTokenDrive();
      if (!this.paused) this.world.update(dt);
      this.version++;
      for (const listener of this.listeners) listener(this);
    }, TICK_MS);
    // Never keep the process alive just for the race.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
  }

  onTick(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /* ---------------------------- state ---------------------------- */

  serialize(): SaveState {
    return this.world.serialize();
  }

  restore(state: SaveState): void {
    this.world.restore(state);
  }

  restart(): void {
    this.world.restart();
  }

  setTheme(name: ThemeName): void {
    if (!THEMES[name] || name === this.themeName) return;
    const state = this.world.serialize();
    this.themeName = name;
    this.theme = THEMES[name]!;
    this.palette = buildThemeRuntime(this.theme);
    this.sprites = buildSpriteBank(this.theme, 160);
    this.track = buildTrack(this.sprites);
    this.world = new RallyWorld(this.track, this.sprites, {
      auto: true,
      totalLaps: state.totalLaps,
    });
    this.world.restore(state);
    this.frame = null;
    this.version++;
  }

  setPanelRows(rows: number): void {
    this.panelRows = Math.max(12, Math.min(34, Math.round(rows)));
    this.frame = null;
    this.version++;
  }

  /* ---------------------------- code fuel ---------------------------- */

  /** A coding event happened: nitro, score and a speed kick. */
  codeBoost(amount = 1): void {
    this.world.codeBoost(amount);
  }

  addNitro(amount: number): void {
    this.world.addNitro(amount);
  }

  /** An error in the session costs the car its nitro. */
  penalty(): void {
    this.world.nitroTimer = 0;
    this.world.shake = 1;
  }

  /* ------------------------- token throughput ------------------------- */

  /**
   * Smoothed token rate in tokens/second, measured over a short sliding window
   * so the car tracks the stream without jittering on every chunk.
   */
  tokenRate = 0;
  private windowTokens = 0;
  private windowStart = Date.now();

  /** Report generated tokens (text, thinking and tool-call deltas). */
  onTokens(count: number): void {
    if (count <= 0) return;
    this.windowTokens += count;
  }

  private updateTokenRate(now: number): void {
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed < 0.25) return;
    const instant = this.windowTokens / elapsed;
    // Half-and-half smoothing: responsive, but not a jitter per chunk.
    this.tokenRate = this.tokenRate * 0.5 + instant * 0.5;
    this.windowTokens = 0;
    this.windowStart = now;
  }

  /** Map the measured token rate onto the car's allowed share of full speed. */
  private applyTokenDrive(): void {
    this.world.tokenDrive = Math.min(1, this.tokenRate / TOKENS_AT_FULL_SPEED);
  }

  /* ---------------------------- rendering ---------------------------- */

  /** Render one frame into a framebuffer of the requested pixel size. */
  framebuffer(width: number, height: number, hud: "full" | "compact" = height >= 40 ? "full" : "compact"): Framebuffer {
    if (!this.frame || this.frame.width !== width || this.frame.height !== height) {
      this.frame = new Framebuffer(width, height);
    }
    renderScene(this.frame, {
      width,
      height,
      hud,
      runtime: this.palette,
      sprites: this.sprites,
      track: this.track,
    }, this.world);
    return this.frame;
  }

  /** Lines for the floating side panel, padded to the panel width. */
  panelLines(width: number, rows: number): string[] {
    const cols = Math.max(20, Math.min(width, 76));
    const fb = this.framebuffer(cols, Math.max(16, rows) * 2, "compact");
    const leftPad = Math.max(0, Math.floor((width - cols) / 2));
    return framebufferToLines(fb, {
      padTo: width,
      padColor: this.theme.frame,
      leftPad,
    });
  }

  statusLine(): string {
    const world = this.world;
    const lap = `${Math.min(world.lap, world.totalLaps)}/${world.totalLaps}`;
    const tokens = `${Math.round(this.tokenRate)}tok/s`;
    return `RALLY ${world.speedKmh}km/h · ${tokens} · LAP ${lap} · SCORE ${Math.floor(world.stats.score)}`;
  }
}
