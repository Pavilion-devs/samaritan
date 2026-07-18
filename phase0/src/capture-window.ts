export type AbsoluteCaptureWindow = {
  startUtc: string;
  endUtc: string;
  startTsMs: number;
  endTsMs: number;
  maxStartupSkewSeconds: number;
};

export function parseAbsoluteCaptureWindow(options: {
  startUtc?: string;
  endUtc?: string;
  maxStartupSkewSeconds: number;
}): AbsoluteCaptureWindow | null {
  if (!options.startUtc && !options.endUtc) return null;
  if (!options.startUtc || !options.endUtc) {
    throw new Error("Absolute capture window requires both --capture-start-utc and --capture-end-utc");
  }
  const startTsMs = Date.parse(options.startUtc);
  const endTsMs = Date.parse(options.endUtc);
  if (!Number.isFinite(startTsMs) || !Number.isFinite(endTsMs) || endTsMs <= startTsMs) {
    throw new Error("Absolute capture window is invalid");
  }
  if (!Number.isInteger(options.maxStartupSkewSeconds) || options.maxStartupSkewSeconds <= 0) {
    throw new Error("Absolute capture window requires a positive integer startup skew");
  }
  return {
    startUtc: new Date(startTsMs).toISOString(),
    endUtc: new Date(endTsMs).toISOString(),
    startTsMs,
    endTsMs,
    maxStartupSkewSeconds: options.maxStartupSkewSeconds
  };
}

export function captureStartupFailure(window: AbsoluteCaptureWindow, nowTsMs: number): string | undefined {
  if (nowTsMs >= window.endTsMs) return "Absolute capture window ended before streams started";
  const skewMs = nowTsMs - window.startTsMs;
  if (skewMs > window.maxStartupSkewSeconds * 1_000) {
    return `Capture streams started ${skewMs}ms after the reviewed window opened`;
  }
  return undefined;
}
