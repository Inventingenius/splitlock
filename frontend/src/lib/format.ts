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

export function formatDelta(ms: number | null): string {
  if (ms == null) return "—";
  if (ms === 0) return "WR";
  const sign = ms > 0 ? "+" : "−";
  return sign + formatTime(Math.abs(ms));
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
