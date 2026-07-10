export type SseMessage = {
  id: string | null;
  event: string | null;
  data: string;
  retryMs: number | null;
};

export type IngestEnvelope = {
  stream: string;
  observedTsMs: number;
  message: SseMessage;
};

export function parseSseBlock(block: string): SseMessage | null {
  let id: string | null = null;
  let event: string | null = null;
  let retryMs: number | null = null;
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine === "" || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
    const rawValue = separator === -1 ? "" : rawLine.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "retry") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0) retryMs = parsed;
    }
  }

  if (id === null && event === null && data.length === 0) return null;
  return { id, event, data: data.join("\n"), retryMs };
}

export async function* decodeSse(
  body: ReadableStream<Uint8Array>,
  stream: string,
  now: () => number = Date.now
): AsyncGenerator<IngestEnvelope> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.match(/\r?\n\r?\n/);
      while (boundary?.index !== undefined) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const message = parseSseBlock(block);
        if (message !== null) yield { stream, observedTsMs: now(), message };
        boundary = buffer.match(/\r?\n\r?\n/);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function capturedFrameToEnvelope(frame: {
  receivedAt: string;
  stream: string;
  rawFrame: string;
}): IngestEnvelope | null {
  const observedTsMs = Date.parse(frame.receivedAt);
  if (!Number.isFinite(observedTsMs)) throw new Error(`Invalid captured receivedAt: ${frame.receivedAt}`);
  const message = parseSseBlock(frame.rawFrame);
  return message === null ? null : { stream: frame.stream, observedTsMs, message };
}
