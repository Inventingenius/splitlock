import { formatTime } from "./format.js";

/**
 * Suspicion scoring for the moderation queue.
 *
 * Design goals:
 *  - Pure function of cheap scalars (no I/O) so it is unit-testable and
 *    safe to run on every queue page render.
 *  - Thresholds are intentionally conservative: false positives cost a
 *    moderator a few seconds of review; false negatives let cheaters through.
 *  - Score is a simple weighted sum of severities so the queue can ORDER BY
 *    it in application space without a persisted column (good enough at
 *    tens of thousands of pending rows; materialize if that grows 10×).
 *
 * Timing constants:
 *  - NTSC frame ≈ 16.67ms. Two runs within 16ms on the same board are
 *    treated as a possible frame-clone / stolen encode.
 *  - WR ratio bands (0.92 / 0.985) come from observed legitimate PB
 *    distributions on long-lived boards — sub-8% improvements on a stable
 *    WR are almost always TAS or a rules violation.
 */

export type FlagSeverity = "info" | "warn" | "crit";

export interface SuspicionFlag {
  code: string;
  severity: FlagSeverity;
  label: string;
  detail: string;
}

export interface SuspicionInput {
  timeMs: number;
  wrMs: number | null;
  /** Runner's previous verified PB on this category, if any. */
  prevPbMs: number | null;
  /** Count of other verified runs within FRAME_TOLERANCE_MS of this time. */
  cloneCount: number;
  emulator: boolean;
  platform: string;
  gamePlatform: string;
  rejectedCount: number;
  videoUrl: string | null;
  comment: string | null;
}

/** ~1 NTSC frame. Used as the clone-detection window. */
export const FRAME_TOLERANCE_MS = 16;

/** time / WR below this → almost certainly impossible on a mature board. */
const WR_IMPOSSIBLE_RATIO = 0.92;
/** time / WR below this → WR threat; deserves human eyes on the encode. */
const WR_THREAT_RATIO = 0.985;
/** Relative PB improvement that triggers an "overnight spike" flag. */
const PB_SPIKE_RATIO = 0.22;

const SEVERITY_WEIGHT: Record<FlagSeverity, number> = {
  crit: 10,
  warn: 4,
  info: 1,
};

const CHEAT_RE =
  /\b(tas|tool[- ]?assisted|cheat|hack|savestate|memory\s*edit)\b/i;

export function computeSuspicion(input: SuspicionInput): SuspicionFlag[] {
  const flags: SuspicionFlag[] = [];

  if (input.wrMs && input.wrMs > 0) {
    const ratio = input.timeMs / input.wrMs;
    if (ratio < WR_IMPOSSIBLE_RATIO) {
      flags.push({
        code: "impossible-wr",
        severity: "crit",
        label: "Implausibly fast",
        detail: `${formatTime(input.timeMs)} vs verified WR ${formatTime(input.wrMs)} (${Math.round((1 - ratio) * 100)}% faster).`,
      });
    } else if (ratio < WR_THREAT_RATIO) {
      flags.push({
        code: "wr-threat",
        severity: "warn",
        label: "World record threat",
        detail: `${((1 - ratio) * 100).toFixed(1)}% faster than the current verified WR. Confirm encode + input.`,
      });
    }
  }

  if (input.prevPbMs && input.prevPbMs > 0) {
    // Relative improvement: (old - new) / old. Large single-step drops on a
    // stable board are a classic signal for tool-assist or a category error.
    const drop = (input.prevPbMs - input.timeMs) / input.prevPbMs;
    if (drop > PB_SPIKE_RATIO) {
      flags.push({
        code: "spike",
        severity: "warn",
        label: "Overnight spike",
        detail: `Improves the runner's verified PB (${formatTime(input.prevPbMs)}) by ${Math.round(drop * 100)}%.`,
      });
    }
  }

  if (input.cloneCount > 0) {
    flags.push({
      code: "clone",
      severity: "crit",
      label: "Frame-clone time",
      detail: `${input.cloneCount} other run(s) on this board land within ${FRAME_TOLERANCE_MS}ms. Possible stolen encode.`,
    });
  }

  if (input.emulator && input.gamePlatform !== "PC") {
    flags.push({
      code: "emu",
      severity: "warn",
      label: "Emulator on a console board",
      detail: `Submitted as ${input.platform} with emulator=true. Board hardware is ${input.gamePlatform}.`,
    });
  }

  if (input.rejectedCount >= 3) {
    flags.push({
      code: "history",
      severity: "warn",
      label: "Repeat rejects",
      detail: `${input.rejectedCount} rejected submissions on file for this runner.`,
    });
  } else if (input.rejectedCount >= 1) {
    flags.push({
      code: "history-soft",
      severity: "info",
      label: "Prior reject",
      detail: `${input.rejectedCount} earlier reject(s). Read the last review before verifying.`,
    });
  }

  if (!input.videoUrl) {
    flags.push({
      code: "no-vod",
      severity: "warn",
      label: "Missing VOD",
      detail: "No video URL. Site policy requires a full encode or stream VOD.",
    });
  }

  if (input.comment && CHEAT_RE.test(input.comment)) {
    flags.push({
      code: "comment",
      severity: "crit",
      label: "Comment names a cheat tool",
      detail: `Submission comment: “${input.comment}”.`,
    });
  }

  return flags;
}

/** Weighted severity sum — higher means review first. */
export function suspicionScore(flags: SuspicionFlag[]): number {
  return flags.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
}
