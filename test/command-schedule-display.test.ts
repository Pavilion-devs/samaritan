import { describe, expect, it } from "vitest";
import { frozenCaptureWindowLabel } from "../apps/dashboard/src/command-schedule.js";

const start = "2026-07-18T18:00:00.000Z";
const end = "2026-07-19T00:00:00.000Z";

describe("frozen command schedule timing", () => {
  it("uses the browser clock without presenting frozen status as live state", () => {
    expect(frozenCaptureWindowLabel(start, end, Date.parse("2026-07-18T16:30:00.000Z"))).toBe(
      "Frozen export · browser clock: window in 1h 30m"
    );
    expect(frozenCaptureWindowLabel(start, end, Date.parse("2026-07-18T21:00:00.000Z"))).toBe(
      "Frozen export · browser clock is inside configured window"
    );
    expect(frozenCaptureWindowLabel(start, end, Date.parse("2026-07-19T01:30:00.000Z"))).toBe(
      "Frozen export · browser clock: window ended 1h 30m ago"
    );
  });

  it("fails to a frozen timing label when the configured window is invalid", () => {
    expect(frozenCaptureWindowLabel("invalid", end, Date.parse(end))).toBe(
      "Frozen export · configured timing unavailable"
    );
    expect(frozenCaptureWindowLabel(start, start, Date.parse(start))).toBe(
      "Frozen export · configured timing unavailable"
    );
  });
});
