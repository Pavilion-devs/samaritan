import type { CanonicalEvent } from "../bus/events.js";

export type ReplayClock = {
  nowMs: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type MergeReplayOptions = {
  speed: number;
  signal?: AbortSignal;
  clock?: ReplayClock;
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

const defaultClock: ReplayClock = { nowMs: Date.now, sleep: defaultSleep };

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

type Head = {
  index: number;
  event: CanonicalEvent;
};

function compareHeads(left: Head, right: Head): number {
  return (
    left.event.sourceTsMs - right.event.sourceTsMs ||
    left.event.observedTsMs - right.event.observedTsMs ||
    left.event.eventId.localeCompare(right.event.eventId) ||
    left.index - right.index
  );
}

function compareObservedHeads(left: Head, right: Head): number {
  return (
    left.event.observedTsMs - right.event.observedTsMs ||
    left.event.sourceTsMs - right.event.sourceTsMs ||
    left.event.eventId.localeCompare(right.event.eventId) ||
    left.index - right.index
  );
}

export async function* mergeReplaySources(
  sources: AsyncIterable<CanonicalEvent>[],
  options: MergeReplayOptions
): AsyncGenerator<CanonicalEvent> {
  if (sources.length === 0) return;
  if (!(options.speed > 0) && options.speed !== Number.POSITIVE_INFINITY) {
    throw new RangeError("Replay speed must be positive or Infinity");
  }
  const clock = options.clock ?? defaultClock;
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  const lastSourceTs = new Array<number | null>(sources.length).fill(null);
  const heads: Head[] = [];
  let firstEventTsMs: number | null = null;
  let firstWallTsMs: number | null = null;

  try {
    const initial = await Promise.all(iterators.map((iterator) => iterator.next()));
    for (const [index, result] of initial.entries()) {
      if (!result.done) heads.push({ index, event: result.value });
    }
    while (heads.length > 0 && !isAborted(options.signal)) {
      heads.sort(compareHeads);
      const head = heads.shift()!;
      const previous = lastSourceTs[head.index] ?? null;
      if (previous !== null && head.event.sourceTsMs < previous) {
        throw new Error(
          `Replay source ${head.index} moved backward from ${previous} to ${head.event.sourceTsMs}`
        );
      }
      lastSourceTs[head.index] = head.event.sourceTsMs;
      if (firstEventTsMs === null) {
        firstEventTsMs = head.event.sourceTsMs;
        firstWallTsMs = clock.nowMs();
      }
      if (options.speed !== Number.POSITIVE_INFINITY) {
        const targetElapsed = (head.event.sourceTsMs - firstEventTsMs) / options.speed;
        const actualElapsed = clock.nowMs() - firstWallTsMs!;
        await clock.sleep(Math.max(0, targetElapsed - actualElapsed), options.signal);
        if (isAborted(options.signal)) break;
      }
      yield head.event;
      const next = await iterators[head.index]!.next();
      if (!next.done) heads.push({ index: head.index, event: next.value });
    }
  } finally {
    await Promise.all(
      iterators.map(async (iterator) => {
        if (iterator.return) await iterator.return().catch(() => undefined);
      })
    );
  }
}

export async function* mergeCapturedSourcesByObservedTime(
  sources: AsyncIterable<CanonicalEvent>[],
  options: MergeReplayOptions
): AsyncGenerator<CanonicalEvent> {
  if (sources.length === 0) return;
  if (!(options.speed > 0) && options.speed !== Number.POSITIVE_INFINITY) {
    throw new RangeError("Replay speed must be positive or Infinity");
  }
  const clock = options.clock ?? defaultClock;
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  const lastObservedTs = new Array<number | null>(sources.length).fill(null);
  const heads: Head[] = [];
  let firstEventTsMs: number | null = null;
  let firstWallTsMs: number | null = null;

  try {
    const initial = await Promise.all(iterators.map((iterator) => iterator.next()));
    for (const [index, result] of initial.entries()) {
      if (!result.done) heads.push({ index, event: result.value });
    }
    while (heads.length > 0 && !isAborted(options.signal)) {
      heads.sort(compareObservedHeads);
      const head = heads.shift()!;
      const previous = lastObservedTs[head.index] ?? null;
      if (previous !== null && head.event.observedTsMs < previous) {
        throw new Error(
          `Captured replay source ${head.index} observation moved backward from ${previous} to ${head.event.observedTsMs}`
        );
      }
      lastObservedTs[head.index] = head.event.observedTsMs;
      if (firstEventTsMs === null) {
        firstEventTsMs = head.event.observedTsMs;
        firstWallTsMs = clock.nowMs();
      }
      if (options.speed !== Number.POSITIVE_INFINITY) {
        const targetElapsed = (head.event.observedTsMs - firstEventTsMs) / options.speed;
        const actualElapsed = clock.nowMs() - firstWallTsMs!;
        await clock.sleep(Math.max(0, targetElapsed - actualElapsed), options.signal);
        if (isAborted(options.signal)) break;
      }
      yield head.event;
      const next = await iterators[head.index]!.next();
      if (!next.done) heads.push({ index: head.index, event: next.value });
    }
  } finally {
    await Promise.all(
      iterators.map(async (iterator) => {
        if (iterator.return) await iterator.return().catch(() => undefined);
      })
    );
  }
}
