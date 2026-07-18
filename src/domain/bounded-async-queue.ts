export type BoundedAsyncQueueState = "open" | "ended" | "failed";

export type BoundedAsyncQueueSnapshot = {
  label: string;
  capacity: number;
  depth: number;
  highWaterMark: number;
  overflowCount: number;
  state: BoundedAsyncQueueState;
};

export class BoundedAsyncQueueOverflowError extends Error {
  readonly code = "BOUNDED_ASYNC_QUEUE_OVERFLOW" as const;
  readonly label: string;
  readonly capacity: number;
  readonly highWaterMark: number;
  readonly overflowCount: number;

  constructor(snapshot: BoundedAsyncQueueSnapshot) {
    super(
      `${snapshot.label} overflowed at capacity ${snapshot.capacity} ` +
      `(high-water ${snapshot.highWaterMark}); processing halted without dropping silently`
    );
    this.name = "BoundedAsyncQueueOverflowError";
    this.label = snapshot.label;
    this.capacity = snapshot.capacity;
    this.highWaterMark = snapshot.highWaterMark;
    this.overflowCount = snapshot.overflowCount;
  }
}

type QueueWaiter<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
};

/**
 * Single-consumer, non-blocking producer queue. Producers never wait for
 * capacity: reaching the bound is a fatal, observable condition and queued
 * values are discarded so a consumer cannot act on a partial stream.
 */
export class BoundedAsyncQueue<T> {
  readonly #items: T[] = [];
  readonly #label: string;
  readonly #capacity: number;
  #waiter: QueueWaiter<T> | null = null;
  #state: BoundedAsyncQueueState = "open";
  #failure: unknown = null;
  #highWaterMark = 0;
  #overflowCount = 0;

  constructor(options: { label: string; capacity: number }) {
    if (options.label.trim().length === 0) throw new Error("Bounded queue label cannot be empty");
    if (!Number.isSafeInteger(options.capacity) || options.capacity <= 0) {
      throw new RangeError("Bounded queue capacity must be a positive safe integer");
    }
    this.#label = options.label;
    this.#capacity = options.capacity;
  }

  push(value: T): BoundedAsyncQueueSnapshot {
    if (this.#state !== "open") {
      throw new Error(`${this.#label} cannot accept values after it is ${this.#state}`);
    }
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter.resolve({ done: false, value });
      return this.snapshot();
    }
    if (this.#items.length >= this.#capacity) {
      this.#overflowCount += 1;
      const error = new BoundedAsyncQueueOverflowError({
        ...this.snapshot(),
        overflowCount: this.#overflowCount,
        state: "failed"
      });
      this.fail(error);
      throw error;
    }
    this.#items.push(value);
    this.#highWaterMark = Math.max(this.#highWaterMark, this.#items.length);
    return this.snapshot();
  }

  end(): BoundedAsyncQueueSnapshot {
    if (this.#state !== "open") return this.snapshot();
    this.#state = "ended";
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter.resolve({ done: true, value: undefined });
    }
    return this.snapshot();
  }

  /** Stop cleanly and discard backlog, used for explicit cancellation. */
  stop(): BoundedAsyncQueueSnapshot {
    if (this.#state === "failed") return this.snapshot();
    this.#items.splice(0);
    if (this.#state === "ended") return this.snapshot();
    return this.end();
  }

  /** Fail closed: queued values become unusable and the consumer is woken. */
  fail(error: unknown): BoundedAsyncQueueSnapshot {
    if (this.#state === "failed") return this.snapshot();
    this.#state = "failed";
    this.#failure = error;
    this.#items.splice(0);
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter.reject(error);
    }
    return this.snapshot();
  }

  async take(): Promise<IteratorResult<T>> {
    if (this.#items.length > 0) return { done: false, value: this.#items.shift()! };
    if (this.#state === "failed") throw this.#failure;
    if (this.#state === "ended") return { done: true, value: undefined };
    if (this.#waiter) throw new Error(`${this.#label} supports exactly one consumer`);
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  snapshot(): BoundedAsyncQueueSnapshot {
    return {
      label: this.#label,
      capacity: this.#capacity,
      depth: this.#items.length,
      highWaterMark: this.#highWaterMark,
      overflowCount: this.#overflowCount,
      state: this.#state
    };
  }
}
