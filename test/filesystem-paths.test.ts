import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDistinctFilesystemPaths } from "../src/domain/filesystem-paths.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("filesystem path identity", () => {
  it("rejects two existing names that are hard links to the same object", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-path-hardlink-"));
    directories.push(directory);
    const first = join(directory, "first.sqlite");
    const second = join(directory, "second.sqlite");
    writeFileSync(first, "sealed\n");
    linkSync(first, second);

    await expect(assertDistinctFilesystemPaths([first, second], "Persistent ledger"))
      .rejects.toThrow(/hard links/);
  });

  it("rejects case-fold aliases before either output exists", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-path-case-"));
    directories.push(directory);

    await expect(assertDistinctFilesystemPaths([
      join(directory, "Spend.sqlite"),
      join(directory, "spend.sqlite")
    ], "Persistent ledger")).rejects.toThrow(/paths must be distinct/);
  });
});
