/**
 * Unit tests for time formatting — the numbers moderators stare at all day.
 * Edge cases (zero, sub-minute, multi-hour, non-finite) are the ones that
 * used to render as "NaN:NaN" in earlier drafts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTime, formatDelta } from "./format.js";

describe("formatTime", () => {
  it("formats sub-minute times as M:SS.mmm", () => {
    assert.equal(formatTime(12_345), "0:12.345");
  });

  it("formats multi-minute times without a leading hour", () => {
    // 1:02.003
    assert.equal(formatTime(62_003), "1:02.003");
  });

  it("formats multi-hour times as H:MM:SS.mmm", () => {
    // 1:00:00.000
    assert.equal(formatTime(3_600_000), "1:00:00.000");
  });

  it("pads millis to three digits", () => {
    assert.equal(formatTime(1_001), "0:01.001");
    assert.equal(formatTime(1_010), "0:01.010");
    assert.equal(formatTime(1_100), "0:01.100");
  });

  it("returns an em-dash for non-finite or negative input", () => {
    assert.equal(formatTime(Number.NaN), "—");
    assert.equal(formatTime(Number.POSITIVE_INFINITY), "—");
    assert.equal(formatTime(-1), "—");
  });

  it("handles zero", () => {
    assert.equal(formatTime(0), "0:00.000");
  });
});

describe("formatDelta", () => {
  it("renders WR for zero delta", () => {
    assert.equal(formatDelta(0), "WR");
  });

  it("prefixes + for times slower than WR and − for faster", () => {
    assert.equal(formatDelta(1_000), "+0:01.000");
    assert.equal(formatDelta(-1_000), "−0:01.000");
  });

  it("returns an em-dash for null", () => {
    assert.equal(formatDelta(null), "—");
  });
});
