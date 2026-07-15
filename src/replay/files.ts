import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import parserStream from "stream-json";
import pick from "stream-json/filters/pick.js";
import streamArray from "stream-json/streamers/stream-array.js";

export type ReadNdjsonOptions = {
  /** Receives the SHA-256 of the exact bytes consumed after a complete scan. */
  onSha256?: (hash: string) => void;
};

export async function* readNdjson<T>(
  path: string,
  options: ReadNdjsonOptions = {}
): AsyncGenerator<T> {
  const input = createReadStream(path);
  const hash = options.onSha256 === undefined ? null : createHash("sha256");
  if (hash !== null) {
    input.on("data", (chunk: string | Buffer) => { hash.update(chunk); });
  }
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });
  let lineNumber = 0;
  let completed = false;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.trim() === "") continue;
      try {
        yield JSON.parse(line) as T;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid NDJSON at ${path}:${lineNumber}: ${detail}`);
      }
    }
    completed = true;
  } finally {
    if (!completed) input.destroy();
  }
  if (hash !== null) options.onSha256!(hash.digest("hex"));
}

export async function* readJsonArray<T>(path: string): AsyncGenerator<T> {
  const values = createReadStream(path)
    .pipe(parserStream())
    .pipe(streamArray.asStream()) as AsyncIterable<{ value: T }>;
  for await (const item of values) yield item.value;
}

export async function* readNestedJsonArray<T>(path: string, key: string): AsyncGenerator<T> {
  const values = createReadStream(path)
    .pipe(parserStream())
    .pipe(pick.asStream({ filter: key }))
    .pipe(streamArray.asStream()) as AsyncIterable<{ value: T }>;
  for await (const item of values) yield item.value;
}
