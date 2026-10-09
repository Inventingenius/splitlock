/**
 * Format milliseconds as H:MM:SS.mmm or M:SS.mmm.
 * Non-finite / negative inputs render as an em-dash so a bad row can never
 * paint "NaN:NaN.NaN" into a moderator's queue.
 */
export function formatTime(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const totalMs = Math.round(ms);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
  }
  return `${minutes}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Delta vs WR. null → "—", 0 → "WR", else signed formatted time. */
export function formatDelta(ms: number | null): string {
  if (ms == null) return "—";
  if (ms === 0) return "WR";
  const sign = ms > 0 ? "+" : "−";
  return sign + formatTime(Math.abs(ms));
}
