import type { CanonicalEvent } from "./events.js";

export type EventHandler = (event: CanonicalEvent) => void | Promise<void>;

export class CanonicalEventBus {
  readonly #handlers = new Set<EventHandler>();
  #tail: Promise<void> = Promise.resolve();

  subscribe(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  publish(event: CanonicalEvent): Promise<void> {
    const dispatch = this.#tail.then(async () => {
      for (const handler of this.#handlers) await handler(event);
    });
    this.#tail = dispatch.catch(() => undefined);
    return dispatch;
  }

  async consume(source: AsyncIterable<CanonicalEvent>): Promise<number> {
    let count = 0;
    for await (const event of source) {
      await this.publish(event);
      count += 1;
    }
    return count;
  }
}
