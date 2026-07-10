import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import parserStream from "stream-json";
import pick from "stream-json/filters/pick.js";
import streamArray from "stream-json/streamers/stream-array.js";

export async function* readNdjson<T>(path: string): AsyncGenerator<T> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let lineNumber = 0;
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
