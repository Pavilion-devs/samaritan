import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export type FilesystemPathIdentity = {
  requestedPath: string;
  canonicalPath: string;
  comparisonKey: string;
  inodeKey: string | null;
};

/**
 * Resolve every existing symlink component without requiring the final path or
 * its parent to exist. Broken symlink components fail closed.
 */
export async function canonicalFilesystemPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await lstat(cursor)).isSymbolicLink()) {
          throw new Error(`Refusing broken symlink path: ${path}`);
        }
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error(`Cannot canonicalize path: ${path}`);
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function inodeKey(path: string): Promise<string | null> {
  try {
    const metadata = await stat(path, { bigint: true });
    return `${metadata.dev}:${metadata.ino}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function filesystemPathIdentity(path: string): Promise<FilesystemPathIdentity> {
  const canonicalPath = await canonicalFilesystemPath(path);
  return {
    requestedPath: path,
    canonicalPath,
    // Conservative on case-sensitive filesystems, correct on default APFS and
    // Windows, and deterministic for two not-yet-created output paths.
    comparisonKey: canonicalPath.normalize("NFC").toLocaleLowerCase("en-US"),
    inodeKey: await inodeKey(canonicalPath)
  };
}

/** Reject string aliases, symlink aliases, case-fold aliases, and hard links. */
export async function assertDistinctFilesystemPaths(
  paths: readonly string[],
  label: string
): Promise<string[]> {
  const identities = await Promise.all(paths.map(filesystemPathIdentity));
  const comparisonKeys = new Set<string>();
  const inodeKeys = new Set<string>();
  for (const identity of identities) {
    if (comparisonKeys.has(identity.comparisonKey)) {
      throw new Error(`${label} paths must be distinct`);
    }
    comparisonKeys.add(identity.comparisonKey);
    if (identity.inodeKey !== null) {
      if (inodeKeys.has(identity.inodeKey)) {
        throw new Error(`${label} paths must not be hard links to the same filesystem object`);
      }
      inodeKeys.add(identity.inodeKey);
    }
  }
  return identities.map((identity) => identity.canonicalPath);
}

/** Require the canonical target to remain inside the canonical root. */
export async function assertFilesystemPathWithin(
  path: string,
  root: string,
  label: string
): Promise<void> {
  const [canonicalPath, canonicalRoot] = await Promise.all([
    canonicalFilesystemPath(path),
    canonicalFilesystemPath(root)
  ]);
  const suffix = relative(canonicalRoot, canonicalPath);
  if (suffix === "" || suffix.startsWith("..") || isAbsolute(suffix)) {
    throw new Error(`${label} must be a descendant of ${root}`);
  }
}
