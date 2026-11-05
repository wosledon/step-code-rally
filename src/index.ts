/**
 * Step Code Rally - a pixel-art 2.5D racing game that runs while you code.
 *
 * Opt-in: nothing is shown until you run `/rally on`, which floats a racing
 * panel on the right edge of the terminal. The panel is non-capturing, so you
 * keep typing in the editor while the car drives itself - and every coding
 * event (tool calls, edits, streamed tokens) feeds it nitro. `/rally` takes the
 * wheel fullscreen, and progress is saved in the session.
 */

import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import type { Component } from "@step-harness/pi-tui";
import { RallyRuntime, RALLY_SAVE_TYPE, type ThemeName } from "./runtime.ts";
import { RallyPanel } from "./panel.ts";
import { RallyGame } from "./play.ts";
import { formatTime } from "./game.ts";
import { THEMES } from "./palette.ts";

const STATUS_KEY = "step-rally";
const SAVE_INTERVAL_MS = 8000;
const DEFAULT_THEME_NAME: ThemeName = "day";

let runtime: RallyRuntime | null = null;
let panel: RallyPanel | null = null;
let panelOpen = false;
let closePanel: (() => void) | null = null;
let panelHandle: { setHidden(hidden: boolean): void } | null = null;
let rpcPanelOn = false;
let rpcTickOff: (() => void) | null = null;
let lastSave = 0;
let statusThrottle = 0;

function isTui(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui";
}

function loadSave(ctx: ExtensionContext): void {
  if (!runtime) return;
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === RALLY_SAVE_TYPE) {
      const data = entry.data as ReturnType<RallyRuntime["serialize"]> | undefined;
      if (data && data.version === 1) runtime.restore(data);
      return;
    }
  }
}

function save(pi: ExtensionAPI, force = false): void {
  if (!runtime) return;
  const now = Date.now();
  if (!force && now - lastSave < SAVE_INTERVAL_MS) return;
  lastSave = now;
  pi.appendEntry(RALLY_SAVE_TYPE, runtime.serialize());
}

function idleStatus(): string {
  return "RALLY ready · /rally on";
}

/** Footer status while the race is on screen. */
function liveStatus(): string {
  return runtime ? runtime.statusLine() : idleStatus();
}

function openPanel(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!runtime || panelOpen) return;
  panelOpen = true;
  runtime.start();

  const tickOff = runtime.onTick(() => {
    const now = Date.now();
    if (now - statusThrottle < 200) return;
    statusThrottle = now;
    ctx.ui.setStatus(STATUS_KEY, liveStatus());
    save(pi);
  });

  void ctx.ui.custom<void>(
    (_tui, _theme, _kb, done) => {
      closePanel = () => done(undefined);
      panel!.attach(_tui);
      return panel as Component & { dispose?(): void };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "right-center",
        width: panelWidth(),
        maxHeight: "78%",
        margin: 1,
        // Keep keyboard focus in the editor: the panel is a spectator view.
        nonCapturing: true,
      },
      onHandle: (handle) => {
        panelHandle = handle;
      },
    },
  ).then(() => {
    tickOff();
    panelOpen = false;
    closePanel = null;
    panelHandle = null;
    panel?.dispose();
    runtime?.stop();
    ctx.ui.setStatus(STATUS_KEY, idleStatus());
  });
}

function panelWidth(): number {
  const columns = process.stdout.columns ?? 100;
  return Math.max(34, Math.min(52, Math.round(columns * 0.34)));
}

/** RPC has no overlays: expose the panel as plain widget lines instead. */
function startRpcPanel(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (rpcPanelOn || !runtime) return;
  rpcPanelOn = true;
  let ticks = 0;
  rpcTickOff = runtime.onTick(() => {
    if (++ticks % 4 !== 0) return;
    ctx.ui.setWidget(STATUS_KEY, runtime!.panelLines(52, runtime!.panelRows));
    save(pi);
  });
  runtime.start();
  ctx.ui.notify("Rally panel on (widget lines).", "info");
}

function stopRpcPanel(ctx: ExtensionContext): void {
  if (!rpcPanelOn) return;
  rpcPanelOn = false;
  rpcTickOff?.();
  rpcTickOff = null;
  ctx.ui.setWidget(STATUS_KEY, undefined);
  runtime?.stop();
  ctx.ui.setStatus(STATUS_KEY, idleStatus());
}

function stopPanel(): void {
  if (!panelOpen) return;
  closePanel?.();
}

export default function (pi: ExtensionAPI) {
  /* ------------------------------ session ------------------------------ */

  pi.on("session_start", async (_event, ctx) => {
    runtime?.stop();
    panel?.dispose();

    runtime = new RallyRuntime({ theme: DEFAULT_THEME_NAME, totalLaps: 3 });
    panel = new RallyPanel(runtime);
    panelOpen = false;
    closePanel = null;
    lastSave = 0;

    loadSave(ctx);

    // Opt-in: nothing on screen until the user asks for it.
    ctx.ui.setStatus(STATUS_KEY, idleStatus());
  });

  pi.on("session_shutdown", () => {
    save(pi, true);
    closePanel?.();
    runtime?.stop();
    panel?.dispose();
    runtime = null;
    panel = null;
    panelOpen = false;
    closePanel = null;
  });

  /* --------------------------- coding fuel ---------------------------- */

  pi.on("agent_start", () => {
    runtime?.addNitro(0.05);
  });

  pi.on("turn_start", () => {
    runtime?.addNitro(0.02);
  });

  pi.on("tool_execution_start", () => {
    runtime?.addNitro(0.035);
  });

  pi.on("tool_result", (event) => {
    if (!runtime) return;
    if (event.isError) runtime.penalty();
    else runtime.codeBoost(1);
  });

  pi.on("message_update", (event) => {
    if (!runtime) return;
    // Token throughput drives the car's speed: one streamed chunk is roughly
    // one token, so count the deltas (text, thinking and tool calls).
    const stream = event.assistantMessageEvent;
    if (
      stream &&
      (stream.type === "text_delta" || stream.type === "thinking_delta" || stream.type === "toolcall_delta") &&
      typeof stream.delta === "string"
    ) {
      runtime.onTokens(Math.max(1, Math.round(stream.delta.length / 3)));
    }
  });

  pi.on("input", (event) => {
    if (event.source === "interactive") runtime?.codeBoost(2);
  });

  /* ----------------------------- commands ----------------------------- */

  pi.registerCommand("rally", {
    description: "Step Code Rally: /rally [on|off|play|theme|size|stats|reset|help]",
    handler: async (args, ctx) => {
      if (!runtime) {
        ctx.ui.notify("Rally is not ready yet.", "error");
        return;
      }
      const sub = args.trim().toLowerCase();

      // Panel switch (default off).
      if (sub === "on" || sub === "bg on" || sub === "panel on") {
        if (ctx.mode === "rpc") {
          startRpcPanel(pi, ctx);
          return;
        }
        if (!isTui(ctx)) {
          ctx.ui.notify("The rally panel needs the interactive TUI.", "error");
          return;
        }
        if (panelOpen) {
          ctx.ui.notify("Rally panel is already open.", "info");
          return;
        }
        openPanel(pi, ctx);
        return;
      }

      if (sub === "off" || sub === "bg off" || sub === "panel off" || sub === "hide") {
        if (ctx.mode === "rpc") {
          stopRpcPanel(ctx);
          return;
        }
        stopPanel();
        return;
      }

      if (sub === "" || sub === "play") {
        if (!isTui(ctx)) {
          ctx.ui.notify("Rally needs the interactive TUI. Run `step` without -p.", "error");
          return;
        }
        if (runtime.playing) {
          ctx.ui.notify("Already racing!", "info");
          return;
        }
        // Hide the spectator panel while driving, restore it afterwards.
        panelHandle?.setHidden(true);
        await ctx.ui.custom<void>((_tui, _theme, _kb, done) => {
          const game = new RallyGame(runtime!, {
            onSave: () => save(pi, true),
            onExit: () => done(undefined),
          });
          return game;
        });
        panelHandle?.setHidden(false);
        save(pi, true);
        return;
      }

      if (sub.startsWith("theme")) {
        const name = sub.slice(5).trim() as ThemeName;
        if (!THEMES[name]) {
          ctx.ui.notify(`Themes: ${Object.keys(THEMES).join(", ")}`, "info");
          return;
        }
        runtime.setTheme(name);
        panel?.invalidate();
        ctx.ui.notify(`Rally theme: ${name}`, "info");
        return;
      }

      if (sub.startsWith("size")) {
        const rows = Number(sub.slice(4).trim());
        if (!Number.isFinite(rows) || rows < 12 || rows > 34) {
          ctx.ui.notify("Usage: /rally size <12-34> (panel height in rows)", "info");
          return;
        }
        runtime.setPanelRows(rows);
        panel?.invalidate();
        ctx.ui.notify(`Rally panel height: ${runtime.panelRows} rows`, "info");
        return;
      }

      if (sub === "stats") {
        const world = runtime.world;
        const stats = world.stats;
        ctx.ui.notify(
          [
            `LAP ${Math.min(world.lap, world.totalLaps)}/${world.totalLaps}`,
            `SPEED ${world.speedKmh} km/h · NITRO ${Math.round(world.nitro * 100)}%`,
            `SCORE ${Math.floor(stats.score)} · DISTANCE ${(stats.distance / 1000).toFixed(2)} km`,
            `OVERTAKES ${stats.overtakes} · CRASHES ${stats.crashes} · CODE BOOSTS ${stats.codeBoosts}`,
            `BEST LAP ${formatTime(stats.bestLapMs)} · LAST ${formatTime(stats.lastLapMs)}`,
          ].join("\n"),
          "info",
        );
        return;
      }

      if (sub === "reset") {
        runtime.restart();
        save(pi, true);
        ctx.ui.notify("Rally reset. Green flag!", "info");
        return;
      }

      ctx.ui.notify(
        [
          "/rally on         floating race panel on the right (default: off)",
          "/rally off        close the panel",
          "/rally            take the wheel fullscreen",
          "/rally theme      day | sunset | night",
          "/rally size 12-34 panel height in rows",
          "/rally stats      session race stats",
          "/rally reset      restart the race",
          "",
          "Coding fuels the car: tool calls, edits and streamed tokens add nitro.",
        ].join("\n"),
        "info",
      );
    },
  });
}
