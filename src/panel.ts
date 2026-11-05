/**
 * Floating side panel: the race running in a right-anchored overlay while you
 * keep typing in the editor.
 *
 * The panel is opt-in (`/rally on`) and non-capturing, so keyboard focus stays
 * in the editor and the car drives itself.
 */

import type { RallyRuntime } from "./runtime.ts";

export interface PanelHost {
  requestRender(): void;
}

export class RallyPanel {
  private runtime: RallyRuntime;
  private host: PanelHost | null = null;
  private cachedLines: string[] = [];
  private cachedWidth = -1;
  private cachedVersion = -1;
  private unsubscribe: (() => void) | null = null;

  constructor(runtime: RallyRuntime) {
    this.runtime = runtime;
  }

  /** Called by the overlay factory once the TUI is available. */
  attach(host: PanelHost | undefined): void {
    if (!host || typeof host.requestRender !== "function") return;
    this.host = host;
    if (!this.unsubscribe) {
      this.unsubscribe = this.runtime.onTick(() => {
        this.cachedVersion = -1;
        this.host?.requestRender();
      });
    }
  }

  invalidate(): void {
    this.cachedWidth = -1;
    this.cachedVersion = -1;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host = null;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.runtime.version) {
      return this.cachedLines;
    }
    const theme = this.runtime.theme;
    const title =
      `\x1b[38;5;${theme.frameAccent}m STEP CODE RALLY \x1b[0m` +
      `\x1b[38;5;${theme.hudDim}m· /rally off\x1b[0m`;
    const titleVisible = " STEP CODE RALLY · /rally off".length;
    const titleLine = title + " ".repeat(Math.max(0, width - titleVisible));

    this.cachedLines = [titleLine, ...this.runtime.panelLines(width, this.runtime.panelRows)];
    this.cachedWidth = width;
    this.cachedVersion = this.runtime.version;
    return this.cachedLines;
  }
}
