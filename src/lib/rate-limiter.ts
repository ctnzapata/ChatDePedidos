export interface RateLimitDecision {
  readonly allowed: boolean;
  /** true solo en el primer rechazo de la ventana, para avisar al usuario una sola vez. */
  readonly firstRejection: boolean;
}

const MAX_TRACKED_KEYS = 10_000;

interface Bucket {
  readonly timestamps: readonly number[];
  readonly notified: boolean;
}

/** Límite en memoria por clave (p. ej. por cliente) con ventana deslizante. */
export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.now();
    if (this.buckets.size > MAX_TRACKED_KEYS) this.pruneIdle(now);
    const previous = this.buckets.get(key);
    const recent = (previous?.timestamps ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length < this.limit) {
      this.buckets.set(key, { timestamps: [...recent, now], notified: false });
      return { allowed: true, firstRejection: false };
    }
    const firstRejection = !(previous?.notified ?? false);
    this.buckets.set(key, { timestamps: recent, notified: true });
    return { allowed: false, firstRejection };
  }

  /** Olvida las claves sin actividad reciente para que la memoria no crezca sin límite. */
  private pruneIdle(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.timestamps.every((t) => now - t >= this.windowMs)) this.buckets.delete(key);
    }
  }
}
