import type { CanonicalEvent } from "../bus/events.js";
import {
  livePolymarketEvents,
  type PolymarketLiveOptions
} from "../ingest/polymarket/live.js";
import { replayCapturedPolymarketMessages } from "../ingest/polymarket/replay.js";
import {
  liveTxLineEvents,
  type TxLineLiveOptions
} from "../ingest/txline/live.js";
import { replayCapturedTxLineFrames } from "../ingest/txline/replay.js";
import type { MappingRegistry } from "../mapping/registry.js";
import { mergeCapturedSourcesByObservedTime } from "../replay/merge.js";

type SourceResult =
  | { index: number; result: IteratorResult<CanonicalEvent> }
  | { index: number; error: unknown };

function nextResult(
  index: number,
  iterator: AsyncIterator<CanonicalEvent>
): Promise<SourceResult> {
  return iterator.next().then(
    (result) => ({ index, result }),
    (error: unknown) => ({ index, error })
  );
}

/**
 * Arrival-order fan-in for continuously running canonical sources. At most one
 * unread iterator result per source is buffered here; callback-driven adapters
 * also enforce their own hard queue bounds. Any source failure, including an
 * adapter overflow, ends the shared source fail closed.
 */
export async function* fanInLiveCanonicalSources(
  sources: AsyncIterable<CanonicalEvent>[],
  options: { signal?: AbortSignal; stop?: () => void } = {}
): AsyncGenerator<CanonicalEvent> {
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<SourceResult>>(
    iterators.map((iterator, index) => [index, nextResult(index, iterator)])
  );
  try {
    while (pending.size > 0 && options.signal?.aborted !== true) {
      const item = await Promise.race(pending.values());
      if ("error" in item) throw item.error;
      if (item.result.done) {
        pending.delete(item.index);
        continue;
      }
      pending.set(item.index, nextResult(item.index, iterators[item.index]!));
      yield item.result.value;
    }
  } finally {
    // The live adapters receive the controller tied to stop, so cancellation
    // happens before awaiting iterator cleanup.
    options.stop?.();
    await Promise.allSettled(iterators.map(async (iterator) => iterator.return?.()));
  }
}

export type CapturedPaperReplaySourceOptions = {
  txlineOddsFramesPath: string;
  txlineScoresFramesPath: string;
  polymarketMessagesPath: string;
  registry: MappingRegistry;
  speed: number;
  signal?: AbortSignal;
  onInputHash?: (
    input: "txlineOdds" | "txlineScores" | "polymarketMessages",
    hash: string
  ) => void;
};

/** Deterministic capture-order replay assembled from the three official feeds. */
export function capturedPaperReplaySource(
  options: CapturedPaperReplaySourceOptions
): AsyncIterable<CanonicalEvent> {
  return mergeCapturedSourcesByObservedTime([
    replayCapturedTxLineFrames(options.txlineOddsFramesPath, {
      ...(options.onInputHash === undefined ? {} : {
        onInputHash: (hash: string) => options.onInputHash!("txlineOdds", hash)
      })
    }),
    replayCapturedTxLineFrames(options.txlineScoresFramesPath, {
      ...(options.onInputHash === undefined ? {} : {
        onInputHash: (hash: string) => options.onInputHash!("txlineScores", hash)
      })
    }),
    replayCapturedPolymarketMessages(options.polymarketMessagesPath, options.registry, {
      ...(options.onInputHash === undefined ? {} : {
        onInputHash: (hash: string) => options.onInputHash!("polymarketMessages", hash)
      })
    })
  ], {
    speed: options.speed,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
}

export type CapturedPaperReplaySnapshotSourceOptions = {
  eventJson: readonly string[];
  speed: number;
  signal?: AbortSignal;
};

/**
 * Replay a preflight-sealed canonical snapshot. The strings are copied before
 * iteration, so the runtime never reopens mutable capture paths after the
 * model/network boundary.
 */
export function capturedPaperReplaySnapshotSource(
  options: CapturedPaperReplaySnapshotSourceOptions
): AsyncIterable<CanonicalEvent> {
  const eventJson = [...options.eventJson];
  const events = async function* (): AsyncGenerator<CanonicalEvent> {
    for (const [index, value] of eventJson.entries()) {
      try {
        const event = JSON.parse(value) as unknown;
        if (event === null || typeof event !== "object" || typeof (event as { kind?: unknown }).kind !== "string") {
          throw new Error("canonical event must be an object with a kind");
        }
        yield event as CanonicalEvent;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid sealed canonical event at index ${index}: ${detail}`);
      }
    }
  };
  return mergeCapturedSourcesByObservedTime([events()], {
    speed: options.speed,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
}

export type LivePaperEventSourceOptions = {
  txline: Omit<TxLineLiveOptions, "stream" | "signal">;
  polymarket: Omit<PolymarketLiveOptions, "signal">;
  signal?: AbortSignal;
};

/**
 * Live TXLine odds + scores and Polymarket books, joined into the same
 * AsyncIterable consumed by runPaperSession. The runtime receives no mode
 * flag and therefore cannot distinguish this source from captured replay.
 */
export async function* livePaperEventSource(
  options: LivePaperEventSourceOptions
): AsyncGenerator<CanonicalEvent> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    yield* fanInLiveCanonicalSources([
      liveTxLineEvents({ ...options.txline, stream: "odds", signal: controller.signal }),
      liveTxLineEvents({ ...options.txline, stream: "scores", signal: controller.signal }),
      livePolymarketEvents({ ...options.polymarket, signal: controller.signal })
    ], {
      signal: controller.signal,
      stop: () => controller.abort()
    });
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", abort);
  }
}
