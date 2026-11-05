/**
 * Pixel framebuffer. One entry per pixel; a pixel is one terminal column wide
 * and half a character row tall, which makes it square on a terminal.
 */

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint16Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixels = new Uint16Array(this.width * this.height);
  }

  clear(color: number): void {
    this.pixels.fill(color);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  set(x: number, y: number, color: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color;
  }

  get(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[y * this.width + x]!;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx++) this.pixels[row + xx] = color;
    }
  }

  /** Horizontal 1px line. */
  hLine(x0: number, x1: number, y: number, color: number): void {
    if (y < 0 || y >= this.height) return;
    const from = Math.max(0, Math.floor(Math.min(x0, x1)));
    const to = Math.min(this.width - 1, Math.floor(Math.max(x0, x1)));
    const row = y * this.width;
    for (let x = from; x <= to; x++) this.pixels[row + x] = color;
  }

  /** Vertical 1px line. */
  vLine(x: number, y0: number, y1: number, color: number): void {
    if (x < 0 || x >= this.width) return;
    const from = Math.max(0, Math.floor(Math.min(y0, y1)));
    const to = Math.min(this.height - 1, Math.floor(Math.max(y0, y1)));
    for (let y = from; y <= to; y++) this.pixels[y * this.width + x] = color;
  }

  /** Hollow rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, color: number): void {
    this.hLine(x, x + w - 1, y, color);
    this.hLine(x, x + w - 1, y + h - 1, color);
    this.vLine(x, y, y + h - 1, color);
    this.vLine(x + w - 1, y, y + h - 1, color);
  }

  /**
   * Trapezoid with horizontal top/bottom edges - the shape every road segment,
   * rumble strip and lane marker projects into.
   */
  fillTrapezoid(
    yTop: number,
    yBottom: number,
    leftTop: number,
    rightTop: number,
    leftBottom: number,
    rightBottom: number,
    color: number,
  ): void {
    let y0 = Math.round(yTop);
    let y1 = Math.round(yBottom);
    if (y1 < y0) {
      const ty = y0;
      y0 = y1;
      y1 = ty;
    }
    if (y1 < 0 || y0 >= this.height) return;
    const span = y1 - y0 || 1;
    const lt = leftTop;
    const rt = rightTop;
    const lb = leftBottom;
    const rb = rightBottom;
    for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y++) {
      const t = (y - y0) / span;
      const left = Math.round(lt + (lb - lt) * t);
      const right = Math.round(rt + (rb - rt) * t);
      const from = Math.max(0, left);
      const to = Math.min(this.width - 1, right);
      const row = y * this.width;
      for (let x = from; x <= to; x++) this.pixels[row + x] = color;
    }
  }

  /**
   * 1px line (Bresenham). `clipBottom` drops pixels at or below that row, which
   * is how road markings stay hidden behind a crest ahead.
   */
  drawLine(x0: number, y0: number, x1: number, y1: number, color: number, clipBottom = this.height): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    // Guard against pathological input looping forever.
    for (let steps = 0; steps <= dx + dy + 2; steps++) {
      if (iy0 < clipBottom) this.set(ix0, iy0, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  /** Nearest-neighbor sprite blit with bottom clipping. */  blit(
    sprite: { width: number; height: number; pixels: Uint16Array },
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    clipBottom: number,
    transparent: number,
    remap?: (color: number) => number,
  ): void {
    if (destW <= 0 || destH <= 0) return;
    const x0 = Math.round(destX);
    const y0 = Math.round(destY);
    const x1 = x0 + Math.round(destW);
    const y1 = Math.min(Math.round(destY + destH), clipBottom);
    if (y1 <= y0) return;
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      const sy = Math.floor(((y - y0) / destH) * sprite.height);
      if (sy < 0 || sy >= sprite.height) continue;
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        const sx = Math.floor(((x - x0) / destW) * sprite.width);
        if (sx < 0 || sx >= sprite.width) continue;
        const source = sprite.pixels[sy * sprite.width + sx]!;
        if (source === transparent) continue;
        this.pixels[y * this.width + x] = remap ? remap(source) : source;
      }
    }
  }
}
