/**
 * Rally world: car physics, traffic, laps, scoring and the "code fuel" nitro
 * system. One world instance is shared by the background widget and the
 * fullscreen game, so the race keeps going while you write code.
 */

import type { Sprite, SpriteBank } from "./sprites.ts";
import { PLAYER_Z } from "./engine.ts";
import { SEGMENT_LENGTH, type Track } from "./track.ts";

export const MAX_SPEED = SEGMENT_LENGTH * 60; // one segment per frame at 60fps
const ACCEL = MAX_SPEED / 4.5;
const BRAKING = -MAX_SPEED;
const COAST_DECEL = -MAX_SPEED / 7;
const OFF_ROAD_DECEL = -MAX_SPEED / 1.4;
const OFF_ROAD_LIMIT = MAX_SPEED / 3.4;
const CENTRIFUGAL = 0.22;
const NITRO_MULTIPLIER = 1.34;
const NITRO_DRAIN = 0.25; // bar per second
const NITRO_REFILL = 0.06; // bar per second while driving clean
const CAR_LENGTH = 700;
const TOP_SPEED_KMH = 320;
const DEFAULT_LAPS = 3;

export interface InputState {
  steer: number;
  throttle: number;
  brake: number;
}

export interface TrafficCar {
  z: number;
  offset: number;
  targetOffset: number;
  speed: number;
  sprite: Sprite;
  changeCooldown: number;
  wasAhead: boolean;
}

export interface RallyStats {
  score: number;
  distance: number;
  laps: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  overtakes: number;
  crashes: number;
  topSpeed: number;
  codeBoosts: number;
  finishedRaces: number;
}

export function emptyStats(): RallyStats {
  return {
    score: 0,
    distance: 0,
    laps: 0,
    bestLapMs: null,
    lastLapMs: null,
    overtakes: 0,
    crashes: 0,
    topSpeed: 0,
    codeBoosts: 0,
    finishedRaces: 0,
  };
}

export interface SaveState {
  version: 1;
  stats: RallyStats;
  position: number;
  playerX: number;
  speed: number;
  lap: number;
  lapTime: number;
  totalTime: number;
  nitro: number;
  auto: boolean;
  totalLaps: number;
}

export interface WorldOptions {
  totalLaps?: number;
  auto?: boolean;
  trafficCount?: number;
}

export class RallyWorld {
  readonly track: Track;
  readonly sprites: SpriteBank;
  readonly totalLaps: number;

  position = 0;
  playerX = 0;
  speed = 0;
  lap = 1;
  lapTime = 0;
  totalTime = 0;
  nitro = 0.35;
  nitroTimer = 0;
  crashTimer = 0;
  crashSpeed = 0;
  shake = 0;
  steerVisual = 0;
  braking = false;
  offRoad = false;
  skyOffset = 0;
  clock = 0;
  auto: boolean;
  finished = false;
  stats: RallyStats = emptyStats();
  traffic: TrafficCar[] = [];
  input: InputState = { steer: 0, throttle: 0, brake: 0 };

  constructor(track: Track, sprites: SpriteBank, options: WorldOptions = {}) {
    this.track = track;
    this.sprites = sprites;
    this.totalLaps = options.totalLaps ?? DEFAULT_LAPS;
    this.auto = options.auto ?? true;
    this.spawnTraffic(options.trafficCount ?? 11);
  }

  /* ---------------------------------------------------------------- *
   * Setup / persistence
   * ---------------------------------------------------------------- */

  spawnTraffic(count: number): void {
    this.traffic = [];
    const trackLength = this.track.length;
    for (let i = 0; i < count; i++) {
      const lane = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
      this.traffic.push({
        z: ((i + 0.5) / count) * trackLength + Math.random() * 400,
        offset: lane * 0.7 + (Math.random() - 0.5) * 0.16,
        targetOffset: lane * 0.7,
        speed: MAX_SPEED * (0.42 + Math.random() * 0.3),
        sprite: Math.random() < 0.5 ? this.sprites.traffic : this.sprites.trafficAlt,
        changeCooldown: Math.random() * 3,
        wasAhead: false,
      });
    }
  }

  serialize(): SaveState {
    return {
      version: 1,
      stats: { ...this.stats },
      position: this.position,
      playerX: this.playerX,
      speed: this.speed,
      lap: this.lap,
      lapTime: this.lapTime,
      totalTime: this.totalTime,
      nitro: this.nitro,
      auto: this.auto,
      totalLaps: this.totalLaps,
    };
  }

  restore(state: SaveState): void {
    this.stats = { ...emptyStats(), ...state.stats };
    this.position = state.position % this.track.length;
    this.playerX = state.playerX;
    this.speed = state.speed;
    this.lap = state.lap;
    this.lapTime = state.lapTime;
    this.totalTime = state.totalTime;
    this.nitro = state.nitro;
    this.auto = state.auto;
    this.finished = false;
    this.crashTimer = 0;
    this.nitroTimer = 0;
  }

  restart(): void {
    this.position = 0;
    this.playerX = 0;
    this.speed = 0;
    this.lap = 1;
    this.lapTime = 0;
    this.nitro = 0.35;
    this.nitroTimer = 0;
    this.crashTimer = 0;
    this.finished = false;    this.stats.score = 0;
    this.stats.distance = 0;
    this.stats.laps = 0;
    this.stats.overtakes = 0;
    this.stats.crashes = 0;
    this.spawnTraffic(11);
  }

  /* ---------------------------------------------------------------- *
   * External "code fuel" hooks
   * ---------------------------------------------------------------- */

  /** Refill a slice of the nitro bar. Called from coding activity events. */
  addNitro(amount: number): void {
    this.nitro = Math.min(1, this.nitro + amount);
  }

  /** A code event happened: nitro, score and a short speed kick. */
  codeBoost(amount = 1): void {
    this.stats.codeBoosts += amount;
    this.stats.score += 25 * amount;
    this.addNitro(0.05 * amount);
    this.speed = Math.min(this.maxSpeed(), this.speed + MAX_SPEED * 0.05 * amount);
    if (this.nitro > 0.3 && this.crashTimer <= 0) this.nitroTimer = Math.max(this.nitroTimer, 0.55);
  }

  maxSpeed(): number {
    let max = MAX_SPEED;
    if (this.nitroTimer > 0) max *= NITRO_MULTIPLIER;
    if (this.offRoad) max = Math.min(max, OFF_ROAD_LIMIT * (this.nitroTimer > 0 ? 1.25 : 1));
    return max;
  }

  get speedKmh(): number {
    return Math.round((this.speed / MAX_SPEED) * TOP_SPEED_KMH);
  }

  get playerZ(): number {
    return this.position + PLAYER_Z;
  }

  /* ---------------------------------------------------------------- *
   * Simulation
   * ---------------------------------------------------------------- */

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    this.totalTime += dt;
    this.lapTime += dt;

    if (this.auto) this.autopilot();
    // Traction assist runs for the human driver too: it never fights your
    // steering, but it will not let the car stay out on the grass.
    this.applyTractionAssist();

    const speedPercent = this.speed / MAX_SPEED;
    const trackLength = this.track.length;
    const playerSegment = this.track.segments[Math.floor(this.playerZ / SEGMENT_LENGTH) % this.track.segments.length]!;

    // Steering + centrifugal drift.
    const steerStep = dt * 2.1 * Math.max(this.offRoad ? 0.55 : 0.25, speedPercent);
    this.playerX += this.input.steer * steerStep;
    this.playerX -= dt * speedPercent * playerSegment.curve * CENTRIFUGAL;
    this.playerX = Math.max(-2.2, Math.min(2.2, this.playerX));
    this.offRoad = Math.abs(this.playerX) > 1;
    // Smoothed visual steering for the car sprite.
    const targetVisual = Math.max(-1, Math.min(1, this.input.steer - playerSegment.curve * 0.08));
    this.steerVisual += (targetVisual - this.steerVisual) * Math.min(1, dt * 8);

    // Throttle / brake.
    if (this.crashTimer > 0) {
      // Scrub speed but keep rolling: a crash should not stop the car dead.
      this.crashTimer = Math.max(0, this.crashTimer - dt);
      const rollFloor = this.crashSpeed * 0.22;
      this.speed = Math.max(rollFloor, this.speed - MAX_SPEED * 0.8 * dt);
    } else if (this.input.brake > 0) {
      this.speed = Math.max(0, this.speed + BRAKING * this.input.brake * dt);
    } else if (this.input.throttle > 0) {
      this.speed += ACCEL * this.input.throttle * dt;
    } else {
      this.speed = Math.max(0, this.speed + COAST_DECEL * dt);
    }
    if (this.offRoad && this.speed > OFF_ROAD_LIMIT) {
      this.speed = Math.max(OFF_ROAD_LIMIT, this.speed + OFF_ROAD_DECEL * dt);
      this.shake = Math.min(1, this.shake + dt * 2);
    } else {
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.speed = Math.min(this.speed, this.maxSpeed());

    // Nitro.
    if (this.nitroTimer > 0) {
      this.nitroTimer = Math.max(0, this.nitroTimer - dt);
      this.nitro = Math.max(0, this.nitro - NITRO_DRAIN * dt);
      if (this.nitro <= 0) this.nitroTimer = 0;
    } else if (!this.offRoad && this.crashTimer <= 0) {
      this.nitro = Math.min(1, this.nitro + NITRO_REFILL * (0.4 + speedPercent) * dt);
    }

    // Advance along the track and detect the lap wrap.
    this.position += this.speed * dt;
    if (this.position >= trackLength) {
      this.position -= trackLength;
      this.completeLap();
    }

    this.updateTraffic(dt);
    this.checkCollisions();

    // Scoring: distance in game meters (10 world units), points scale with it.
    this.stats.distance += (this.speed * dt) / 10;
    this.stats.score += ((this.speed * dt) / 10) * 0.1;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.speedKmh);

    // Sky parallax follows the current curve.
    this.skyOffset += playerSegment.curve * speedPercent * dt * 26;
  }

  private completeLap(): void {
    const lapMs = this.lapTime * 1000;
    this.stats.lastLapMs = lapMs;
    if (this.stats.bestLapMs === null || lapMs < this.stats.bestLapMs) this.stats.bestLapMs = lapMs;
    this.stats.laps = this.lap;
    this.lap++;
    this.lapTime = 0;
    this.stats.score += 500;
    this.addNitro(0.25);
    if (this.lap > this.totalLaps) {
      this.finished = true;
      this.stats.finishedRaces += 1;
      this.lap = this.totalLaps;
    }
  }

  private updateTraffic(dt: number): void {
    const trackLength = this.track.length;
    const playerZ = this.playerZ;
    for (const car of this.traffic) {
      car.z += car.speed * dt;
      if (car.z >= trackLength) car.z -= trackLength;
      car.changeCooldown -= dt;
      // Never drift into the player's path: freeze a lane change (including one
      // already in progress) that would end up alongside them.
      if (
        Math.abs(playerZ - car.z) < 14000 &&
        Math.abs(this.playerX - car.targetOffset) < 0.62 &&
        Math.abs(this.playerX - car.offset) > 0.62
      ) {
        car.targetOffset = car.offset;
        car.changeCooldown = Math.max(car.changeCooldown, 0.4);
      }
      if (car.changeCooldown <= 0) {
        // Look for a car just ahead in the same lane and move aside.
        const ahead = car.z + 1200;
        const blocked = this.traffic.some(
          (other) =>
            other !== car &&
            Math.abs(other.z - ahead) < 1400 &&
            Math.abs(other.offset - car.offset) < 0.5,
        );
        const playerClose = Math.abs(playerZ - car.z) < 12000 && Math.abs(this.playerX - car.offset) < 1.5;
        if (blocked || playerClose) {
          // Move away from whatever is in the way: the player when they are
          // close, otherwise whatever is blocking this car.
          const awayFrom = playerClose
            ? Math.sign(this.playerX - car.offset || 1)
            : car.offset <= 0
              ? 1
              : -1;
          car.targetOffset = Math.max(-0.75, Math.min(0.75, car.offset + awayFrom * 0.6));
          car.changeCooldown = 1.6 + Math.random();
        }
      }
      car.offset += Math.sign(car.targetOffset - car.offset) * Math.min(Math.abs(car.targetOffset - car.offset), dt * 0.5);
    }
  }

  private checkCollisions(): void {
    if (this.crashTimer > 0) return;
    const playerZ = this.playerZ;
    const trackLength = this.track.length;
    for (const car of this.traffic) {
      let delta = car.z - playerZ;
      if (delta > trackLength / 2) delta -= trackLength;
      if (delta < -trackLength / 2) delta += trackLength;

      // Swept test: a fast car can cross a whole car between ticks, so treat
      // "was ahead, now behind" as an overlap too.
      const overlap = Math.abs(delta) < CAR_LENGTH;
      const crossed = car.wasAhead && delta <= 0 && delta > -CAR_LENGTH;
      const lateral = Math.abs(car.offset - this.playerX);

      // A touch only counts when the cars really overlap: lane-adjacent
      // passing has to be possible, so the lateral band is well under a lane.
      if (lateral < 0.5 && (overlap || crossed)) {
        this.crashTimer = 0.65;
        this.crashSpeed = this.speed;
        this.stats.crashes += 1;
        this.stats.score = Math.max(0, this.stats.score - 150);
        this.speed = Math.max(0, this.speed * 0.35);
        this.nitroTimer = 0;
        // Pull back towards the middle of the road: never kick the car off it.
        this.playerX *= 0.6;
        car.wasAhead = false;
        return;
      }
      // Overtake: the car was ahead last frame and is behind now.
      const ahead = delta > 0;
      if (car.wasAhead && !ahead && lateral < 1.2) {
        this.stats.overtakes += 1;
        this.stats.score += 75;
        this.addNitro(0.06);
      }
      car.wasAhead = ahead;
    }
  }

  /**
   * Traction assist. Past the shoulder margin it blends a corrective steer into
   * whatever the driver (human or autopilot) asked for, ramping up as the car
   * gets closer to the edge so it always wins there - but leaves the driver in
   * charge while the car is on the road.
   */
  private applyTractionAssist(): void {
    const margin = 0.8;
    const magnitude = Math.abs(this.playerX);
    if (magnitude <= margin) return;
    const overshoot = magnitude - margin;
    const correction = -Math.sign(this.playerX) * Math.min(1, 0.5 + overshoot * 8);
    const blend = Math.min(1, 0.3 + overshoot * 2.5);
    this.input.steer = this.input.steer * (1 - blend) + correction * blend;
  }

  /** Simple AI driver used while the widget is the active view. */
  private autopilot(): void {
    if (this.finished) {
      this.input.throttle = 0.35;
      this.input.brake = 0;
      this.input.steer = Math.sin(this.clock) * 0.2;
      return;
    }
    const segments = this.track.segments;
    const count = segments.length;
    const baseIndex = Math.floor(this.position / SEGMENT_LENGTH) % count;

    // Aim for the inside of the curve ahead: centrifugal drift pushes the car
    // to the outside, so the racing line has to lean the other way.
    let curveAhead = 0;
    for (let i = 4; i < 26; i++) {
      curveAhead += segments[(baseIndex + i) % count]!.curve;
    }
    curveAhead /= 22;
    const racingLine = Math.max(-0.7, Math.min(0.7, curveAhead * 0.12));

    // Pick the lateral slot that stays closest to the racing line while
    // keeping clear of traffic ahead. Weight by time-to-impact, so a car we are
    // closing on fast matters far more than one we are merely near.
    const playerZ = this.playerZ;
    const trackLength = this.track.length;
    const lookAhead = 16000;
    let closingOnAhead = 0;
    // Adaptive cruise only reacts to cars we would actually hit - i.e. those in
    // our own lane - not to traffic we are safely passing in the next one.
    for (const car of this.traffic) {
      let delta = car.z - playerZ;
      if (delta > trackLength / 2) delta -= trackLength;
      if (delta < -trackLength / 2) delta += trackLength;
      if (delta <= 0 || delta > lookAhead) continue;
      if (Math.abs(car.offset - this.playerX) >= 0.62) continue;
      const closing = Math.max(1, this.speed - car.speed);
      closingOnAhead = Math.max(closingOnAhead, Math.max(0, 1 - delta / closing / 2.5));
    }
    const candidates = [-0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85];
    // Hard rule: a slot we would pass through closer than this is not a slot.
    const SAFE_LATERAL = 0.62;
    let target = racingLine;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      let score = -Math.abs(candidate - racingLine) * 3 - Math.abs(candidate) * 0.6;
      let unsafe = 0;
      for (const car of this.traffic) {
        let delta = car.z - playerZ;
        if (delta > trackLength / 2) delta -= trackLength;
        if (delta < -trackLength / 2) delta += trackLength;
        if (delta <= 0 || delta > lookAhead) continue;
        const lateral = Math.abs(car.offset - candidate);
        const closing = Math.max(1, this.speed - car.speed);
        const timeToImpact = delta / closing;
        const urgency = Math.max(0, 1 - timeToImpact / 2.5);
        if (lateral < 1) {
          score -= urgency * urgency * 40 * (1.3 - lateral);
        }
        if (lateral < SAFE_LATERAL) {
          unsafe = Math.max(unsafe, urgency);
        }
      }
      // Soft-hard: heavily penalise unsafe slots, but never make them impossible
      // so a wall of traffic still resolves to the least-bad line.
      score -= unsafe * unsafe * 400;
      if (score > bestScore) {
        bestScore = score;
        target = candidate;
      }
    }

    // The traction assist applied above owns edge recovery, so the autopilot
    // only has to aim for the line it wants.
    this.input.steer = Math.max(-1, Math.min(1, (target - this.playerX) * 2.2));

    // Driver assist 2 - adaptive cruise: match the speed of whatever is ahead
    // in our lane instead of rear-ending it, and brake if impact is imminent.
    let throttle = Math.abs(curveAhead) > 5 ? 0.6 : 1;
    let brake = 0;
    if (closingOnAhead > 0) {
      throttle *= Math.max(0.22, 1 - closingOnAhead);
      // urgency > 0.76 means under ~0.6s to impact: get on the brakes.
      if (closingOnAhead > 0.76) brake = 1;
    }
    this.input.throttle = throttle;
    this.input.brake = brake;
    this.braking = throttle < 1 || brake > 0;

    // Keep the bar useful: auto-ignite when there is fuel to burn.
    if (this.nitro > 0.45 && this.crashTimer <= 0 && !this.offRoad) {
      this.nitroTimer = Math.max(this.nitroTimer, 0.4);
    }
  }

  /** Scene cars in the shape the renderer expects. */
  sceneCars(): Array<{ z: number; offset: number; sprite: Sprite }> {
    return this.traffic.map((car) => ({ z: car.z, offset: car.offset, sprite: car.sprite }));
  }
}

export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "--:--.--";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
