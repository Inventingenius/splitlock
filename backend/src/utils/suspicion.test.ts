/**
 * Unit tests for the suspicion model.
 *
 * These lock in the threshold math and severity weights so a future change
 * to WR ratios or frame tolerance cannot silently re-rank the queue.
 * Run: npm test  (from backend/)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSuspicion,
  suspicionScore,
  FRAME_TOLERANCE_MS,
  type SuspicionInput,
} from "./suspicion.js";

function base(over: Partial<SuspicionInput> = {}): SuspicionInput {
  return {
    timeMs: 1_000_000,
    wrMs: 1_000_000,
    prevPbMs: null,
    cloneCount: 0,
    emulator: false,
    platform: "N64",
    gamePlatform: "N64",
    rejectedCount: 0,
    videoUrl: "https://example.com/vod",
    comment: null,
    ...over,
  };
}

describe("FRAME_TOLERANCE_MS", () => {
  it("is one NTSC frame (±1ms)", () => {
    assert.equal(FRAME_TOLERANCE_MS, 16);
  });
});

describe("computeSuspicion — WR ratio bands", () => {
  it("flags impossible-wr (crit) when time is >8% under the verified WR", () => {
    // ratio = 0.90 → 10% faster than WR
    const flags = computeSuspicion(base({ timeMs: 900_000, wrMs: 1_000_000 }));
    const hit = flags.find((f) => f.code === "impossible-wr");
    assert.ok(hit);
    assert.equal(hit!.severity, "crit");
  });

  it("flags wr-threat (warn) in the 1.5–8% under-WR band", () => {
    // ratio = 0.97 → 3% faster
    const flags = computeSuspicion(base({ timeMs: 970_000, wrMs: 1_000_000 }));
    assert.ok(flags.some((f) => f.code === "wr-threat"));
    assert.ok(!flags.some((f) => f.code === "impossible-wr"));
  });

  it("stays quiet when at or slower than WR", () => {
    const flags = computeSuspicion(base({ timeMs: 1_050_000, wrMs: 1_000_000 }));
    assert.ok(!flags.some((f) => f.code === "impossible-wr" || f.code === "wr-threat"));
  });

  it("skips WR checks when wrMs is null or zero", () => {
    assert.ok(!computeSuspicion(base({ wrMs: null })).some((f) => f.code.startsWith("wr") || f.code === "impossible-wr"));
    assert.ok(!computeSuspicion(base({ wrMs: 0 })).some((f) => f.code === "impossible-wr"));
  });
});

describe("computeSuspicion — PB spike", () => {
  it("flags spike when improvement exceeds 22% of prior PB", () => {
    // 30% drop: (1e6 - 700k) / 1e6 = 0.30
    const flags = computeSuspicion(
      base({ timeMs: 700_000, prevPbMs: 1_000_000, wrMs: 600_000 })
    );
    assert.ok(flags.some((f) => f.code === "spike"));
  });

  it("does not flag a modest PB improvement", () => {
    // 10% drop
    const flags = computeSuspicion(
      base({ timeMs: 900_000, prevPbMs: 1_000_000, wrMs: 800_000 })
    );
    assert.ok(!flags.some((f) => f.code === "spike"));
  });
});

describe("computeSuspicion — clones, emu, history, vod, comment", () => {
  it("flags frame-clone when cloneCount > 0", () => {
    const flags = computeSuspicion(base({ cloneCount: 2 }));
    const hit = flags.find((f) => f.code === "clone");
    assert.ok(hit);
    assert.equal(hit!.severity, "crit");
    assert.match(hit!.detail, new RegExp(String(FRAME_TOLERANCE_MS)));
  });

  it("flags emulator on a non-PC board", () => {
    const flags = computeSuspicion(
      base({ emulator: true, platform: "Emulator", gamePlatform: "N64" })
    );
    assert.ok(flags.some((f) => f.code === "emu"));
  });

  it("does not flag emulator on a PC board", () => {
    const flags = computeSuspicion(
      base({ emulator: true, platform: "PC", gamePlatform: "PC" })
    );
    assert.ok(!flags.some((f) => f.code === "emu"));
  });

  it("escalates reject history at 1 (info) and 3+ (warn)", () => {
    const soft = computeSuspicion(base({ rejectedCount: 1 }));
    assert.ok(soft.some((f) => f.code === "history-soft" && f.severity === "info"));

    const hard = computeSuspicion(base({ rejectedCount: 3 }));
    assert.ok(hard.some((f) => f.code === "history" && f.severity === "warn"));
    assert.ok(!hard.some((f) => f.code === "history-soft"));
  });

  it("flags missing VOD", () => {
    const flags = computeSuspicion(base({ videoUrl: null }));
    assert.ok(flags.some((f) => f.code === "no-vod"));
  });

  it("flags cheat-language in the submission comment", () => {
    const flags = computeSuspicion(base({ comment: "used a TAS tool for practice" }));
    const hit = flags.find((f) => f.code === "comment");
    assert.ok(hit);
    assert.equal(hit!.severity, "crit");
  });
});

describe("suspicionScore", () => {
  it("weights crit=10, warn=4, info=1", () => {
    const flags = computeSuspicion(
      base({
        timeMs: 900_000, // crit impossible-wr
        wrMs: 1_000_000,
        cloneCount: 1, // crit clone
        rejectedCount: 1, // info history-soft
        videoUrl: null, // warn no-vod
      })
    );
    // 10 + 10 + 1 + 4 = 25
    assert.equal(suspicionScore(flags), 25);
  });

  it("returns 0 for a clean submission", () => {
    // Slightly slower than WR, has VOD, no history, no clones
    const flags = computeSuspicion(base({ timeMs: 1_100_000, wrMs: 1_000_000 }));
    assert.equal(flags.length, 0);
    assert.equal(suspicionScore(flags), 0);
  });
});
