export type RollingPoint = { tsMs: number; value: number };

export class RollingSeries {
  readonly #points: RollingPoint[] = [];

  constructor(readonly retentionMs: number) {
    if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
      throw new RangeError("RollingSeries retentionMs must be positive");
    }
  }

  get count(): number {
    return this.#points.length;
  }

  get latest(): RollingPoint | null {
    return this.#points.at(-1) ?? null;
  }

  add(point: RollingPoint): { accepted: boolean; previous: RollingPoint | null } {
    const previous = this.latest;
    if (!Number.isFinite(point.tsMs) || !Number.isFinite(point.value)) {
      throw new RangeError("Rolling point must contain finite values");
    }
    if (previous && point.tsMs < previous.tsMs) return { accepted: false, previous };
    this.#points.push(point);
    const minimum = point.tsMs - this.retentionMs;
    let drop = 0;
    while (drop < this.#points.length && this.#points[drop]!.tsMs < minimum) drop += 1;
    if (drop > 0) this.#points.splice(0, drop);
    return { accepted: true, previous };
  }

  valueAtOrBefore(tsMs: number): RollingPoint | null {
    let low = 0;
    let high = this.#points.length - 1;
    let match: RollingPoint | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const point = this.#points[middle]!;
      if (point.tsMs <= tsMs) {
        match = point;
        low = middle + 1;
      } else high = middle - 1;
    }
    return match;
  }
}

export type EwmaObservation = {
  zScore: number | null;
  baselineMean: number | null;
  baselineStdDev: number | null;
};

export class EwmaMoments {
  #mean = 0;
  #variance = 0;
  #lastTsMs: number | null = null;
  #count = 0;

  constructor(readonly halfLifeMs: number, readonly minimumStdDev = 1e-9) {
    if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) {
      throw new RangeError("EWMA half-life must be positive");
    }
  }

  observe(value: number, tsMs: number): EwmaObservation {
    const ready = this.#count >= 2 && this.#variance > this.minimumStdDev ** 2;
    const baselineStdDev = ready ? Math.sqrt(this.#variance) : null;
    const observation: EwmaObservation = {
      zScore: ready ? (value - this.#mean) / baselineStdDev! : null,
      baselineMean: this.#count > 0 ? this.#mean : null,
      baselineStdDev
    };

    if (this.#lastTsMs === null) {
      this.#mean = value;
      this.#variance = 0;
    } else {
      const elapsed = Math.max(1, tsMs - this.#lastTsMs);
      const alpha = 1 - Math.exp((-Math.LN2 * elapsed) / this.halfLifeMs);
      const difference = value - this.#mean;
      this.#mean += alpha * difference;
      this.#variance = (1 - alpha) * (this.#variance + alpha * difference * difference);
    }
    this.#lastTsMs = tsMs;
    this.#count += 1;
    return observation;
  }
}

export class TwoSidedCusum {
  #up = 0;
  #down = 0;

  constructor(readonly drift: number) {
    if (!Number.isFinite(drift) || drift < 0) throw new RangeError("CUSUM drift cannot be negative");
  }

  update(delta: number): { up: number; down: number } {
    this.#up = Math.max(0, this.#up + delta - this.drift);
    this.#down = Math.max(0, this.#down - delta - this.drift);
    return { up: this.#up, down: this.#down };
  }

  reset(): void {
    this.#up = 0;
    this.#down = 0;
  }
}
