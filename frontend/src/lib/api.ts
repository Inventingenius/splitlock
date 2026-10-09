const MOD_KEY = "splitlock.moderatorId";

export function getModeratorId(): string {
  return localStorage.getItem(MOD_KEY) || "mod-alice";
}

export function setModeratorId(id: string) {
  localStorage.setItem(MOD_KEY, id);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Moderator-Id": getModeratorId(),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  // CSV export returns text
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/csv")) {
    return (await res.text()) as unknown as T;
  }
  return res.json();
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  moderators: () => request<Moderator[]>("/api/moderators"),
  me: () => request<Moderator>("/api/moderators/me"),
  games: () => request<GameSummary[]>("/api/games"),
  game: (slug: string) => request<GameDetail>(`/api/games/${slug}`),
  leaderboard: (slug: string, params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return request<Leaderboard>(`/api/leaderboard/${slug}?${qs}`);
  },
  exportLeaderboard: (slug: string, params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    return request<string>(`/api/leaderboard/${slug}/export?${qs}`);
  },
  run: (id: number) => request<RunDetail>(`/api/runs/${id}`),
  approve: (id: number, note?: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  reject: (id: number, note: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  reopen: (id: number, note?: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}/reopen`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  queue: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return request<QueueResult>(`/api/queue?${qs}`);
  },
  runner: (id: number) => request<RunnerDetail>(`/api/runners/${id}`),
  ban: (id: number, reason: string) =>
    request<{ ok: boolean }>(`/api/runners/${id}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  unban: (id: number, reason?: string) =>
    request<{ ok: boolean }>(`/api/runners/${id}/unban`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};

// Types
export interface Moderator {
  id: string;
  name: string;
  handle: string;
  title: string;
  games?: { id: number; name: string; slug: string }[];
  gameIds?: number[];
}

export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  short_name: string;
  year: number;
  platform: string;
  genre: string;
  hue: number;
  category_count: number;
  verified_count: number;
  pending_count: number;
}

export interface GameDetail {
  id: number;
  slug: string;
  name: string;
  short_name: string;
  year: number;
  platform: string;
  genre: string;
  hue: number;
  categories: {
    id: number;
    slug: string;
    name: string;
    rules: string;
    verified_count: number;
    wr_ms: number | null;
  }[];
}

export interface Leaderboard {
  game: { id: number; name: string; slug: string; platform: string };
  category: { id: number; slug: string; name: string; rules: string };
  categories: { id: number; slug: string; name: string; rules: string }[];
  page: number;
  pageSize: number;
  total: number;
  wrMs: number | null;
  entries: {
    rank: number;
    runId: number;
    timeMs: number;
    deltaMs: number | null;
    platform: string;
    emulator: boolean;
    videoUrl: string | null;
    submittedAt: string;
    verifiedAt: string | null;
    runner: { id: number; name: string; country: string };
  }[];
}

export interface SuspicionFlag {
  code: string;
  severity: "info" | "warn" | "crit";
  label: string;
  detail: string;
}

export interface RunDetail {
  id: number;
  timeMs: number;
  status: string;
  platform: string;
  emulator: boolean;
  videoUrl: string | null;
  comment: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  game: { id: number; name: string; slug: string; platform: string };
  category: { id: number; name: string; slug: string };
  runner: { id: number; name: string; country: string; banned: boolean };
  splits: { checkpoint: string; timeMs: number; orderIndex: number }[];
  reviews: {
    id: number;
    action: string;
    note: string | null;
    createdAt: string;
    moderator: { id: string; name: string | null; handle: string | null } | null;
  }[];
  suspicion: { score: number; flags: SuspicionFlag[] };
}

export interface QueueResult {
  total: number;
  page: number;
  pageSize: number;
  items: {
    id: number;
    timeMs: number;
    platform: string;
    emulator: boolean;
    videoUrl: string | null;
    comment: string | null;
    submittedAt: string;
    game: { id: number; name: string; slug: string };
    category: { id: number; name: string };
    runner: { id: number; name: string; country: string };
    suspicion: { score: number; flags: SuspicionFlag[] };
  }[];
}

export interface RunnerDetail {
  id: number;
  name: string;
  country: string;
  joinedAt: string;
  banned: boolean;
  stats: { total: number; verified: number; pending: number; rejected: number };
  runs: {
    id: number;
    timeMs: number;
    status: string;
    platform: string;
    submittedAt: string;
    game: { name: string; slug: string };
    category: { name: string };
  }[];
  bans: {
    id: number;
    reason: string;
    createdAt: string;
    liftedAt: string | null;
    liftReason: string | null;
    moderatorName: string;
    liftedByName: string | null;
  }[];
}
