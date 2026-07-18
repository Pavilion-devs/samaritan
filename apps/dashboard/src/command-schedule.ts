function windowDistance(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Describes clock position relative to a configured capture window without
 * claiming that the frozen export reflects a live recorder process.
 */
export function frozenCaptureWindowLabel(
  captureStartUtc: string,
  captureEndUtc: string,
  browserNowMs: number
): string {
  const startMs = Date.parse(captureStartUtc);
  const endMs = Date.parse(captureEndUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !Number.isFinite(browserNowMs)) {
    return "Frozen export · configured timing unavailable";
  }
  if (browserNowMs < startMs) {
    return `Frozen export · browser clock: window in ${windowDistance(startMs - browserNowMs)}`;
  }
  if (browserNowMs < endMs) {
    return "Frozen export · browser clock is inside configured window";
  }
  if (browserNowMs === endMs) return "Frozen export · browser clock: window just ended";
  return `Frozen export · browser clock: window ended ${windowDistance(browserNowMs - endMs)} ago`;
}
